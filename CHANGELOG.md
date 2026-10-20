# Changelog

All notable changes to this project are documented here.
本文件记录本项目的所有重要变更。

---

## 0.5.0 — 2026-01-05

### 记仇、记好、黏人、怕生：她会记着你了 / She remembers you now

0.4.0 的性格是「当下」的脾气；0.5.0 加的三条**跨会话**，靠 `state.json` 里的五个计数活下来。
台词仍然照作者写定的文案表，**逐字照搬**：v2 追加 12 条（`greet-cold` / `greet-warm` / `reunited` / `shy`
各 3 条），总数 26 + 12 = **38 条**。

### 新增 / Added

- **五个持久化计数**：`fatCalls`、`nickCalls`、`countersDay`、`lastSeenAt`、`totalInteractions`。
  - 非负整数、上限 100000、负数夹到 0；
  - `countersDay` 是 `YYYY-MM-DD`（本地时间），形状不对**自愈成今天**；
  - `lastSeenAt` 是 epoch ms，比现在晚一天以上按时钟偏差夹回；
  - **0.4.0 的 state 文件没有这些键 → 静默升级**（每项都有默认值）；
  - 校验仍然严格：未知键 400、类型不对 400 并说明。
- **入口函数 `nextGreeting(state, now, config)`**：纯函数，时钟与配置都可注入。优先级
  **cold > warm > reunited > shy > normal**：
  - 今天被叫「大肥鱼」≥ 3 次 → `cold`；
  - 今天被叫「鲸鲸」≥ 3 次 → `warm`（冷优先于暖：**仇比好记得久**）；
  - 离开 > 30 分钟 → `reunited`（`lastSeenAt` 为 0 表示从没见过，不算久别）；
  - 累计交互 < 3 次 → `shy`；
  - 否则 `normal`。
  - **日期翻篇**：`countersDay !== today` → 两个计数清零并重记今天，`rolledOver` 在返回值里可见。
- **接线**：进会话时从宿主读计数，由入口函数决定用哪一桶招呼，**一次会话只打一次招呼**
  （`greeted` 布尔量，重渲染不会重复）；`call-fat` / `call-nick` / `click` 各自加计数并即时 POST。
  躺平期间被吸收的点击**不计数**，否则可以刷。
- **拒绝实现「感知 DSH 状态」**：没有验证到可信的「忙碌」字段，标为**待确认**并写进 `ARCHITECTURE.md`；
  不硬编猜出来的字段。

### 修复 / Fixed

- **`update()` 吞掉了本轮的 `issues`**：合并后的状态已经夹过一次（超上限、日期自愈），但写回时又
  sanitize 一次，返回的 issues 只剩第二次的，于是**客户端收到 200 却不知道自己被夹过**。现在会带上。
- **负数计数被拒绝**，而越界坐标是夹取的。现在一致：**范围用夹取，类型才拒绝**。

### 校验 / Verification

- `verify-pet.mjs`（742 → 975 条）：十三桶、38 条、双语非空、气泡长度、无软件自指、「肥」自指守卫覆盖新行；
  **入口函数矩阵**（五种结局、优先级四条、`fatCalls` 2/3、`nickCalls` 2/3、离开 30min−1 / **恰好** / +1、
  跨零点前后各一毫秒、`totalInteractions` 2/3、`lastSeenAt` 为 0、注入 config、不修改入参、垃圾输入不抛、
  客户端与宿主的日期戳一致、新四桶每一条都可达）。
- `verify-routes.mjs`（259 → 309 条）：五个计数往返、部分更新只改named 的那个、超上限夹取并说明、
  负数夹到 0、六种错误类型各 400、坏的 `countersDay` 自愈并说明、手改文件五个字段全坏仍 200 且**保住坐标与皮肤**、
  0.4.0 形状静默升级（`healed: false`）。
- `verify-client-boot.mjs`（114 → 134 条）：招呼气泡**重渲染不累加、不重复、过期后不再出现**；
  四桶都在产物里、都能从 picker 取到。

### 已知限制 / Known limitations

- **仍然没有在真实 DSH 宿主上安装验证过。** 计数与入口函数只在数据层与内存 handler 上验证过。
- 招呼的**观感**、以及「你走挺久」在真实计时下是否真的出现，没有被浏览器验证过。
- 「感知 DSH 状态」**没做**，原因见 `ARCHITECTURE.md` 的待确认一节。

---

## 0.4.0 — 2026-01-04

### 性格：一只会生气的鲸鱼 / A personality: the whale has opinions now

