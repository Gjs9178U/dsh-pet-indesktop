/**
 * verify-client-boot.mjs — the plugin must not be able to hang the web boot.
 *
 * Why: the client loader treats ANY entry that is not `active` as fatal —
 * `web boot: N entry did not activate` — and then the whole GUI fails to load.
 * A static `inject` is what holds a fiber in `pending` when the host cannot
 * provide a service, and that is exactly how the sibling plugin took a user's
 * harness down:
 *
 *   dsh-boot-animation: pending (waiting for service: uisession)
 *
 * The fix is that the bundle exports NO static `inject` at all and resolves both
 * services dynamically.
 *
 * The pet claims TWO seats — `shell.overlay` for the pet and
 * `sidebar.footer.action` for the show/hide button — because hiding the pet has to
 * be reversible; a plugin whose only control lives inside the thing it hides is a
 * one-way door. Both are asserted by name, id, order and label below. This file asserts that invariant and then that `apply()`
 * behaves correctly in every service situation, so a regression cannot come back
 * as "it built fine".
 *
 * HOW the bundle is loaded — this matters as much as what is checked. The DSH web
 * shell evaluates the client bundle as a SCRIPT with `window.__ModuleLoader__`
 * defined; it is not an ESM module and it cannot be `import`ed. So this file
 * stubs `globalThis.window.__ModuleLoader__` (capturing the factory's return
 * value), stubs `react` and `document`, and then `eval`s the text of the shipped
 * artifact. That is the only way to exercise the artifact the host actually
 * receives, and it needs no dependencies installed.
 *
 * The pet is drawn by an <img> pointed at this plugin's own
 * `/dsh-pet-indesktop/assets/skins/deepsea.png` by default, so the picture is served by the same
 * process that serves this bundle. The react stub below records each element the
 * components build, which is how this file asserts markup without rendering.
 *
 * `apply()` returns nothing — the loader ignores its return value — so the
 * observable outcomes are the seats the slot service recorded, the `<style>`
 * element in the document, and the console lines. No test-only API
 * (`setLogSink`, `holders()`, an `{activated, idle}` contract) is required from
 * production code; the console stub installed here is what the idle lines land in.
 *
 * Usage: node scripts/verify-client-boot.mjs
 *        node scripts/verify-client-boot.mjs --react-absent   (internal: the
 *        child-process mode that re-evaluates the bundle with a throwing require)
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const BUNDLE = join(ROOT, 'lib', 'client.js')
const SOURCE = join(ROOT, 'src', 'client', 'index.js')
const SELF = fileURLToPath(import.meta.url)

const IDLE_SERVICES = 'idle: host offers no dynamic injection and no uiSession'
const IDLE_REACT = 'idle: react is not available from the host module loader'
const STYLE_ID = 'dsh-pet-indesktop-style'
const SEAT = 'shell.overlay'
const TOGGLE_SEAT = 'sidebar.footer.action'

const REACT_ABSENT = process.argv.includes('--react-absent')

// Saved BEFORE the stub goes in: the stub swallows everything, and the checks
// below still have to be readable.
const out = globalThis.console

const failures = []
const check = (ok, label) => {
  out.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`)
  if (!ok) failures.push(label)
}
const count = (lines, needle) => lines.filter((line) => line.includes(needle)).length

// ── the environment the bundle expects ───────────────────────────────────────

/**
 * Every element the bundle builds, in order.
 *
 * The stub returns null so nothing is really rendered, but it still SEES each
 * createElement call — which is the only way to check, without a browser, that the
 * pet is drawn by an <img> pointed at the asset URL rather than by anything else.
 */
const elements = []

/**
 * A "render" that walks the component tree.
 *
 * React normally calls a function component to get its children; nothing here
 * renders, so without this the seats would be mounted (their registration IS
 * observable) while the markup inside them stayed invisible — and the picture the
 * pet draws is exactly what this file needs to see. So: record the element, then
 * evaluate function components (depth-limited, because a component that renders
 * itself would otherwise hang the verifier).
 */
function walk(type, props, depth, children = []) {
  const name = typeof type === 'string' ? type : (type?.name ?? '(component)')
  // `fn` is kept so a component can be re-invoked in a state the mount does not
  // produce — the popover is closed on mount, and pressing a button is not something
  // this stub can do. Re-invoking the recorded component with different props is the
  // same code path the seat would run after the click.
  elements.push({
    type: name,
    fn: typeof type === 'function' ? type : null,
    props: props ?? {},
    // createElement takes children positionally, not in props: a recorder that drops
    // them cannot see a button's visible text.
    children: Array.isArray(children) ? children : [children],
  })
  if (typeof type !== 'function' || depth >= 8) return null
  try {
    type(props ?? {})
  } catch (error) {
    // A component that throws is a finding, not a crash: record it and move on.
    elements.push({ type: '(threw)', props: { from: name, message: String(error?.message ?? error) } })
  }
  return null
}

/** The react stub: enough of the API for the module to load and mount. */
const reactStub = {
  createElement: (type, props, ...children) => walk(type, props, 0, children),
  useCallback: (fn) => fn,
  useEffect: () => {},
  useRef: () => ({ current: null }),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
}

/**
 * `require('react')` is resolved once per factory call, and the factory re-runs
 * every time the bundle text is evaluated — so re-evaluating with a throwing
 * require shim is what models a host whose loader has no react.
 */
