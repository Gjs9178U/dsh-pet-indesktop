# dsh-pet-indesktop

## Status / 状态

> **A working desktop pet: a real feature, not a stand-in.**
>
> What it does: puts a **hand-drawn little character** (blue hair, fin ears, whale tail, holding a white cup) in the
> bottom-right corner of the DSH web GUI. It **bobs, sways and slowly "breathes"**. **Press and drag** to move it
> (mouse or touch) and it remembers where you left it. **Click it** and it says one line, Chinese over English, which
> disappears by itself. A "桌宠 开 / 关" button in the sidebar footer hides it and brings it back.
>
> How it is drawn: **one PNG shipped with the plugin**, served by the plugin's own host half
> (`/dsh-pet-indesktop/assets/skins/<id>.png`), with the motion in CSS around them. **There are no third-party requests**:
> image, script and styles all come from the same package and the same process.
>
> **Attribution:** the artwork carries an **"OleapCrow"** mark and was **supplied by the repository owner**. It is not
> this project's own drawing and it is not official DeepSeek art. Licence situation: "supplied by the repository
> owner; see LICENSE".
>
> **It has never been installed against a live DSH host.** Every verifier in this repository runs against artifact
> text and in-memory handlers. They prove the plugin cannot hang the GUI, that the routes and the state validation
> behave as documented, and that the pet's decision matrix is correct — they are **not** a substitute for a real
> install. See "Known limitations".

**中文说明见 [`README.md`](./README.md)。**

---

## What this is

A DSH (DeepSeek Harness) plugin that adds **two mount points** to the web GUI:

| Slot | Kind | What goes there |
| --- | --- | --- |
| `shell.overlay` | `kind: list` | the pet itself. **A list slot ADDS a cell** — it can never displace official UI |
| `sidebar.footer.action` | `kind: list` | the "桌宠 开 / 关" show/hide button |

The host half (Node) does exactly two things: report status, and **store the pet's state**.

| Half | What it does |
| --- | --- |
| Host half — `src/host/index.js` | three routes: `status.json` (liveness), `state.json` (read), `state.json/state` (write, with strict validation and an atomic write) |
| Browser half — `src/client/index.js` | dynamically injects `slots` / `uiSession`, mounts the pet and the toggle; **idles silently** on a host that offers nothing |

The browser half is **one plain JavaScript file** wrapped in the DSH loader envelope. There is no compiler, no
bundler and no npm dependency: `node scripts/build.mjs` **copies it verbatim** to `lib/client.js` and prepends a
generated banner.

## What the pet does

| Behaviour | How | Why |
| --- | --- | --- |
| Breathes | CSS keyframes, a 3.2s cycle | A completely still image reads as broken; a slow float is enough |
| Blinks | decided by the **pure function** `blinkAt(now)`; the component only adds a class | The timing has to be assertable, not buried in CSS where no test can read it |
| Tail sway | a 5.2s cycle, deliberately **not a multiple** of the 3.2s breath | Two periods that do not divide each other read as alive; a loop reads as a loop |
| Drag | Pointer Events + `setPointerCapture`, position updated through **the same clamp** | One code path for mouse and touch, and every position passed through during a drag is one that can legally be saved |
| Remembers its place | a **600ms-debounced** POST after the drag ends | One drag emits dozens of pointermove events; without debouncing that is dozens of requests |
| Click to talk | one line (Chinese over English), gone after **2600ms** | A pet that talks forever is a modal dialog with extra steps |
| Click vs drag | more than **4px** of travel counts as a drag, and does not trigger speech | Otherwise every time you move it, it natters at you |
| Hide | the sidebar button; the choice is persisted | A pet that is the only control over itself is a one-way door |
| Reduced motion | `prefers-reduced-motion: reduce` → a **still frame** | "Reduced" is not "slower": a slow bob is still a bob |

**The decisions are data, not rendering.** Every judgement the pet makes is exported from the bundle as a **pure
function**: `nextPose(state, event, now)`, `poseAt(now, options)`, `stanceAt(state, now)`,
`clampPosition(position)`, `clampPercent(value)`, `pickLine(index)`, `pickMode(since, now)`, `blinkAt`,
`swayAt`, `breathAt`. The component is a thin renderer over them, so `scripts/verify-pet.mjs` can drive the whole
matrix with numbers and never needs a browser. The pattern is copied from the sibling plugin
`dsh-boot-animation`'s `decidePlay`, which is the one that survived contact with a real host.

