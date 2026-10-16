# ARCHITECTURE — 接线约定与原因

本文件只记录**不会随视觉改变的东西**：一个 DSH 插件怎么装进 profile、怎么挂上宿主、怎么保证不会把图形界面弄挂，
以及每条规则的**原因**。原因不是装饰：下面每一条都对应一次真实的失败。

> **当前实现：一只可拖动的桌宠（desktop pet）。** 视觉部分（鲸鱼的形状、动画节奏）可以随时被换掉，
> 而本文件里的约定不该跟着变。

---

## 0. 两个半边，一条边界

```
宿主进程 (Node)                       浏览器
┌──────────────────────────────┐      ┌───────────────────────────────┐
│ src/host/index.js            │      │ src/client/index.js           │
│  · inject: ['webServer']     │      │  · 无静态 inject              │
│  · status.json               │      │  · ctx.inject([...], cb)      │
│  · state.json (读)           │      │  · 纯函数决策 + SVG 渲染      │
│  · state.json/state (写)     │      │                               │
└──────────────────────────────┘      └───────────────────────────────┘
        ↓ lib/index.js 垫片                    ↓ lib/client.js（复制 + 横幅）
        ↓ $DSH_HOME/pet-indesktop/state.json
```

- **宿主半边**是普通 JavaScript，不 import 任何 DSH SDK。构建只是复制文件，Node 原生解析相对 ESM 导入，这一半没有打包器。
- **浏览器半边**是**一个纯 JavaScript 文件**，用 DSH 的加载器信封包起来（见第 0.1 节）。
- 两个半边**各自实现一次坐标夹取**（因为浏览器半边不能 import 任何东西），
  所以 `scripts/verify-pet.mjs` 拿同一个网格把两边都跑一遍，证明它们给出的答案逐项相同。
  这是本仓库里唯一一处刻意的重复，也是唯一一处必须用测试来钉住的重复。

## 0.1 客户端产物的形状：`window.__ModuleLoader__.load({ ... })`

**事实：DSH 的 web 外壳把客户端 bundle 当作一段脚本求值。** 它先定义 `window.__ModuleLoader__`，取回 bundle，
然后求值。因此产物里不能有 `import` / `export` —— ESM 产物在这段脚本里无处可去，加载器根本求值不了，
表现是「插件像没装一样」，而不是一条清晰的错误。

**信封写法是照抄的，不是发明的：** 姊妹插件 `dsh-boot-animation` 的已发布产物开头就是

```js
window.__ModuleLoader__.load({ id: "dsh-boot-animation", factory: (require) => { var module = { exports: {} }; ... } })
```

本仓库的 `src/client/index.js` 用的是同一个信封（只换 `id`），因为它是**已经被真实宿主加载过**的形状。
`react` 不在产物里：加载器把 `require` 交给 `factory`，插件在里面 `require('react')`；拿不到就待机。

**由此产生的一条硬约束：浏览器半边只能是一个文件。** `factory` 只拿到 `require`，不能 import 兄弟文件，
所以样式表、SVG、组件、纯函数都必须在 `src/client/index.js` 里。这不是偷懒，是信封的直接后果；
`lib/client.js` 由 `scripts/build.mjs` 复制生成，前后各加一段检查（形状 + 不许出现 ESM 语句）。

## 1. 安装路径：为什么 `lib/` 必须提交

`dsh plugin add github:Gjs9178U/dsh-pet-indesktop` 是**直接从 git 检出安装**的。

- 所以包里**不能有** `prepare` / `postinstall`：那既会让安装需要编译器，也会撞上 pnpm 的 `allowBuilds` 审批门。
- 所以 `lib/` 里的产物**必须在仓库里**，且必须是能直接加载的纯 JS。`.gitignore` 里专门写了一行注释说明
  `lib/` 不被忽略，因为这是最容易被「顺手加进 .gitignore」毁掉的一条。

## 2. 最重要的一条：客户端半边永远不要静态 `inject`

**规则：** 客户端半边不导出静态 `inject`；`slots` / `uiSession` 一律用 cordis 动态注入解析。

**原因：** web 启动检查把**任何非 `active` 的条目**当作致命错误 —— `web boot: N entry did not activate` ——
然后**整个 GUI 起不来**。而静态 `inject` 正是让 fiber 停在 `pending` 的原因：宿主提供不了那个服务，等待就永无止境。
现场日志长这样：

```
dsh-boot-animation: pending (waiting for service: uisession)
```

一只桌宠不该有能力让人打不开工具。动态注入把等待放进**子 fiber**，插件自己立刻 `active`，
于是「宿主没有这个服务」退化成「这个插件什么都不做」，而不是「用户的界面没了」。

**待机路径也是规范的一部分：** 宿主没有动态注入、服务又不在时，插件安静待机并输出一行
`[dsh-pet-indesktop] idle: host offers no dynamic injection and no uiSession`。
有一条路是**不输出**的，这是对的：宿主**有**动态注入但服务一直没到，回调根本不会运行，所以没什么可报告的；
此时不报错、不挂载、也不留 pending，就是全部要求。`DEBUG = false` 是默认值。