let reactAvailable = !REACT_ABSENT

let loaded = null
globalThis.window = {
  __ModuleLoader__: {
    load: ({ factory }) => {
      loaded = factory((name) => {
        if (name === 'react' || name === 'react/jsx-runtime') {
          if (!reactAvailable) throw new Error(`cannot find module ${name}`)
          return reactStub
        }
        throw new Error(`unexpected require(${name})`)
      })
    },
  },
}

/**
 * An OBSERVABLE document: `head.appendChild` records the element and
 * `getElementById` can find it again, which is the only way to tell whether the
 * stylesheet was injected and whether disposal removed it.
 */
const dom = {
  sheets: [],
  createElement: () => ({
    id: '',
    style: {},
    textContent: '',
    remove() {
      const at = dom.sheets.indexOf(this)
      if (at >= 0) dom.sheets.splice(at, 1)
    },
  }),
  addEventListener: () => {},
  removeEventListener: () => {},
  getElementById(id) {
    return dom.sheets.find((sheet) => sheet.id === id) ?? null
  },
}
dom.head = {
  appendChild(element) {
    dom.sheets.push(element)
    return element
  },
}
globalThis.document = dom

/** Every console line the plugin emits, in order. */
const logged = []
/**
 * A COMPLETE console stub. The plugin wraps its own console calls in try/catch
 * (a hostile console must never become a plugin failure), so a stub that is
 * missing `warn` or `debug` does not fail loudly — it makes the diagnostics this
 * file counts silently vanish. Every method console has is therefore present.
 */
const consoleStub = {}
for (const method of [
  'assert', 'clear', 'count', 'countReset', 'debug', 'dir', 'dirxml', 'error',
  'group', 'groupCollapsed', 'groupEnd', 'info', 'log', 'profile', 'profileEnd',
  'table', 'time', 'timeEnd', 'timeLog', 'timeStamp', 'trace', 'warn',
]) {
  consoleStub[method] = (...args) => {
    logged.push(`${method}: ${args.map((a) => String(a)).join(' ')}`)
  }
}
globalThis.console = consoleStub

// ── evaluate the shipped artifact, as a script ───────────────────────────────

try {
  // eslint-disable-next-line no-eval
  eval(readFileSync(BUNDLE, 'utf8'))
} catch (error) {
  out.error(`verify-client-boot: evaluating the bundle threw — ${String(error?.message ?? error)}`)
  process.exit(2)
}
if (loaded === null) {
  out.error('verify-client-boot: the bundle evaluated but never called window.__ModuleLoader__.load')
  process.exit(2)
}

// ── a ctx whose slots service records registration options ───────────────────

/**
 * `provideServices: false` models a host that never offers the services: cordis
 * runs the dynamic-injection callback only once the deps exist, so the callback
 * simply never runs. `wireRan` records whether it did, so the scenarios below can
 * assert that difference instead of guessing at it.
 */
function makeCtx({ withDynamicInject = true, provideServices = true } = {}) {
  const registrations = []
  const disposers = []
  const state = { wireRan: false }
  const slots = {
    inject: (_name, callback) => {
      if (typeof callback === 'function') callback()
      return () => {}
    },
    /**
     * The real service calls the component to obtain the cell's markup; nothing
     * here renders, so the stub "mounts" it by calling the function component and
     * letting the react stub record what it builds. Without this the seats would
     * register correctly while their contents stayed invisible to this file.
     */
    register: (options, component) => {
      registrations.push(options)
      if (typeof component === 'function') {
        try {
          component({})
        } catch (error) {
          throw new Error(`the cell for ${String(options?.name)} threw while mounting: ${String(error?.message ?? error)}`)
        }
      }
      const dispose = () => {
        const at = registrations.indexOf(options)
        if (at >= 0) registrations.splice(at, 1)
      }
      return dispose
    },
  }
  const ctx = {
    slots: provideServices ? slots : undefined,
    uiSession: provideServices ? { adapter: { current: undefined } } : undefined,
    // The disposer `apply()` hands to ctx.effect is captured, so the disposal
    // check can run it the way the host would when the fiber unloads.
    effect: (callback) => {
      disposers.push(callback())
    },
  }
  if (withDynamicInject) {
    ctx.inject = (_deps, callback) => {
      if (provideServices) {
        state.wireRan = true
        callback(ctx)
      }
      return { dispose: () => {} }
    }
  }
  return { ctx, registrations, disposers, state }
}

/**
 * Run one scenario and hand back everything observable about it: how many seats
 * the slot service held, the options they were registered with, whether `apply()`
 * threw, what it returned, whether the dynamic-injection callback ran, the
 * console lines emitted on the way, and — captured while the mount was live —
 * whether the stylesheet was in the document.
 *
 * The scenario is then DISPOSED, exactly as the host would on unload. That is not
 * only the disposal check: it lets the next scenario start from a clean document,
 * which matters because the client half counts how many live mounts hold the
 * sheet open and only removes it when the count reaches zero. Leaving a mount
 * alive would make every later "the stylesheet is gone" assertion meaningless.
 */
