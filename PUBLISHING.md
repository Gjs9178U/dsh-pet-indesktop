# 发布手册（从这台机器交到你手上之后）

**当前状态：本地仓库已就绪，但还没有推送到 GitHub。**

原因很直白：生成这个仓库的机器上**没有 git、没有 GitHub CLI、也没有任何 GitHub 凭据**
（`~/.ssh` 为空、没有 `~/.gitconfig`、Windows 凭据管理器里没有 github 条目、
`.dsh/.credentials.yaml` 里也没有 GitHub 令牌）。所以「创建远端仓库」和「推上去」这两步
**只能由你在自己有凭据的机器上完成**，例如你平时开发用的 `C:\Users\高振杰\dsh-dev\`。

本文件给出两条路：**A. 用 bundle 文件搬过去**（推荐，本机就能产出），
**B. 网页建仓 + 命令行推送**。最后是市场投稿那一步。

---

## 一、已经替你做完的事

| 项目 | 状态 |
|---|---|
| 仓库内容（`src/` `lib/` `scripts/` 文档 `submission/`） | ✅ 已写好 |
| `lib/` 构建产物已提交（不需要 `prepare`，不触发 pnpm `allowBuilds`） | ✅ |
| `package.json` 同时声明 `dsh.bundle` + `dsh.client`（市场闸门 1 的硬要求） | ✅ |
| 没有任何 `@deepseek-ai/dsh-*` 的 `peerDependencies`（不会被版本闸门静默跳过） | ✅ |
| 客户端半边只用**动态注入**，没有静态 `inject`（不会把整个 GUI 弄挂） | ✅ |
| git 仓库已 `init`，分支 `main`，作者身份已设 | ✅ |
| 提交（commit） | ✅ 见下 |
| **推送到 GitHub** | ❌ **做不到：本机无凭据** |
| **在 GitHub 上创建仓库** | ❌ **做不到：需要 API 凭据** |

提交身份（与 `dsh-boot-animation` 保持一致，避免把真实邮箱写进公开历史）：

```
Gjs9178U <343280832+Gjs9178U@users.noreply.github.com>
```

想换成真实邮箱，在推送**之前**改：

```sh
git config user.email "你的真实邮箱"
git commit --amend --reset-author --no-edit
```

---

## 二、路线 A（推荐）：把仓库搬到你有 git 的机器

生成仓库的那台机器上，已经**同时产出了一个单文件 bundle**（含完整提交历史）：

```
dsh-pet-indesktop.bundle
```

把它拷到你的开发机（U 盘 / 网盘 / 随便什么方式），然后：

```sh
cd C:\Users\高振杰\dsh-dev
git clone dsh-pet-indesktop.bundle dsh-pet-indesktop
cd dsh-pet-indesktop
git remote remove origin
```

bundle 里**没有**远端地址，所以接下来按路线 B 的「第 2 步」建仓并推送即可。

> 为什么要用 bundle 而不是直接拷文件夹：拷文件夹会连 `.git` 一起拷，通常也能用，
> 但 bundle 是 git 自己认的传输格式，`git clone` 之后 `git fsck` 干净、历史完整。

---

## 三、路线 B：建仓 + 推送

### 第 0 步：在开发机上确认 git 可用

```sh
git --version
```

### 第 1 步：进入仓库

```sh
cd C:\Users\高振杰\dsh-dev\dsh-pet-indesktop
```

### 第 2 步：在 GitHub 上创建远端仓库

**方式一：网页（不需要 gh CLI，约 20 秒）**

1. 打开 <https://github.com/new>
2. **Repository name** 填：`dsh-pet-indesktop`
3. Owner 选 `Gjs9178U`，可见性选 **Public**
4. **什么都不要勾** —— 不要勾 "Add a README file"、不要勾 `.gitignore`、不要选 license。
   勾任何一个都会产生一个远端提交，让下面的 `git push` 变成非快进（non-fast-forward）而被拒。
5. 点 **Create repository**

**方式二：用 gh CLI（如果装了）**

```sh
gh repo create Gjs9178U/dsh-pet-indesktop --public --source . --push
```

这一条等于把第 2、3 步一起做完了。

### 第 3 步：接上远端并推送

```sh
git remote add origin https://github.com/Gjs9178U/dsh-pet-indesktop.git
git push -u origin main
```

推送时会要凭据。**密码不能用账号密码**，要用 **Personal Access Token（classic，勾 `repo`）
或 fine-grained token（对该仓库给 Contents: Read and write）**。
Windows 上通常由 Git Credential Manager 弹窗接管，选 "Sign in with your browser" 最省事。

### 第 4 步：验证

```sh
git ls-remote https://github.com/Gjs9178U/dsh-pet-indesktop
```

能列出一行 `refs/heads/main` 就成功了。

### 第 5 步：加 topic（市场闸门不查，但建议做）

GitHub → 仓库 → 右上 **⚙ Settings** 旁边 → **Topics** → 加 `dsh-plugin`。

### 第 6 步：重命名的情况（如果远端已存在同名仓库）

如果你已经建过 `dsh-pet-indesktop` 只是想覆盖内容，**不要**用 `--force` 覆盖别人的历史。
先 `git fetch origin && git log origin/main` 看一眼远端有什么，再决定合并还是换名字。

---

## 四、市场投稿（可选，等仓库建好再做）

市场不是这个仓库，而是由数据文件生成的大仓库：

- 注册表：`https://awesome-dsh-plugin.com/plugins.json`
- 数据源：`https://github.com/awesome-dsh-plugin/awesome-dsh-plugin`
- **一次投稿 = 往数据源加一个文件**：`data/plugins/Gjs9178U__dsh-pet-indesktop.yml`