**桌宠不再只是一张会动的图，她有性格了。** 台词是作者写定的文案表，**逐字照搬**；行为由一张数据表加一个
纯转移函数实现，不在 JSX 里。

### 新增 / Added

- **文案表 `PERSONA_LINES`**：按事件分九桶 —— `greet`、`click`、`call-fat`、`call-nick`、`lazy-start`、
  `lazy-click`、`lazy-end`、`idle-drift`、`skin-switch`，共 26 条，每条 `{ zh, en }` 双语。
- **心情状态机 `nextMood(state, event, now, config)`**：四种心情（`idle` / `happy` / `annoyed` / `lazy`），
  五种事件（`call-fat` / `call-nick` / `click` / `idle-for-a-while` / `lazy-ends`），**config 可注入**，
  所以测试不依赖挂钟常量。
  - `call-fat` → `annoyed`（她坚称自己不胖）；
  - `call-nick` → `happy`（只有「鲸鲸」让她满意）；
  - 窗口内连点 N 次 → `lazy`（默认 4 次 / 2.6 秒），躺平期间**吸收一切事件**，点她也**不弹气泡**
    （只给一句 `lazy-click` 嘀咕，`speak:false`），到时间自己起来；
  - 未知事件**原样忽略**，不抛异常。
- **两个称呼按钮**：面板里八色块下面的「叫它 大肥鱼」与「叫它 鲸鲸」，都带中英双语 `aria-label`。
  这是用户唯一能触发傲娇反应的入口。
- **躺平姿势**：压扁 + 倾斜，同时停掉浮动/摇摆/呼吸三组动画。纯 CSS 变换，**没有新增图片资产**，
  八种皮肤照常可用。
- **角落漂移**：十分钟无交互后游到最近的角，**只改视觉**（`transform` 过渡），
  **绝不写回 `state.json` 的 `x`/`y`**；任何交互立刻取消；漂移开始时说一句 `idle-drift`，每次漂移只说一次。
- **换肤与亮相也说话**：换皮肤说 `skin-switch`，第一次挂载说 `greet`，都走同一个气泡机制。

### 校验 / Verification

- `verify-pet.mjs`（286 → 732 条断言）：逐条检查文案表（九桶齐全、26 条、双语非空、气泡长度、
  无软件自指、**"肥"自指守卫**）；穷举心情矩阵（四种心情可达、窗口/躺平边界各差 1ms、未知事件、
  注入 config、确定性、垃圾输入不抛）；台词选取（确定性、不重复上一条、每桶全可达）；
  以及漂移的"只改视觉"硬断言。
- `verify-client-boot.mjs`：两个称呼按钮（双语 `aria-label`、可点、带文字）、八色块仍在、
  躺平人格**不产生气泡**而会说话的人格**恰好产生一个**、reduced-motion 与躺平姿势都停掉三组动画。
- `verify-build.mjs` / `verify-routes.mjs`：行为不变，保持绿色。

### 已知限制 / Known limitations

- **仍然没有在真实 DSH 宿主上安装验证过。**
- **气泡的实际观感、躺平姿势好不好看、漂移过程顺不顺滑，都没有被验证过**——那需要真实浏览器。
  被验证的是数据结构、状态转移、标记与样式规则的存在性。
- 文案是逐字照搬的：如果将来要改角色口径，改的是文案表，不是校验脚本。

---

## 0.3.0 — 2026-01-03

### 八种配色皮肤 / Eight colour skins

**桌宠现在叫「大肥鱼」/ "Big Fat Fish"，有八种皮肤可以随时切换。**
**（历史：0.4.0 起她有了性格，0.5.0 起她会记事，见上。）**
0.2.0 只有一张图；0.3.0 把画面按区域重新配色，做出了八种读起来确实不同的样子
（头发、鳍、尾巴和描线换色相/饱和度/明度；白色袖子、杯子和徽章做乘性着色；皮肤不动）。

| id | 名字 | 看起来 |
| --- | --- | --- |
| `deepsea` | 深海蓝 / Deep Sea | 原始蓝色 |
| `sakura` | 樱花粉 / Sakura | 粉 |
| `mint` | 薄荷绿 / Mint | 薄荷绿 |
| `twilight` | 暮光紫 / Twilight | 紫 |
| `caramel` | 焦糖金 / Caramel | 琥珀金 |
| `silver` | 雪白银 / Silver | 近乎白色 |
| `ink` | 墨黑 / Ink | 近黑的海军蓝 |
| `ember` | 余烬红 / Ember | 红 |

### 新增 / Added

