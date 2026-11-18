/* ============================================================
   3D 粒子圣诞树 · 粒子告白 —— 主逻辑
   全部视觉均为 Three.js 3D 发光粒子，无任何可见文字渲染。
   「I LOVE YOU LILI」只出现在下方 LOVE_TEXT 常量与离屏采样中。
   ============================================================ */

'use strict';

/* ---------- 可修改参数 ---------- */
const LOVE_TEXT_LINE1 = 'I LOVE YOU';      // 竖屏第一行文字
const LOVE_TEXT_LINE2 = 'LILI';            // 竖屏第二行文字
const LOVE_TEXT_FULL = 'I LOVE YOU LILI';  // 横屏单行文字

const CONFIG = {
  particleCount: 12000,      // 桌面粒子总数
  particleCountMid: 9500,    // 宽度 < 768px 或核心数 ≤ 4
  particleCountSmall: 7800,  // 宽度 < 420px
  ambientStars: 0.14,        // 背景星星占比（不参与变形）
  morphK: 6.0,               // 变形跟随速度
  colorK: 4.0,               // 颜色过渡速度
  morphHoldMax: 0.85,        // 粒子延迟出发的最大时长（秒）
  cameraZ: { stars: 30, tree: 23, love: 19 },
  treeRotSpeed: 0.16,        // 圣诞树自转速度
  bg: 0x050d16,
};

const PALETTE = {
  // 参考图青蓝冷色调：暗青 → 亮青 → 冰白高光
  stars: [0xffffff, 0xd8f6ff, 0xa8d8ff, 0x7fe8e0, 0xc8e8ff],
  treeGreenA: [0.02, 0.20, 0.28],   // 深青
  treeGreenB: [0.14, 0.85, 0.78],   // 亮青绿
  treeEdge:   [0.62, 1.0, 0.98],    // 树冠边缘高光（冰青）
  decorations: [0xf0ffff, 0x4de8ff, 0x9fe8ff, 0x7fd8ff, 0xb8fff2],
  trunk: [0.14, 0.26, 0.30],
  starTop: [0.78, 1.0, 0.98],
  textA: [0.90, 1.0, 1.0],          // 文字近白
  textB: [0.42, 0.92, 1.0],         // 文字青
  heartA: [0.10, 0.68, 1.0],        // 爱心深天蓝
  heartB: [0.75, 0.97, 1.0],        // 爱心冰蓝白
  ambientLove: [0x7fe8ff, 0xb8e8ff, 0xd8ffff, 0x9fb8ff],
  burst: [0xd8ffff, 0x7fe8ff, 0xffffff, 0x9fe0ff, 0xb8fff2],
};

/* ---------- 轻量模式（自动化测试/低端设备 ?light=1） ---------- */
const LIGHT = /[?&]light=1/.test(location.search);

/* ---------- 基础环境 ---------- */
const canvas = document.getElementById('scene');
const hint1 = document.getElementById('hint');
const hint2 = document.getElementById('hint2');
const bgm = document.getElementById('bgm');

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: !LIGHT, alpha: false });
} catch (e) {
  hint1.textContent = '当前浏览器不支持 WebGL，请用新版浏览器打开';
  throw e;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

// WebGL 上下文意外丢失时阻止默认销毁，three.js 会自动恢复
canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); });

const scene = new THREE.Scene();
scene.background = new THREE.Color(CONFIG.bg);

const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 200);
camera.position.set(0, 1.2, CONFIG.cameraZ.stars);

/* ---------- 粒子规模自适应 ---------- */
const isMobile = window.innerWidth < 768 || (navigator.hardwareConcurrency || 8) <= 4;
const isSmall = window.innerWidth < 420;
let TOTAL = isSmall ? CONFIG.particleCountSmall : (isMobile ? CONFIG.particleCountMid : CONFIG.particleCount);
if (LIGHT) TOTAL = Math.floor(TOTAL * 0.3);
const N_AMBIENT = Math.floor(TOTAL * CONFIG.ambientStars);
const N_STAGE = TOTAL - N_AMBIENT;