**由谁保证：** `scripts/verify-client-boot.mjs` 对**已提交的产物** `lib/client.js` 断言这条不变量
（`inject === undefined`，并且在两份文本里都不允许出现静态 `inject` 导出），
再在四种服务情形下跑 `apply()`：有服务、没服务、有动态注入、没有动态注入。

## 3. 两个座位，以及为什么藏起来必须是可逆的

| 座位 | id | order | 放什么 |
| --- | --- | --- | --- |
| `shell.overlay` | `dsh-pet-indesktop` | 700 | 桌宠本体 |
| `sidebar.footer.action` | `dsh-pet-indesktop-toggle` | 40 | 「桌宠 开 / 关」按钮（带 `label`） |

**为什么是两处而不是一处：** 如果桌宠是唯一能控制自己的东西，那么「藏起来」就是一个**单向门** ——
用户一旦点错，就再也没有入口把它叫回来。侧边栏按钮是那个入口，所以它是必需品，不是装饰。
`scripts/verify-client-boot.mjs` 对两个座位都断言 `name` / `id` / `order`，对按钮还断言 `label` 能渲染出文本
（一个没有 label 的侧边栏动作就是底部一个匿名小点）。

**z-index：**

| 层 | z-index | 谁 |
| --- | --- | --- |
| 整屏覆盖层 | `2147483000` | 姊妹插件 `dsh-boot-animation` |
| **桌宠** | **`2147481000`** | 本插件 |
| 普通界面 | 低几千 | DSH |

桌宠要盖住普通界面，但必须被整屏覆盖层盖住。低 2000 既留出中间插一层的余地，又永远不会反超一个整屏层。

**层本身不吃点击：** `.dpi-root` 是 `position:fixed; inset:0` 但 `pointer-events:none`，
只有鲸鱼自己那个盒子是 `pointer-events:auto`。否则一只坐在页面中间的桌宠会挡住整个页面。

## 4. 状态：为什么由宿主保存，以及三条保证

**为什么不放在 `localStorage`：** 那样状态就只属于**一个浏览器**。放在宿主里，状态属于这台机器上的这个 profile：
换浏览器还在，`curl` 能读能改，重启 DSH 也不丢。代价是宿主半边必须有一个路径，
而这个路径必须是**代码里的常量**，不能来自请求（见第 5 节）。

**文件：** `$DSH_HOME/pet-indesktop/state.json`（没设 `DSH_HOME` 时 `~/.dsh/...`）。

1. **原子写**：写 `state.json.tmp`（**同目录**的兄弟文件），再 `rename()` 盖上去。
   同目录内的 `rename` 是原子的：崩溃或并发写只会留下旧的或新的，不会留下半个。
   临时文件**不能**放系统临时目录：跨文件系统的 `rename` 退化成复制，就不再原子。
2. **自愈读**：缺失/读不了/太大/JSON 坏/被手改，都**不抛异常**、不端出脏数据。
   每个字段过一遍 HTTP 层用的**同一个**校验器：越界夹回、不能用退回默认，并在响应的 `issues` 里说明。
   **同一个校验器**是关键：如果文件和 HTTP 走两条规则，手改文件就能让它端出 HTTP 会拒绝的东西。
3. **载荷里没有路径**：路径 = 状态根 + 两个常量。请求体里装的是桌宠在哪，不是往哪写。
   `scripts/verify-routes.mjs` 会送一个带 `path` 字段的载荷，断言它是 400，并且断言状态目录里
   只有状态文件本身。

**校验的两种严格度，一个函数：** `sanitizeState(raw, { strict })`。HTTP 用 `strict: true`（类型不对就 400，
因为「发错了还以为成功了」是最难查的 bug）；文件用 `strict: false`（类型不对退回默认值并报告，
因为「配置文件打错一个字就找不到桌宠」是更糟的结果）。**越界在两种模式下都只是夹取**，
因为范围本来就是干这个的。未知字段在 strict 下**拒绝**（`{"xpos":10}` 不能悄悄什么都不做还回 200），
在文件模式下**丢弃**。

## 5. 路由：前缀、尾斜杠、互相抢、缓存

**前缀末尾不能有斜杠。** 宿主的匹配规则是：

```
pathname !== prefix && !pathname.startsWith(prefix + '/')
```

注册成 `.../state.json/` 时，匹配器会去试 `.../state.json//`，没有任何真实请求以它开头 —— 路由**永远不触发**。

**短前缀会抢长路径。** 这条更隐蔽：如果同时注册 `/state` 和 `/state.json`，
那么请求 `/state.json` 会被 `/state` 吃掉 —— 边界判断 `'/x/state.json'.startsWith('/x/state' + '/')` 是**假**的，
但 `/state` 仍然匹配 `/state.json`（它只是不以 `/state/` 开头），于是**读状态的路由永远收不到请求**。
本插件因此**只注册一个状态前缀** `/state.json`，把写路径挂在它下面（`/state.json/state`），
并且这个后缀是从前缀**算出来的**，不是抄两遍。