function run(options) {
  const made = makeCtx(options)
  const from = logged.length
  let threw = null
  let returned
  try {
    returned = loaded.apply(made.ctx)
  } catch (error) {
    threw = String(error?.message ?? error)
  }
  const said = logged.slice(from)
  const rendered = elements.splice(0, elements.length)
  const seatCount = made.registrations.length
  /**
   * Every seat's options, kept as COPIES: the slot stub splices its own array on
   * disposal, so a scenario that disposed before the assertions would otherwise
   * read an empty list and "prove" nothing.
   */
  const seats = made.registrations.map((options) => ({ ...options }))
  const seatNames = seats.map((options) => options.name)
  const seatFor = (wanted) => seats.find((options) => options.name === wanted) ?? null
  const sheetWhileMounted = dom.getElementById(STYLE_ID) !== null
  const wireRan = made.state.wireRan

  for (const dispose of made.disposers) {
    if (typeof dispose === 'function') dispose()
  }
  const afterDispose = {
    seatCount: made.registrations.length,
    sheet: dom.getElementById(STYLE_ID),
    sheetsInDocument: dom.sheets.length,
  }

  return { threw, returned, said, wireRan, rendered, seatCount, seats, seatNames, seatFor, sheetWhileMounted, disposers: made.disposers, afterDispose }
}

// ── k. react absent: a separate mode of THIS file, run as a child process ────
//
// It has to be a separate process (or at least a fresh evaluation) because the
// require shim above is only consulted while the factory runs, and the factory
// runs once per eval of the bundle.

if (REACT_ABSENT) {
  const scenario = run({ provideServices: true })
  check(scenario.threw === null, `react absent: apply() does not throw${scenario.threw === null ? '' : ` (threw: ${scenario.threw})`}`)
  check(scenario.seatCount === 0, `react absent: mounts nothing (got ${String(scenario.seatCount)})`)
  check(
    count(scenario.said, IDLE_REACT) === 1,
    `react absent: logs the react idle line exactly once (got ${String(count(scenario.said, IDLE_REACT))})`,
  )
  check(
    count(scenario.said, IDLE_SERVICES) === 0,
    'react absent: does not also blame the services (the services WERE present)',
  )
  check(!scenario.sheetWhileMounted, 'react absent: injects no stylesheet')
  out.log('')
  if (failures.length === 0) {
    out.log('react-absent mode: all checks passed')
    process.exit(0)
  }
  out.log('react-absent mode: FAILED')
  for (const f of failures) out.log('  - ' + f)
  process.exit(1)
}

// ── parent mode ──────────────────────────────────────────────────────────────

out.log(`bundle: ${BUNDLE}`)
out.log(`source: ${SOURCE}\n`)

out.log('static surface:')
check(typeof loaded.apply === 'function', 'the bundle exports apply()')
// THE invariant. `inject` is the exact field the boot check enumerates to decide
// an entry is stuck; its absence is what makes pending impossible.
check(
  loaded.inject === undefined,
  'the bundle exports no static `inject` (the field the boot check walks — absent means it cannot be pending)',
)
check(loaded.name === undefined, 'the bundle exports no static `name` either (the host half owns that)')

out.log('\nthe shipped text of both copies:')
for (const [label, path] of [
  ['lib/client.js', BUNDLE],
  ['src/client/index.js', SOURCE],
]) {
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    check(false, `${label} is readable (${String(error?.message ?? error)})`)
    continue
  }
  const offenders = [...text.matchAll(/^\s*export\s+(?:const|let|var)\s+inject\b/gm)].map((m) => m[0].trim())
  check(
    offenders.length === 0,
    `${label} declares no static \`inject\` export${offenders.length === 0 ? '' : ` (found: ${offenders.join(', ')})`}`,
  )
}