/* ---------- 粒子缓冲区 ---------- */
const pos = new Float32Array(N_STAGE * 3);
const col = new Float32Array(N_STAGE * 3);
const size = new Float32Array(N_STAGE);
const twPhase = new Float32Array(N_STAGE);
const holdPos = new Float32Array(N_STAGE * 3);
const holdUntil = new Float32Array(N_STAGE);
const burstUntil = new Float32Array(N_STAGE);
const burstBase = new Float32Array(N_STAGE * 3);
const burstDir = new Float32Array(N_STAGE * 3);
const heartOff = new Float32Array(N_STAGE * 3);

let tgtPosTree = null, tgtColTree = null, tgtPosLove = null, tgtColLove = null;
let textN = 0, heartN = 0;
let heartCenterY = 0;

/* ---------- 星空（独立 Points） ---------- */
function buildStars() {
  const n = N_AMBIENT;
  const p = new Float32Array(n * 3);
  const c = new Float32Array(n * 3);
  const s = new Float32Array(n);
  const ph = new Float32Array(n);
  const cols = PALETTE.stars.map(v => new THREE.Color(v));
  for (let i = 0; i < n; i++) {
    const r = 16 + Math.random() * 34;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    p[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    p[i * 3 + 1] = r * Math.cos(phi) * 0.85;
    p[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    const cc = cols[Math.floor(Math.random() * cols.length)];
    c[i * 3] = cc.r; c[i * 3 + 1] = cc.g; c[i * 3 + 2] = cc.b;
    s[i] = 0.9 + Math.random() * 1.4;
    ph[i] = Math.random() * Math.PI * 2;
  }
  return { p, c, s, ph };
}

/* ---------- 圣诞树目标 ---------- */
function buildTreeTargets() {
  const p = new Float32Array(N_STAGE * 3);
  const c = new Float32Array(N_STAGE * 3);
  const H = 11, BASE = -2, R = 4.4;
  const cA = new THREE.Color().fromArray(PALETTE.treeGreenA);
  const cB = new THREE.Color().fromArray(PALETTE.treeGreenB);
  const cE = new THREE.Color().fromArray(PALETTE.treeEdge);
  const cT = new THREE.Color().fromArray(PALETTE.trunk);
  const cS = new THREE.Color().fromArray(PALETTE.starTop);
  const deco = PALETTE.decorations.map(v => new THREE.Color(v));
  let idx = 0;

  // 树干 4%
  const trunkN = Math.floor(N_STAGE * 0.04);
  for (let i = 0; i < trunkN && idx < N_STAGE; i++, idx++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * 0.85;
    p[idx * 3] = Math.cos(a) * r;
    p[idx * 3 + 1] = BASE + Math.random() * 2.6;
    p[idx * 3 + 2] = Math.sin(a) * r;
    const sh = 0.75 + Math.random() * 0.25;
    c[idx * 3] = cT.r * sh; c[idx * 3 + 1] = cT.g * sh; c[idx * 3 + 2] = cT.b * sh;
  }
  // 树顶星 2%
  const starN = Math.floor(N_STAGE * 0.02);
  for (let i = 0; i < starN && idx < N_STAGE; i++, idx++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.pow(Math.random(), 0.5) * 0.55;
    p[idx * 3] = Math.cos(a) * r;
    p[idx * 3 + 1] = 11.0 + Math.random() * 0.9;
    p[idx * 3 + 2] = Math.sin(a) * r;
    c[idx * 3] = cS.r; c[idx * 3 + 1] = cS.g; c[idx * 3 + 2] = cS.b;
  }
  // 装饰灯 5%
  const decoN = Math.floor(N_STAGE * 0.05);
  for (let i = 0; i < decoN && idx < N_STAGE; i++, idx++) {
    const y = BASE + Math.random() * H;
    const rr = R * (1 - y / H) + 0.08;
    const a = Math.random() * Math.PI * 2;
    p[idx * 3] = Math.cos(a) * rr * 0.96;
    p[idx * 3 + 1] = y;
    p[idx * 3 + 2] = Math.sin(a) * rr * 0.96;
    const cc = deco[Math.floor(Math.random() * deco.length)];
    c[idx * 3] = cc.r; c[idx * 3 + 1] = cc.g; c[idx * 3 + 2] = cc.b;
  }
  // 树冠主体（螺旋锥体 + 内部填充）
  while (idx < N_STAGE) {
    const y = Math.pow(Math.random(), 0.8) * H + BASE;
    const rr = R * (1 - (y - BASE) / H);
    const a = y * 3.1 + Math.random() * 1.6;
    const inner = Math.random() < 0.3;
    const rad = inner ? rr * (0.25 + Math.random() * 0.55) : rr * (0.86 + Math.random() * 0.16);
    p[idx * 3] = Math.cos(a) * rad;
    p[idx * 3 + 1] = y;
    p[idx * 3 + 2] = Math.sin(a) * rad;
    const t = (y - BASE) / H;
    let cc;
    if (!inner && Math.random() < 0.16) {
      cc = cE; // 边缘高光
    } else {
      cc = new THREE.Color().lerpColors(cA, cB, 0.25 + t * 0.5 + Math.random() * 0.25);
    }
    const sh = 0.8 + Math.random() * 0.4;
    c[idx * 3] = cc.r * sh; c[idx * 3 + 1] = cc.g * sh; c[idx * 3 + 2] = cc.b * sh;
    idx++;
  }
  return { p, c };
}

/* ---------- 文字粒子采样（离屏 canvas，仅作采样模板） ---------- */
function sampleTextPoints(text, fontSize, maxPoints) {
  const off = document.createElement('canvas');
  const ctx = off.getContext('2d', { willReadFrequently: true });
  const font = `900 ${fontSize}px "Arial Black", Arial, "PingFang SC", "Microsoft YaHei", sans-serif`;
  ctx.font = font;
  const m = ctx.measureText(text);
  const W = Math.max(24, Math.ceil(m.width) + 24);
  const H = Math.ceil(fontSize * 1.35);
  off.width = W; off.height = H;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#fff';
  ctx.font = font;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(text, 12, H / 2 + fontSize * 0.05);
  const img = ctx.getImageData(0, 0, W, H).data;
  const pts = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (img[(y * W + x) * 4 + 3] > 120) pts.push(x, y);
    }
  }
  const n0 = pts.length / 2;
  if (n0 === 0) return { pts: new Float32Array(0), W, H };
  if (n0 > maxPoints) {
    const step = n0 / maxPoints;
    const out = [];
    for (let k = 0; k < n0; k++) {
      if (k % step < 1) out.push(pts[k * 2], pts[k * 2 + 1]);
    }
    return { pts: new Float32Array(out), W, H };
  }
  return { pts: new Float32Array(pts), W, H };
}

