# dsh-pet-indesktop

## 状态 / Status

> **这是一个能用的桌宠（desktop pet），不是占位动画。**
>
> 它做什么：在 DSH 网页界面右下角放一只**手绘的小角色**——蓝头发、鳍状耳朵、鲸鱼尾巴，手里捧着一个白色杯子。
> 它会**上下轻轻浮动、左右微微摇摆、缓慢地“呼吸”**；**按住可以拖动**（鼠标和触摸都行），松开后位置会被记住；
> **点一下会说一句话**（中英双语，说完自己消失）；侧边栏底部有一个「桌宠 开 / 关」按钮，
> 可以随时把它藏起来或叫回来。
>
> 它的名字是 **「大肥鱼」/ "Big Fat Fish"**，有 **八种配色皮肤**可以随时切换：
> 深海蓝 `deepsea`、樱花粉 `sakura`、薄荷绿 `mint`、暮光紫 `twilight`、焦糖金 `caramel`、
> 雪白银 `silver`、墨黑 `ink`、余烬红 `ember`。切换在侧边栏那枚按钮弹出的面板里点一下色块即可，
> 选择会被记住（存在宿主上），重开页面也还在。
>
> 画法：**八张随插件一起分发的 PNG 图片**，由插件自己的宿主半边提供
> （`/dsh-pet-indesktop/assets/skins/<id>.png`），动效是它外面的 CSS。**没有任何第三方请求**：
> 图片、脚本、样式全部来自同一个包、同一个进程。
>
> **图片署名（attribution）：** 画面带有 **“OleapCrow”** 的画师标记，由**仓库所有者提供**，
> 不是本项目的原创绘制，也不是 DeepSeek 的官方素材。授权情况见 `LICENSE`
> ——「由仓库所有者提供；详见 LICENSE」。

**English summary:** a working desktop pet for the DSH web GUI — one hand-drawn character (blue hair, fin ears, whale tail, holding a white cup) that bobs, sways and breathes, can be dragged, remembers where it was left, and says a bilingual line when clicked. The image is one PNG shipped inside the plugin and served by its own host half, so there are no third-party requests, no video and no external assets. The artwork carries an "OleapCrow" mark and was supplied by the repository owner; see LICENSE for the licence situation. It has **not** been installed against a live DSH host; see "Known limitations".

---

## 这是什么

一个 DSH（DeepSeek Harness）插件，在网页界面里加**两个挂载点**：

| 插槽 | 类型 | 放什么 |
| --- | --- | --- |
| `shell.overlay` | `kind: list` | 桌宠本体。**清单插槽 = 新增一个单元**，永远不会顶掉官方界面 |
| `sidebar.footer.action` | `kind: list` | 「桌宠 开 / 关」按钮 |

宿主半边（Node）只做两件事：报状态、**保存桌宠的状态**。

| 半边 | 做了什么 |
| --- | --- |
| 宿主半边 `src/host/index.js` | 三条路由：`status.json`（存活探针）、`state.json`（读状态）、`state.json/state`（写状态，带严格校验与原子写） |
| 浏览器半边 `src/client/index.js` | 动态注入 `slots` / `uiSession`，挂上桌宠与开关按钮；宿主什么都不提供时**安静待机** |

浏览器半边是**一个纯 JavaScript 文件**，用 DSH 的加载器信封包起来（见下一节）。它没有编译器、没有打包器、
也没有任何 npm 依赖：`node scripts/build.mjs` 把它**原样复制**成 `lib/client.js`，只在最前面加一段生成横幅。

## 桌宠的行为

