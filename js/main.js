/* ============================================================
   3D 粒子圣诞树 · 粒子告白 —— 主逻辑（视觉修复版 v2）
   全部视觉均为 Three.js 3D 发光粒子，无任何可见文字渲染。

   本轮修复的根因：
   1) gl_PointSize 用「像素系数」近似 → 真机 DPR=2 下粒子被放大到
      10~30 CSS px，叠加 AdditiveBlending 后整片饱和成白色（过曝/横带）。
      改为「世界尺寸 × 正确透视投影系数」，粒子典型只有 2~4 CSS px。
   2) 粒子颜色/透明度接近满值 + 密集重叠 → 融合成光块。
      降低单粒子强度、加 ACES 色调映射压制高光截断。
   3) 树冠用「锥面随机抖动」生成 → 螺旋臂过密成白色缎带。
      改为按弧长等距的显式螺旋臂 + 稀疏内部 + 冰蓝点缀。
   4) 告白阶段有一圈半径 5~15 的随机「氛围粒子」→ 铺满全屏。
      删除该设计，改为限定在构图范围内的少量细尘。
   5) 额外的点击「粒子爆炸」→ 改为克制的爱心脉冲。
   ============================================================ */

'use strict';

/* ---------- 可修改参数 ---------- */
const TREE_TEXT = 'MERRY CHRISTMAS';       // 圣诞树阶段的文字
const LOVE_TEXT_LINE1 = 'I LOVE YOU';      // 第一行文字
const LOVE_TEXT_LINE2 = 'LILI';            // 第二行文字

const CONFIG = {
  // 粒子总数（桌面）；手机按宽度/核心数自动降档
  particleCount: 6800,
  particleCountMid: 5600,
  particleCountSmall: 4800,
  ambientStars: 0.12,        // 背景星空粒子占比（独立 Points，不参与变形）
  starfieldCount: 700,       // 背景星星数量（桌面），手机自动降
  morphRingSpeed: 4.5,       // 变形跟随速度（越小越慢越丝滑）
  morphDelayMax: 0.55,       // 逐粒子出发延迟上限（秒）
  cameraZ: { stars: 19, tree: 17, text: 13.5, heart: 12 },
  portraitScale: 1.28,       // 竖屏相机拉远系数
  treeRotSpeed: 0.10,        // 圣诞树自转速度
  bg: 0x040814,
  // 粒子世界尺寸（单位=世界坐标，约等于屏幕上的直径；会随透视缩放）
  sizeStars: [0.05, 0.10],
  sizeFoliage: [0.055, 0.10],
  sizeAccent: [0.12, 0.17],
  sizeStarTop: [0.13, 0.21],
  sizeText: [0.048, 0.062],
  sizeHeart: [0.06, 0.09],
  sizeDust: [0.03, 0.05],
};

/* 配色：深蓝黑背景 + 白色主调 + 少量冰蓝 */
const PALETTE = {
  starWhite: 0xf2f7ff,
  starBlue: 0x9fd4ff,
  white: [0.92, 0.96, 1.0],
  whiteDim: [0.55, 0.62, 0.72],
  iceBlue: [0.55, 0.82, 1.0],
  iceBlueDim: [0.30, 0.50, 0.68],
  text: [0.90, 0.95, 1.0],
  heart: [0.86, 0.93, 1.0],
  heartEdge: [0.50, 0.78, 1.0],
  dust: [0.14, 0.18, 0.28],
};

/* ---------- 轻量模式（自动化测试/低端设备 ?light=1） ---------- */
const LIGHT = /[?&]light=1/.test(location.search);
const PROBE = /[?&]probe=1/.test(location.search);  // 测试专用：保留绘制缓冲以便读回

/* ---------- 基础环境 ---------- */
const canvas = document.getElementById('scene');
const hint1 = document.getElementById('hint');
const hint2 = document.getElementById('hint2');
const bgm = document.getElementById('bgm');

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: !LIGHT, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: PROBE });
} catch (e) {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;left:0;right:0;top:50%;transform:translateY(-50%);text-align:center;color:#cfd8ff;font:15px/1.6 -apple-system,"PingFang SC",sans-serif;z-index:30;letter-spacing:1px';
  el.textContent = '当前浏览器不支持 WebGL，请用新版浏览器打开';
  document.body.appendChild(el);
  throw e;
}
const DPR = Math.min(window.devicePixelRatio || 1, (navigator.hardwareConcurrency || 8) <= 4 ? 1.5 : 2);
renderer.setPixelRatio(DPR);
// ACES 色调映射：把高光柔和压缩，避免叠加后纯白截断（过曝根因之一）
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.outputEncoding = THREE.sRGBEncoding;

canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); });

const scene = new THREE.Scene();
scene.background = new THREE.Color(CONFIG.bg);

const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 300);
camera.position.set(0, 3.4, CONFIG.cameraZ.stars);

/* ---------- 粒子规模自适应 ---------- */
const isMobile = window.innerWidth < 768 || (navigator.hardwareConcurrency || 8) <= 4;
const isSmall = window.innerWidth < 420;
let TOTAL = isSmall ? CONFIG.particleCountSmall : (isMobile ? CONFIG.particleCountMid : CONFIG.particleCount);
if (LIGHT) TOTAL = Math.floor(TOTAL * 0.55);
const N_AMBIENT = Math.floor(TOTAL * CONFIG.ambientStars);
const N_STAGE = TOTAL - N_AMBIENT;          // 参与三个阶段变形的粒子
const N_STARFIELD = Math.floor(CONFIG.starfieldCount * (isMobile ? 0.7 : 1));

/* ---------- 粒子缓冲区 ---------- */
const pos = new Float32Array(N_STAGE * 3);
const col = new Float32Array(N_STAGE * 3);
const size = new Float32Array(N_STAGE);
const twPhase = new Float32Array(N_STAGE);
const twSpeed = new Float32Array(N_STAGE);
const holdPos = new Float32Array(N_STAGE * 3);
const holdUntil = new Float32Array(N_STAGE);
const heartOff = new Float32Array(N_STAGE * 3);
const dustSeed = new Float32Array(N_STAGE * 3);
const tgtPosStars = new Float32Array(N_STAGE * 3);   // 星空阶段的粒子目标（初始散点）
const tgtColStars = new Float32Array(N_STAGE * 3);
const sizeStars = new Float32Array(N_STAGE);

let tgtPosTree = null, tgtColTree = null, tgtPosText = null, tgtColText = null,
    tgtPosHeart = null, tgtColHeart = null;