- **八张皮肤资产**：`assets/skins/<id>.png`（420x409 RGBA，每张约 200 KB），构建时逐字节复制到
  `lib/assets/skins/`，并清理陈旧文件。`assets/pet.png` 已删除（`deepsea` 与它同源，留着就是纯重复）。
- **皮肤路由**：`GET /dsh-pet-indesktop/assets/skins/<id>.png`。
  - `<id>` **只**与八项白名单比较，绝不作为路径片段；路径由**列表里的那一项**拼出。
  - 未知 id、错误形状、`/assets` 下其他路径 → **`no-store` 的 404**（由本插件回，不是宿主的）。
  - 每张图各自的 `no-cache` + 强 `ETag`（内容 SHA-256）、`If-None-Match` → 304 无 body、弱校验不算命中。
- **状态增加 `skin` 字段**：与路由共用同一份白名单，默认 `deepsea`。未知值 → **400 并说明**；
  手改 `state.json` 里的坏值 → **回落到默认**并报告 `healed`，不崩、不端出坏值、
  不带一个会 404 的 `<img>`；旧版没有这个字段的文件被静默升级。
- **侧边栏变成小面板**：显示/隐藏 + **八个色块**。每个色块是带 `aria-pressed` 与中英双语
  `aria-label` 的 `<button>`（不是一个没有名字的彩色圆点）；面板是 `role="group"`，Esc 关闭。
  点色块立刻换图并 POST 选择，刷新后仍在。
- **换肤不重启动画**：只换 `<img>` 的 `src`，外面三层 `div`（摇摆 / 浮动 / 呼吸）保持挂载，
  `<img>` 上没有 React `key` —— 所以不会跳一下。

### 校验 / Verification

- `verify-build.mjs`：八个资产都存在、与源逐字节相同、PNG magic bytes；**客户端列表 = 宿主列表 = 目录内容**
  （三者必须完全一致，多一个少一个都失败）；每张 420x409；manifest 记录 `skins` / `skinsBytes`。
- `verify-routes.mjs`：八个皮肤各自 200 + `image/png` + 内容哈希 ETag；304 路径；八个 ETag 两两不同；
  未知 id / 十几种穿越形态 → `no-store` 404 且不返回任何一张图或 `package.json`；
  `state.json` 的 `skin` 往返；坏 skin 的 POST → 400；文件里的坏 skin → 默认值。
  另外**直接驱动 `asset server.load(id)`**，证明只有真正的 id 才触达文件系统。
- `verify-client-boot.mjs`：面板标记（八个色块、双语 label、唯一 `aria-pressed`、`<img>` 无 key）；
  两个座位与原有全部场景不变。
- `verify-pet.mjs`：`resolveSkin` 的输入空间（31 个未知/恶意值全部回落到默认）；
  由任何恶意值拼出的 URL 都是 `assets/skins/` 下的普通路径；客户端与宿主白名单一致。

### 已知限制 / Known limitations

- **仍然没有在真实 DSH 宿主上安装验证过。**
- **面板的点击与换肤后的实际观感没有被验证过**：那需要真实 DOM 与浏览器。
  被验证的是标记结构、路由行为、状态往返与 `resolveSkin` 的决策矩阵。

---

## 0.2.0 — 2026-01-02

### 桌宠换上了真正的角色图 / The pet is the real artwork now

**0.1.0 里那只内联 SVG 画的小鲸鱼是占位画面，现在没有了。** 0.2.0 的画面是仓库所有者提供的一张
**420x409 的 PNG**——一个蓝头发、鳍状耳朵、鲸鱼尾巴、捧着白色杯子的手绘小角色。
**（历史：0.2.0 只有这一张图，0.3.0 起它被扩成八种配色，见上。）**

### 新增 / Added

- **图片资产**：`assets/pet.png`（206,557 字节，RGBA）随包分发，构建时复制到 `lib/assets/pet.png`
  （逐字节，且会清理 `lib/assets/` 里的陈旧文件）。构建会校验 PNG magic bytes，
  并记录进 `lib/.build-manifest.json` 的 `assets` / `assetsBytes`。
- **图片路由**：`GET /dsh-pet-indesktop/assets/pet.png`，由插件自己的宿主半边提供。
  - `content-type: image/png`，`cache-control: no-cache`，**强 `ETag`（内容 SHA-256）**。
  - `If-None-Match` 命中 → **304**，无 body；`*` 也匹配；过期或弱校验不匹配。
  - 前缀注册在 `/assets` 目录上，所以 `/assets/` 下的未知路径由本插件回一个 **`no-store` 的 404**，
    而不是落到宿主的 404（后者无缓存指令、无诊断）。
  - **路径永远不来自请求**：文件位置 = 包根目录 + 两个常量。读失败只让这一条路由 500，不影响宿主。