| 行为 | 怎么做的 | 为什么 |
| --- | --- | --- |
| 呼吸 | CSS keyframes，3.2 秒一个周期 | 完全静止的贴图看起来像坏了；一个缓慢的上下浮动就够了 |
| 眨眼 | **纯函数** `blinkAt(now)` 决定，组件只负责加 class | 时机要能被测试读到，而不是埋在 CSS 里没法断言 |
| 尾巴摆 | 5.2 秒一个周期，和呼吸的 3.2 秒**不互为倍数** | 两个不整除的周期读起来像活着，像循环动画反而假 |
| 拖动 | Pointer Events + `setPointerCapture`，位置在**同一个 clamp** 里更新 | 鼠标和触摸同一套代码；拖动中经过的位置一定是能存下去的合法位置 |
| 记住位置 | 松手后 **600ms 防抖** POST 给宿主 | 拖动一次会发出几十个 pointermove，不防抖就是几十个请求 |
| 点击说话 | 一句话（中文一行、英文一行），**2600ms** 后自己消失 | 说个不停的宠物等于一个关不掉的对话框 |
| 点击 vs 拖动 | 位移超过 **4px** 就当作拖动，不触发说话 | 不然每次搬动它都会聒噪一句 |
| 藏起来 | 侧边栏按钮；状态持久化 | 只有宠物自己能控制自己，就是一个单向门 |
| 减少动态 | `prefers-reduced-motion: reduce` → **静帧** | 「减少动态」不等于「放慢动画」：慢速的呼吸仍然是动画 |

**决策是数据，不是渲染。** 桌宠所有的判断都从 bundle 里导出成**纯函数**：
`nextPose(state, event, now)`、`poseAt(now, options)`、`stanceAt(state, now)`、`clampPosition(position)`、
`clampPercent(value)`、`pickLine(index)`、`pickMode(since, now)`、`blinkAt`、`swayAt`、`breathAt`。
组件只是它们之上的一层薄渲染，所以 `scripts/verify-pet.mjs` 能用**数字**把整个矩阵跑一遍，
完全不需要浏览器。这个模式是从姊妹插件 `dsh-boot-animation` 的 `decidePlay` 抄来的，
它是唯一一个在真实宿主上活下来的写法。

## 八种皮肤

侧边栏底部那枚按钮（写着「大肥鱼 开 / 关」）点开是一个小面板：**上面是显示/隐藏，下面是八个色块**。
点一个色块，画面立刻换，同时把选择 POST 给宿主 —— 所以刷新页面、重启 DSH、换个浏览器，皮肤都还在。

| id | 名字 | 看起来 |
| --- | --- | --- |
| `deepsea` | 深海蓝 / Deep Sea | 原始配色，蓝色的头发与鳍 |
| `sakura` | 樱花粉 / Sakura | 粉 |
| `mint` | 薄荷绿 / Mint | 薄荷绿 |
| `twilight` | 暮光紫 / Twilight | 紫 |
| `caramel` | 焦糖金 / Caramel | 琥珀金 |
| `silver` | 雪白银 / Silver | 近乎白色的银发 |
| `ink` | 墨黑 / Ink | 接近黑的海军蓝 |
| `ember` | 余烬红 / Ember | 红 |

**换肤不会让动画重来一遍。** 切换只改 `<img>` 的 `src`，包裹它的三层 `div`（摇摆 / 浮动 / 呼吸）
一直挂着，所以不会跳一下。这是刻意的，也是 `scripts/verify-client-boot.mjs` 断言的一条：
`<img>` 上没有 React `key`，元素被复用而不是重建。

**id 是白名单里的键，不是路径片段。** 客户端与宿主各有一份八个 id 的白名单（浏览器半边不能 import 宿主），
`scripts/build.mjs` 会把这两份和 `assets/skins/` 目录**三者对齐**检查 —— 少一个、多一个都会让构建失败，
而不是发一个点了 404 的色块。宿主的换肤路由从**列表里取到的那个字符串**拼路径，
从不使用请求里的文本（详见 `ARCHITECTURE.md`）。

## 为什么客户端产物长成 `window.__ModuleLoader__.load({...})`

因为 **DSH 的 web 外壳是这样加载客户端 bundle 的**：它定义 `window.__ModuleLoader__`，取回 bundle，
然后把这**当作一段脚本求值**。所以：

- 产物必须是**普通 JavaScript**，不能是 ESM —— `import` / `export` 在这段脚本里无处可去，加载器根本求值不了；
- `react` 不是打包进来的，而是由加载器把 `require` 交给 `factory`，插件在里面 `require('react')` 拿到它。

这个信封写法**照抄姊妹插件 `dsh-boot-animation` 的已发布产物**，而不是自己发明一种 ESM 产物。
代价说清楚：`factory` 只拿到 `require`、无法 import 同目录的兄弟文件，
所以**整个浏览器半边只能是一个文件** —— 样式表、组件，以及图片的 `<img>` 都在 `src/client/index.js` 里，
这是刻意的。（图片本身是 `lib/assets/skins/*.png`，由宿主半边提供，不塞进 JS。）