**前缀路由要为它下面的所有路径负责。** 前缀会接收 `/dsh-pet-indesktop/**` 的全部请求，
所以 handler 自己必须对「不是我那条路」的请求回 404，而不是把自己的载荷端到不存在的地址上。
`scripts/verify-routes.mjs` 直接复刻宿主的规则来驱动真实 handler，并额外断言「带尾斜杠的注册什么都匹配不到」：
如果哪天这条通过了，说明测试工具已经和宿主的规则脱节，其余断言也就不值钱了。

**缓存：**

| 场景 | 头 | 为什么 |
| --- | --- | --- |
| 状态 / JSON / 任何失败响应（本插件现状） | `no-store` | 它回答的是「桌宠现在在哪」。而且一个没有缓存指令的 404 会被启发式缓存：路由坏过一次，修好之后那个浏览器还在 404 |
| **将来要发的媒体资源** | **`no-cache` + `ETag`** | 媒体体量大、内容不变，要的是「每次校验、命中就 304」。**`no-store` 在这里是错的** |

## 6. 决策是数据：为什么桌宠的判断要导出成纯函数

`nextPose(state, event, now)`、`poseAt`、`stanceAt`、`clampPosition`、`clampPercent`、`pickLine`、
`pickMode`、`blinkAt`、`swayAt`、`breathAt` —— 全部是**纯函数**，全部从 bundle 里导出。

**原因：** 如果「什么时候眨眼」「拖到边界怎么办」「说哪句话」写在渲染里，那么唯一能验证它们的方式就是
在浏览器里画一只鲸鱼然后**用眼睛看**。本仓库的校验脚本没有浏览器，所以那样写等于这些行为**完全没有被验证过**。
把它们做成纯函数之后，`scripts/verify-pet.mjs` 用数字就能把整个矩阵跑完：四个边界、越界、NaN、
未知事件、减少动态、台词全覆盖。

**减少动态是静帧，不是慢动作。** `prefers-reduced-motion: reduce` 返回 `sway: 0, breath: 0, blinking: false`，
并且 `verify-pet.mjs` 会采样 30 秒证明它**只有一个取值**（同时采样普通模式，证明它不是「因为什么都没变」才通过的）。
「减少」不等于「放慢」：慢速的呼吸仍然是动画。

**未知输入被忽略，不抛异常。** 未知模式退回 `idle`，未知事件不改变模式而是被原样回显。
桌宠是装饰品，一个会抛异常的装饰品会把整个界面一起带走。

## 7. CSS 模板字符串：不要放反引号

样式表放在模板字符串里，就在**浏览器半边的唯一源文件** `src/client/index.js`（产物 `lib/client.js`）。
**注释里的一个反引号就会提前结束这个模板字符串**，而出错的样子完全不像 CSS 问题：

1. 加载器报的是**解析错误**，指向某一行 CSS；
2. **旧的 `lib/client.js` 还在原地**，于是改动静默地没有发布。

本插件第一次写样式表时就踩了：`/* ... the pure `blinkAt` decision ... */` 里的反引号直接打断了模板字符串，
`scripts/check-css-template.mjs` 报出了行号。守卫**同时检查源码与产物两份**，
`scripts/build.mjs` 生成的横幅里也**一个反引号都没有**，免得干扰这段逐行扫描。

## 8. 这套约定不包含什么

- 不包含「已对真实 DSH 宿主验证过」这种断言。本目录里的校验脚本全部针对**产物文本、内存中的 handler
  和纯函数**运行，不能替代一次真实的安装。
- 不包含 react 渲染、指针事件与触摸的验证：那些需要真实 DOM。被验证的是**决策**，
  以及座位、样式表、待机、卸载这些不需要渲染的部分。
- 不包含媒体管线、片源注册表、设置界面 —— 姊妹插件有，这个桌宠故意没有。

## 9. 校验清单

```bash
node scripts/check-css-template.mjs   # 样式表模板字符串没被打断（源码 + 产物两份）
node scripts/build.mjs                # 宿主复制 + 客户端复制（带横幅）+ 形状检查 + 清单
node scripts/verify-build.mjs         # 产物齐全；lib/client.js = 源码 + 横幅；入口导出的性质
node scripts/verify-routes.mjs        # 路由按宿主的真实规则可达；状态校验/自愈/原子写/路径隔离
node scripts/verify-client-boot.mjs   # 产物无静态 inject；两个座位；四种服务情形；卸载
node scripts/verify-pet.mjs           # 纯函数：夹取（两边一致）、姿态、减少动态、台词、未知输入
```

六个脚本都不需要安装依赖，也不运行打包器 —— 这正是这个骨架能被验证的原因。
`verify-client-boot.mjs` 与 `verify-pet.mjs` 把产物**当脚本求值**（stub `window.__ModuleLoader__` /
`require` / `document` / `console`），不 import 它：这正是宿主加载它的方式。
