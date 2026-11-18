# 部署指南（三种方案，任选其一）

> 目标：把本目录变成一个 https 公网链接，可直接发给别人，手机/电脑浏览器打开即用。

## 方案 A：GitHub Pages + Token（最快，推荐）

适合：愿意把 GitHub 用户名 + 只读/写权限 Token 交给 DSH 的情况。

1. GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)
2. Generate new token (classic) → Expiration 选 7 days → 勾选 `repo` → 生成并复制
3. 把「GitHub 用户名 + ghp_ 开头的 Token」发到 DSH 对话
4. DSH 自动执行：
   - 创建仓库 `christmas-gift`
   - 上传全部文件
   - 开启 GitHub Pages（main 分支根目录）
   - 等待构建并验证公网资源，返回链接
5. 链接格式：`https://<用户名>.github.io/christmas-gift/`

> 部署完成后可在同一个页面撤销 Token，或等它 7 天自动过期。

## 方案 B：GitHub 网页上传（不想给 Token、有电脑）

1. github.com → New repository → 名字填 `christmas-gift` → Public → Create
2. 在空仓库页点 **uploading an existing file**
3. 把解压后的**所有文件**拖进去（注意保留 `css/`、`js/`、`assets/` 三个文件夹结构），Commit
4. 仓库 Settings → Pages → Source 选 **Deploy from a branch** → Branch: `main` / `(root)` → Save
5. 等 1~2 分钟，访问 `https://<用户名>.github.io/christmas-gift/`

## 方案 C：Netlify Drop（不用命令行、不用 GitHub）

1. 电脑浏览器打开 https://app.netlify.com/drop
2. 把解压后的整个文件夹拖进页面
3. 免费注册/登录后即可获得 `https://xxx.netlify.app` 链接（可自定义前缀）
   ⚠️ netlify.app 在国内部分网络访问较慢，发给国内朋友前建议先自测

## 部署后自测清单（重要）

打开链接后依次确认：

- [ ] 首屏出现深色星空 + 「✨ 点击开启 ✨」提示（不是白屏、不是报错页）
- [ ] 点一下屏幕 → 粒子汇聚成青蓝色圣诞树，**音乐同时响起并循环**
- [ ] 再点一下 → 粒子变成「I LOVE YOU LILI」+ 冰蓝粒子爱心，页面任何位置都没有普通字体文字
- [ ] 手机上竖屏显示完整、文字与爱心不超出屏幕
- [ ] 刷新页面后可重复上述流程

如果只有「点击开启」提示没有星空：多半是 `assets/three.min.js` 没上传成功；
如果没声音：多半是 `assets/music.mp3` 缺失，或浏览器要求先点一下（本页已按此设计）。

## 修改方法

见本目录 `README.md` 的「修改指引」表格；改完重新上传对应文件即可（GitHub 网页可直接改文件内容）。