## 安装

```bash
dsh plugin --profile web add github:Gjs9178U/dsh-pet-indesktop
```

安装后**必须**做两件事，否则你看到的仍然是没有桌宠的界面：

1. **重启 DSH 服务**（宿主半边新增了路由，运行中的进程不会自己知道）；
2. 在浏览器里按 **Ctrl+Shift+R 强制刷新**（普通的 F5 会继续用缓存的旧启动脚本）。

验证装上了：

```bash
# 宿主半边的存活探针
curl http://127.0.0.1:<你的 DSH 端口>/dsh-pet-indesktop/status.json
# 桌宠现在记到哪儿了
curl http://127.0.0.1:<你的 DSH 端口>/dsh-pet-indesktop/state.json
```

状态大概是这样的：

```json
{
  "plugin": "dsh-pet-indesktop",
  "state": { "version": 1, "visible": true, "x": 92, "y": 88, "name": "小深" },
  "healed": false,
  "issues": []
}
```

只装、不重启、不强制刷新，是最常见的「装了没用」；不是插件坏了。

## 卸载

```bash
dsh plugin --profile web remove dsh-pet-indesktop
```

然后同样：重启 DSH 服务 + Ctrl+Shift+R。
如果你想让状态文件也消失，删掉 `$DSH_HOME/pet-indesktop/` 即可（不删也不会影响别的插件）。

## 桌宠的状态存在哪

`$DSH_HOME/pet-indesktop/state.json`（没设 `DSH_HOME` 时是 `~/.dsh/pet-indesktop/state.json`）。

```json
{ "version": 1, "visible": true, "x": 92, "y": 88, "name": "小深" }
```

- `x` / `y` 是**视口百分比（2..98 的整数）**，不是像素。像素在换显示器或改窗口大小之后就失效了，
  百分比不会。
- `version` 是**模式版本**，不是包版本：将来改这个文件的形状时，靠它辨认而不是靠猜。
- 这个文件是**唯一的持久化位置**：浏览器半边不用 `localStorage`。

三条保证（都由 `scripts/verify-routes.mjs` 断言）：

1. **原子写**：先写 `state.json.tmp`（同目录的兄弟文件，保证同盘），再 `rename()` 盖上去。
   `rename` 在同目录内是原子的，所以崩溃或并发写只会留下旧的或新的，不会留下写了一半的。
   临时文件故意放在**同目录**而不是系统临时目录：跨文件系统的 `rename` 会退化成复制，就不再原子了。
2. **读的时候自愈**：文件缺失、读不了、太大、JSON 坏了、或者**被人手改过**，都**不会抛异常**，
   也不会把脏数据端出去。每个字段都过一遍 HTTP 层用的同一个校验器：越界的夹回范围、不能用的退回默认值，
   并且把「我修了什么」放在响应的 `issues` 里。所以**手改文件不能让它端出 HTTP 不会接受的东西**。
3. **载荷里没有路径**：文件路径 = 状态根 + 代码里的两个常量。请求体里没有任何文件名、目录名或路径片段
   能影响它 —— 请求体里装的是桌宠在哪，不是往哪写。

## 状态的 HTTP 接口

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| `GET` | `/dsh-pet-indesktop/status.json` | 插件名、版本、`behaviour`、路由列表、状态文件路径 |
| `GET` | `/dsh-pet-indesktop/state.json` | 读状态（缺字段补默认值） |
| `POST` | `/dsh-pet-indesktop/state.json/state` | 局部更新：校验通过才写，返回写入后的完整状态 |
| `GET` | `/dsh-pet-indesktop/assets/skins/<id>.png` | 某个皮肤的图片（`lib/assets/skins/<id>.png`）；`<id>` 必须是八个之一 |

**写入是严格的**，而且**必须是**：

```bash
# 移动桌宠（只更新 x/y，别的字段保留）
curl -X POST http://127.0.0.1:<端口>/dsh-pet-indesktop/state.json/state \
  -H 'content-type: application/json' -d '{"x": 20, "y": 30}'

# 藏起来
curl -X POST .../state.json/state -d '{"visible": false}'
```