## Why the client artifact is wrapped in `window.__ModuleLoader__.load({...})`

Because that is **how the DSH web shell loads a client bundle**: it defines `window.__ModuleLoader__`, fetches the
bundle, and evaluates it **as a script**. Therefore the artifact must be plain JavaScript — an `import` /
`export` has nowhere to go in that script — and `react` is not bundled in but handed to the `factory` through
the loader's `require`.

That envelope is **copied from the shipped artifact of the sibling plugin `dsh-boot-animation`** rather than
inventing an ESM artifact. The price, stated plainly: the `factory` only receives `require` and cannot import
sibling files, so **the whole browser half has to live in one file** — the stylesheet, the component and the
image's `<img>` are all inside `src/client/index.js`, deliberately. (The images themselves are
`lib/assets/skins/*.png`, served by the host half, not inlined into the JS.)

## Install

```bash
dsh plugin --profile web add github:Gjs9178U/dsh-pet-indesktop
```

**Two steps are mandatory after installing**, or you will still be looking at a GUI without the pet:

1. **Restart the DSH service** — the host half added routes, and a running process does not learn about them;
2. Press **Ctrl+Shift+R** in the browser to hard-reload — a plain F5 keeps serving the cached boot script.

Verify it is installed:

```bash
curl http://127.0.0.1:<your DSH port>/dsh-pet-indesktop/status.json
curl http://127.0.0.1:<your DSH port>/dsh-pet-indesktop/state.json
```

## Uninstall

```bash
dsh plugin --profile web remove dsh-pet-indesktop
```

Then, again: restart the DSH service and press Ctrl+Shift+R. To remove the state as well, delete
`$DSH_HOME/pet-indesktop/`; leaving it harms nothing.

## Where the pet's state lives

`$DSH_HOME/pet-indesktop/state.json`, or `~/.dsh/pet-indesktop/state.json` when `DSH_HOME` is unset.

```json
{ "version": 1, "visible": true, "x": 92, "y": 88, "name": "小深" }
```

- `x` / `y` are **integer percentages of the viewport (2..98)**, not pixels — pixels go stale the moment the
  window is resized or the GUI moves to another monitor; percentages do not.
- `version` is the **schema** version, not the package version: it exists so a future change to this file can be
  recognised rather than guessed.
- This file is the only persistence: the browser half does not use `localStorage`.

Three properties, each asserted by `scripts/verify-routes.mjs`:

1. **Atomic writes**: serialize, write `state.json.tmp` (a SIBLING, so the rename stays on one filesystem), then
   `rename()` over the real file. A crash or a concurrent writer leaves either the old file or the new one, never a
   half-written one. A temp file in the OS temp directory could sit on another volume, where `rename` is a copy and
   therefore not atomic.
2. **Self-healing reads**: a missing, unreadable, oversized, malformed or **hand-edited** file never throws and never
   propagates junk. Every field goes through the same validator the HTTP layer uses: out-of-range values are clamped
   back, unusable ones fall back to the default, and the response's `issues` says what was repaired. A hand-edited
   file therefore cannot make this plugin serve something it would have rejected over HTTP.
3. **No path from the payload**: the path is the state root plus two constants in the source. Nothing in a request
   body can name a file, a directory or a path fragment — the body carries where the pet is, not where to write.

