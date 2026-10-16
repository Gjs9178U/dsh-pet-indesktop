# Changelog

All notable changes to this project are documented here.
本文件记录本项目的所有重要变更。

---

## 0.1.0 — 2026-01-01

### 第一版：一只真的桌宠 / First release: a real desktop pet

**这不是骨架版本。** 它发布的是一个**能用的功能**：一只住在 DSH 网页界面里的桌宠。

### 新增 / Added

- **桌宠本体**（`shell.overlay`，`order: 700`）：一只小鲸鱼，**内联 SVG + CSS**，
  没有图片、没有字体、没有视频、没有网络请求。
  它会缓慢呼吸（3.2s）、偶尔眨眼（纯函数 `blinkAt` 决定时机）、尾巴轻摆（5.2s，
  与呼吸周期不互为倍数，读起来不像循环）。
- **拖动与记忆**：Pointer Events（鼠标与触摸同一套代码），位置在**同一个 clamp** 里更新，
  松手后经 **600ms 防抖** POST 给宿主；重新加载后从宿主恢复。位置存的是**视口百分比**而不是像素。
- **点击说话**：中英双语各一行（`LINES`，6 条），2600ms 后自己消失；位移超过 4px 视为拖动，不触发说话。
- **开关按钮**（`sidebar.footer.action`，`order: 40`，带 `label`）：显示/隐藏桌宠，选择会被持久化。
  没有它，「藏起来」就是单向门。
- **减少动态**：`prefers-reduced-motion: reduce` 时**静帧**（不是慢速动画）。
- **决策是数据**：`nextPose` / `poseAt` / `stanceAt` / `clampPosition` / `clampPercent` / `pickLine` /
  `pickMode` / `blinkAt` / `swayAt` / `breathAt` 从 bundle 导出，全部是纯函数，
  由 `scripts/verify-pet.mjs` 用数字穷举验证。
- **宿主半边**（`src/host/index.js`）：三条前缀路由 —— `status.json`、`state.json`（读）、
  `state.json/state`（写）。状态存在 `$DSH_HOME/pet-indesktop/state.json`（没设则 `~/.dsh/...`）。
  - **原子写**：同目录临时文件 + `rename()`。
  - **自愈读**：缺失/损坏/超大/被手改都不抛异常，逐字段过同一个校验器，报告修了什么。
  - **严格校验**：未知字段 400（不静默忽略）、类型错误 400 并说明、越界夹取、名字超长拒绝而不截断、
    请求体按字节限量（超限 413）、被拒绝的更新一个字节都不写。
  - **载荷里没有路径**：路径只由代码常量决定。
- **配置层**：`cordis.patch.yml` 提供把插件挂进 profile 的 `insert` 行；`package.json` 同时声明
  `dsh.bundle` 与 `dsh.client`（只声明后者会被插件市场拒绝）。
- **客户端产物无编译器**：`lib/client.js` 是 `src/client/index.js` **逐字节**复制加一段生成横幅
  （`verify-build.mjs` 断言这一点）。没有 tsdown、没有 TypeScript、没有 `devDependencies`、
  安装时不需要 `npm install`。
- **六个校验脚本**：`check-css-template`、`build`、`verify-build`、`verify-routes`、
  `verify-client-boot`、`verify-pet`，全部针对已提交产物运行，无需安装依赖。

### 修复 / Fixed

- **样式表里的反引号**：CSS 注释里出现了一个反引号，提前结束了模板字符串。
  `scripts/check-css-template.mjs` 抓到并报出行号（这正是它存在的理由）。
- **两个前缀互相抢**：最初把读路径注册成 `/state.json`、写路径注册成 `/state`，
  于是请求 `/state.json` 被短前缀 `/state` 吃掉，读状态永远 404。
  现在只注册一个前缀，写路径挂在它下面。
- **`sendJson` 参数顺序写反**：成功分支把 `{ ok, state }` 当成了状态码，响应变成 200 但状态码是个对象。
  `verify-routes.mjs` 抓到。

### 已知限制 / Known limitations

- **未在真实 DSH 宿主上安装验证过。** 校验脚本只针对产物文本、内存中的处理器和纯函数运行。
- **react 渲染没有被验证过**：两个校验脚本都用 react stub，`createElement` 返回 `null`，
  所以「画出来是什么样」没有被测过。
- **拖动、指针事件、触摸没有被验证过**：需要真实 DOM。被验证的是决策矩阵，以及座位、样式表、待机、卸载。
- 视觉细节（鲸鱼形状、动画节奏）是作者的设计选择，没有经过用研。

### 不变量 / Invariants（不要改）

- 客户端半边**不导出静态 `inject`**：静态依赖会让 fiber 永远 `pending`，
  web 启动会把任何非 `active` 条目当作致命错误，**整个 GUI 起不来**。
- `peerDependencies` 里**永远不出现** `@deepseek-ai/dsh-*`（DSH ≥ 0.2.0 会静默丢弃对不上的插件）。
- 路由前缀**不带尾斜杠**；**也不要注册两个会互相抢的前缀**。
- 桌宠的 z-index（`2147481000`）必须**低于**整屏覆盖层的 `2147483000`。
- 桌宠的坐标是**视口百分比（2..98 的整数）**，两个半边用同一套夹取规则。
- 将来发媒体资源时用 **`no-cache` + `ETag`**，不用 `no-store`。