| 情况 | 结果 |
| --- | --- |
| **未知字段**（`{"xpos": 10}`） | **400**，不是静默忽略 —— 打错字必须看得见 |
| 类型不对（`{"visible":"false"}`、`{"x":"30"}`、`{"name":7}`） | 400 + 指出是哪个字段、收到的是什么 |
| `x`/`y` 越界（`1e9`、`-50`） | **200，夹到 2..98** —— 范围本来就是干这个的，但 `issues` 里会说明 |
| 名字超过 24 字符 | **400，不截断** —— 悄悄改掉别人的宠物名比报错更糟 |
| 请求体超过 4096 字节 | **413**，在**边收边算**的时候就拒绝，不是收完再说 |
| JSON 坏了 / 空 body | 400 |
| 方法不对（`GET .../state.json/state`、`POST .../state.json`） | 405 |
| 被拒绝的更新 | **一个字节都不写**：不存在「写了一半」的状态 |

### 图片的缓存：`no-cache` + ETag，**不是** `no-store`

图片是一条**常量**：200 KB，永远不变（换图 = 重新构建 = 重启）。所以它和状态 JSON 的缓存策略必须相反：

| 路由 | 缓存头 | 为什么 |
| --- | --- | --- |
| `status.json` / `state.json` / 任何失败响应 | `no-store` | 它回答「现在是什么样」，缓存一份就等于缓存一个谎言 |
| **`assets/skins/<id>.png`（成功）** | **`no-cache` + 强 `ETag`** | 「留着，但每次问一下」：没变就是一次 **304**（无 body），变了才下载一次 |
| 图片路径下的任何 404 | `no-store` | 一个没有缓存指令的 404 会被启发式缓存，写错一次就一直 404 |

用 `no-store` 的后果很具体：**每次页面加载都重新下载 200 KB**。
`no-cache` 不是「不缓存」，而是「用之前先验证」—— 这正是 ETag 存在的意义。

`ETag` 是图片**内容的 SHA-256**（强校验，带引号），不是修改时间：
重启进程、重新克隆仓库都不会让它变，只有图片真的换了才会变。
`If-None-Match` 命中返回 `304` 且**没有 body**；`*` 也匹配；而一个过期的或弱校验（`W/"..."`）的值**不会**被当成命中 ——
否则换了图也永远发不出去。

## 设计：为什么用动态注入，为什么禁止静态 `inject`

这是本仓库最重要的一条约定，代价是真实事故换来的。

**静态 `inject` 的后果。** 如果客户端半边静态声明依赖（例如 `export const inject = ['slots', 'uiSession']`），
而宿主提供不了其中任何一个服务，那么这个插件的 fiber 会**永远停在 `pending`**。
而 web 启动检查把**任何非 `active` 的条目**都当作致命错误：

```
web boot: N entry did not activate
```

接下来发生的事情是：**整个图形界面起不来**。作者在 `dsh-boot-animation` 上真的遇到过，现场日志是：

```
dsh-boot-animation: pending (waiting for service: uisession)
```

一只桌宠不该有能力让人打不开工具。

**正确做法（本仓库采用）：**

- 客户端半边**不导出任何静态 `inject`**，两个服务都用 cordis 的**动态注入**解析：
  `ctx.inject(['slots', 'uiSession'], (ready) => { ... })`。
  等待发生在**子 fiber** 里，插件自己立刻就是 `active`，所以启动检查永远看不到 pending。
- 宿主提供不了服务时**安静待机**：没有动态注入、服务又不在时输出一行
  `[dsh-pet-indesktop] idle: host offers no dynamic injection and no uiSession`。
  对这类附加插件来说，这就是正确的失败姿势。
- 有一条路是**不输出**的，这是对的：宿主**有**动态注入但服务一直没到，回调根本不会运行，所以没什么可报告的；
  此时不报错、不挂载、也不留 pending，就是全部要求。
- 宿主半边可以静态 `inject`，但它声明的是 cordis **服务名** `['webServer']`，不是包名。
- **`peerDependencies` 里永远不要写 `@deepseek-ai/dsh-*`。** DSH ≥ 0.2.0 会**静默丢弃** peerDependencies
  对不上的插件；本仓库只保留一个可选的 `react`（`peerDependenciesMeta.react.optional = true`）。