要提交的内容**已经放在本仓库里**，原样复制：

```
submission/data/plugins/Gjs9178U__dsh-pet-indesktop.yml
```

步骤（网页，约 1 分钟）：

1. 打开 <https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/fork> → **Create fork**
2. 在你的 fork 里：**Add file** → **Create new file**
3. 文件名填：`data/plugins/Gjs9178U__dsh-pet-indesktop.yml`
4. 内容粘贴 `submission/` 里那份，**一个字节都不要改**
5. **Commit changes** → 回 fork 首页 → **Contribute** → **Open pull request**

⚠️ **只交这一个 `.yml`。** 不要手工改 `README.md` / `README.zh.md`（由 yml 生成，
生成结果永远冲突）。文件名必须**恰好**是 `owner__repo`，且必须在 `data/plugins/` 下**恰好一层**。

### 投稿前请先想清楚一件事

市场的年龄闸门要求**仓库创建满 24 小时**（不是提交后 24 小时，是仓库本身的年龄）。
它会先红一下然后自己变绿，**不需要重新提交**。

这个插件**已经是一个能用的功能**，不再是占位骨架；`status.json` 里的
`behaviour: "desktop-pet"` 说的就是它现在的形状。投稿时唯一要诚实交代的是：
**它没有在真实的 DSH 宿主上装过**（校验脚本只针对产物与内存中的处理器运行）。

---

## 五、改桌宠要动哪里

1. **换画面**：替换或新增 `assets/skins/<id>.png`（保持文件名；显示宽度由 `PET_WIDTH` 控制）。
   构建会把 `assets/*.png` 复制到 `lib/assets/`，宿主半边从那里读。
   画面带有 "OleapCrow" 标记、由仓库所有者提供 —— 换图时如果换成别人的作品，**必须更新 `LICENSE` 与两版 README 的署名**。
2. **改行为/样式**：改 `src/client/index.js` —— **样式表、纯函数决策、`<img>` 与 React 组件都在这一个文件里**
   （加载器信封的 `factory` 只拿到 `require`，不能 import 兄弟文件，所以只能是一个文件）
3. `node scripts/build.mjs` 重新生成 `lib/client.js`（复制 + 生成横幅）、`lib/host/*` 与 `lib/assets/*`
4. 跑验证：`npm run check`（CSS 模板守卫 + 构建 + 路由 + 启动安全 + 桌宠纯函数）。
   换图之后 `verify-build.mjs` 会检查「`lib/assets/skins/` 与 `assets/skins/` 逐字节相同、PNG magic bytes，且客户端与宿主的 id 列表和目录三者一致」，
   `verify-routes.mjs` 会检查图片路由的 200/304/404 与 ETag —— 两者都会因为一张坏图而变红，这是好事。
5. **升版本号**并打 tag：

   ```sh
   npm version patch
   git push --follow-tags
   ```

   客户端 bundle 的 URL `rev` 是进程 nonce、不随内容变化，所以**用户升级后必须
   重启 DSH 服务 + Ctrl+Shift+R** 才能看到新版。README 里已经写明这一条。

6. 如果改了**视觉或行为**，顺手更新 README 的「桌宠的行为」表与 `CHANGELOG.md`；
   如果改了**坐标范围或状态字段**，必须同时改
   `src/host/index.js` 与 `src/client/index.js` 两边的夹取规则 ——
   `node scripts/verify-pet.mjs` 会用同一个网格把两边跑一遍，不一致就会红。

---

## 六、许可

BSD-3-Clause，见 [LICENSE](LICENSE)。