/* ---------- 爱心粒子 ---------- */
function buildHeartPoints(n) {
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    let x, y;
    if (Math.random() < 0.45) { // 轮廓
      const t = Math.random() * Math.PI * 2;
      x = 16 * Math.pow(Math.sin(t), 3) / 16;
      y = (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) / 16;
    } else { // 内部填充（隐式方程拒绝采样）
      for (let k = 0; k < 8; k++) {
        x = (Math.random() * 2 - 1) * 1.15;
        y = Math.random() * 1.75 - 1.05;
        if (Math.pow(x * x + y * y - 1, 3) - x * x * y * y * y <= 0) break;
      }
    }
    const z = (Math.random() - 0.5) * 0.5;
    out[i * 3] = x;
    out[i * 3 + 1] = -y; // 翻转 y（屏幕向上）
    out[i * 3 + 2] = z;
  }
  return out;
}

/* ---------- 恋爱阶段目标（文字 + 爱心 + 氛围粒子） ---------- */
function buildLoveTargets() {
  const p = new Float32Array(N_STAGE * 3);
  const c = new Float32Array(N_STAGE * 3);
  const aspect = camera.aspect;
  const zL = CONFIG.cameraZ.love * (aspect < 0.75 ? 1.22 : 1);
  const vH = 2 * zL * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const vW = vH * aspect;

  const portrait = aspect < 0.75;
  const worldTextW = Math.min(vW * 0.92, 16);

  // 采样文字
  let s1, s2 = null;
  if (portrait) {
    s1 = sampleTextPoints(LOVE_TEXT_LINE1, 150, Math.floor(N_STAGE * 0.36));
    s2 = sampleTextPoints(LOVE_TEXT_LINE2, 260, Math.floor(N_STAGE * 0.20));
  } else {
    s1 = sampleTextPoints(LOVE_TEXT_FULL, 180, Math.floor(N_STAGE * 0.56));
  }
  const totalPts = (s1.pts.length + (s2 ? s2.pts.length : 0)) / 2;
  textN = totalPts;

  // 爱心数量：剩余粒子的 30%
  const remain = N_STAGE - textN;
  heartN = Math.floor(remain * 0.3);

  // 计算布局尺寸
  const scl1 = (worldTextW * (portrait ? 0.98 : 1)) / s1.W;
  let h1 = s1.H * scl1;
  let h2 = 0, scl2 = 0;
  if (s2) {
    scl2 = (worldTextW * 0.6) / s2.W;
    h2 = s2.H * scl2;
  }
  let hh = THREE.MathUtils.clamp(vH * 0.24, 2.4, 4.4);
  const gap = 0.95, gap2 = 0.4;
  let total = hh + gap + h1 + (s2 ? gap2 + h2 : 0);
  if (total > vH * 0.9) { // 整体缩小适配
    const f = (vH * 0.9) / total;
    hh *= f; h1 *= f; h2 *= f; scl1 *= f; if (s2) scl2 *= f;
    total = hh + gap * f + h1 + (s2 ? gap2 * f + h2 : 0);
  }
  const topY = total / 2;
  const heartY = topY - hh / 2;
  heartCenterY = heartY;
  const line1Y = heartY - hh / 2 - gap - h1 / 2;
  const line2Y = s2 ? line1Y - h1 / 2 - gap2 - h2 / 2 : 0;

  // 心形世界缩放：曲线 y 范围约 [-1.06, 0.31]，翻转后总高 1.37
  const hs = hh / 1.37;
  const cHA = new THREE.Color().fromArray(PALETTE.heartA);
  const cHB = new THREE.Color().fromArray(PALETTE.heartB);
  const cTA = new THREE.Color().fromArray(PALETTE.textA);
  const cTB = new THREE.Color().fromArray(PALETTE.textB);
  const ambCols = PALETTE.ambientLove.map(v => new THREE.Color(v));

  let idx = 0;

  // 文字粒子
  const placeLine = (s, scl, centerY) => {
    const half = s.pts.length / 2;
    for (let k = 0; k < half && idx < N_STAGE; k++, idx++) {
      const px = s.pts[k * 2], py = s.pts[k * 2 + 1];
      p[idx * 3] = (px - s.W / 2) * scl;
      p[idx * 3 + 1] = centerY + (s.H / 2 - py) * scl;
      p[idx * 3 + 2] = (Math.random() - 0.5) * 0.55;
      const t = Math.abs(p[idx * 3]) / (worldTextW / 2);
      const cc = new THREE.Color().lerpColors(cTA, cTB, 0.35 + t * 0.5);
      const sh = 0.85 + Math.random() * 0.3;
      c[idx * 3] = Math.min(1, cc.r * sh);
      c[idx * 3 + 1] = Math.min(1, cc.g * sh);
      c[idx * 3 + 2] = Math.min(1, cc.b * sh);
    }
  };
  placeLine(s1, scl1, line1Y);
  if (s2) placeLine(s2, scl2, line2Y);
  textN = idx;

  // 爱心粒子
  const heartPts = buildHeartPoints(heartN);
  for (let k = 0; k < heartN && idx < N_STAGE; k++, idx++) {
    const hx = heartPts[k * 3], hy = heartPts[k * 3 + 1], hz = heartPts[k * 3 + 2];
    p[idx * 3] = hx * hs;
    p[idx * 3 + 1] = heartY + hy * hs;
    p[idx * 3 + 2] = hz;
    const t = THREE.MathUtils.clamp((hy + 1.06) / 1.37, 0, 1);
    const cc = new THREE.Color().lerpColors(cHA, cHB, t * 0.9);
    const sh = 0.8 + Math.random() * 0.4;
    c[idx * 3] = Math.min(1, cc.r * sh);
    c[idx * 3 + 1] = Math.min(1, cc.g * sh);
    c[idx * 3 + 2] = Math.min(1, cc.b * sh);
  }
  heartN = idx - textN;

  // 记录爱心粒子相对爱心中心的偏移（用于呼吸脉动）
  for (let k = 0; k < heartN; k++) {
    const i = textN + k;
    heartOff[i * 3] = p[i * 3];
    heartOff[i * 3 + 1] = p[i * 3 + 1] - heartY;
    heartOff[i * 3 + 2] = p[i * 3 + 2];
  }

  // 氛围粒子（周围漂浮）
  while (idx < N_STAGE) {
    const r = 5 + Math.random() * 10;
    const a = Math.random() * Math.PI * 2;
    const e = (Math.random() - 0.5) * 2.4;
    p[idx * 3] = Math.cos(a) * r;
    p[idx * 3 + 1] = e + Math.random() * 2;
    p[idx * 3 + 2] = Math.sin(a) * r;
    const cc = ambCols[Math.floor(Math.random() * ambCols.length)];
    c[idx * 3] = cc.r; c[idx * 3 + 1] = cc.g; c[idx * 3 + 2] = cc.b;
    idx++;
  }
  return { p, c };
}