`scripts/verify-client-boot.mjs` 直接对**已提交的产物** `lib/client.js` 断言这条不变量：它 stub 出
`window.__ModuleLoader__`、`react` 和 `document`，然后把这**当作脚本**求值（不 `import`），
再在四种服务情形下跑 `apply()`；它不依赖任何构建，也不要求生产代码提供任何「测试专用 API」。

## z-index：桌宠必须待在整屏覆盖层下面

| 层 | z-index | 谁 |
| --- | --- | --- |
| 整屏片头/覆盖层 | `2147483000` | 姊妹插件 `dsh-boot-animation` |
| **桌宠** | **`2147481000`** | 本插件 |
| 普通界面元素 | 低几千 | DSH 自己的界面 |

桌宠要**盖住普通界面**（不然会被页面内容压住），但必须**被整屏覆盖层盖住** ——
片头动画盖住整个画面时，桌宠也该一起被盖住，而不是浮在片头上面抢戏。
比 `2147483000` 低 2000，既留出了中间再插一层的余地，又永远不会反超一个整屏层。
两个数字都写在 `ARCHITECTURE.md` 里，都不是随手挑的。

## 必需的清单字段

`package.json` 里**两个** `dsh` 字段都要有，缺一个就装不上：

- `dsh.bundle = { "patch": "./cordis.patch.yml" }` —— 让这个包成为**配置层（profile layer）**。
  少了它，包装上了但什么也不做，只会得到一句 `declares no dsh.bundle` 警告。
- `dsh.client = { "inject": [...], "platform": "web" }` —— **只声明 `dsh.client` 会被插件市场拒绝**。

另外：不写 `prepare` / `postinstall`；`lib/` 里提交**纯 JS 产物**。

## 路由约定

前缀路由由宿主这样匹配：

```
pathname !== prefix && !pathname.startsWith(prefix + '/')
```

这条规则有两个容易搞反的后果，本插件两个都踩过：

1. 注册成 `.../state.json/` 会让匹配器去试 `.../state.json//`，**永远匹配不上任何真实请求**；
2. 前后缀会互相抢：如果同时注册 `/state` 和 `/state.json`，
   那么 `/state.json` 这个路径会被 `/state` **按前缀吃掉**
   （因为 `'/x/state.json'.startsWith('/x/state' + '/')` 是假的，但短前缀仍然匹配），
   于是**读状态的路由永远收不到请求**。

所以本插件**只注册一个状态前缀** `/state.json`，写路径挂在它下面（`/state.json/state`），
由 handler 自己按精确路径分发。`scripts/verify-routes.mjs` 用宿主**原始规则**驱动真实 handler，
并且专门断言「带尾斜杠的注册什么都匹配不到」，防止测试工具自己漂移。

关于缓存：本插件返回的是**状态**，不是媒体，所以 `no-store` 是刻意的
（一个被启发式缓存的 404，会在你修好之后继续在该浏览器里 404）。

## CSS 模板字符串的坑

客户端样式表放在模板字符串里，就在 `src/client/index.js`（也就是产物 `lib/client.js`）中。
**在 CSS 注释里写一个反引号会提前结束这个模板字符串**，而出错的样子完全不像 CSS 问题：
加载器会报一个指向 CSS 行的**JavaScript 解析错误**，同时**旧的 `lib/client.js` 留在原地**，
于是你改了但没生效、还以为自己改错了地方。

因此保留 `scripts/check-css-template.mjs`，并且让它**同时检查 `src/client/index.js` 和产物 `lib/client.js`**。
这一次它是真的抓到了一次：桌宠的样式表里有一个反引号，守卫直接报出了行号。

## 构建

```bash
node scripts/build.mjs
```

做四件事：

1. 把 `src/host/*.js` 复制到 `lib/host/*.js`（并清掉 `lib/host/` 里已经没有源文件的陈旧模块）；
2. 生成 `lib/index.js` 垫片（`export * from './host/index.js'`）；
3. 把 `src/client/index.js` **原样复制**成 `lib/client.js`，只在最前面加一段生成横幅
   （横幅里**没有反引号**，免得干扰 CSS 守卫的逐行扫描）；复制前后都会检查产物仍是
   `window.__ModuleLoader__.load({ ... })` 形状、且不含任何 ESM 语句；
4. 重写 `lib/.build-manifest.json`，并校验样式表两份副本一致。

