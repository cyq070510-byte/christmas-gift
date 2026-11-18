# 圣诞礼物 · 3D 粒子圣诞树 × 粒子告白

纯静态单页站点，零依赖 CDN、零后端。手机上打开 → 点击屏幕 → 粒子圣诞树 → 再点一下 → 「I LOVE YOU LILI」+ 粒子爱心（全部由 3D 发光粒子构成，页面上没有任何可见文字渲染）。

## 目录结构

```
index.html          # 页面骨架 + 修改指引（顶部注释）
css/style.css       # 全屏样式、星空背景、点击提示
js/main.js          # 粒子引擎：星空 → 圣诞树 → 文字+爱心 三阶段变形
assets/three.min.js # Three.js r149（本地化，不依赖 CDN）
assets/music.mp3    # 背景音乐（27 秒无缝循环纯音乐（前 30 秒纯音乐段做成首尾连续循环），首次点击后循环播放）
```

## 部署到 GitHub Pages（推荐）

1. 在 GitHub 新建一个公开仓库（例如 `christmas-gift`），不要勾选初始化 README。
2. 把本目录所有文件推送到仓库 `main` 分支：
   ```bash
   git init -b main
   git add -A
   git commit -m "christmas gift"
   git remote add origin https://github.com/<你的用户名>/christmas-gift.git
   git push -u origin main
   ```
   或直接在网页上拖拽上传这些文件。
3. 仓库 Settings → Pages → Build and deployment → Source 选 `Deploy from a branch`，Branch 选 `main` / `(root)`，保存。
4. 等 1~2 分钟，访问 `https://<你的用户名>.github.io/christmas-gift/`。

也可以把整个目录拖到 Netlify Drop / Cloudflare Pages 直接部署。

## 修改指引

| 想改什么 | 改哪里 |
| --- | --- |
| 告白文字 | `js/main.js` 顶部 `LOVE_TEXT_LINE1 / LOVE_TEXT_LINE2 / LOVE_TEXT_FULL`（文字只用于离屏采样生成粒子坐标，不会以文字形式显示） |
| 背景音乐 | 替换 `assets/music.mp3`（保持文件名，建议 128kbps、30 秒内的无缝循环 mp3（当前为 27 秒交叉淡化循环）） |
| 配色 | `js/main.js` 的 `PALETTE` 对象（树、装饰、文字、爱心颜色全在这里） |
| 粒子数量/密度 | `js/main.js` 的 `CONFIG.particleCount*` |
| 变形速度/相机距离 | `CONFIG.morphK`、`CONFIG.cameraZ` |
| 树旋转速度 | `CONFIG.treeRotSpeed` |
| 开场提示文字 | `index.html` 里 `#hint` / `#hint2`（只允许操作提示类文字） |

## 交互流程

1. 打开：星空开场，显示「✨ 点击开启 ✨」提示。
2. 第一次点击/触摸：星空粒子汇聚成 3D 粒子圣诞树，同时音乐开始循环播放。
3. 第二次点击/触摸：圣诞树粒子飞散并变形为「I LOVE YOU LILI」+ 3D 粒子爱心。
4. 之后每次点击：爱心脉冲 + 粒子迸发庆祝。

> 红线：页面不包含任何普通字体形式的告白文字或图形爱心，所有内容均为粒子系统的一部分。