/* ---------- 着色器 ---------- */
const mat = new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 }, uPR: { value: renderer.getPixelRatio() }, uMaxSize: { value: LIGHT ? 26 : 72 } },
  vertexShader: `
    attribute float aSize;
    attribute float aPhase;
    attribute vec3 aColor;
    varying vec3 vColor;
    varying float vPhase;
    uniform float uTime;
    uniform float uPR;
    uniform float uMaxSize;
    void main() {
      vColor = aColor;
      vPhase = aPhase;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      float ps = aSize * uPR * (150.0 / max(1.0, -mv.z));
      gl_PointSize = min(ps, uMaxSize);
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: `
    varying vec3 vColor;
    varying float vPhase;
    uniform float uTime;
    void main() {
      float d = length(gl_PointCoord - vec2(0.5));
      if (d > 0.5) discard;
      float a = smoothstep(0.5, 0.06, d);
      float tw = 0.72 + 0.28 * sin(uTime * 2.1 + vPhase);
      float core = 1.0 + 0.5 * smoothstep(0.28, 0.0, d);
      gl_FragColor = vec4(vColor * core * tw, a);
    }
  `,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  transparent: true,
});

/* ---------- 组装 Points ---------- */
const geo = new THREE.BufferGeometry();
geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
geo.setAttribute('aPhase', new THREE.BufferAttribute(twPhase, 1));
const points = new THREE.Points(geo, mat);
points.frustumCulled = false;
scene.add(points);

const starGeo = new THREE.BufferGeometry();
{
  const st = buildStars();
  starGeo.setAttribute('position', new THREE.BufferAttribute(st.p, 3));
  starGeo.setAttribute('aColor', new THREE.BufferAttribute(st.c, 3));
  starGeo.setAttribute('aSize', new THREE.BufferAttribute(st.s, 1));
  starGeo.setAttribute('aPhase', new THREE.BufferAttribute(st.ph, 1));
}
const starPoints = new THREE.Points(starGeo, mat);
starPoints.frustumCulled = false;
scene.add(starPoints);

/* ---------- 初始：星空分布 ---------- */
function scatterStage() {
  for (let i = 0; i < N_STAGE; i++) {
    const r = 14 + Math.random() * 26;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    pos[i * 3 + 1] = r * Math.cos(phi) * 0.8;
    pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    const cc = new THREE.Color(PALETTE.stars[Math.floor(Math.random() * PALETTE.stars.length)]);
    col[i * 3] = cc.r; col[i * 3 + 1] = cc.g; col[i * 3 + 2] = cc.b;
    size[i] = 1.0 + Math.random() * 1.6;
    twPhase[i] = Math.random() * Math.PI * 2;
  }
}
scatterStage();
tgtPosTree = buildTreeTargets().p;
tgtColTree = buildTreeTargets().c;
// 尺寸：树冠小粒子、装饰与树顶星大粒子
{
  const t = tgtPosTree;
  for (let i = 0; i < N_STAGE; i++) {
    const y = t[i * 3 + 1];
    if (y > 10.8) size[i] = 3.2 + Math.random() * 2.2;
    else if (y < 0.6) size[i] = 1.6 + Math.random() * 0.8;
    else size[i] = 1.5 + Math.random() * 1.3;
  }
}
buildLoveStage();

function buildLoveStage() {
  const t = buildLoveTargets();
  tgtPosLove = t.p;
  tgtColLove = t.c;
  for (let i = 0; i < N_STAGE; i++) {
    size[i] = 1.7 + Math.random() * 1.1;
  }
  for (let k = 0; k < heartN; k++) {
    const i = textN + k;
    size[i] = 2.0 + Math.random() * 1.2;
  }
}

/* ---------- 阶段机 ---------- */
let phase = 'stars'; // stars -> tree -> love
let baseRotY = 0;
let pulseBoost = 0;
let camZ = CONFIG.cameraZ.stars;
let camZTarget = CONFIG.cameraZ.stars;

function transition(to) {
  const now = performance.now() / 1000;
  for (let i = 0; i < N_STAGE; i++) {
    holdUntil[i] = now + Math.random() * CONFIG.morphHoldMax;
    holdPos[i * 3] = pos[i * 3];
    holdPos[i * 3 + 1] = pos[i * 3 + 1];
    holdPos[i * 3 + 2] = pos[i * 3 + 2];
  }
  phase = to;
  if (to === 'tree') {
    camZTarget = CONFIG.cameraZ.tree;
  } else if (to === 'love') {
    camZTarget = CONFIG.cameraZ.love;
  } else {
    camZTarget = CONFIG.cameraZ.stars;
  }
}

/* ---------- 交互 ---------- */
let lastTapMs = 0;
let musicTried = false;
function startMusic() {
  if (musicTried) return;
  musicTried = true;
  const p = bgm.play();
  if (p && p.catch) p.catch(() => { musicTried = false; });
}

function onTap() {
  // 防止 touchstart 与 click 双重触发
  const nowMs = performance.now();
  if (nowMs - lastTapMs < 450) return;
  lastTapMs = nowMs;

  if (phase === 'stars') {
    startMusic();
    hint1.classList.add('hidden');
    transition('tree');
    setTimeout(() => {
      if (phase === 'tree') hint2.classList.remove('hidden');
    }, 1600);
  } else if (phase === 'tree') {
    hint2.classList.add('hidden');
    transition('love');
    pulseBoost = 0.25;
  } else {
    // 恋爱阶段：爱心脉冲 + 粒子迸发
    pulseBoost = Math.min(0.35, pulseBoost + 0.22);
    const now = performance.now() / 1000;
    const n = 150;
    for (let k = 0; k < n; k++) {
      const i = Math.floor(Math.random() * N_STAGE);
      const a = Math.random() * Math.PI * 2;
      const e = (Math.random() - 0.5) * Math.PI;
      burstDir[i * 3] = Math.cos(a) * Math.cos(e);
      burstDir[i * 3 + 1] = Math.sin(e);
      burstDir[i * 3 + 2] = Math.sin(a) * Math.cos(e);
      burstUntil[i] = now + 0.9;
      burstBase[i * 3] = pos[i * 3];
      burstBase[i * 3 + 1] = pos[i * 3 + 1];
      burstBase[i * 3 + 2] = pos[i * 3 + 2];
    }
  }
}

canvas.addEventListener('click', onTap);
canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  onTap();
}, { passive: false });

/* ---------- 尺寸适配 ---------- */
let loveBuiltAspect = -1;
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (Math.abs(camera.aspect - loveBuiltAspect) > 0.01) {
    buildLoveStage();
    loveBuiltAspect = camera.aspect;
  }
}
window.addEventListener('resize', resize);
resize();

/* ---------- 调试钩子（自动化测试用，不影响正常访问） ---------- */
let __frames = 0;
window.__siteDebug = {
  phase: () => phase,
  frames: () => __frames,
  counts: () => ({ TOTAL, N_STAGE, N_AMBIENT, textN, heartN, aspect: +camera.aspect.toFixed(3), light: LIGHT }),
  posOk: () => {
    let bad = 0;
    for (let i = 0; i < pos.length; i++) if (!Number.isFinite(pos[i])) bad++;
    return bad;
  },
  camZ: () => +camera.position.z.toFixed(2),
  dump: () => ({
    tgtPosTree: Array.from(tgtPosTree), tgtColTree: Array.from(tgtColTree),
    tgtPosLove: Array.from(tgtPosLove), tgtColLove: Array.from(tgtColLove),
    textN, heartN, heartCenterY, fov: camera.fov, aspect: camera.aspect,
    zTree: CONFIG.cameraZ.tree, zLove: CONFIG.cameraZ.love,
    total: TOTAL, stage: N_STAGE,
  }),
  ctxLost: () => {
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    return gl ? gl.isContextLost() : 'no-gl';
  },
  px: () => {
    const t = document.createElement('canvas');
    t.width = 64; t.height = 64;
    const c = t.getContext('2d');
    try { c.drawImage(canvas, 0, 0, 64, 64); } catch (e) { return 'drawfail'; }
    const d = c.getImageData(0, 0, 64, 64).data;
    let r = 0, g = 0, b = 0, n = 0, mx = 0;
    for (let i = 0; i < d.length; i += 4) {
      r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
      mx = Math.max(mx, d[i] + d[i + 1] + d[i + 2]);
    }
    return { avg: [Math.round(r / n), Math.round(g / n), Math.round(b / n)], max: mx };
  },
};

/* ---------- 主循环 ---------- */
let last = performance.now() / 1000;

function animate() {
  requestAnimationFrame(animate);
  __frames++;
  const now = performance.now() / 1000;
  let dt = now - last;
  last = now;
  if (!(dt > 0) || dt > 0.05) dt = 0.016; // 负值/异常帧率保护
  mat.uniforms.uTime.value = now;

  // 相机
  camZ += (camZTarget - camZ) * (1 - Math.exp(-dt * 2.2));
  const port = camera.aspect < 0.75 ? 1.22 : 1;
  camera.position.z = camZ * port;
  camera.position.x = Math.sin(now * 0.12) * 0.8;
  camera.position.y = 1.1 + Math.sin(now * 0.2) * 0.35;
  camera.lookAt(0, 1.2, 0);

  // 旋转
  if (phase === 'tree') {
    baseRotY += dt * CONFIG.treeRotSpeed;
  } else {
    baseRotY *= Math.exp(-dt * 1.5);
  }
  points.rotation.y = baseRotY;

  // 爱心呼吸
  pulseBoost *= Math.exp(-dt * 2.6);
  const heartPulse = 1 + pulseBoost + 0.03 * Math.sin(now * 1.7);

  const k = 1 - Math.exp(-dt * CONFIG.morphK);
  const kc = 1 - Math.exp(-dt * CONFIG.colorK);

  for (let i = 0; i < N_STAGE; i++) {
    const i3 = i * 3;
    let tx, ty, tz;
    let cr, cg, cb;

    if (now < holdUntil[i]) {
      tx = holdPos[i3]; ty = holdPos[i3 + 1]; tz = holdPos[i3 + 2];
      cr = col[i3]; cg = col[i3 + 1]; cb = col[i3 + 2];
    } else if (phase === 'tree') {
      tx = tgtPosTree[i3]; ty = tgtPosTree[i3 + 1]; tz = tgtPosTree[i3 + 2];
      cr = tgtColTree[i3]; cg = tgtColTree[i3 + 1]; cb = tgtColTree[i3 + 2];
    } else if (phase === 'love') {
      if (i < textN) {
        const wave = Math.sin(now * 1.25 + twPhase[i] * 1.7);
        tx = tgtPosLove[i3];
        ty = tgtPosLove[i3 + 1] + wave * 0.12;
        tz = tgtPosLove[i3 + 2] + Math.sin(now * 0.9 + twPhase[i]) * 0.12;
      } else if (i < textN + heartN) {
        tx = heartOff[i3] * heartPulse;
        ty = heartCenterY + heartOff[i3 + 1] * heartPulse;
        tz = heartOff[i3 + 2];
      } else {
        tx = tgtPosLove[i3];
        ty = tgtPosLove[i3 + 1] + Math.sin(now * 0.5 + twPhase[i]) * 0.5;
        tz = tgtPosLove[i3 + 2];
      }
      cr = tgtColLove[i3]; cg = tgtColLove[i3 + 1]; cb = tgtColLove[i3 + 2];
    } else {
      // stars：静止壳层
      tx = pos[i3]; ty = pos[i3 + 1]; tz = pos[i3 + 2];
      cr = col[i3]; cg = col[i3 + 1]; cb = col[i3 + 2];
    }

    // 迸发覆盖
    if (now < burstUntil[i]) {
      const p2 = (now - (burstUntil[i] - 0.9)) / 0.9;
      const fly = Math.sin(Math.PI * p2) * 5.8;
      tx = burstBase[i3] + burstDir[i3] * fly;
      ty = burstBase[i3 + 1] + burstDir[i3 + 1] * fly;
      tz = burstBase[i3 + 2] + burstDir[i3 + 2] * fly;
      const cc = PALETTE.burst[i % PALETTE.burst.length];
      cr = ((cc >> 16) & 255) / 255;
      cg = ((cc >> 8) & 255) / 255;
      cb = (cc & 255) / 255;
    }

    pos[i3] += (tx - pos[i3]) * k;
    pos[i3 + 1] += (ty - pos[i3 + 1]) * k;
    pos[i3 + 2] += (tz - pos[i3 + 2]) * k;
    col[i3] += (cr - col[i3]) * kc;
    col[i3 + 1] += (cg - col[i3 + 1]) * kc;
    col[i3 + 2] += (cb - col[i3 + 2]) * kc;
  }

  geo.attributes.position.needsUpdate = true;
  geo.attributes.aColor.needsUpdate = true;
  renderer.render(scene, camera);
}

animate();