**这里没有编译器（诚实交代）：** `lib/client.js` 是 `src/client/index.js` 加一段横幅，
**逐字节**相同（`scripts/verify-build.mjs` 会断言 `lib/client.js` 以 `src/client/index.js` 结尾）。
没有 tsdown、没有 TypeScript、没有 `npm install`，`package.json` 里也没有 `devDependencies` ——
因为 `factory` 只拿到 `require`，整个浏览器半边本来就必须是一个文件，打包器在这里无事可做。

换桌宠的画面，就是替换 `assets/skins/<id>.png`（保持文件名；显示宽度由 `PET_WIDTH` 控制），
然后重新构建 —— 构建会把 `assets/skins/*.png` 复制到 `lib/assets/skins/` 并记录进清单。

**新增一种皮肤**要同时动三处，否则构建会拒绝：
`assets/skins/<id>.png`（文件）、`src/host/index.js` 的 `SKIN_IDS`、`src/client/index.js` 的
`SKIN_IDS` + `SKIN_LABELS` + 一个色块颜色。这是有意的：三处不一致就会发一个点不开的色块。

## 校验

```bash
node scripts/check-css-template.mjs   # 样式表模板字符串没被打断（源码 + 产物两份）
node scripts/build.mjs                # 宿主复制 + 客户端复制（带横幅）+ 形状检查 + 清单
node scripts/verify-build.mjs         # 产物齐全；lib/client.js = 源码 + 横幅；清单字段齐全
node scripts/verify-routes.mjs        # 路由可达；状态校验/自愈/原子写/路径隔离
node scripts/verify-client-boot.mjs   # 产物无静态 inject；两个座位；四种服务情形；卸载
node scripts/verify-pet.mjs           # 桌宠的纯函数：夹取、姿态、减少动态、台词、未知输入
# 或者： npm run check
```

六个脚本都**不需要安装任何依赖**，全部针对已提交的产物运行。

## 已知限制（诚实交代）

- **没有在真实 DSH 宿主上安装验证过。** 校验脚本只针对产物文本和内存中的处理器运行。
- **react 渲染没有被验证过**：`verify-pet.mjs` 与 `verify-client-boot.mjs` 用的是 react stub，
  `createElement` 返回 `null`，所以「画出来是什么样」没人测过。
- **拖动、指针事件、触摸也没被验证过**：那些需要真实的 DOM。被验证的是**决策**（夹取、姿态、台词选择），
  以及座位、样式表、待机、卸载这些不依赖渲染的部分。
- 桌宠是 **一张 PNG + CSS**：没有视频、没有第三方请求，也没有声音。
- **画面不是本项目原创**：它带有 "OleapCrow" 的画师标记，由仓库所有者提供，授权情况见 `LICENSE`。
  八种皮肤是同一张画的**派生配色**（按区域调整色相/饱和度/明度，并把浅色布料与杯子做乘性着色），
  不是八张独立绘制的作品。
  动画节奏（浮动 / 摇摆 / 呼吸的周期）是本项目的设计选择，没有经过用研。

## 文件一览

```
package.json                    清单：dsh.bundle + dsh.client + exports（无 devDependencies）
cordis.patch.yml                让包成为配置层的 insert 行
src/host/index.js               宿主半边：status + 状态读写（严格校验、原子写、自愈）
src/client/index.js             浏览器半边：唯一源文件（加载器信封 + <img> + 样式表 + 纯函数）
assets/skins/<id>.png           八张皮肤（源，420x409，随包分发；由宿主半边提供）
lib/index.js                    生成的一行垫片（main / exports 指向它）
lib/host/index.js               宿主半边的产物
lib/client.js                   浏览器半边产物（= src/client/index.js + 生成横幅，无静态 inject）
lib/assets/skins/<id>.png       皮肤产物（= assets/skins/，逐字节复制；build 会清理陈旧文件）
lib/types/*.d.ts                类型声明
lib/.build-manifest.json        lib/ 里到底有什么
scripts/                        构建 + 六个校验脚本
submission/data/plugins/...     市场提交文件
ARCHITECTURE.md                 接线约定的「是什么 + 为什么」
CHANGELOG.md                    0.3.0：八种配色皮肤
```

## 许可

BSD-3-Clause，版权人 Gjs9178U，年份 2026。见 `LICENSE`。