- **为什么不是 `no-store`**：图片是常量、约 200 KB。`no-store` 会让**每次页面加载都重新下载**；
  `no-cache` + ETag 是「留着，但每次问一下」——没变就是一次无 body 的 304。这条规则写进了 `ARCHITECTURE.md`。
- **客户端改用 `<img>`**：`src=` 指向上面的 URL，宽 **160 CSS px**（`height:auto` 保持比例），
  `draggable={false}`、`pointer-events:none`，拖动仍然挂在包裹层上（否则浏览器自带的图片拖拽会和手势打架）。
  `alt=""`：可访问控件是那个 `role="button"` 的包裹层，不是图片本身。
- **闲置动效移进 CSS**：外面两层 `div` 分别承担**浮动**（5.2s）与**左右摇摆**（5.2s），
  图片自己承担**呼吸缩放**（3.2s）。两个周期不互为倍数，读起来不像循环。
  `prefers-reduced-motion: reduce` → 全部 `animation:none`，**静帧**，不是慢速动画。
- **校验**：`verify-build.mjs` 断言图片存在、是 PNG、与源逐字节相同、客户端引用了那个 URL；
  `verify-routes.mjs` 断言 200/304/404、ETag 是内容哈希、以及各种路径探测都是 404；
  `verify-client-boot.mjs` 现在会**记录组件构建出的元素**，断言渲染的是 `<img>`、`src` 正确、
  且不再有内联 SVG。

### 移除 / Removed

- 内联 SVG 的鲸鱼图形与它的 CSS 规则（`.dpi-whale` / `.dpi-tail` / `.dpi-fin` / `.dpi-spout` /
  `.dpi-eye` / `.dpi-blush` 及 `dpi-hop`、`dpi-fin-beat`、`dpi-spout` 三组 keyframes）。
- 「眨眼」不再有画面可动（眼睛在图片里，不在 DOM 里），所以 `.dpi-blinking` 的样式没有了；
  `blinkAt` 纯函数仍然导出并仍然被验证，只是暂时没有渲染目标。

### 署名 / Attribution

- 画面带有 **"OleapCrow"** 的画师标记，由**仓库所有者提供**，不是本项目的原创绘制，
  也不是 DeepSeek 官方素材。授权情况见 `LICENSE`：**supplied by the repository owner; see LICENSE**。

### 已知限制 / Known limitations

- **仍然没有在真实 DSH 宿主上安装验证过。**
- **react 渲染和拖动手势仍然没有被验证过**（需要真实 DOM 与浏览器）；
  被验证的是产物的结构、路由行为、以及桌宠的纯函数决策矩阵。
- 图片的视觉效果（角色长什么样、动效好不好看）没有经过用研。

---

## 0.1.0 — 2026-01-01

### 第一版：一只真的桌宠 / First release: a real desktop pet

**这不是骨架版本。** 它发布的是一个**能用的功能**：一只住在 DSH 网页界面里的桌宠。

### 新增 / Added

- **桌宠本体**（`shell.overlay`，`order: 700`）：一只有占位画面（内联 SVG 画的小鲸鱼）的桌宠。
  它会缓慢呼吸（3.2s）、偶尔眨眼（纯函数 `blinkAt` 决定时机）、尾巴轻摆（5.2s，
  与呼吸周期不互为倍数，读起来不像循环）。
  **（历史：这只 SVG 鲸鱼已在 0.2.0 被真正的角色图替换，见上。）**
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
- 视觉细节（当时的鲸鱼形状、动画节奏）是作者的设计选择，没有经过用研。

### 不变量 / Invariants（不要改）

- 客户端半边**不导出静态 `inject`**：静态依赖会让 fiber 永远 `pending`，
  web 启动会把任何非 `active` 条目当作致命错误，**整个 GUI 起不来**。
- `peerDependencies` 里**永远不出现** `@deepseek-ai/dsh-*`（DSH ≥ 0.2.0 会静默丢弃对不上的插件）。
- 路由前缀**不带尾斜杠**；**也不要注册两个会互相抢的前缀**。
- 桌宠的 z-index（`2147481000`）必须**低于**整屏覆盖层的 `2147483000`。
- 桌宠的坐标是**视口百分比（2..98 的整数）**，两个半边用同一套夹取规则。
- 将来发媒体资源时用 **`no-cache` + `ETag`**，不用 `no-store`。