let textN = 0, heartN = 0, heartCenterY = 0;

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/* ---------- 着色器：世界尺寸 → 正确透视像素尺寸 ---------- */
const mat = new THREE.ShaderMaterial({
  uniforms: {
    uTime: { value: 0 },
    uProjScale: { value: 800 },   // drawingBufferHeight / (2*tan(fov/2))，resize 时更新
    uMaxPx: { value: 26 },        // 单粒子最大设备像素（防止异常放大）
    uOpacity: { value: 1 },
  },
  vertexShader: `
    attribute float aSize;
    attribute float aPhase;
    attribute float aSpeed;
    attribute vec3 aColor;
    varying vec3 vColor;
    varying float vPhase;
    varying float vSpeed;
    uniform float uTime;
    uniform float uProjScale;
    uniform float uMaxPx;
    void main() {
      vColor = aColor;
      vPhase = aPhase;
      vSpeed = aSpeed;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      float dist = max(1.0, -mv.z);
      // 世界直径 × 透视系数 / 距离 = 屏幕上的物理像素直径
      gl_PointSize = clamp(aSize * uProjScale / dist, 1.0, uMaxPx);
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: `
    varying vec3 vColor;
    varying float vPhase;
    varying float vSpeed;
    uniform float uTime;
    uniform float uOpacity;
    void main() {
      float d = length(gl_PointCoord - vec2(0.5));
      if (d > 0.5) discard;
      // 清晰的小圆点：软边只占 1 个像素，核心略亮 → 独立星尘感
      float a = smoothstep(0.5, 0.16, d);
      float core = 1.0 + 0.45 * smoothstep(0.26, 0.0, d);
      float tw = 0.78 + 0.22 * sin(uTime * vSpeed + vPhase);
      gl_FragColor = vec4(vColor * core * tw * 0.85, a * uOpacity);
    }
  `,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  depthTest: false,
  transparent: true,
});

/* ---------- 背景星空（独立 Points，始终存在） ---------- */
function buildStarfield() {
  const n = N_STARFIELD;
  const p = new Float32Array(n * 3);
  const c = new Float32Array(n * 3);
  const s = new Float32Array(n);
  const ph = new Float32Array(n);
  const sp = new Float32Array(n);
  const cw = new THREE.Color(PALETTE.starWhite);
  const cb = new THREE.Color(PALETTE.starBlue);
  for (let i = 0; i < n; i++) {
    const r = rnd(26, 70);
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    p[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    p[i * 3 + 1] = r * Math.cos(phi) * 0.7;
    p[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    const blue = Math.random() < 0.18;
    const cc = blue ? cb : cw;
    const dim = rnd(0.22, 0.62);          // 背景星要暗，不能抢主体
    c[i * 3] = cc.r * dim; c[i * 3 + 1] = cc.g * dim; c[i * 3 + 2] = cc.b * dim;
    s[i] = rnd(CONFIG.sizeStars[0], CONFIG.sizeStars[1]);
    ph[i] = Math.random() * Math.PI * 2;
    sp[i] = rnd(0.3, 1.1);
  }
  return { p, c, s, ph, sp };
}

/* ---------- 圣诞树：显式螺旋臂 + 稀疏内部 + 冰蓝点缀 + 树顶星 + 树底光影 ---------- */
function buildTreeTargets() {
  const p = new Float32Array(N_STAGE * 3);
  const c = new Float32Array(N_STAGE * 3);
  const sz = new Float32Array(N_STAGE);

  const H = 9.6, BASE = -1.9, R = 3.5;      // 树高 9.6，底半径 3.5
  const ARMS = 5, TURNS = 2.6;
  const cw = PALETTE.white, cwd = PALETTE.whiteDim, cb = PALETTE.iceBlue, cbd = PALETTE.iceBlueDim;

  let idx = 0;
  const put = (x, y, z, cc, s) => {
    if (idx >= N_STAGE) return;
    p[idx * 3] = x; p[idx * 3 + 1] = y; p[idx * 3 + 2] = z;
    c[idx * 3] = cc[0]; c[idx * 3 + 1] = cc[1]; c[idx * 3 + 2] = cc[2];
    sz[idx] = s;
    idx++;
  };

  // 0) 树上方「MERRY CHRISTMAS」两行粒子文字（与圣诞树同一批粒子一起聚合，衔接流畅）
  {
    const vt = visSize(CONFIG.cameraZ.tree);
    const maxW = vt.vW * 0.92;
    const targetH = vt.vH * 0.052;            // 每行目标高度
    const gmA = renderGlyphMask('MERRY', 170);
    const gmB = renderGlyphMask('CHRISTMAS', 170);
    if (gmA && gmB) {
      const scA = Math.min(targetH / gmA.bboxH, maxW / gmA.bboxW);
      const scB = Math.min(targetH / gmB.bboxH, maxW / gmB.bboxW);
      const stepA = Math.max(2, Math.round((0.75 * 0.095) / scA));
      const stepB = Math.max(2, Math.round((0.75 * 0.095) / scB));
      const ptsA = sampleGlyphMask(gmA, stepA, Math.floor(N_STAGE * 0.09));
      const ptsB = sampleGlyphMask(gmB, stepB, Math.floor(N_STAGE * 0.13));
      const hA = gmA.bboxH * scA, hB = gmB.bboxH * scB;
      const gap = vt.vH * 0.020;
      const bottomY = 9.05;                    // 文字块底部（树顶星上方）
      const cyB = bottomY + hB / 2;            // CHRISTMAS（下一行）
      const cyA = bottomY + hB + gap + hA / 2; // MERRY（上一行）
      const place = (pts, sc, cy, dimProb) => {
        const n = pts.length / 2;
        for (let k = 0; k < n && idx < N_STAGE; k++, idx++) {
          p[idx * 3] = pts[k * 2] * sc;
          p[idx * 3 + 1] = cy - pts[k * 2 + 1] * sc;      // 画布 y 向下 → 世界 y 向上
          p[idx * 3 + 2] = rnd(-0.12, 0.12);
          const dim = Math.random() < dimProb;
          const cc = dim ? cwd : cw;
          c[idx * 3] = cc[0]; c[idx * 3 + 1] = cc[1]; c[idx * 3 + 2] = cc[2];
          sz[idx] = rnd(0.085, 0.105);      // 树阶段文字用稍大粒子（LED 点阵感、清晰）
        }
      };
      place(ptsA, scA, cyA, 0.18);
      place(ptsB, scB, cyB, 0.18);
      __treeTextStats = { a: ptsA.length / 2, b: ptsB.length / 2, hA: +hA.toFixed(2), hB: +hB.toFixed(2), cyA: +cyA.toFixed(2), cyB: +cyB.toFixed(2) };
    }
  }
  const textCount = idx;
  const N_TREE = Math.max(100, N_STAGE - textCount);

  // 1) 树顶星：五角星轮廓 + 少量内部（精致的粒子星星）
  {
    const topY = BASE + H + 0.55;
    const starN = Math.floor(N_TREE * 0.024);
    for (let i = 0; i < starN; i++) {
      const t = Math.random();
      let x, y;
      if (t < 0.7) {
        const k = Math.random() * 5;
        const a1 = (k / 5) * Math.PI * 2 - Math.PI / 2;
        const a2 = ((k + 1) / 5) * Math.PI * 2 - Math.PI / 2;
        const r1 = 0.52, r2 = 0.22;
        const tt = Math.random();
        const ax = Math.cos(a1) * r1, ay = Math.sin(a1) * r1;
        const bx = Math.cos(a2) * r2, by = Math.sin(a2) * r2;
        x = ax + (bx - ax) * tt;
        y = ay + (by - ay) * tt;
      } else {
        const a = Math.random() * Math.PI * 2, r = Math.pow(Math.random(), 0.6) * 0.16;
        x = Math.cos(a) * r; y = Math.sin(a) * r;
      }
      put(x * 0.9, topY + y * 0.9, x * 0.1 + rnd(-0.06, 0.06),
          Math.random() < 0.25 ? cb : cw, rnd(CONFIG.sizeStarTop[0], CONFIG.sizeStarTop[1]));
    }
  }

  // 2) 螺旋光带：5 条显式螺旋臂，按弧长等距布点
  {
    const bandN = Math.floor(N_TREE * 0.62);
    const perArm = Math.floor(bandN / ARMS);
    for (let a = 0; a < ARMS; a++) {
      const armOff = (a / ARMS) * Math.PI * 2;
      const count = perArm;
      for (let k = 0; k < count; k++) {
        const t = Math.pow(k / (count - 1), 0.92);
        const y = BASE + t * H;
        const radius = R * (1 - t) + 0.06;
        const ang = armOff + t * TURNS * Math.PI * 2 + rnd(-0.05, 0.05);
        const jr = rnd(-0.05, 0.05);
        const x = Math.cos(ang) * (radius + jr);
        const z = Math.sin(ang) * (radius + jr);
        const icy = Math.random() < 0.14;
        put(x, y + rnd(-0.03, 0.03), z,
            icy ? cb : cw, rnd(CONFIG.sizeFoliage[0], CONFIG.sizeFoliage[1]));
      }
    }
  }

  // 3) 稀疏内部填充
  {
    const innerN = Math.floor(N_TREE * 0.20);
    for (let i = 0; i < innerN; i++) {
      const t = Math.pow(Math.random(), 0.85);
      const y = BASE + t * H;
      const radius = (R * (1 - t)) * rnd(0.18, 0.82);
      const ang = Math.random() * Math.PI * 2;
      const dim = Math.random() < 0.6;
      put(Math.cos(ang) * radius, y, Math.sin(ang) * radius,
          dim ? cwd : cbd, rnd(CONFIG.sizeFoliage[0], CONFIG.sizeFoliage[0] * 1.3));
    }
  }

  // 4) 冰蓝点缀灯
  {
    const decoN = Math.floor(N_TREE * 0.045);
    for (let i = 0; i < decoN; i++) {
      const t = Math.pow(Math.random(), 0.9);
      const y = BASE + t * H;
      const radius = R * (1 - t) + 0.10;
      const ang = Math.random() * Math.PI * 2;
      put(Math.cos(ang) * radius, y, Math.sin(ang) * radius,
          cb, rnd(CONFIG.sizeAccent[0], CONFIG.sizeAccent[1]));
    }
  }

  // 5) 树底柔和光影
  {
    const baseN = Math.floor(N_TREE * 0.035);
    for (let i = 0; i < baseN; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.pow(Math.random(), 0.7) * 2.6;
      put(Math.cos(a) * r, BASE - 0.05 + rnd(-0.08, 0.02), Math.sin(a) * r * 0.75,
          cbd, rnd(CONFIG.sizeFoliage[0], CONFIG.sizeFoliage[1]));
    }
  }

  // 剩余粒子：树干
  const trunkN = Math.max(0, N_STAGE - idx);
  for (let i = 0; i < trunkN; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * 0.34;
    put(Math.cos(a) * r, BASE + rnd(-0.1, 1.0), Math.sin(a) * r, cwd, rnd(0.05, 0.08));
  }

  return { p, c, sz };
}

/* ---------- 文字粒子采样（离屏 canvas 仅作采样模板） ----------
   两段式：① 渲染文字并测量字形包围盒（只统计 alpha>128 的笔画像素，背景透明）
           ② 根据「目标屏幕间距」换算画布步长后采样，只取笔画像素。
   旧 bug：黑色不透明背景 + alpha 判断 → 整块矩形通过 → 矩形点阵。 */
function renderGlyphMask(text, fontPx) {
  const off = document.createElement('canvas');
  const ctx = off.getContext('2d', { willReadFrequently: true });
  const font = `900 ${fontPx}px "Arial Black", "Arial Bold", Arial, "Helvetica Neue", "PingFang SC", "Microsoft YaHei", sans-serif`;
  ctx.font = font;
  // 逐字绘制并加入字距（tracking），保证每个字母之间有清晰空隙、不会糊成一片
  const tracking = Math.round(fontPx * 0.11);
  const chars = Array.from(text);
  let totalW = 0;
  const widths = chars.map(ch => {
    const w = ctx.measureText(ch).width;
    totalW += w + (ch === ' ' ? tracking * 0.4 : tracking);
    return w;
  });
  const W = Math.ceil(totalW) + 20;
  const Hc = Math.ceil(fontPx * 1.34);
  off.width = W; off.height = Hc;          // 设置尺寸后画布透明
  ctx.clearRect(0, 0, W, Hc);
  ctx.font = font;
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  let penX = 10;
  for (let i = 0; i < chars.length; i++) {
    ctx.fillText(chars[i], penX, Hc / 2);
    penX += widths[i] + (chars[i] === ' ' ? tracking * 0.4 : tracking);
  }
  const data = ctx.getImageData(0, 0, W, Hc).data;
  let minX = W, maxX = -1, minY = Hc, maxY = -1, glyphPx = 0;
  for (let y = 0; y < Hc; y++) {
    for (let x = 0; x < W; x++) {
      if (data[(y * W + x) * 4 + 3] > 128) {
        glyphPx++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { data, W, Hc, minX, maxX, minY, maxY, bboxW: maxX - minX + 1, bboxH: maxY - minY + 1, glyphPx };
}

function sampleGlyphMask(g, step, maxPoints) {
  const cx = g.minX + g.bboxW / 2, cy = g.minY + g.bboxH / 2;
  const all = [];
  for (let y = g.minY; y <= g.maxY; y += step) {
    for (let x = g.minX; x <= g.maxX; x += step) {
      if (g.data[(y * g.W + x) * 4 + 3] > 128) all.push(x - cx, y - cy);
    }
  }
  const n = all.length / 2;
  if (n <= maxPoints) return new Float32Array(all);
  // 点数超预算：等间隔抽样（保持字形完整）
  const stride = n / maxPoints;
  const out = new Float32Array(Math.floor(maxPoints) * 2);
  let oi = 0;
  for (let k = 0; k < n && oi < maxPoints; k++) {
    const idx = Math.min(n - 1, Math.floor(k * stride));
    out[oi * 2] = all[idx * 2];
    out[oi * 2 + 1] = all[idx * 2 + 1];
    oi++;
  }
  return out.subarray(0, oi * 2);
}

/* ---------- 爱心粒子（轮廓 + 内部稀疏填充） ---------- */
function buildHeartPoints(n) {
  // 统一使用参数方程心形：外轮廓精确，内部按向形心径向收缩填充，
  // 保证整体包围盒严格为 宽2.0 × 高1.375（经典爱心比例 0.6875）
  const out = new Float32Array(n * 3);
  const cyLocal = -0.15625;    // 心形包围盒中心（翻转前的 y，与真实范围一致）
  for (let i = 0; i < n; i++) {
    const t = Math.random() * Math.PI * 2;
    const bx = 16 * Math.pow(Math.sin(t), 3) / 16;
    const by = (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) / 16;
    let x, y;
    if (Math.random() < 0.55) {          // 外轮廓（清晰边界）
      x = bx + rnd(-0.012, 0.012);
      y = by + rnd(-0.012, 0.012);
    } else {                              // 内部填充：向形心收缩
      const sc = Math.pow(Math.random(), 0.55);
      x = bx * sc;
      y = cyLocal + (by - cyLocal) * sc;
    }
    out[i * 3] = x;
    out[i * 3 + 1] = y;        // 不翻转：原始 y 的正方向就是"爱心上方"（lobes）
    out[i * 3 + 2] = rnd(-0.22, 0.22);
  }
  return out;
}

/* ---------- 布局计算：可视世界范围 ---------- */
function visSize(camZ) {
  const aspect = camera.aspect;
  const port = aspect < 0.75 ? CONFIG.portraitScale : 1;
  const z = camZ * port;
  const vH = 2 * z * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  return { vH, vW: vH * aspect, z };
}

/* ---------- 告白阶段目标 ----------
   阶段一：两行文字（第一行 I LOVE YOU 略大，第二行 LILI，均水平居中）
   阶段二：同样的文字保留在上方 + 粒子爱心出现在下方（两者同时显示） */
let __glyphStats = { l1: 0, l2: 0, hit1: 0, hit2: 0, bbox1: [0, 0], bbox2: [0, 0] };
let __treeTextStats = null;
let __glyphDbg = [];

function buildLoveTargets() {
  const pT = new Float32Array(N_STAGE * 3);
  const cT = new Float32Array(N_STAGE * 3);
  const sT = new Float32Array(N_STAGE);
  const pH = new Float32Array(N_STAGE * 3);
  const cH = new Float32Array(N_STAGE * 3);
  const sH = new Float32Array(N_STAGE);

  const cText = PALETTE.text, cTextDim = PALETTE.whiteDim;
  const vt = visSize(CONFIG.cameraZ.text);
  const vh = visSize(CONFIG.cameraZ.heart);

  // ---- 采样两行字形（只采样一次，两个阶段共用，保证变形连续） ----
  const gm1 = renderGlyphMask(LOVE_TEXT_LINE1, 170);
  const gm2 = renderGlyphMask(LOVE_TEXT_LINE2, 170);
  if (!gm1 || !gm2) { console.warn('glyph render failed'); }
  // 文字阶段缩放（世界/画布像素）
  const maxWt0 = vt.vW * 0.90;
  const sc1t0 = Math.min((vt.vH * 0.098) / gm1.bboxH, maxWt0 / gm1.bboxW);
  const sc2t0 = Math.min((vt.vH * 0.086) / gm2.bboxH, maxWt0 / gm2.bboxW);
  const H_screen = window.innerHeight;
  const pxPerWorld = H_screen / vt.vH;              // 屏幕像素/世界单位
  // 目标屏幕间距 ≈ 1.45 × 粒子屏径，换算回画布步长
  // 密集采样（步长 ≈ 0.55×粒子直径），再按预算均匀抽稀，保证字形完整且笔画连续
  const step1 = Math.max(2, Math.round((0.55 * CONFIG.sizeText[1]) / sc1t0));
  const step2 = Math.max(2, Math.round((0.55 * CONFIG.sizeText[1]) / sc2t0));
  const pts1 = sampleGlyphMask(gm1, step1, Math.floor(N_STAGE * 0.44));
  const pts2 = sampleGlyphMask(gm2, step2, Math.floor(N_STAGE * 0.22));
  const g1 = { pts: pts1, bboxW: gm1.bboxW, bboxH: gm1.bboxH };
  const g2 = { pts: pts2, bboxW: gm2.bboxW, bboxH: gm2.bboxH };
  const n1 = g1.pts.length / 2, n2 = g2.pts.length / 2;
  textN = n1 + n2;
  __glyphDbg = [
    { mask: gm1.data, pts: pts1, W: gm1.W, Hc: gm1.Hc, minX: gm1.minX, minY: gm1.minY,
      bboxW: gm1.bboxW, bboxH: gm1.bboxH, sc: sc1t0 },
    { mask: gm2.data, pts: pts2, W: gm2.W, Hc: gm2.Hc, minX: gm2.minX, minY: gm2.minY,
      bboxW: gm2.bboxW, bboxH: gm2.bboxH, sc: sc2t0 },
  ];
  __glyphStats = { l1: n1, l2: n2, step1, step2,
                   bbox1: [gm1.bboxW, gm1.bboxH], bbox2: [gm2.bboxW, gm2.bboxH],
                   hit1: +((n1 * (step1 * step1)) / gm1.glyphPx).toFixed(2),
                   hit2: +((n2 * (step2 * step2)) / gm2.glyphPx).toFixed(2) };

  // ---- 阶段一：文字（大、居中） ----
  const maxWt = vt.vW * 0.90;
  const sc1t = Math.min((vt.vH * 0.098) / g1.bboxH, maxWt / g1.bboxW);
  const h1t = g1.bboxH * sc1t;                       // 第一行实际高度（通常受屏宽限制）
  const sc2t = Math.min((h1t * 0.78) / g2.bboxH, maxWt / g2.bboxW);
  const h2t = g2.bboxH * sc2t;
  // 覆盖率统计使用真实排版缩放
  if (__glyphDbg[0]) __glyphDbg[0].sc = sc1t;
  if (__glyphDbg[1]) __glyphDbg[1].sc = sc2t;
  const gapT = vt.vH * 0.045;
  const totalT = h1t + gapT + h2t;
  const y1t = totalT / 2 - h1t / 2;
  const y2t = -totalT / 2 + h2t / 2;

  // 把字形点阵铺到目标数组（两阶段共用同一函数）
  const placeGlyph = (g, sc, cy, tgt, colA, sizA, i0) => {
    const n = Math.min(g.pts.length / 2, N_STAGE - i0);
    for (let k = 0; k < n; k++) {
      const i = i0 + k;
      tgt[i * 3] = g.pts[k * 2] * sc;             // pts 已相对字形中心
      tgt[i * 3 + 1] = cy - g.pts[k * 2 + 1] * sc; // canvas y 向下 → 世界 y 向上
      tgt[i * 3 + 2] = rnd(-0.18, 0.18);
      const dim = Math.random() < 0.18;
      const cc = dim ? cTextDim : cText;
      colA[i * 3] = cc[0]; colA[i * 3 + 1] = cc[1]; colA[i * 3 + 2] = cc[2];
      sizA[i] = rnd(CONFIG.sizeText[0], CONFIG.sizeText[1]);
    }
    return n;
  };
  placeGlyph(g1, sc1t, y1t, pT, cT, sT, 0);
  placeGlyph(g2, sc2t, y2t, pT, cT, sT, n1);

  // 文字阶段细尘：严格在文字构图内
  for (let i = textN; i < N_STAGE; i++) {
    pT[i * 3] = rnd(-maxWt * 0.44, maxWt * 0.44);
    pT[i * 3 + 1] = rnd(-totalT * 0.50, totalT * 0.50);
    pT[i * 3 + 2] = rnd(-0.9, 0.9);
    cT[i * 3] = PALETTE.dust[0]; cT[i * 3 + 1] = PALETTE.dust[1]; cT[i * 3 + 2] = PALETTE.dust[2];
    sT[i] = rnd(CONFIG.sizeDust[0], CONFIG.sizeDust[1]);
  }

  // ---- 阶段二：文字在上 + 爱心在下 ----
  const maxWh = vh.vW * 0.90;
  const sc1h = Math.min((vh.vH * 0.086) / g1.bboxH, maxWh / g1.bboxW);
  const h1h = g1.bboxH * sc1h;
  const sc2h = Math.min((h1h * 0.78) / g2.bboxH, maxWh / g2.bboxW);
  const h2h = g2.bboxH * sc2h;
  const heartWMax = vh.vW * 0.60;
  const heartH = Math.min(heartWMax / 1.1034, vh.vH * 0.30);
  const hs = heartH / 1.8125;
  const gapH1 = vh.vH * 0.026, gapH2 = vh.vH * 0.030;
  let totalH = h1h + gapH1 + h2h + gapH2 + heartH;
  let scaleAll = 1;
  if (totalH > vh.vH * 0.90) {
    scaleAll = (vh.vH * 0.90) / totalH;
    totalH = vh.vH * 0.90;
  }
  const topH = totalH / 2;
  const y1h = topH - (h1h * scaleAll) / 2;
  const y2h = topH - h1h * scaleAll - gapH1 * scaleAll - (h2h * scaleAll) / 2;
  const heartTopY = topH - (h1h + gapH1 + h2h + gapH2) * scaleAll;
  heartCenterY = heartTopY - (heartH * scaleAll) / 2;

  placeGlyph(g1, sc1h * scaleAll, y1h, pH, cH, sH, 0);
  placeGlyph(g2, sc2h * scaleAll, y2h, pH, cH, sH, n1);

  // 爱心粒子（文字之后的粒子）
  const heartBudget = Math.min(Math.floor(N_STAGE * 0.34), N_STAGE - textN - Math.floor(N_STAGE * 0.05));
  const heartPts = buildHeartPoints(Math.max(0, heartBudget));
  const cHeart = PALETTE.heart, cHeartEdge = PALETTE.heartEdge;
  const hsAll = hs * scaleAll;
  let hi = textN;
  for (let k = 0; k < heartBudget && hi < N_STAGE; k++, hi++) {
    const hx = heartPts[k * 3], hy = heartPts[k * 3 + 1], hz = heartPts[k * 3 + 2];
    pH[hi * 3] = hx * hsAll;
    pH[hi * 3 + 1] = heartCenterY + (hy - 0.15625) * hsAll;
    pH[hi * 3 + 2] = hz;
    const tcol = THREE.MathUtils.clamp((hy + 1.0625) / 1.8125, 0, 1);
    const cc = tcol > 0.72 ? cHeart : cHeartEdge;
    cH[hi * 3] = cc[0]; cH[hi * 3 + 1] = cc[1]; cH[hi * 3 + 2] = cc[2];
    sH[hi] = rnd(CONFIG.sizeHeart[0], CONFIG.sizeHeart[1]);
    heartOff[hi * 3] = hx * hsAll;
    heartOff[hi * 3 + 1] = (hy - 0.15625) * hsAll;
    heartOff[hi * 3 + 2] = hz;
  }
  heartN = hi - textN;

  // 爱心阶段细尘：在爱心范围内
  for (let i = hi; i < N_STAGE; i++) {
    const ra = Math.random() * Math.PI * 2;
    const hr = heartH * scaleAll * rnd(0.12, 0.36);
    pH[i * 3] = Math.cos(ra) * hr * 1.05;
    pH[i * 3 + 1] = heartCenterY + Math.sin(ra) * hr * 0.85;
    pH[i * 3 + 2] = rnd(-0.7, 0.7);
    cH[i * 3] = PALETTE.dust[0]; cH[i * 3 + 1] = PALETTE.dust[1]; cH[i * 3 + 2] = PALETTE.dust[2];
    sH[i] = rnd(CONFIG.sizeDust[0], CONFIG.sizeDust[1]);
  }

  return { pT, cT, sT, pH, cH, sH };
}

/* ---------- 组装 Points ---------- */
const geo = new THREE.BufferGeometry();
geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
geo.setAttribute('aPhase', new THREE.BufferAttribute(twPhase, 1));
geo.setAttribute('aSpeed', new THREE.BufferAttribute(twSpeed, 1));
const points = new THREE.Points(geo, mat);
points.frustumCulled = false;
scene.add(points);

const starGeo = new THREE.BufferGeometry();
{
  const st = buildStarfield();
  starGeo.setAttribute('position', new THREE.BufferAttribute(st.p, 3));
  starGeo.setAttribute('aColor', new THREE.BufferAttribute(st.c, 3));
  starGeo.setAttribute('aSize', new THREE.BufferAttribute(st.s, 1));
  starGeo.setAttribute('aPhase', new THREE.BufferAttribute(st.ph, 1));
  starGeo.setAttribute('aSpeed', new THREE.BufferAttribute(st.sp, 1));
}
const starPoints = new THREE.Points(starGeo, mat);
starPoints.frustumCulled = false;
scene.add(starPoints);

/* ---------- 最终转场特效：环绕构图的星尘层 ---------- */
const SPARKLE_N = 460;
let sparkleMat = null, sparklePoints = null;
let sparkleTargetAlpha = 0, sparkleAlpha = 0, heartFormedAt = -1, burstT0 = -1;
let sparkleBasePos = null, sparkleSizeArr = null;

function buildSparkles() {
  const p = new Float32Array(SPARKLE_N * 3);
  const c = new Float32Array(SPARKLE_N * 3);
  const sz = new Float32Array(SPARKLE_N);
  const ph = new Float32Array(SPARKLE_N);
  const sp = new Float32Array(SPARKLE_N);
  for (let i = 0; i < SPARKLE_N; i++) {
    const ang = Math.random() * Math.PI * 2;
    const r = 2.0 + Math.pow(Math.random(), 0.75) * 3.4;         // 环绕构图
    p[i * 3] = Math.cos(ang) * r;
    p[i * 3 + 1] = 0.4 + Math.sin(ang) * r * 0.95;
    p[i * 3 + 2] = (Math.random() - 0.5) * 2.6;
    const warm = Math.random() < 0.3;
    const cc = warm ? PALETTE.heartEdge : PALETTE.iceBlue;
    const dim = 0.45 + Math.random() * 0.55;
    c[i * 3] = cc[0] * dim; c[i * 3 + 1] = cc[1] * dim; c[i * 3 + 2] = cc[2] * dim;
    sz[i] = 0.03 + Math.random() * 0.05;
    ph[i] = Math.random() * Math.PI * 2;
    sp[i] = 0.5 + Math.random() * 1.4;
  }
  const geo2 = new THREE.BufferGeometry();
  geo2.setAttribute('position', new THREE.BufferAttribute(p, 3));
  geo2.setAttribute('aColor', new THREE.BufferAttribute(c, 3));
  geo2.setAttribute('aSize', new THREE.BufferAttribute(sz, 1));
  geo2.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
  geo2.setAttribute('aSpeed', new THREE.BufferAttribute(sp, 1));
  sparkleMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uProjScale: { value: mat.uniforms.uProjScale.value },
      uMaxPx: { value: 18 },
      uOpacity: { value: 0 },
    },
    vertexShader: mat.vertexShader,
    fragmentShader: mat.fragmentShader,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    transparent: true,
  });
  sparklePoints = new THREE.Points(geo2, sparkleMat);
  sparklePoints.frustumCulled = false;
  scene.add(sparklePoints);
  sparkleBasePos = p;
  sparkleSizeArr = sz;
}

buildSparkles();

/* ---------- 初始：星空分布 ---------- */
function scatterStage() {
  for (let i = 0; i < N_STAGE; i++) {
    const r = rnd(12, 34);
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    pos[i * 3 + 1] = r * Math.cos(phi) * 0.8;
    pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    const cc = Math.random() < 0.15 ? PALETTE.starBlue : PALETTE.starWhite;
    const c3 = new THREE.Color(cc);
    const dim = rnd(0.45, 0.9);
    col[i * 3] = c3.r * dim; col[i * 3 + 1] = c3.g * dim; col[i * 3 + 2] = c3.b * dim;
    size[i] = rnd(CONFIG.sizeStars[0], CONFIG.sizeStars[1]);
    twPhase[i] = Math.random() * Math.PI * 2;
    twSpeed[i] = rnd(0.3, 1.2);
  }
  // 记录星空阶段的粒子目标（供「回到星空」转场使用）
  tgtPosStars.set(pos);
  tgtColStars.set(col);
  sizeStars.set(size);
}
scatterStage();

/* 阶段目标 */
const tree = buildTreeTargets();
tgtPosTree = tree.p; tgtColTree = tree.c;

const love = buildLoveTargets();
tgtPosText = love.pT; tgtColText = love.cT;
tgtPosHeart = love.pH; tgtColHeart = love.cH;

/* 各阶段尺寸（按阶段应用，保留大小层次） */
const sizeTree = new Float32Array(N_STAGE);
let sizeText = love.sT;
let sizeHeart = love.sH;

function applyStageSizes(phaseName) {
  for (let i = 0; i < N_STAGE; i++) {
    if (phaseName === 'stars') size[i] = sizeStars[i] || 0.08;
    else if (phaseName === 'tree') size[i] = sizeTree[i] || 0.07;
    else if (phaseName === 'text') size[i] = sizeText[i] || 0.06;
    else if (phaseName === 'heart') size[i] = sizeHeart[i] || 0.07;
  }
}
{
  // 直接使用树生成时按层分配的尺寸（树顶星/点缀/树冠各不相同）
  for (let i = 0; i < N_STAGE; i++) sizeTree[i] = tree.sz[i] || 0.07;
}

/* ---------- 阶段机 ---------- */
let phase = 'stars';
let baseRotY = 0;
let pulseBoost = 0;
let camZ = CONFIG.cameraZ.stars;
let camZTarget = CONFIG.cameraZ.stars;
let lookY = 3.4, lookYTarget = 3.4;
let morphSpeedTarget = 4.5;   // 变形跟随速度目标（最后一次转场会放慢）
let morphSpeedCur = 4.5;      // 当前变形速度（平滑过渡）
let heartPulseT = -10;

function transition(to) {
  const now = performance.now() / 1000;
  // 最后一次转场（文字 → 文字+爱心）：粒子按「离构图中心的距离」排序出发，
  // 形成由内向外扩散的波浪；跟随速度放慢，整体更丝滑
  const smooth = (to === 'heart');
  for (let i = 0; i < N_STAGE; i++) {
    if (smooth) {
      const dx = pos[i * 3], dy = pos[i * 3 + 1] - heartCenterY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      holdUntil[i] = now + Math.min(0.9, (dist / 9) * 0.62) + Math.random() * 0.18;
    } else {
      holdUntil[i] = now + Math.random() * CONFIG.morphDelayMax;
    }
    holdPos[i * 3] = pos[i * 3];
    holdPos[i * 3 + 1] = pos[i * 3 + 1];
    holdPos[i * 3 + 2] = pos[i * 3 + 2];
  }
  morphSpeedTarget = smooth ? 2.5 : CONFIG.morphRingSpeed;
  sparkleTargetAlpha = smooth ? 1 : 0;
  if (smooth) heartFormedAt = now + 2.4;
  phase = to;
  if (to === 'tree') {
    camZTarget = CONFIG.cameraZ.tree;
    lookYTarget = 4.9;
  } else if (to === 'text') {
    camZTarget = CONFIG.cameraZ.text;
    lookYTarget = 0.2;
  } else if (to === 'heart') {
    camZTarget = CONFIG.cameraZ.heart;
    lookYTarget = 0;
  } else {
    camZTarget = CONFIG.cameraZ.stars;
    lookYTarget = 3.4;
  }
  applyStageSizes(to);
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
  const nowMs = performance.now();
  if (nowMs - lastTapMs < 450) return;
  lastTapMs = nowMs;

  // 一次点击 = 一次转场：星空 → 圣诞树 → 两行文字 → 文字+爱心 → 回到星空 …
  if (phase === 'stars') {
    startMusic();
    transition('tree');
  } else if (phase === 'tree') {
    transition('text');
  } else if (phase === 'text') {
    transition('heart');
  } else if (phase === 'heart') {
    transition('stars');
  }
}

canvas.addEventListener('click', onTap);
canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  onTap();
}, { passive: false });

/* ---------- 尺寸适配 ---------- */
let loveBuiltAspect = -1;
function updateProjScale() {
  // drawingBufferHeight / (2*tan(fov/2))：世界直径→物理像素的正确透视系数
  const fovR = THREE.MathUtils.degToRad(camera.fov);
  const hPx = renderer.getContext().drawingBufferHeight;
  mat.uniforms.uProjScale.value = hPx / (2 * Math.tan(fovR / 2));
}
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  updateProjScale();
  if (sparkleMat) sparkleMat.uniforms.uProjScale.value = mat.uniforms.uProjScale.value;
  if (Math.abs(camera.aspect - loveBuiltAspect) > 0.01) {
    const tr2 = buildTreeTargets();
    tgtPosTree = tr2.p; tgtColTree = tr2.c;
    for (let i = 0; i < N_STAGE; i++) sizeTree[i] = tr2.sz[i] || 0.07;
    const lv = buildLoveTargets();
    tgtPosText = lv.pT; tgtColText = lv.cT;
    tgtPosHeart = lv.pH; tgtColHeart = lv.cH;
    sizeText = lv.sT; sizeHeart = lv.sH;
    loveBuiltAspect = camera.aspect;
    applyStageSizes(phase);
  }
}
window.addEventListener('resize', resize);
resize();

/* ---------- 调试钩子（自动化测试用） ---------- */
let __frames = 0;
window.__siteDebug = {
  phase: () => phase,
  frames: () => __frames,
  counts: () => ({ TOTAL, N_STAGE, N_AMBIENT, N_STARFIELD, textN, heartN, aspect: +camera.aspect.toFixed(3), light: LIGHT, dpr: DPR }),
  glyph: () => __glyphStats,
  fx: () => ({ sparkle: +sparkleAlpha.toFixed(2), sparkleTarget: +sparkleTargetAlpha.toFixed(2), morphSpeed: +morphSpeedCur.toFixed(2) }),
  treeText: () => __treeTextStats,
  // 字形笔画覆盖率：统计"笔画内部像素"中被粒子圆点覆盖的比例
  glyphCoverage: () => __glyphDbg.map(o => {
    const R = Math.max(2, Math.ceil((CONFIG.sizeText[1] / 2) / o.sc));
    const mark = new Uint8Array(o.W * o.Hc);
    const cx = o.minX + o.bboxW / 2, cy = o.minY + o.bboxH / 2;
    for (let k = 0; k < o.pts.length / 2; k++) {
      const px = Math.round(o.pts[k * 2] + cx), py = Math.round(o.pts[k * 2 + 1] + cy);
      for (let dy = -R; dy <= R; dy++) {
        for (let dx = -R; dx <= R; dx++) {
          if (dx * dx + dy * dy > R * R) continue;
          const x = px + dx, y = py + dy;
          if (x < 0 || y < 0 || x >= o.W || y >= o.Hc) continue;
          mark[y * o.W + x] = 1;
        }
      }
    }
    let hit = 0, tot = 0;
    for (let y = o.minY; y < o.minY + o.bboxH; y++) {
      for (let x = o.minX; x < o.minX + o.bboxW; x++) {
        if (o.mask[(y * o.W + x) * 4 + 3] > 200) { tot++; if (mark[y * o.W + x]) hit++; }
      }
    }
    return +(hit / Math.max(1, tot) * 100).toFixed(1);
  }),
  posOk: () => { let bad = 0; for (let i = 0; i < pos.length; i++) if (!Number.isFinite(pos[i])) bad++; return bad; },
  // 测试专用：把当前 WebGL 画布读回成小尺寸图像 + 统计（绕过无头截图失效）
  snap: (tw = 140) => {
    const cw = canvas.width, ch = canvas.height;
    const th = Math.max(2, Math.round(tw * ch / cw));
    const t = document.createElement('canvas');
    t.width = tw; t.height = th;
    const ctx = t.getContext('2d');
    ctx.drawImage(canvas, 0, 0, tw, th);
    const d = ctx.getImageData(0, 0, tw, th).data;
    let blown = 0, bright = 0, dark = 0;
    const rows = new Array(th).fill(0);
    const mask = [];
    for (let y = 0; y < th; y++) {
      let rb = 0;
      for (let x = 0; x < tw; x++) {
        const i = (y * tw + x) * 4;
        const l = (d[i] + d[i + 1] + d[i + 2]) / 3;
        if (l > 245) blown++;
        if (l > 120) { bright++; rb++; }
        if (l < 25) dark++;
        mask.push(l > 90 ? 1 : 0);
      }
      rows[y] = rb;
    }
    const n = tw * th;
    return {
      w: tw, h: th,
      blown: +(blown / n * 100).toFixed(2),
      bright: +(bright / n * 100).toFixed(2),
      dark: +(dark / n * 100).toFixed(2),
      bandRows: rows.filter(r => r > tw * 0.7).length,
      mask, jpg: t.toDataURL('image/jpeg', 0.75),
    };
  },
  camZ: () => +camera.position.z.toFixed(2),
  dump: () => ({
    posNow: Array.from(pos), colNow: Array.from(col), szNow: Array.from(size),
    tgtPosTree: Array.from(tgtPosTree), tgtColTree: Array.from(tgtColTree),
    tgtPosText: Array.from(tgtPosText), tgtColText: Array.from(tgtColText),
    tgtPosHeart: Array.from(tgtPosHeart), tgtColHeart: Array.from(tgtColHeart),
    textN, heartN, heartCenterY, fov: camera.fov, aspect: camera.aspect,
    zTree: CONFIG.cameraZ.tree, zText: CONFIG.cameraZ.text, zHeart: CONFIG.cameraZ.heart,
    portraitScale: CONFIG.portraitScale, stage: N_STAGE,
    szTree: Array.from(sizeTree), szText: Array.from(sizeText), szHeart: Array.from(sizeHeart),
    lookY: { tree: 4.9, text: 0.2, heart: 0 },
  }),
};

/* ---------- 主循环 ---------- */
let last = performance.now() / 1000;

function animate() {
  requestAnimationFrame(animate);
  const now = performance.now() / 1000;
  let dt = now - last;
  last = now;
  if (!(dt > 0) || dt > 0.05) dt = 0.016;
  __frames++;
  mat.uniforms.uTime.value = now;

  // 相机：缓慢推拉 + 轻微摇摆（营造 3D 空间感，无跳变）
  camZ += (camZTarget - camZ) * (1 - Math.exp(-dt * 1.1));
  lookY += (lookYTarget - lookY) * (1 - Math.exp(-dt * 1.1));
  const port = camera.aspect < 0.75 ? CONFIG.portraitScale : 1;
  camera.position.z = camZ * port;
  camera.position.x = Math.sin(now * 0.10) * 0.55;
  camera.position.y = lookY + Math.sin(now * 0.16) * 0.16;
  camera.lookAt(0, lookY, 0);

  // 树自转（仅在树阶段），其他阶段缓缓归零
  if (phase === 'tree') {
    baseRotY += dt * CONFIG.treeRotSpeed;
  } else {
    baseRotY *= Math.exp(-dt * 1.2);
  }
  points.rotation.y = baseRotY;

  // 爱心呼吸 / 脉冲
  pulseBoost *= Math.exp(-dt * 2.2);
  const heartScale = 1 + pulseBoost + 0.02 * Math.sin(now * 1.6);

  // 变形速度平滑过渡（最后一次转场更慢更丝滑）
  morphSpeedCur += (morphSpeedTarget - morphSpeedCur) * (1 - Math.exp(-dt * 2.2));
  const k = 1 - Math.exp(-dt * morphSpeedCur);
  const kc = 1 - Math.exp(-dt * 3.2);

  // ---- 最终画面星尘特效 ----
  if (sparklePoints) {
    sparkleAlpha += (sparkleTargetAlpha - sparkleAlpha) * (1 - Math.exp(-dt * 1.9));
    sparkleMat.uniforms.uOpacity.value = sparkleAlpha;
    sparkleMat.uniforms.uTime.value = now;
    sparkleMat.uniforms.uProjScale.value = mat.uniforms.uProjScale.value;
    // 缓慢环绕 + 形成爱心瞬间的柔和绽放
    sparklePoints.rotation.y = Math.sin(now * 0.12) * 0.25;
    let burst = 0;
    if (burstT0 > 0) {
      const bt = now - burstT0;
      if (bt > 0 && bt < 1.8) burst = Math.sin((bt / 1.8) * Math.PI);
      else if (bt >= 1.8) burstT0 = -1;
    }
    const sc = 1 + burst * 0.32;
    sparklePoints.scale.setScalar(sc);
    // 微弱的呼吸闪烁
    const breathe = 0.85 + 0.15 * Math.sin(now * 1.1);
    sparkleMat.uniforms.uOpacity.value = sparkleAlpha * (0.75 + 0.35 * burst) * breathe;
    // 爱心形成的瞬间触发一次绽放
    if (heartFormedAt > 0 && now >= heartFormedAt) { burstT0 = now; heartFormedAt = -1; }
  }

  for (let i = 0; i < N_STAGE; i++) {
    const i3 = i * 3;
    let tx, ty, tz, cr, cg, cb;

    if (now < holdUntil[i]) {
      tx = holdPos[i3]; ty = holdPos[i3 + 1]; tz = holdPos[i3 + 2];
      cr = col[i3]; cg = col[i3 + 1]; cb = col[i3 + 2];
    } else if (phase === 'tree') {
      tx = tgtPosTree[i3]; ty = tgtPosTree[i3 + 1]; tz = tgtPosTree[i3 + 2];
      cr = tgtColTree[i3]; cg = tgtColTree[i3 + 1]; cb = tgtColTree[i3 + 2];
    } else if (phase === 'text') {
      tx = tgtPosText[i3];
      ty = tgtPosText[i3 + 1] + Math.sin(now * 0.8 + twPhase[i]) * 0.045;
      tz = tgtPosText[i3 + 2];
      cr = tgtColText[i3]; cg = tgtColText[i3 + 1]; cb = tgtColText[i3 + 2];
    } else if (phase === 'heart') {
      if (i >= textN && i < textN + heartN) {
        tx = heartOff[i3] * heartScale;
        ty = heartCenterY + heartOff[i3 + 1] * heartScale;
        tz = heartOff[i3 + 2];
      } else if (i < textN) {
        tx = tgtPosHeart[i3];
        ty = tgtPosHeart[i3 + 1] + Math.sin(now * 0.7 + twPhase[i]) * 0.035;
        tz = tgtPosHeart[i3 + 2];
      } else {
        tx = tgtPosHeart[i3];
        ty = tgtPosHeart[i3 + 1] + Math.sin(now * 0.5 + twPhase[i]) * 0.10;
        tz = tgtPosHeart[i3 + 2];
      }
      cr = tgtColHeart[i3]; cg = tgtColHeart[i3 + 1]; cb = tgtColHeart[i3 + 2];
    } else {
      tx = pos[i3]; ty = pos[i3 + 1]; tz = pos[i3 + 2];
      cr = col[i3]; cg = col[i3 + 1]; cb = col[i3 + 2];
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
  geo.attributes.aSize.needsUpdate = true;
  renderer.render(scene, camera);
}

// 开场淡入（防止首帧突然出现 → 闪白）
{
  const fade = document.createElement('div');
  fade.id = 'fade';
  fade.style.cssText = 'position:fixed;inset:0;background:#040814;z-index:20;pointer-events:none;transition:opacity 1.4s ease;opacity:1';
  document.body.appendChild(fade);
  requestAnimationFrame(() => { fade.style.opacity = '0'; });
  setTimeout(() => { if (fade.parentNode) fade.parentNode.removeChild(fade); }, 2200);
}

animate();