## The state HTTP interface

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/dsh-pet-indesktop/status.json` | plugin name, version, `behaviour`, route list, state file path |
| `GET` | `/dsh-pet-indesktop/state.json` | read the state, defaults filled in |
| `POST` | `/dsh-pet-indesktop/state.json/state` | partial update: validated, then persisted |
| `GET` | `/dsh-pet-indesktop/assets/skins/<id>.png` | one skin (`lib/assets/skins/<id>.png`, served by this plugin) |

Writes are strict, and they have to be:

| Case | Result |
| --- | --- |
| **Unknown key** (`{"xpos": 10}`) | **400**, not silently ignored — a typo has to be visible |
| Wrong type (`{"visible":"false"}`, `{"x":"30"}`, `{"name":7}`) | 400, naming the field and what arrived |
| `x`/`y` out of range (`1e9`, `-50`) | **200, clamped into 2..98** — that is what the range is for — with the clamp reported in `issues` |
| A name over 24 characters | **400, not truncated** — silently renaming someone's pet is worse |
| A body over 4096 bytes | **413**, refused **as the bytes arrive**, not after reading it all |
| Malformed JSON / empty body | 400 |
| Wrong method | 405 |
| Any rejected update | **not one byte is written** — there is no half-applied state |

### The image is cached with `no-cache` + ETag, **not** `no-store`

The image is a constant: 200 KB, never changing (a new image means a rebuild and a restart). So its caching rule is the
opposite of the state JSON's:

| Route | Header | Why |
| --- | --- | --- |
| `status.json` / `state.json` / every failure | `no-store` | it answers "what is it right now"; a cached copy is a cached lie |
| **`assets/skins/<id>.png` (success)** | **`no-cache` + a strong `ETag`** | "keep it, ask first": unchanged is one bodyless **304**, changed is one download |
| any 404 under the image path | `no-store` | a 404 with no directive is heuristically cached, so one typo keeps 404ing |

`no-store` here would mean **re-downloading 200 KB on every page load**. `no-cache` does not mean "do not cache"; it
means "revalidate before use", which is exactly what an ETag is for.

The `ETag` is the **SHA-256 of the bytes** (strong, quoted), not a modification time: a process restart or a fresh
clone does not change it, only a different image does. `If-None-Match` gets a `304` with **no body**; `*` matches
too; a stale or weak (`W/"..."`) validator deliberately does **not** match, or a new image could never be delivered.

## Why dynamic injection, and why static `inject` is forbidden

This is the most important convention in this repository, and it was paid for with a real incident. If the browser
half declares a static dependency and the host cannot provide one of those services, this plugin's fiber stays
`pending` forever — and the web boot treats **any entry that is not `active`** as fatal
(`web boot: N entry did not activate`), which takes the **entire GUI** down. The author hit exactly this in
`dsh-boot-animation`; the field log read `dsh-boot-animation: pending (waiting for service: uisession)`.

So the browser half exports **no static `inject` at all**: both services are resolved with cordis **dynamic
injection**, the wait happens in a **child fiber**, and the plugin's own entry reaches `active` immediately. On a
host that offers nothing it **idles** — one line, and only on the path where the host has no dynamic injection
either. `scripts/verify-client-boot.mjs` asserts this against the **committed artifact**, by evaluating
`lib/client.js` **as a script** with `window.__ModuleLoader__`, `react` and `document` stubbed.

The host half may inject statically, but it names a cordis **service**, `['webServer']` — never a package. And
**never put `@deepseek-ai/dsh-*` in `peerDependencies`**: DSH ≥ 0.2.0 silently drops plugins whose
peerDependencies do not match.

## z-index: the pet stays under a full-frame overlay

| Layer | z-index | Who |
| --- | --- | --- |
| Full-frame intro / overlay | `2147483000` | the sibling plugin `dsh-boot-animation` |
| **The pet** | **`2147481000`** | this plugin |
| Ordinary UI | low thousands | DSH itself |

The pet has to cover ordinary page content, but it must be **covered by a full-frame overlay**: when an intro
animation fills the frame it should cover the pet too, not fight it. 2000 below that leaves room for another
full-frame layer in between and can never outrank one. Both numbers are documented in `ARCHITECTURE.md`.

## Route conventions

The host matches a prefix route like this:

```
pathname !== prefix && !pathname.startsWith(prefix + '/')
```

Two consequences are easy to get backwards, and this plugin hit both:

1. registering `.../state.json/` makes the matcher test `.../state.json//`, which no real request starts with;
2. prefixes steal from each other: with both `/state` and `/state.json` registered, the path
   `/state.json` is swallowed by `/state` (the boundary test fails, but the short prefix still matches), so the
   **read route never receives a request**.

This plugin therefore registers exactly **one** state prefix (`/state.json`) and hangs the write beneath it
(`/state.json/state`), dispatching on the exact pathname in the handler. `scripts/verify-routes.mjs` drives the
real handlers through the server's own rule, and asserts explicitly that a trailing-slash registration matches
nothing — so the harness itself cannot drift away from the server.