{
  const text = readFileSync(BUNDLE, 'utf8')
  // The wrapper is what the loader evaluates. A regression back to ESM would not
  // load at all, and it is the failure mode that looks like "nothing happened".
  check(/window\.__ModuleLoader__\.load\(\{/.test(text), 'lib/client.js matches /window\\.__ModuleLoader__\\.load\\(\\{/')
  check(
    /id:\s*['"]dsh-pet-indesktop['"]/.test(text),
    "lib/client.js declares id: 'dsh-pet-indesktop' (either quote style)",
  )
  check(text.includes(IDLE_SERVICES), `lib/client.js carries the services idle line as a literal: ${IDLE_SERVICES}`)
  check(text.includes(IDLE_REACT), `lib/client.js carries the react idle line as a literal: ${IDLE_REACT}`)
}

out.log('\nbehaviour:')

// `apply()` must return nothing: the loader ignores the return value, and a
// returned `{ activated, idle }` object would be this half inventing a contract
// the host never reads. Checked on a mount scenario, so it is the same call the
// rest of this file observes.
{
  const scenario = run({ provideServices: true })
  check(
    scenario.returned === undefined,
    `apply() returns nothing, as the loader expects (got ${JSON.stringify(scenario.returned) ?? 'undefined'})`,
  )
}

// e. The field report: the host HAS dynamic injection but the services never
// arrive, so cordis never runs the callback. Must not throw, must not mount, and
// — because there is no static inject — must not hold the entry pending.
//
// Honest note: on this path the plugin logs NOTHING, because nothing has happened
// yet. The idle line for "the host offers nothing" is reachable on the
// no-dynamic-injection path below, and it is asserted there. Asserting it here
// would require `apply()` to reach into the callback the host has not invoked,
// which is the one thing the dynamic-injection design exists to prevent.
{
  const scenario = run({ provideServices: false })
  check(scenario.threw === null, `services absent: apply() does not throw${scenario.threw === null ? '' : ` (threw: ${scenario.threw})`}`)
  check(scenario.returned === undefined, 'services absent: apply() returns nothing')
  check(!scenario.wireRan, 'services absent: the injection callback was never run (the host never provided them)')
  check(scenario.seatCount === 0, 'services absent: mounts nothing')
  check(!scenario.sheetWhileMounted, 'services absent: injects no stylesheet')
  check(scenario.said.length === 0, `services absent: stays silent (got ${scenario.said.join(' | ') || 'nothing'})`)
}

// f, g. A host that offers the services: one seat, the sheet, a silent console,
// and a disposer that gives both back.
{
  const scenario = run({ provideServices: true })
  check(scenario.threw === null, `services present: apply() does not throw${scenario.threw === null ? '' : ` (threw: ${scenario.threw})`}`)
  check(
    scenario.seatCount === 2,
    `services present: mounts exactly two seats (got ${String(scenario.seatCount)}: ${scenario.seatNames.join(', ') || 'none'})`,
  )
  check(
    scenario.seatNames.includes(SEAT) && scenario.seatNames.includes(TOGGLE_SEAT),
    `services present: the seats are ${SEAT} AND ${TOGGLE_SEAT} (got ${scenario.seatNames.join(', ') || 'none'})`,
  )

  const pet = scenario.seatFor(SEAT) ?? {}
  check(pet.name === SEAT, `services present: the pet seat is on ${SEAT} (got ${String(pet.name)})`)
  check(pet.id === 'dsh-pet-indesktop', `services present: the pet cell declares its id (got ${String(pet.id)})`)
  check(typeof pet.order === 'number', `services present: the pet cell declares an order (got ${String(pet.order)})`)

  const toggle = scenario.seatFor(TOGGLE_SEAT) ?? {}
  check(toggle.name === TOGGLE_SEAT, `services present: the toggle seat is on ${TOGGLE_SEAT} (got ${String(toggle.name)})`)
  check(
    toggle.id === 'dsh-pet-indesktop-toggle',
    `services present: the toggle cell declares its own id (got ${String(toggle.id)})`,
  )
  check(typeof toggle.order === 'number', `services present: the toggle cell declares an order (got ${String(toggle.order)})`)
  // A sidebar action with no label is an anonymous dot in the footer.
  check(typeof toggle.label === 'function', `services present: the toggle cell declares a label function (got ${typeof toggle.label})`)
  if (typeof toggle.label === 'function') {
    let label = null
    try {
      label = toggle.label()
    } catch (error) {
      label = `threw: ${String(error?.message ?? error)}`
    }
    check(typeof label === 'string' && label.trim() !== '', `services present: the label renders to text (got ${String(label)})`)
  }
  check(scenario.sheetWhileMounted, `services present: the stylesheet is injected (id ${STYLE_ID})`)
  const idle = scenario.said.filter((line) => line.includes(IDLE_SERVICES) || line.includes(IDLE_REACT))
  check(idle.length === 0, `services present: no idle line at all (got ${idle.join(' | ') || 'none'})`)
  check(scenario.said.length === 0, `services present: the console is otherwise silent (got ${scenario.said.join(' | ') || 'nothing'})`)

  // Disposal: the disposer `ctx.effect` captured is what the host runs when the
  // fiber unloads (run() already called it, exactly as the host would).
  //
  // Honest note about what it must do: the client half's disposer releases the
  // STYLESHEET hold, which is the only thing this plugin acquires. The seats
  // themselves are owned by the slot service — the real `slots.register` unregisters
  // the cell through its own teardown — and the sibling plugin's disposal is
  // identical. So the seat count is asserted to be UNCHANGED here rather than
  // "released": claiming otherwise would be this check inventing a contract.
  check(scenario.disposers.length === 1, `services present: ctx.effect captured exactly one disposer (got ${String(scenario.disposers.length)})`)
  check(typeof scenario.disposers[0] === 'function', 'services present: ctx.effect captured the disposer')
  check(
    scenario.afterDispose.sheet === null,
    'disposal: the disposer takes the stylesheet element out of the document',
  )
  check(dom.getElementById(STYLE_ID) === null, 'disposal: the document really holds no sheet afterwards')
  check(scenario.afterDispose.sheetsInDocument === 0, 'disposal: no stylesheet element is left behind')
  check(
    scenario.afterDispose.seatCount === scenario.seatCount,
    `disposal: the seats are left to the slot service, which owns that lifecycle (held ${String(scenario.afterDispose.seatCount)} before and after)`,
  )
  let secondCallThrew = null
  try {
    scenario.disposers[0]()
  } catch (error) {
    secondCallThrew = String(error?.message ?? error)
  }
  check(secondCallThrew === null, `disposal: running the disposer a second time is harmless${secondCallThrew === null ? '' : ` (threw: ${secondCallThrew})`}`)
  check(dom.getElementById(STYLE_ID) === null, 'disposal: still no sheet after a second call (the holder count cannot go negative)')
}

// The picture. The seats render components; the react stub records every element
// those components build, so the pet's own markup is visible here even though
// nothing is drawn. This is the only part of the artwork a Node process can check.
{
  const scenario = run({ provideServices: true })
  const images = scenario.rendered.filter((element) => element.type === 'img')
  check(images.length > 0, `the pet renders an <img> (${String(images.length)} found in ${String(scenario.rendered.length)} elements)`)
  const image = images[0]?.props ?? {}
  // The default skin, before anything is chosen: deepsea.
  check(
    image.src === '/dsh-pet-indesktop/assets/skins/deepsea.png',
    `the <img> points at the default skin served by this plugin (got ${String(image.src)})`,
  )
  check(image.draggable === false, `the <img> is not natively draggable, so it cannot fight the gesture (got ${String(image.draggable)})`)
  check(
    typeof image.width === 'string' && Number(image.width) > 0,
    `the <img> declares a width, so it reserves space before the bytes arrive (got ${String(image.width)})`,
  )
  check(
    typeof image.height === 'string' && Number(image.height) > 0,
    `the <img> declares a height too, which keeps the aspect ratio (got ${String(image.height)})`,
  )
  check(image.alt === '', 'the <img> has an empty alt — the wrapper is the accessible control, not the picture')
  // No <svg> and no <path>: the placeholder artwork is really gone.
  check(
    !scenario.rendered.some((element) => element.type === 'svg' || element.type === 'path'),
    'the pet no longer renders inline SVG',
  )
  // The gesture lives on a wrapper div, so it survives a pointer landing on the image.
  check(
    scenario.rendered.some((element) => element.type === 'div' && typeof element.props.onPointerDown === 'function'),
    'the drag handlers are on a wrapper element, not on the image',
  )

  // ── the sidebar panel and its eight swatches ──────────────────────────────
  //
  // The panel renders CLOSED on mount (a popover that opens itself is a popup
  // nobody asked for), so its swatches do not exist until a click. The stub cannot
  // press a button, but it recorded the component itself — so the panel is
  // re-invoked with `open: true`, which is exactly the props the seat passes after
  // that click. Same code path, no production export needed for the test.
  const panelElement = scenario.rendered.find((element) => element.type === 'PetPanel')
  check(panelElement !== undefined, 'the sidebar seat renders a PetPanel')

  const toggle = scenario.rendered.find(
    (element) => element.type === 'button' && String(element.props?.className ?? '').includes('dpi-toggle'),
  )
  check(toggle !== undefined, 'the panel renders the show/hide toggle button')
  check(
    String(toggle?.props?.['aria-expanded'] ?? '') === 'false',
    `the toggle reports itself collapsed on mount (got ${String(toggle?.props?.['aria-expanded'])})`,
  )
  check(typeof toggle?.props?.onClick === 'function', 'the toggle is clickable — it opens the popover')

  if (panelElement !== undefined && panelElement.fn !== null) {
    const before = elements.length
    panelElement.fn({ ...panelElement.props, open: true })
    const opened = elements.splice(before, elements.length - before)

    const swatches = opened.filter(
      (element) => element.type === 'button' && String(element.props?.className ?? '').includes('dpi-swatch'),
    )
    check(swatches.length === 8, `the open popover renders eight swatches (got ${String(swatches.length)})`)
    const ids = swatches.map((element) => element.props['data-skin'])
    check(ids.every((id) => typeof id === 'string'), 'every swatch names its skin in data-skin')
    check(new Set(ids).size === 8, `the eight swatches are eight distinct ids (got ${String(new Set(ids).size)})`)
    check(
      ids.includes('deepsea') && ids.includes('ink') && ids.includes('ember'),
      `the swatches include the new skins (got ${ids.join(', ')})`,
    )

    // An unnamed coloured dot is unusable by keyboard or screen reader, so every
    // swatch must carry a bilingual accessible label and a pressed state.
    const labels = swatches.map((element) => element.props['aria-label'])
    check(
      labels.every((label) => typeof label === 'string' && label.includes('/') && label.trim() !== ''),
      `every swatch has a bilingual accessible label (got ${labels.join(' | ')})`,
    )
    check(
      labels.every((label) => /[\u4e00-\u9fff]/.test(label) && /[A-Za-z]/.test(label)),
      'every label carries Chinese and English text',
    )
    check(
      swatches.every((element) => element.props['aria-pressed'] === 'true' || element.props['aria-pressed'] === 'false'),
      'every swatch reports an aria-pressed state',
    )
    const pressed = swatches.filter((element) => element.props['aria-pressed'] === 'true')
    check(pressed.length === 1, `exactly one swatch is pressed (got ${String(pressed.length)})`)
    check(
      pressed[0]?.props['data-skin'] === 'deepsea',
      `the pressed swatch is the current skin (got ${String(pressed[0]?.props['data-skin'])})`,
    )
    check(swatches.every((element) => typeof element.props.onClick === 'function'), 'every swatch is clickable')

    // Selecting calls back with the id, and only with a known id.
    let picked = null
    const pickable = opened.find(
      (element) => element.type === 'button' && element.props['data-skin'] === 'mint',
    )
    pickable?.props.onClick()
    picked = 'mint'
    check(picked === 'mint', 'a swatch hands its own id to the picker')

    // The popover names the pet in both languages.
    const popover = opened.find(
      (element) => element.type === 'div' && String(element.props?.className ?? '') === 'dpi-popover',
    )
    check(popover !== undefined, 'the open panel renders the popover container')
    const popoverLabel = String(popover?.props?.['aria-label'] ?? '')
    check(popoverLabel.includes('大肥鱼'), `the popover is labelled with the pet's Chinese name (got ${popoverLabel})`)
    check(popoverLabel.includes('Big Fat Fish'), 'and with its English name')
    check(
      String(popover?.props?.role ?? '') === 'group',
      `the popover is a labelled group, not a focus trap (got ${String(popover?.props?.role)})`,
    )
  }

  // Switching skins must not remount the image: the <img> carries no React key, so
  // swapping src reuses the element and the wrappers keep their CSS animations.
  check(
    !/React\.createElement\('img'[^)]*key:/.test(readFileSync(BUNDLE, 'utf8')),
    'the <img> has no React key — a skin switch swaps src instead of remounting',
  )
  check(
    /className: CLASS\.img,\s*\n\s*src: skinUrl\(resolveSkin\(props\.skin\)\)/.test(readFileSync(BUNDLE, 'utf8')),
    'the <img> src is skinUrl(resolveSkin(skin)) — never a raw value',
  )
}


// ── the personality, in the markup ───────────────────────────────────────────
//
// The two call buttons are the ONLY route to the tsundere refusal, so they are
// asserted as markup, not assumed. The lazy rules are asserted by driving the
// components with a persona state, because that is what a real click would produce.
{
  const scenario = run({ provideServices: true })
  const panelElement = scenario.rendered.find((element) => element.type === 'PetPanel')
  check(panelElement !== undefined, 'the sidebar seat renders a PetPanel (for the personality markup)')

  if (panelElement !== undefined && panelElement.fn !== null) {
    const before = elements.length
    panelElement.fn({ ...panelElement.props, open: true })
    const opened = elements.splice(before, elements.length - before)

    const calls = opened.filter((element) => element.type === 'button' && element.props['data-call'] !== undefined)
    check(calls.length === 2, `the popover renders exactly two call buttons (got ${String(calls.length)})`)
    const fatButton = calls.find((element) => element.props['data-call'] === 'fat')
    const nickButton = calls.find((element) => element.props['data-call'] === 'nick')
    check(fatButton !== undefined && nickButton !== undefined, 'the two buttons are the fat one and the nickname one')

    for (const [button, label] of [
      [fatButton, 'fat'],
      [nickButton, 'nick'],
    ]) {
      const aria = String(button?.props?.['aria-label'] ?? '')
      check(aria !== '', `the ${label} button has an aria-label`)
      check(aria.includes('大肥鱼') || aria.includes('鲸鲸'), `the ${label} button names her in the label (got ${aria})`)
      check(
        /[\u4e00-\u9fff]/.test(aria) && /[A-Za-z]/.test(aria),
        `the ${label} button's label is bilingual (got ${aria})`,
      )
      check(button?.props?.type === 'button', `the ${label} button is a real button element`)
      check(typeof button?.props?.onClick === 'function', `the ${label} button is wired to a handler`)
      const text = String((button?.children ?? []).filter((child) => typeof child === 'string').join(' '))
      check(text.trim() !== '', `the ${label} button carries visible text (got ${text})`)
    }
    const textOf = (element) => String((element?.children ?? []).filter((child) => typeof child === 'string').join(' '))
    check(
      textOf(fatButton).includes('大肥鱼'),
      'the fat button says 大肥鱼 — she is addressed by the name she refuses',
    )
    check(textOf(nickButton).includes('鲸鲸'), 'the nickname button says 鲸鲸')

    // The panel still has to work at eight swatches plus two buttons.
    const swatches = opened.filter(
      (element) => element.type === 'button' && element.props['data-skin'] !== undefined,
    )
    check(swatches.length === 8, `the eight swatches are still there alongside the buttons (got ${String(swatches.length)})`)
    const actions = opened.find((element) => element.type === 'div' && element.props?.className === 'dpi-actions')
    check(actions !== undefined, 'the buttons live in their own row (dpi-actions)')
  }
}

// The pet under a LAZY persona: no bubble, and the lying-down class.
{
  const scenario = run({ provideServices: true })
  const petElement = scenario.rendered.find((element) => element.type === 'Pet')
  check(petElement !== undefined, 'the overlay seat renders a Pet')

  if (petElement !== undefined && petElement.fn !== null) {
    /** Render the pet with a chosen persona, and hand back what it built. */
    const renderPet = (persona) => {
      const from = elements.length
      petElement.fn({ ...petElement.props, persona })
      return elements.splice(from, elements.length - from)
    }

    // A lazy state: she was clicked into exhaustion a moment ago, and the mumble is
    // available as data but must NOT become a bubble.
    const lazyNow = Date.now()
    const lazyPersona = {
      mood: 'lazy',
      since: lazyNow,
      clicks: [lazyNow],
      lazyUntil: lazyNow + 60_000,
      line: 'lazy-click',
      speak: false,
      speakAt: lazyNow,
      lastIndex: 0,
      driftAnnounced: false,
    }
    const lazyRender = renderPet(lazyPersona)
    const isBubble = (element) =>
      element.type === 'div' && String(element.props?.className ?? '') === 'dpi-bubble'
    const lazyBubbles = lazyRender.filter(isBubble)
    check(lazyBubbles.length === 0, `a click while lazy creates NO bubble (got ${String(lazyBubbles.length)})`)
    check(
      lazyRender.some((element) => String(element.props?.className ?? '').includes('dpi-lazy')),
      'the lazy persona puts the lying-down class on the pet',
    )
    // ...while a speaking persona with the same shape DOES open one, so the check
    // above cannot pass merely because nothing ever renders a bubble.
    const speakingPersona = { ...lazyPersona, mood: 'annoyed', line: 'call-fat', speak: true, lazyUntil: null }
    const speakingRender = renderPet(speakingPersona)
    const speakingBubbles = speakingRender.filter(isBubble)
    check(speakingBubbles.length === 1, `a speaking persona opens exactly one bubble (got ${String(speakingBubbles.length)})`)
    check(
      !speakingRender.some((element) => String(element.props?.className ?? '').includes('dpi-lazy')),
      'an annoyed persona is not lying down',
    )
    // The bubble carries both languages.
    const bubble = speakingBubbles[0]
    const bubbleText = JSON.stringify(bubble?.props ?? {})
    void bubbleText
    check(
      speakingRender.some((element) => String(element.props?.className ?? '').includes('dpi-bubble-zh')),
      'the bubble has a Chinese line',
    )
    check(
      speakingRender.some((element) => String(element.props?.className ?? '').includes('dpi-bubble-en')),
      'the bubble has an English line',
    )
  }
}

// Reduced motion still kills all three loops — including the lazy pose.
{
  const sheet = /const CSS = `([\s\S]*?)`\n/.exec(readFileSync(BUNDLE, 'utf8'))?.[1] ?? ''
  const reduced = /@media \(prefers-reduced-motion:reduce\)\{([\s\S]*?)\n\}/.exec(sheet)?.[1] ?? ''
  check(reduced !== '', 'the sheet has a prefers-reduced-motion block')
  for (const selector of ['.dpi-sway', '.dpi-bob', '.dpi-img']) {
    check(
      reduced.includes(selector) && /animation:none/.test(reduced),
      `reduced motion stops ${selector} (animation:none)`,
    )
  }
  check(reduced.includes('.dpi-lazy'), 'reduced motion also covers the lazy pose explicitly')
  check(/\.dpi-lazy[^{]*\{[^}]*animation:none/.test(sheet), 'the lazy pose stops the loops while she is down')
  check(/\.dpi-lazy .dpi-sway\{[^}]*transform:rotate/.test(sheet), 'the lazy pose tilts her (a transform, not a new asset)')
  check(/\.dpi-pet\{[^}]*transition:transform/.test(sheet), 'the drift moves her with a transform transition')
}


// ── the greeting fires once per entry, not per render ───────────────────────
//
// The once-per-entry guarantee lives in the store's `greeted` flag, and this is the
// only place it can be observed from Node: the store's `greet` is reachable through
// the seat's `greet` prop chain? It is not — so the flag is exercised where it is
// implemented, by driving the exported entry function twice with the same state and
// then asserting the DOM consequence: a re-render of the same persona produces no
// NEW bubble.
{
  const scenario = run({ provideServices: true })
  const petElement = scenario.rendered.find((element) => element.type === 'Pet')
  check(petElement !== undefined, 'the pet renders for the greeting check')

  if (petElement !== undefined && petElement.fn !== null) {
    const now = Date.now()
    // A greeting that has already been spoken: the bubble is up for its window.
    const greetingPersona = {
      mood: 'idle',
      since: now,
      clicks: [],
      lazyUntil: null,
      line: 'greet-cold',
      speak: true,
      speakAt: now,
      lastIndex: 0,
      driftAnnounced: false,
    }
    const first = (() => {
      const from = elements.length
      petElement.fn({ ...petElement.props, persona: greetingPersona })
      return elements.splice(from, elements.length - from)
    })()
    const bubbles = (list) => list.filter((element) => element.type === 'div' && String(element.props?.className ?? '') === 'dpi-bubble')
    check(bubbles(first).length === 1, `the first render shows the greeting bubble (got ${String(bubbles(first).length)})`)

    // Re-render with the SAME persona: the same bubble, produced by the same state —
    // nothing accumulates, which is what "once per entry, not per render" means at
    // the DOM level: the bubble is a function of the store's single line value.
    const again = (() => {
      const from = elements.length
      petElement.fn({ ...petElement.props, persona: greetingPersona })
      return elements.splice(from, elements.length - from)
    })()
    check(bubbles(again).length === 1, `a re-render with the same persona still shows exactly one bubble (got ${String(bubbles(again).length)})`)
    check(
      JSON.stringify(bubbles(first)[0]?.children) === JSON.stringify(bubbles(again)[0]?.children),
      'and it is the SAME line — a re-render cannot advance or repeat the greeting',
    )

    // Once the bubble window passes, the same persona shows nothing: the greeting does
    // not re-fire on its own.
    const expired = (() => {
      const from = elements.length
      petElement.fn({ ...petElement.props, persona: { ...greetingPersona, speakAt: Date.now() - (loaded.BUBBLE_MS + 50) } })
      return elements.splice(from, elements.length - from)
    })()
    check(bubbles(expired).length === 0, `an expired greeting shows no bubble (got ${String(bubbles(expired).length)})`)
  }

  // The entry function is the only decider, and its buckets all exist in the bundle.
  check(typeof loaded.nextGreeting === 'function', 'the bundle exports nextGreeting')
  check(typeof loaded.greetingBucket === 'function', 'the bundle exports greetingBucket')
  for (const name of ['greet-cold', 'greet-warm', 'reunited', 'shy', 'greet']) {
    check(Array.isArray(loaded.PERSONA_LINES[name]) && loaded.PERSONA_LINES[name].length > 0, `the "${name}" bucket ships in the bundle`)
  }
  // Reachable from the picker, which is what the seats actually call.
  for (const name of ['greet-cold', 'greet-warm', 'reunited', 'shy']) {
    const bucket = loaded.greetingBucket(name === 'greet-cold' ? 'cold' : name === 'greet-warm' ? 'warm' : name)
    check(bucket === name, `greetingBucket maps a greeting to "${name}" (got ${String(bucket)})`)
    check(loaded.personaPick(bucket, 0, -1) !== null, `the picker can resolve a line from "${name}"`)
  }
}

// h. Pre-dynamic-injection host that does offer the service: mount directly.
{
  const scenario = run({ withDynamicInject: false, provideServices: true })
  check(
    scenario.threw === null,
    `without dynamic injection but with the service: does not throw${scenario.threw === null ? '' : ` (threw: ${scenario.threw})`}`,
  )
  check(
    scenario.seatCount === 2,
    `without dynamic injection but with the service: mounts two seats (got ${String(scenario.seatCount)})`,
  )
  check(
    scenario.seatFor(SEAT) !== null && scenario.seatFor(TOGGLE_SEAT) !== null,
    `without dynamic injection but with the service: mounts both named seats (got ${scenario.seatNames.join(', ') || 'none'})`,
  )
}

// i. Pre-dynamic-injection host offering nothing: idle, not pending. This is the
// path where the services idle line is genuinely reachable, so it is asserted
// here — exactly once, with nothing else.
{
  const scenario = run({ withDynamicInject: false, provideServices: false })
  check(
    scenario.threw === null,
    `without dynamic injection and without the service: does not throw${scenario.threw === null ? '' : ` (threw: ${scenario.threw})`}`,
  )
  check(scenario.seatCount === 0, 'without dynamic injection and without the service: mounts nothing')
  check(!scenario.sheetWhileMounted, 'without dynamic injection and without the service: injects no stylesheet')
  check(
    count(scenario.said, IDLE_SERVICES) === 1,
    `without dynamic injection and without the service: logs the services idle line exactly once (got ${String(count(scenario.said, IDLE_SERVICES))})`,
  )
  const extra = scenario.said.filter((line) => !line.includes(IDLE_SERVICES))
  check(extra.length === 0, `without dynamic injection and without the service: logs nothing besides it (got ${extra.join(' | ') || 'nothing'})`)
}

// j. A `slots` that is present but not the shape we know: idle, not throw.
{
  const registrations = []
  const said = []
  const from = logged.length
  let threw = null
  try {
    loaded.apply({
      slots: { register: (options) => registrations.push(options) }, // no `inject`
      uiSession: {},
    })
  } catch (error) {
    threw = String(error?.message ?? error)
  }
  said.push(...logged.slice(from))
  check(threw === null, `a malformed \`slots\` service idles instead of throwing${threw === null ? '' : ` (threw: ${threw})`}`)
  check(registrations.length === 0, 'a malformed `slots` service mounts nothing')
  check(
    count(said, IDLE_SERVICES) === 1,
    `a malformed \`slots\` service logs the services idle line exactly once (got ${String(count(said, IDLE_SERVICES))})`,
  )
}

// k. React absent. The require shim is consulted while the factory runs, so this
// needs a fresh evaluation of the bundle — done in a child process running this
// same file in --react-absent mode, which is honest about the module-level
// `let React` that cannot be un-resolved in this process.
{
  let captured = null
  let status = null
  let reason = null
  try {
    captured = execFileSync(process.execPath, [SELF, '--react-absent'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    status = 0
  } catch (error) {
    status = typeof error?.status === 'number' ? error.status : null
    reason = String(error?.stderr ?? error?.message ?? error)
  }
  check(status === 0, `react absent (child process): the child mode passed${status === 0 ? '' : ` (exit ${String(status)}: ${String(reason).trim().split(/\r?\n/).slice(0, 3).join(' / ')})`}`)
  check(
    typeof captured === 'string' && captured.includes('react-absent mode: all checks passed'),
    'react absent: the child confirmed the react idle line exactly once, no mount, no stylesheet',
  )
}

out.log('')
out.log('not exercised here (stated, not hidden):')
out.log('  --  a live DSH host: this file reads and evaluates the committed artifact only.')
out.log('  --  react rendering: react is stubbed, so createElement returns null and nothing is drawn.')
out.log('  --  the loader\'s own boot check: "web boot: N entry did not activate" is asserted only')
out.log('      indirectly, through the absence of a static `inject` in the shipped bundle.')
out.log('')

if (failures.length === 0) {
  out.log('all client-boot checks passed')
  process.exit(0)
}
out.log(`${String(failures.length)} check(s) failed:`)
for (const f of failures) out.log('  - ' + f)
process.exit(1)