## The CSS template-string trap

The stylesheet lives in a template literal inside `src/client/index.js` (and therefore inside `lib/client.js`).
**A backtick inside a CSS comment ends that literal early**, and the failure does not look like a CSS problem: the
loader reports a **JavaScript** parse error pointing at a CSS line, while the old `lib/client.js` stays in place, so
your change silently does not ship.

`scripts/check-css-template.mjs` exists for that, and it checks **both copies**. This time it earned its keep: the
pet's sheet really did contain a backtick, and the guard reported the exact line.

## Build

```bash
node scripts/build.mjs
```

It copies `src/host/*.js` to `lib/host/*.js` (pruning stale modules), writes the one-line `lib/index.js` shim
(`export * from './host/index.js'`), **copies** `src/client/index.js` to `lib/client.js` behind a generated
banner, refuses to ship anything that is not in the `window.__ModuleLoader__.load({ ... })` shape or that contains
an ESM statement, **copies `assets/*.png` to `lib/assets/*.png`** (same stale-pruning, byte for byte, PNG magic
bytes checked), rewrites `lib/.build-manifest.json` (which now records the assets and their total size), and asserts
the two copies of the sheet agree.

`lib/` is the only directory the package ships, so the artwork has to end up at `lib/assets/skins/` — which is
exactly the file the host half reads and the URL the client asks for. `scripts/verify-build.mjs` asserts all three:
the shipped copies exist, they are byte-identical to `assets/skins/`, and the client's allow-list matches them.

**There is no compiler, and that is not a shortcut.** `lib/client.js` is `src/client/index.js` plus a banner,
**byte for byte**. No tsdown, no TypeScript, no `npm install`, and no `devDependencies` — because the `factory`
only receives `require`, the whole browser half necessarily lives in one file.

## Verify

```bash
node scripts/check-css-template.mjs
node scripts/build.mjs
node scripts/verify-build.mjs
node scripts/verify-routes.mjs
node scripts/verify-client-boot.mjs
node scripts/verify-pet.mjs
# or: npm run check
```

None of the six requires installed dependencies; all of them run against the committed artifacts.

## File map

```
package.json                    manifest: dsh.bundle + dsh.client + exports (no devDependencies)
cordis.patch.yml                the insert row that makes the package a profile layer
src/host/index.js               host half: status, state read/write, the pet image + its ETag
src/client/index.js             browser half: the ONLY source file (loader envelope + <img> + sheet + pure functions)
assets/skins/<id>.png           the eight skins (source, 420x409, shipped inside the package)
lib/index.js                    generated one-line shim (main / exports point here)
lib/host/index.js               built host half
lib/client.js                   browser half artifact (= src/client/index.js + generated banner, no static inject)
lib/assets/skins/<id>.png       skin artifacts (= assets/skins/, byte for byte)
lib/types/*.d.ts                type declarations
lib/.build-manifest.json        what is actually in lib/
scripts/                        the build + verifiers
submission/data/plugins/...     market submission file
ARCHITECTURE.md                 the plumbing rules, and the reasons behind them
CHANGELOG.md                    0.2.0: the pet is the real artwork now
LICENSE                         BSD-3-Clause, plus the note on the artwork's provenance
```

## Known limitations

- **Not verified against a live DSH host.** The scripts read artifact text and drive in-memory handlers.
- **React rendering is not exercised**: the verifiers use a react stub whose `createElement` returns `null`, so how the
  character actually looks on screen is untested. What they DO assert is the markup: that the pet renders an `<img>`,
  its `src`, its declared width and height, and that the drag handlers live on a wrapper rather than on the picture.
- **Dragging, pointer events and touch are not exercised either**: those need a real DOM. What IS verified is the
  decision matrix (clamping, poses, line selection) plus the parts that do not need rendering — the seats, the
  stylesheet, the idle path, the asset route and disposal.
- The pet is **one PNG + CSS**: no video, no third-party requests, no sound.
- **The artwork is not this project's own**: it carries an "OleapCrow" mark and was supplied by the repository owner
  (see `LICENSE`). The animation timings are this project's design decisions and have not been user-tested.

## License

BSD-3-Clause, copyright holder Gjs9178U, year 2026. See `LICENSE`.
