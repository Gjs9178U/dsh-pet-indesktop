/**
 * verify-pet.mjs — the pet's decisions, checked as DATA.
 *
 * Why this file exists: the pet's behaviour is a decision matrix (which pose, how
 * far the tail has swung, whether the eyes are shut, which line it says, where it
 * is allowed to stand). If that matrix lived in the renderer, the only way to test
 * it would be to render a whale in a browser and look at it — which no script here
 * can do, and which would make every assertion a guess.
 *
 * So the client half exports the matrix as PURE functions (`nextPose`, `poseAt`,
 * `clampPosition`, `blinkAt`, `swayAt`, `breathAt`, `pickMode`, `pickLine`), and
 * this file drives them with numbers. No DOM, no react, no timers, no browser: the
 * bundle is evaluated ONCE with a minimal shim, and everything after that is
 * arithmetic.
 *
 * Two things it deliberately does NOT do:
 *   - render anything (the react stub's createElement returns null; that is
 *     verify-client-boot.mjs's territory and it says so there);
 *   - restate the pet's numbers. Bounds are read from the bundle and compared
 *     against the HOST half's exported limits, so the two halves cannot drift
 *     apart silently — which is the failure that would strand the pet off-screen
 *     after a save/restore round trip.
 *
 * Usage: node scripts/verify-pet.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { clampPercent as hostClampPercent, limits as hostLimits, validateStatePayload } from '../lib/index.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const BUNDLE = join(ROOT, 'lib', 'client.js')
const SOURCE = join(ROOT, 'src', 'client', 'index.js')

/**
 * Saved BEFORE the console stub replaces the global: the stub is silent on purpose
 * (so nothing the bundle prints can pollute this file's output), which would also
 * silence the checks themselves if they used the global.
 */
const out = globalThis.console

const failures = []
const check = (ok, label) => {
  out.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`)
  if (!ok) failures.push(label)
}

// ── evaluate the shipped bundle as a SCRIPT, exactly once ────────────────────
//
// The client half cannot be imported: it is a script in the loader wrapper. The
// shim here is the minimum needed for the factory to RUN; nothing in this file
// touches the component after that.

const reactStub = {
  createElement: () => null,
  useCallback: (fn) => fn,
  useEffect: () => {},
  useRef: () => ({ current: null }),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
}

let pet = null
globalThis.window = {
  __ModuleLoader__: {
    load: ({ factory }) => {
      pet = factory((name) => {
        if (name === 'react' || name === 'react/jsx-runtime') return reactStub
        throw new Error(`unexpected require(${name})`)
      })
    },
  },
}
globalThis.document = {
  getElementById: () => null,
  createElement: () => ({ id: '', style: {}, textContent: '', remove() {} }),
  head: { appendChild: () => {} },
  addEventListener: () => {},
  removeEventListener: () => {},
}
globalThis.console = { ...console, warn: () => {}, debug: () => {}, log: () => {}, error: () => {} }

try {
  // eslint-disable-next-line no-eval
  eval(readFileSync(BUNDLE, 'utf8'))
} catch (error) {
  out.error(`verify-pet: evaluating the bundle threw — ${String(error?.message ?? error)}`)
  process.exit(2)
}
if (pet === null) {
  out.error('verify-pet: the bundle never called window.__ModuleLoader__.load')
  process.exit(2)
}

for (const name of ['clampPosition', 'clampPercent', 'nextPose', 'poseAt', 'stanceAt', 'pickLine', 'pickMode', 'blinkAt', 'swayAt', 'breathAt', 'resolveSkin', 'skinUrl']) {
  if (typeof pet[name] !== 'function') {
    out.error(`verify-pet: the bundle does not export the pure function ${name}() — the matrix is not data any more`)
    process.exit(2)
  }
}

const MIN = pet.MIN_POS
const MAX = pet.MAX_POS

out.log(`bundle: ${BUNDLE}`)
out.log(`source: ${SOURCE}\n`)

// ── the exported constants ───────────────────────────────────────────────────

out.log('the matrix is exported as data:')
check(Array.isArray(pet.POSES) && pet.POSES.length > 0, `POSES is a non-empty list (got ${JSON.stringify(pet.POSES)})`)
check(pet.POSES.includes('idle'), 'POSES includes the idle mode')
check(Array.isArray(pet.LINES) && pet.LINES.length >= 3, `LINES is a list of at least 3 lines (got ${String(pet.LINES?.length)})`)
check(typeof pet.BUBBLE_MS === 'number' && pet.BUBBLE_MS > 0, `BUBBLE_MS is a positive duration (got ${String(pet.BUBBLE_MS)})`)
check(MIN === hostLimits.MIN_POS && MAX === hostLimits.MAX_POS, `the client bounds (${String(MIN)}..${String(MAX)}) match the host's (${String(hostLimits.MIN_POS)}..${String(hostLimits.MAX_POS)})`)

// ── clamping ─────────────────────────────────────────────────────────────────

out.log('\nclamping — the four edges, and everything that is not a number:')
{
  // The four edges. The pet is anchored at a percentage of the viewport, so 0 is
  // the top-left corner exactly and 100 the bottom-right; both are outside what the
  // pet is allowed to occupy, which is the point of the margin.
  const edges = [
    ['the left/top edge', { x: 0, y: 0 }, { x: MIN, y: MIN }],
    ['the right/bottom edge', { x: 100, y: 100 }, { x: MAX, y: MAX }],
    ['past the left/top edge', { x: -250, y: -250 }, { x: MIN, y: MIN }],
    ['past the right/bottom edge', { x: 1e9, y: 1e9 }, { x: MAX, y: MAX }],
    ['exactly inside', { x: 50, y: 50 }, { x: 50, y: 50 }],
    ['exactly on the low bound', { x: MIN, y: MIN }, { x: MIN, y: MIN }],
    ['exactly on the high bound', { x: MAX, y: MAX }, { x: MAX, y: MAX }],
    ['one step outside the low bound', { x: MIN - 1, y: MIN - 1 }, { x: MIN, y: MIN }],
    ['one step outside the high bound', { x: MAX + 1, y: MAX + 1 }, { x: MAX, y: MAX }],
  ]
  for (const [label, input, want] of edges) {
    const got = pet.clampPosition(input)
    check(got.x === want.x && got.y === want.y, `${label}: ${JSON.stringify(input)} -> ${JSON.stringify(got)}`)
  }

  // Fractional input rounds to an integer, so what the pet saves is what the host
  // accepts (the host validates integers). A rounding disagreement between the two
  // halves is what would make a saved position unrecoverable.
  const fractional = pet.clampPosition({ x: 33.4, y: 66.6 })
  check(Number.isInteger(fractional.x) && Number.isInteger(fractional.y), `fractional input is rounded to integers (got ${JSON.stringify(fractional)})`)
  check(fractional.x === 33 && fractional.y === 67, `and rounded the expected way (got ${String(fractional.x)},${String(fractional.y)})`)

  // Everything that is not a usable number. None of these may produce NaN: a NaN
  // written into the DOM's `left` silently parks the pet in the corner, which is
  // exactly the bug this guards.
  const unusable = [
    ['undefined position', undefined],
    ['null position', null],
    ['an empty object', {}],
    ['NaN', { x: NaN, y: NaN }],
    ['Infinity', { x: Infinity, y: -Infinity }],
    ['strings', { x: '10', y: '90' }],
    ['booleans', { x: true, y: false }],
    ['nulls', { x: null, y: null }],
    ['an array', [10, 90]],
    ['a nested object', { x: { v: 10 }, y: { v: 90 } }],
    ['only one axis', { x: 10 }],
  ]
  for (const [label, input] of unusable) {
    let got = null
    let threw = null
    try {
      got = pet.clampPosition(input)
    } catch (error) {
      threw = String(error?.message ?? error)
    }
    check(threw === null, `${label} does not throw${threw === null ? '' : ` (threw: ${threw})`}`)
    if (got === null) continue
    check(
      Number.isFinite(got.x) && Number.isFinite(got.y),
      `${label} produces finite coordinates (got ${JSON.stringify(got)})`,
    )
    check(got.x >= MIN && got.x <= MAX && got.y >= MIN && got.y <= MAX, `${label} lands inside the bounds (got ${JSON.stringify(got)})`)
  }

  // A partial position must still land somewhere legal and finite. The missing axis
  // takes the BOUND the clamp produces for unusable input — deliberately NOT the
  // stored default, because `clampPosition` is a clamp and substituting defaults
  // would make it disagree with `clampPercent` (and with the host) on exactly the
  // inputs that matter. What it must never do is produce NaN or leave the frame.
  const partial = pet.clampPosition({ x: 10 })
  check(Number.isInteger(partial.y) && partial.y >= MIN && partial.y <= MAX, `a missing axis lands inside the bounds (got y ${String(partial.y)})`)
  check(partial.y === MAX, `a missing axis clamps like any other unusable input (got ${String(partial.y)}, want ${String(MAX)})`)
  check(partial.x === 10, 'the axis that WAS supplied is kept')
  const empty = pet.clampPosition({})
  check(empty.x === MAX && empty.y === MAX, `an empty position is a legal corner, not NaN (got ${JSON.stringify(empty)})`)
}

// ── clamping, one axis at a time ─────────────────────────────────────────────

out.log('\nclampPercent — the single-axis rule the host also applies:')
{
  // `null` in the expected slot means "a bound, because the input is unusable" —
  // the same rule the host applies, which is why the cross-half section below can
  // compare the two directly.
  const cases = [
    [undefined, MAX],
    [NaN, MAX],
    [Infinity, MAX],
    [-Infinity, MAX],
    ['50', MAX],
    [0, MIN],
    [1, MIN],
    [MIN, MIN],
    [50, 50],
    [MAX, MAX],
    [99, MAX],
    [100, MAX],
    [1e6, MAX],
    [-1e6, MIN],
    [50.5, 51],
    [50.4, 50],
  ]
  for (const [input, want] of cases) {
    const got = pet.clampPercent(input)
    const expected = want
    check(got === expected, `clampPercent(${String(input)}) -> ${String(got)} (want ${String(expected)})`)
    check(got >= MIN && got <= MAX, `clampPercent(${String(input)}) is inside the bounds`)
  }
}

// ── the pose over time ───────────────────────────────────────────────────────

out.log('\npose transitions — deterministic in the clock:')
{
  /**
   * The same clock must always give the same pose. That is the property that makes
   * the matrix testable at all, and the reason the periods live in the bundle
   * instead of in a CSS animation only.
   */
  const first = pet.poseAt(12_345)
  const second = pet.poseAt(12_345)
  check(JSON.stringify(first) === JSON.stringify(second), 'the same clock produces the same pose')

  const a = pet.poseAt(1000)
  const b = pet.poseAt(1000 + pet.BUBBLE_MS)
  check(a.mode === 'idle' && b.mode === 'idle', 'a plain tick is idle')

  // Breathing is periodic, not monotonic: it must come back.
  const breathAt0 = pet.breathAt(0)
  const breathQuarter = pet.breathAt(800)
  const breathBack = pet.breathAt(3200)
  check(breathAt0 === breathBack, `breathing returns to its start after one period (${String(breathAt0)} -> ${String(breathBack)})`)
  check(breathQuarter !== breathAt0, 'breathing moves between the ends of its period')

  // The blink schedule: a short window, and only after the first period.
  let blinks = 0
  let samples = 0
  for (let t = 0; t < 60_000; t += 25) {
    samples += 1
    if (pet.blinkAt(t)) blinks += 1
  }
  check(blinks > 0, 'the pet does blink over a minute of ticks')
  check(blinks / samples < 0.2, `blinking is a small fraction of the time (${String(blinks)}/${String(samples)} samples)`)
  check(!pet.blinkAt(0), 'the pet is not mid-blink at t=0')

  // The tail sways, and stays inside a human range.
  let minSway = 0
  let maxSway = 0
  for (let t = 0; t < 40_000; t += 37) {
    const sway = pet.swayAt(t)
    minSway = Math.min(minSway, sway)
    maxSway = Math.max(maxSway, sway)
  }
  check(minSway < 0 && maxSway > 0, `the tail sways both ways (got ${String(minSway)}..${String(maxSway)} degrees)`)
  check(Math.abs(minSway) <= 30 && Math.abs(maxSway) <= 30, `the sway stays subtle (got ${String(minSway)}..${String(maxSway)} degrees)`)
}

// ── reduced motion ───────────────────────────────────────────────────────────

out.log('\nprefers-reduced-motion — a STILL FRAME, not a faster animation:')
{
  const still = pet.poseAt(4300, { reducedMotion: true })
  const moving = pet.poseAt(4300)

  check(still.still === true, 'the pose reports itself as still')
  check(moving.still === false, 'and reports the opposite when motion is allowed')
  check(still.blinking === false, 'a still pet does not blink')
  check(still.sway === 0, `a still tail does not sway (got ${String(still.sway)})`)
  check(still.breath === 0, `a still body does not breathe (got ${String(still.breath)})`)

  // The whole point: "reduced" must not become "slower". Sampling the still pose
  // across a full cycle of every period must give ONE value, not a small one.
  const sampled = new Set()
  for (let t = 0; t < 30_000; t += 100) {
    const pose = pet.poseAt(t, { reducedMotion: true })
    sampled.add(`${String(pose.breath)}|${String(pose.sway)}|${String(pose.blinking)}`)
  }
  check(sampled.size === 1, `the still pose never varies across 30s of ticks (got ${String(sampled.size)} distinct: ${[...sampled].slice(0, 4).join(' ')})`)

  // ...while the moving pose demonstrably does vary, so the check above is not
  // passing because everything is constant.
  const movingSamples = new Set()
  for (let t = 0; t < 30_000; t += 100) {
    const pose = pet.poseAt(t)
    movingSamples.add(`${String(pose.breath)}|${String(pose.sway)}|${String(pose.blinking)}`)
  }
  check(movingSamples.size > 5, `the moving pose does vary (got ${String(movingSamples.size)} distinct states)`)

  check(pet.swayAt(5000, { reducedMotion: true }) === 0, 'swayAt honours reduced motion directly')
  check(pet.breathAt(5000, { reducedMotion: true }) === 0, 'breathAt honours reduced motion directly')
  check(pet.blinkAt(4300, { reducedMotion: true }) === false, 'blinkAt honours reduced motion directly')
}

// ── the happy burst ──────────────────────────────────────────────────────────

out.log('\nthe happy burst is self-limiting:')
{
  check(pet.pickMode(null, 1000) === 'idle', 'no interaction means idle')
  check(pet.pickMode(1000, 1000) === 'happy', 'the moment of interaction is happy')
  check(pet.pickMode(1000, 1600) === 'happy', 'and it lasts for a while')
  check(pet.pickMode(1000, 1000 + 60_000) === 'idle', 'and then it ends on its own (no timer to leak)')
  check(pet.pickMode(5000, 1000) === 'idle', 'a clock that went backwards is idle, not negative-happy')
  check(pet.pickMode('nonsense', 1000) === 'idle', 'a non-numeric `since` is idle')
  check(pet.pickMode(undefined, 1000) === 'idle', 'an absent `since` is idle')

  const happy = pet.nextPose({ mode: 'happy', since: 0 }, 'poke', 500)
  check(happy.mode === 'happy', 'nextPose passes the happy mode through')
  check(happy.elapsed === 500, `nextPose reports how far into the mode it is (got ${String(happy.elapsed)})`)
}

// ── unknown input ────────────────────────────────────────────────────────────

out.log('\nunknown input is ignored, never fatal:')
{
  const unknownMode = pet.nextPose({ mode: 'backflip' }, 'tick', 1000)
  check(unknownMode.mode === 'idle', `an unknown mode falls back to idle (got ${String(unknownMode.mode)})`)
  check(pet.POSES.includes(unknownMode.mode), 'and the result is always a mode from POSES')

  const unknownEvent = pet.nextPose({ mode: 'idle' }, 'launch-missiles', 1000)
  check(unknownEvent.mode === 'idle', 'an unknown event does not change the mode')
  check(unknownEvent.event === 'launch-missiles', 'the unknown event is echoed back, for a caller that logs it')

  const cases = [
    ['a null state', null, 'tick', 0],
    ['an undefined state', undefined, undefined, undefined],
    ['a string state', 'idle', 'tick', 5],
    ['a number state', 42, 7, 9],
    ['a negative clock', { mode: 'idle' }, 'tick', -9999],
    ['a NaN clock', { mode: 'idle' }, 'tick', NaN],
    ['an Infinity clock', { mode: 'idle' }, 'tick', Infinity],
    ['an object event', { mode: 'idle' }, { type: 'poke' }, 1000],
  ]
  for (const [label, state, event, now] of cases) {
    let pose = null
    let threw = null
    try {
      pose = pet.nextPose(state, event, now)
    } catch (error) {
      threw = String(error?.message ?? error)
    }
    check(threw === null, `${label} does not throw${threw === null ? '' : ` (threw: ${threw})`}`)
    if (pose === null) continue
    check(pet.POSES.includes(pose.mode), `${label} still yields a known mode (got ${String(pose.mode)})`)
    check(Number.isFinite(pose.breath) && Number.isFinite(pose.sway), `${label} still yields finite motion values`)
    check(pose.elapsed >= 0, `${label} still yields a non-negative elapsed (got ${String(pose.elapsed)})`)
  }

  // stanceAt is the composite the renderer uses; it must survive the same junk.
  for (const junk of [null, undefined, 'nonsense', {}, { x: NaN }]) {
    let stance = null
    let threw = null
    try {
      stance = pet.stanceAt(junk, 1000)
    } catch (error) {
      threw = String(error?.message ?? error)
    }
    check(threw === null, `stanceAt(${JSON.stringify(junk) ?? 'undefined'}) does not throw${threw === null ? '' : ` (threw: ${threw})`}`)
    check(stance !== null && Number.isFinite(stance.position.x) && Number.isFinite(stance.position.y), `stanceAt(${JSON.stringify(junk) ?? 'undefined'}) yields a finite position`)
  }
}

// ── the speech bubble ────────────────────────────────────────────────────────

out.log('\nthe speech bubble:')
{
  const lines = pet.LINES
  const ids = new Set()
  for (const [index, line] of lines.entries()) {
    check(typeof line.id === 'string' && line.id !== '', `line ${String(index)} has an id`)
    check(typeof line.zh === 'string' && line.zh.trim() !== '', `line ${String(index)} has Chinese text`)
    check(typeof line.en === 'string' && line.en.trim() !== '', `line ${String(index)} has English text`)
    ids.add(line.id)
  }
  check(ids.size === lines.length, `every line id is unique (got ${String(ids.size)} ids for ${String(lines.length)} lines)`)

  // Deterministic: the same index always gives the same line.
  for (const index of [0, 1, 2, 7, 999]) {
    const a = pet.pickLine(index)
    const b = pet.pickLine(index)
    check(a === b, `pickLine(${String(index)}) is deterministic`)
    check(a !== undefined && a !== null, `pickLine(${String(index)}) resolves to a line`)
  }

  // ...and the whole set is reachable: every line can actually be shown.
  const reachable = new Set()
  for (let i = 0; i < lines.length; i += 1) reachable.add(pet.pickLine(i).id)
  check(reachable.size === lines.length, `every line is reachable (got ${String(reachable.size)}/${String(lines.length)})`)

  // Anything at all must fold into range rather than throw or return nothing.
  const wild = [undefined, null, NaN, Infinity, -Infinity, -1, -7, 1e9, 3.7, '2', {}, []]
  for (const input of wild) {
    let line = null
    let threw = null
    try {
      line = pet.pickLine(input)
    } catch (error) {
      threw = String(error?.message ?? error)
    }
    check(threw === null, `pickLine(${JSON.stringify(input) ?? 'undefined'}) does not throw${threw === null ? '' : ` (threw: ${threw})`}`)
    check(line !== undefined && line !== null, `pickLine(${JSON.stringify(input) ?? 'undefined'}) still returns a line`)
    if (line === undefined || line === null) continue
    check(
      typeof line.zh === 'string' && line.zh !== '' && typeof line.en === 'string' && line.en !== '',
      `pickLine(${JSON.stringify(input) ?? 'undefined'}) returns both languages`,
    )
  }
}

// ── the two halves agree ─────────────────────────────────────────────────────

out.log('\nthe skin allow-list — a valid id is kept, anything else becomes the default:')
{
  /**
   * The skin id is the ONE input that reaches a URL, so it is the one place a bad
   * value could do damage. `resolveSkin` is the gate: everything that renders a skin
   * goes through it, so this section exhausts its input space rather than sampling it.
   */
  const ids = pet.SKIN_IDS
  check(Array.isArray(ids) && ids.length === 8, `SKIN_IDS is the eight looks (got ${String(ids?.length)})`)
  check(ids.includes(pet.DEFAULT_SKIN), `the default skin is on the list (got ${String(pet.DEFAULT_SKIN)})`)

  // Every legitimate id is preserved EXACTLY — no trimming, no case folding, no
  // coercion: an id is a key, not a path.
  for (const id of ids) {
    check(pet.resolveSkin(id) === id, `resolveSkin('${id}') keeps it`)
  }

  // A URL for a real id is the asset route, and the id is the only variable part.
  for (const id of ids) {
    const url = pet.skinUrl(id)
    check(
      url === `/dsh-pet-indesktop/assets/skins/${id}.png`,
      `skinUrl('${id}') is the asset route (got ${String(url)})`,
    )
  }

  // Everything else folds to the default. The traversal-shaped inputs matter most:
  // they must never appear in a URL, because the URL is what the <img> loads.
  const hostile = [
    '../../package.json',
    '..%2f..%2fpackage.json',
    '../skins/deepsea',
    'skins/deepsea',
    'deepsea.png',
    'DEEPSEA',
    'Deepsea',
    ' deepsea',
    'deepsea ',
    'deepsea\u0000.png',
    '/etc/passwd',
    '//etc/passwd',
    'http://evil.invalid/x.png',
    'javascript:alert(1)',
    '',
    ' ',
    0,
    1,
    42,
    NaN,
    Infinity,
    -1,
    true,
    false,
    null,
    undefined,
    [],
    ['deepsea'],
    {},
    { id: 'deepsea' },
    () => 'deepsea',
  ]
  let bad = 0
  for (const value of hostile) {
    const resolved = pet.resolveSkin(value)
    if (resolved !== pet.DEFAULT_SKIN) {
      bad += 1
      check(false, `resolveSkin(${JSON.stringify(value) ?? String(value)}) returned ${String(resolved)}, want ${pet.DEFAULT_SKIN}`)
    }
  }
  check(bad === 0, `all ${String(hostile.length)} unknown/hostile skin values fold to the default (${String(bad)} leaked)`)

  // The consequence that actually protects the browser: no hostile input can produce
  // a URL with a traversal, a scheme, an extra segment or an encoded slash in it.
  for (const value of hostile) {
    const url = pet.skinUrl(pet.resolveSkin(value))
    const ok =
      url.startsWith('/dsh-pet-indesktop/assets/skins/') &&
      !url.includes('..') &&
      !url.includes('%') &&
      !url.includes('\u0000') &&
      !/^[a-z]+:/i.test(url) &&
      url.split('/').length === 5 &&
      url.endsWith('.png')
    if (!ok) {
      check(false, `the URL built from ${JSON.stringify(value) ?? String(value)} is unsafe (got ${String(url)})`)
    }
  }
  check(true, 'every URL built from hostile input is a plain path under assets/skins/')

  // The resolver is a pure function of its argument: same input, same output, and it
  // does not mutate the list it reads from.
  const before = [...pet.SKIN_IDS]
  pet.resolveSkin('nope')
  pet.resolveSkin('deepsea')
  check(
    JSON.stringify([...pet.SKIN_IDS]) === JSON.stringify(before),
    'resolveSkin does not mutate the allow-list',
  )
  check(pet.resolveSkin('mint') === pet.resolveSkin('mint'), 'resolveSkin is deterministic')

  // The labels exist for every id, in both languages: a swatch with no label would be
  // an unnamed colour in the UI.
  for (const id of ids) {
    const label = pet.SKIN_LABELS?.[id]
    check(label !== undefined, `${id} has a label entry`)
    check(typeof label?.zh === 'string' && label.zh.trim() !== '', `${id}'s Chinese label is non-empty`)
    check(typeof label?.en === 'string' && label.en.trim() !== '', `${id}'s English label is non-empty`)
  }
  check(
    Object.keys(pet.SKIN_LABELS ?? {}).length === ids.length,
    `there is exactly one label per skin (got ${String(Object.keys(pet.SKIN_LABELS ?? {}).length)} labels for ${String(ids.length)} skins)`,
  )

  // The pet's name is exported, in both languages, and it is the name the user asked
  // for — the UI copy comes from here, so a typo would be visible.
  check(pet.PET_NAME?.zh === '大肥鱼', `the pet's Chinese name is 大肥鱼 (got ${String(pet.PET_NAME?.zh)})`)
  check(/Big Fat Fish/i.test(String(pet.PET_NAME?.en ?? '')), `the pet's English name is "Big Fat Fish" (got ${String(pet.PET_NAME?.en)})`)

  // The client and the host must publish the same list. They cannot share code (the
  // bundle has no imports), so the only defence against drift is this comparison.
  const hostIds = hostLimits.SKIN_IDS
  check(
    Array.isArray(hostIds) && JSON.stringify([...hostIds].sort()) === JSON.stringify([...ids].sort()),
    `the client and the host allow-lists are identical (client: ${[...ids].sort().join(', ')} | host: ${String(hostIds?.join(', '))})`,
  )
  check(
    hostLimits.DEFAULT_SKIN === pet.DEFAULT_SKIN,
    `the client and the host agree on the default skin (client ${String(pet.DEFAULT_SKIN)} | host ${String(hostLimits.DEFAULT_SKIN)})`,
  )
  check(
    typeof hostLimits.isKnownSkin === 'function' &&
      ids.every((id) => hostLimits.isKnownSkin(id)) &&
      !hostLimits.isKnownSkin('nope'),
    'the host exposes the same allow-list predicate, and it agrees on every id',
  )
}

out.log('\nthe persona — the copy table, checked entry by entry:')
{
  /**
   * The copy is the deliverable, so it is checked as DATA: every bucket present,
   * every entry bilingual, and no entry allowed to put a fat joke in her own mouth.
   */
  const BUCKETS = [
    'greet',
    'click',
    'call-fat',
    'call-nick',
    'lazy-start',
    'lazy-click',
    'lazy-end',
    'idle-drift',
    'skin-switch',
    // v2: the three extra traits (grudges/favours, reunion, shyness).
    'greet-cold',
    'greet-warm',
    'reunited',
    'shy',
  ]
  const table = pet.PERSONA_LINES
  check(table !== null && typeof table === 'object', 'PERSONA_LINES is exported')
  check(
    JSON.stringify(Object.keys(table ?? {}).sort()) === JSON.stringify([...BUCKETS].sort()),
    `the table has exactly the thirteen copy buckets (got ${Object.keys(table ?? {}).join(', ')})`,
  )

  let entries = 0
  for (const key of BUCKETS) {
    const pool = table?.[key]
    check(Array.isArray(pool) && pool.length > 0, `the "${key}" bucket is a non-empty list`)
    if (!Array.isArray(pool)) continue
    entries += pool.length
    for (const [index, line] of pool.entries()) {
      check(
        typeof line.zh === 'string' && line.zh.trim() !== '',
        `"${key}"[${String(index)}] has non-empty zh`,
      )
      check(
        typeof line.en === 'string' && line.en.trim() !== '',
        `"${key}"[${String(index)}] has non-empty en`,
      )
      // A line is a bubble, not an essay: the sheet has room for two short rows.
      check(line.zh.length <= 40, `"${key}"[${String(index)}] zh is bubble-sized (${String(line.zh.length)} chars)`)
      check(line.en.length <= 90, `"${key}"[${String(index)}] en is bubble-sized (${String(line.en.length)} chars)`)
      // No fourth-wall self-reference: she is a whale, not software.
      //
      // WORD BOUNDARIES matter here: the first version of this check matched
      // "t-AI-l" inside "tail" and "f-AI-r" inside "fairly", and failed five lines
      // that are perfectly good copy. A guard that fires on ordinary English is
      // worse than no guard, because it trains the next person to delete it.
      check(
        !/\b(AI|A\.I\.|program|programme|plugin|model|assistant|robot|chatbot|bot)\b/i.test(line.en),
        `"${key}"[${String(index)}] does not describe herself as software`,
      )
      check(
        !/(插件|程序|模型|人工智能|机器人)/.test(line.zh),
        `"${key}"[${String(index)}] zh does not describe herself as software`,
      )
    }
  }
  // 26 lines: greet 3, click 4, call-fat 4, call-nick 4, lazy-start 3, lazy-click 2,
  // lazy-end 2, idle-drift 2, skin-switch 2.
  check(entries === 38, `the table carries all 38 copy lines, 26 + 12 (got ${String(entries)})`)
  for (const [key, expected] of Object.entries({
    greet: 3,
    click: 4,
    'call-fat': 4,
    'call-nick': 4,
    'lazy-start': 3,
    'lazy-click': 2,
    'lazy-end': 2,
    'idle-drift': 2,
    'skin-switch': 2,
    // v2
    'greet-cold': 3,
    'greet-warm': 3,
    reunited: 3,
    shy: 3,
  })) {
    check(table?.[key]?.length === expected, `"${key}" carries ${String(expected)} line(s) (got ${String(table?.[key]?.length)})`)
  }

  /**
   * THE "肥" GUARD. A cheap, deliberately blunt check so a future edit cannot put a
   * fat joke in her own mouth: she may QUOTE the word back at the user ("谁肥了"),
   * but no line anywhere may assert fatness in the first person, or use it as a name.
   */
  const SELF_FAT = [
    // First person plus 肥 in the SAME clause. Clause-scoped on purpose: she may say
    // "谁肥了" or quote the name back, but she may never describe herself that way.
    /我[^，。；]{0,6}肥/,
    // 肥 used as a noun for her.
    /肥(鲸|鱼|妹|婆|猪)/,
    // "叫我大肥" / "是我肥" style self-labelling.
    /(叫|是)我(大)?肥/,
  ]

  /**
   * The guard must not be vacuous. These strings are what it EXISTS to catch, so they
   * are asserted to match: narrowing the patterns above then fails here instead of
   * quietly letting a fat joke through.
   */
  for (const sample of ['我是有点肥，但很可爱。', '我很肥。', '我肥了啦', '肥鲸一只', '叫我大肥鱼就行']) {
    check(
      SELF_FAT.some((pattern) => pattern.test(sample)),
      `the self-fat guard catches ${JSON.stringify(sample)}`,
    )
  }
  // ...and it must not fire on the copy's own, legitimate first-person lines.
  for (const allowed of ['我不是来干活的。', '我在思考。很复杂的那种。', '我叫鲸鲸。', '我不是胖，是圆润。', '我算过了，这一碗的热量刚好。']) {
    check(
      !SELF_FAT.some((pattern) => pattern.test(allowed)),
      `the self-fat guard leaves ${JSON.stringify(allowed)} alone`,
    )
  }
  let fatHits = 0
  for (const key of BUCKETS) {
    for (const line of table?.[key] ?? []) {
      for (const pattern of SELF_FAT) {
        if (pattern.test(line.zh)) {
          fatHits += 1
          check(false, `"${key}" line calls her fat in her own voice: ${line.zh}`)
        }
      }
    }
  }
  check(fatHits === 0, `no entry anywhere asserts fatness in the first person (${String(fatHits)} hit(s))`)
  check(
    !(table?.['call-fat'] ?? []).some((line) => line.zh.includes('大肥鱼')),
    'the refusal bucket never repeats the name as if she accepted it',
  )
  // ...and the bucket must still ENGAGE with being called fat, or the guard above
  // would pass on a table that quietly dropped the joke.
  const fatPool = table?.['call-fat'] ?? []
  check(
    fatPool.some((line) => /(肥|胖)/.test(line.zh)),
    'the call-fat bucket actually addresses being called fat',
  )
  check(
    fatPool.some((line) => /(不|谁|警告|扣|才)/.test(line.zh)),
    'and it pushes back rather than agreeing',
  )

  // The constants are the copy's, verbatim.
  check(pet.PET_NAME?.zh === '大肥鱼' && pet.PET_NAME?.en === 'Big Fat Fish', 'PET_NAME is 大肥鱼 / Big Fat Fish')
  check(pet.PET_NICK?.zh === '鲸鲸' && pet.PET_NICK?.en === 'Jingjing', 'PET_NICK is 鲸鲸 / Jingjing')
  check(pet.CALL_FAT?.zh === '叫它 大肥鱼', 'CALL_FAT carries the button label')
  check(pet.CALL_NICK?.zh === '叫它 鲸鲸', 'CALL_NICK carries the button label')
}

out.log('\nthe mood machine — every transition, as arithmetic:')
{
  /**
   * The config is INJECTED, so nothing here depends on the shipped timings. The
   * values are small and round on purpose: a boundary of 100 is easy to be one
   * millisecond either side of.
   */
  const cfg = { lazyAfterClicks: 3, clickWindowMs: 1000, lazyMs: 500, happyMs: 200, annoyedMs: 200, idleDriftMs: 5000 }
  const start = { mood: 'idle', since: 0, clicks: [], lazyUntil: null }

  const step = (state, event, now) => pet.nextMood(state, event, now, cfg)
  check(typeof pet.nextMood === 'function', 'nextMood is exported')

  // ── the two addressable reactions ────────────────────────────────────────
  const fat = step(start, 'call-fat', 100)
  check(fat.mood === 'annoyed', `call-fat -> annoyed (got ${String(fat.mood)})`)
  check(fat.line === 'call-fat', `call-fat -> the call-fat pool (got ${String(fat.line)})`)
  check(fat.speak === true, 'call-fat opens a bubble')
  const fatLines = pet.PERSONA_LINES['call-fat']
  check(
    fatLines.some((line) => /(不是胖|浮力|圆润|尾鳍|鲸脂|不叫胖|谁肥)/.test(line.zh) || /(not fat|buoyancy|rounded)/i.test(line.en)),
    'the call-fat pool says she is NOT fat',
  )

  const nick = step(start, 'call-nick', 100)
  check(nick.mood === 'happy', `call-nick -> happy (got ${String(nick.mood)})`)
  check(nick.line === 'call-nick', `call-nick -> the call-nick pool (got ${String(nick.line)})`)
  check(nick.speak === true, 'call-nick opens a bubble')

  const clicked = step(start, 'click', 100)
  check(clicked.mood === 'happy', `a click -> happy (got ${String(clicked.mood)})`)
  check(clicked.line === 'click', 'a click -> the click pool')

  // ── the lazy lock ────────────────────────────────────────────────────────
  // N rapid clicks -> lazy. The count is inclusive of the click that trips it.
  let busy = start
  for (let i = 0; i < cfg.lazyAfterClicks - 1; i += 1) busy = step(busy, 'click', 100 + i * 10)
  check(busy.mood === 'happy', `${String(cfg.lazyAfterClicks - 1)} rapid clicks are NOT enough (got ${String(busy.mood)})`)
  const tripped = step(busy, 'click', 100 + (cfg.lazyAfterClicks - 1) * 10)
  check(tripped.mood === 'lazy', `${String(cfg.lazyAfterClicks)} rapid clicks -> lazy (got ${String(tripped.mood)})`)
  check(tripped.line === 'lazy-start', `lazy -> the lazy-start pool (got ${String(tripped.line)})`)
  check(tripped.speak === true, 'going lazy opens one bubble')
  check(
    tripped.lazyUntil === 100 + (cfg.lazyAfterClicks - 1) * 10 + cfg.lazyMs,
    `lazyUntil is the trip time plus lazyMs (got ${String(tripped.lazyUntil)})`,
  )
  check(pet.PERSONA_LINES['lazy-start'].some((line) => line.zh.includes('今天不干了')), 'the lazy-start copy says 今天不干了')

  // While lazy, a click is ABSORBED: a mumble, never a bubble.
  const absorbed = step(tripped, 'click', tripped.lazyUntil - 1)
  check(absorbed.mood === 'lazy', 'a click while lazy leaves her lazy')
  check(absorbed.line === 'lazy-click', `the mumble is the lazy-click pool (got ${String(absorbed.line)})`)
  check(absorbed.speak === false, 'THE MUMBLE IS NOT A BUBBLE: click while lazy has speak:false')
  // The call buttons are absorbed too: "refuses to react for a while".
  for (const event of ['call-fat', 'call-nick', 'idle-for-a-while']) {
    const during = step(tripped, event, tripped.lazyUntil - 1)
    check(during.mood === 'lazy', `${event} while lazy does not change the mood (got ${String(during.mood)})`)
    check(during.speak === false, `${event} while lazy stays silent`)
  }

  // The lock RELEASES by the clock, and the boundary is half-open.
  check(pet.currentMood(tripped, tripped.lazyUntil - 1, cfg) === 'lazy', 'one ms before lazyUntil she is still lazy')
  check(pet.currentMood(tripped, tripped.lazyUntil, cfg) === 'idle', 'at exactly lazyUntil she is not lazy')
  check(pet.currentMood(tripped, tripped.lazyUntil + 1, cfg) === 'idle', 'one ms after, still not lazy')
  const woke = step(tripped, 'lazy-ends', tripped.lazyUntil)
  check(woke.mood === 'idle', `lazy-ends at the boundary -> idle (got ${String(woke.mood)})`)
  check(woke.line === 'lazy-end', `lazy-ends speaks the lazy-end pool (got ${String(woke.line)})`)
  check(woke.speak === true, 'waking up opens a bubble')
  check(woke.lazyUntil === null, 'waking clears lazyUntil')
  // After expiry, a click is processed again rather than absorbed.
  //
  // The clock here is past BOTH lazyUntil and clickWindowMs. That matters: with this
  // test config lazyMs (500) is SHORTER than the click window (1000), so a click one
  // millisecond after waking would still see the three rapid clicks as "recent" and
  // legitimately put her straight back down. With the shipped defaults that cannot
  // happen (lazyMs 6000 > clickWindowMs 2600), and the case is asserted separately
  // below so the behaviour is pinned rather than assumed.
  const afterExpiry = step(tripped, 'click', tripped.lazyUntil + cfg.clickWindowMs + 1)
  check(afterExpiry.mood === 'happy', `a click after expiry is handled (got ${String(afterExpiry.mood)})`)
  const earlyWaker = step(tripped, 'click', tripped.lazyUntil + 1)
  check(
    earlyWaker.mood === 'lazy',
    'with a lazyMs shorter than the click window, the old rapid clicks re-trip the lock (shipped defaults make this impossible)',
  )
  check(
    pet.PERSONA_CONFIG.lazyMs > pet.PERSONA_CONFIG.clickWindowMs,
    'the shipped defaults keep lazyMs longer than the click window, so waking does not instantly re-trip',
  )

  // ── the click-window boundary ────────────────────────────────────────────
  // A click exactly clickWindowMs old still counts; one ms older does not.
  const exactly = { mood: 'happy', since: 0, clicks: [1000 - cfg.clickWindowMs], lazyUntil: null }
  const atEdge = step(exactly, 'click', 1000)
  check(atEdge.clicks.length === 2, `a click exactly at the window edge still counts (got ${String(atEdge.clicks.length)})`)
  const pastEdge = { mood: 'happy', since: 0, clicks: [1000 - cfg.clickWindowMs - 1], lazyUntil: null }
  const justPast = step(pastEdge, 'click', 1000)
  check(
    justPast.clicks.length === 1,
    `a click one ms past the window edge is forgotten (got ${String(justPast.clicks.length)})`,
  )
  // ...and that difference decides the trip: two stale clicks plus one does not trip
  // when N is three, but two fresh ones plus one does.
  const staleBase = { mood: 'happy', since: 0, clicks: [1000 - cfg.clickWindowMs - 1, 1000 - cfg.clickWindowMs - 2], lazyUntil: null }
  check(step(staleBase, 'click', 1000).mood === 'happy', 'stale clicks do not accumulate towards lazy')
  const freshBase = { mood: 'happy', since: 0, clicks: [1000 - 10, 1000 - 20], lazyUntil: null }
  check(step(freshBase, 'click', 1000).mood === 'lazy', 'fresh clicks do accumulate towards lazy')

  // ── the idle tick is silent ──────────────────────────────────────────────
  const ticked = step({ mood: 'happy', since: 0, clicks: [], lazyUntil: null }, 'idle-for-a-while', 2000)
  check(ticked.mood === 'idle', `idle-for-a-while -> idle (got ${String(ticked.mood)})`)
  check(ticked.line === null, 'the idle tick says nothing: the drift line is fired by the drift itself')
  check(ticked.speak === false, 'and it does not open a bubble')

  // ── unknown events are ignored ───────────────────────────────────────────
  for (const bogus of ['', 'explode', 'CLICK', 'call-fat ', 'lazy_start', null, undefined, 42, {}, []]) {
    let result = null
    let threw = null
    try {
      result = step({ mood: 'annoyed', since: 55, clicks: [900], lazyUntil: null }, bogus, 1000)
    } catch (error) {
      threw = String(error?.message ?? error)
    }
    check(threw === null, `unknown event ${JSON.stringify(bogus)} does not throw${threw === null ? '' : ` (threw: ${threw})`}`)
    if (result === null) continue
    check(result.mood === 'annoyed', `unknown event ${JSON.stringify(bogus)} leaves the mood alone`)
    check(result.line === null, `unknown event ${JSON.stringify(bogus)} produces no line`)
    check(result.speak === false, `unknown event ${JSON.stringify(bogus)} stays silent`)
  }

  // ── all four moods are reachable, and moodPose agrees ────────────────────
  const reached = new Set([
    step(start, 'call-fat', 100).mood,
    step(start, 'call-nick', 100).mood,
    step(start, 'idle-for-a-while', 100).mood,
    tripped.mood,
  ])
  for (const mood of pet.MOODS) check(reached.has(mood), `the mood "${mood}" is reachable from the machine`)
  check(JSON.stringify(reached.size) === '4', `all four moods are reachable (got ${[...reached].join(', ')})`)
  for (const mood of pet.MOODS) {
    const pose = pet.moodPose(mood)
    check(pose.mood === mood, `moodPose("${mood}") reports itself`)
    check(pose.lying === (mood === 'lazy'), `moodPose("${mood}").lying is ${mood === 'lazy' ? 'true' : 'false'}`)
  }
  check(pet.moodPose('nonsense').mood === 'idle', 'moodPose falls back to idle for an unknown mood')

  // ── the config really is injectable ──────────────────────────────────────
  const quick = step({ mood: 'idle', since: 0, clicks: [], lazyUntil: null }, 'click', 10) && pet.nextMood({ mood: 'idle', since: 0, clicks: [0, 1], lazyUntil: null }, 'click', 10, { lazyAfterClicks: 2, lazyMs: 50 })
  check(quick.mood === 'lazy', 'lazyAfterClicks:2 trips on the second click')
  check(quick.lazyUntil === 60, `lazyMs:50 is honoured (got ${String(quick.lazyUntil)})`)
  const folded = pet.personaConfig({ lazyAfterClicks: 0, clickWindowMs: -5, lazyMs: 12 })
  check(folded.lazyAfterClicks === 1, `personaConfig floors lazyAfterClicks at 1 (got ${String(folded.lazyAfterClicks)})`)
  check(folded.clickWindowMs === 0, `personaConfig floors the window at 0 (got ${String(folded.clickWindowMs)})`)
  check(folded.lazyMs === 12, 'personaConfig keeps a usable override')
  const defaults = pet.personaConfig(null)
  check(
    defaults.lazyAfterClicks === pet.PERSONA_CONFIG.lazyAfterClicks && defaults.idleDriftMs === pet.PERSONA_CONFIG.idleDriftMs,
    'an absent config falls back to the shipped defaults',
  )
  check(typeof pet.PERSONA_CONFIG.idleDriftMs === 'number' && pet.PERSONA_CONFIG.idleDriftMs === 600000, 'the idle drift default is ten minutes')

  // ── determinism and junk input ───────────────────────────────────────────
  const a = step(start, 'click', 123)
  const b = step(start, 'click', 123)
  check(JSON.stringify(a) === JSON.stringify(b), 'the same inputs give the same state')
  for (const junk of [null, undefined, 'idle', 42, [], { mood: 'weird' }, { clicks: 'nope' }]) {
    let threw = null
    let result = null
    try {
      result = pet.nextMood(junk, 'click', 100, cfg)
    } catch (error) {
      threw = String(error?.message ?? error)
    }
    check(threw === null, `nextMood(${JSON.stringify(junk) ?? 'undefined'}) does not throw${threw === null ? '' : ` (threw: ${threw})`}`)
    check(result !== null && pet.MOODS.includes(result.mood), `nextMood(${JSON.stringify(junk) ?? 'undefined'}) yields a known mood`)
  }
  for (const now of [NaN, Infinity, -Infinity, -1, undefined, 'soon']) {
    let threw = null
    try {
      pet.nextMood(start, 'click', now, cfg)
      pet.currentMood(start, now, cfg)
      pet.idleDrift({ position: { x: 50, y: 50 }, lastInteraction: 0 }, now, cfg)
    } catch (error) {
      threw = String(error?.message ?? error)
    }
    check(threw === null, `a clock of ${String(now)} does not throw${threw === null ? '' : ` (threw: ${threw})`}`)
  }
}

out.log('\nthe line picker — deterministic, and it does not repeat itself:')
{
  for (const key of Object.keys(pet.PERSONA_LINES)) {
    const pool = pet.PERSONA_LINES[key]
    const seen = new Set()
    for (let seed = 0; seed < pool.length; seed += 1) {
      const picked = pet.personaPick(key, seed, -1)
      check(picked !== null && picked.line !== undefined, `personaPick("${key}", ${String(seed)}) resolves a line`)
      if (picked === null) continue
      check(picked.index === seed % pool.length, `personaPick("${key}", ${String(seed)}) indexes in range (got ${String(picked.index)})`)
      check(pool[picked.index] === picked.line, `personaPick("${key}", ${String(seed)}) returns the indexed entry`)
      seen.add(picked.index)
    }
    check(seen.size === pool.length, `every entry of "${key}" is reachable (${String(seen.size)}/${String(pool.length)})`)
  }
  // The last-used rule: with more than one entry, the pick moves off the last one.
  for (const key of Object.keys(pet.PERSONA_LINES)) {
    const pool = pet.PERSONA_LINES[key]
    let repeated = 0
    for (let seed = 0; seed < 12; seed += 1) {
      const first = pet.personaPick(key, seed, -1)
      const second = pet.personaPick(key, seed, first.index)
      if (pool.length > 1 && second.index === first.index) repeated += 1
    }
    check(repeated === 0, `"${key}" never repeats the previous line when it has alternatives (${String(repeated)} repeat(s))`)
  }
  check(pet.personaPick('nope', 0, -1) === null, 'an unknown pool yields null rather than throwing')
  check(pet.personaPick('click', 7, -1).index === pet.personaPick('click', 7, -1).index, 'personaPick is deterministic')
  for (const seed of [NaN, Infinity, -1, -7, 1e9, 3.7, '2', {}, []]) {
    let threw = null
    let picked = null
    try {
      picked = pet.personaPick('click', seed, -1)
    } catch (error) {
      threw = String(error?.message ?? error)
    }
    check(threw === null, `personaPick with seed ${JSON.stringify(seed) ?? 'undefined'} does not throw`)
    check(picked !== null && Number.isInteger(picked.index), `personaPick with seed ${JSON.stringify(seed) ?? 'undefined'} yields an index`)
  }
}

out.log('\nthe idle drift — visual only, and the stored position is never touched:')
{
  const cfg = { idleDriftMs: 1000 }
  const base = { position: { x: 20, y: 70 }, lastInteraction: 0 }

  const recent = pet.idleDrift({ ...base, lastInteraction: 500 }, 1000, cfg)
  check(recent.drifting === false, 'a recent interaction does not drift (exactly one window later)')
  const early = pet.idleDrift({ ...base, lastInteraction: 1 }, 1000, cfg)
  check(early.drifting === false, 'one ms short of the threshold does not drift')
  const atThreshold = pet.idleDrift({ ...base, lastInteraction: 0 }, 1000, cfg)
  check(atThreshold.drifting === true, 'exactly at the threshold she drifts')
  const past = pet.idleDrift({ ...base, lastInteraction: 0 }, 1001, cfg)
  check(past.drifting === true, 'one ms past the threshold she drifts')

  // The nearest corner: left/top when she is in the left/top half, else right/bottom.
  const topLeft = pet.idleDrift({ position: { x: 10, y: 10 }, lastInteraction: 0 }, 5000, cfg).target
  check(topLeft.x === pet.MIN_POS && topLeft.y === pet.MIN_POS, `a pet near the top-left drifts to the top-left corner (got ${JSON.stringify(topLeft)})`)
  const bottomRight = pet.idleDrift({ position: { x: 90, y: 90 }, lastInteraction: 0 }, 5000, cfg).target
  check(bottomRight.x === pet.MAX_POS && bottomRight.y === pet.MAX_POS, `a pet near the bottom-right drifts to that corner (got ${JSON.stringify(bottomRight)})`)
  const mixed = pet.idleDrift({ position: { x: 10, y: 90 }, lastInteraction: 0 }, 5000, cfg).target
  check(mixed.x === pet.MIN_POS && mixed.y === pet.MAX_POS, 'each axis picks its own nearest corner')

  /**
   * THE PROPERTY THAT MATTERS: drift is visual only.
   *
   * If a drift wrote into x/y it would overwrite the spot the user chose, which is
   * the one thing a "remember where I left it" pet must never do. So: the result
   * says persist:false, the input object is not mutated, and the position it reports
   * as its origin is the stored one.
   */
  const stored = { position: { x: 20, y: 70 }, lastInteraction: 0 }
  const before = JSON.stringify(stored)
  const drift = pet.idleDrift(stored, 5000, cfg)
  check(drift.persist === false, 'the drift result says persist:false')
  check(JSON.stringify(stored) === before, 'the drift does not mutate the state it was given')
  check(
    drift.from.x === stored.position.x && drift.from.y === stored.position.y,
    `the drift starts from the STORED position (got ${JSON.stringify(drift.from)})`,
  )
  check(
    drift.target.x !== drift.from.x || drift.target.y !== drift.from.y,
    'and its target differs from the stored position',
  )
  // Nothing on the drift result is shaped like a state update the client would post.
  check(
    drift.x === undefined && drift.y === undefined,
    'the drift exposes no x/y of its own for a caller to mistake for a position',
  )
  check(
    !JSON.stringify(drift).includes('"skin"') && !JSON.stringify(drift).includes('"persist":true'),
    'and nothing in the result looks like a persisted state patch',
  )

  // Interaction cancels it; reduced motion disables it entirely.
  const touched = pet.idleDrift({ ...base, lastInteraction: 4999 }, 5000, cfg)
  check(touched.drifting === false, 'an interaction one ms ago cancels the drift')
  const still = pet.idleDrift({ ...base, lastInteraction: 0, reducedMotion: true }, 5000, cfg)
  check(still.drifting === false, 'prefers-reduced-motion disables the drift (it is movement)')
  check(still.persist === false, 'and the reduced-motion result is still non-persistent')
  check(pet.idleDrift({ ...base, lastInteraction: 0 }, 5000, { idleDriftMs: 0 }).drifting === false, 'a zero drift delay disables it')

  // The line fires ONCE per drift: started only while it has not been announced.
  const first = pet.idleDrift({ ...base, announced: false }, 5000, cfg)
  check(first.started === true, 'the first idle tick after the threshold reports started')
  const again = pet.idleDrift({ ...base, announced: true }, 5000, cfg)
  check(again.drifting === true && again.started === false, 'once announced, a tick drifts without speaking again')
  check(first.reason === 'idle' && still.reason === 'reduced-motion', 'the result says why it did or did not drift')
  const pool = pet.PERSONA_LINES['idle-drift']
  check(Array.isArray(pool) && pool.length >= 1, 'there is copy for the drift')
}

out.log('\nthe greeting entry function — priority, counters and every boundary:')
{
  /**
   * The clock is assembled from LOCAL date parts, so nothing here depends on the
   * machine timezone: `day` is a fixed local midnight, and every test timestamp is
   * built relative to it.
   */
  const day0 = new Date(2026, 0, 15, 12, 0, 0, 0).getTime() // 2026-01-15 12:00 local
  const midnight = new Date(2026, 0, 16, 0, 0, 0, 0).getTime() // 2026-01-16 00:00 local
  const cfg = { coldAfter: 3, warmAfter: 3, reuniteMs: 30 * 60 * 1000, shyUntil: 3 }

  const base = { fatCalls: 0, nickCalls: 0, countersDay: '2026-01-15', lastSeenAt: 0, totalInteractions: 0 }
  const ask = (over, now) => pet.nextGreeting({ ...base, ...over }, now === undefined ? day0 : now, cfg)
  const countersOf = (result) => result.counters

  check(typeof pet.nextGreeting === 'function', 'nextGreeting is exported')
  check(JSON.stringify(Object.keys(pet.GREETING_BUCKETS).sort()) === JSON.stringify(['cold', 'normal', 'reunited', 'shy', 'warm']), 'the greeting names are the five we expect')

  // ── the five outcomes ────────────────────────────────────────────────���──
  check(ask({}).greeting === 'shy', `a brand-new visitor is shy (got ${String(ask({}).greeting)})`)
  check(ask({ totalInteractions: 9 }).greeting === 'normal', `a regular visitor is normal (got ${String(ask({ totalInteractions: 9 }).greeting)})`)
  check(ask({ fatCalls: 3 }).greeting === 'cold', `three fat-calls makes her cold (got ${String(ask({ fatCalls: 3 }).greeting)})`)
  check(ask({ nickCalls: 3 }).greeting === 'warm', `three nickname-calls makes her warm (got ${String(ask({ nickCalls: 3 }).greeting)})`)
  const reunited = ask({ totalInteractions: 9, lastSeenAt: day0 - cfg.reuniteMs - 1 })
  check(reunited.greeting === 'reunited', `a long absence greets you as reunited (got ${String(reunited.greeting)})`)

  // Each outcome speaks from the right bucket, and the bucket exists.
  for (const [over, greeting, bucket] of [
    [{ fatCalls: 3 }, 'cold', 'greet-cold'],
    [{ nickCalls: 3 }, 'warm', 'greet-warm'],
    [{ totalInteractions: 9, lastSeenAt: day0 - cfg.reuniteMs - 1 }, 'reunited', 'reunited'],
    [{}, 'shy', 'shy'],
    [{ totalInteractions: 9 }, 'normal', 'greet'],
  ]) {
    const result = ask(over)
    check(result.greeting === greeting, `${greeting} is chosen (got ${String(result.greeting)})`)
    check(result.bucket === bucket, `${greeting} speaks from "${bucket}" (got ${String(result.bucket)})`)
    check(Array.isArray(pet.PERSONA_LINES[result.bucket]) && pet.PERSONA_LINES[result.bucket].length > 0, `"${bucket}" is a non-empty bucket`)
    check(pet.greetingBucket(greeting) === bucket, `greetingBucket("${greeting}") is "${bucket}"`)
  }

  // ── priority: cold > warm > reunited > shy > normal ────────────────────
  const all = ask({ fatCalls: 9, nickCalls: 9, totalInteractions: 99, lastSeenAt: 1 })
  check(all.greeting === 'cold', `cold outranks everything (got ${String(all.greeting)})`)
  const warmOverReunited = ask({ nickCalls: 9, totalInteractions: 99, lastSeenAt: 1 })
  check(warmOverReunited.greeting === 'warm', `warm outranks reunited (got ${String(warmOverReunited.greeting)})`)
  const reunitedOverShy = ask({ totalInteractions: 0, lastSeenAt: day0 - cfg.reuniteMs - 1 })
  check(reunitedOverShy.greeting === 'reunited', `reunited outranks shy (got ${String(reunitedOverShy.greeting)})`)
  const shyOverNormal = ask({ totalInteractions: 2 })
  check(shyOverNormal.greeting === 'shy', `shy outranks normal (got ${String(shyOverNormal.greeting)})`)

  // ── the fat-call boundary: 2 vs 3 ─────────────────────────────────────
  check(ask({ fatCalls: 2 }).greeting !== 'cold', `fatCalls 2 is NOT cold (got ${String(ask({ fatCalls: 2 }).greeting)})`)
  check(ask({ fatCalls: 2 }).greeting === 'shy', 'fatCalls 2 with a new visitor is still shy')
  check(ask({ fatCalls: 3 }).greeting === 'cold', 'fatCalls 3 IS cold')
  check(ask({ fatCalls: 4 }).greeting === 'cold', 'fatCalls 4 stays cold')
  check(ask({ fatCalls: 2, totalInteractions: 9 }).greeting === 'normal', 'fatCalls 2 with a regular is normal')

  // ── the nick-call boundary: 2 vs 3 ────────────────────────────────────
  check(ask({ nickCalls: 2, totalInteractions: 9 }).greeting === 'normal', `nickCalls 2 is NOT warm (got ${String(ask({ nickCalls: 2, totalInteractions: 9 }).greeting)})`)
  check(ask({ nickCalls: 3 }).greeting === 'warm', 'nickCalls 3 IS warm')
  check(ask({ nickCalls: 2, fatCalls: 3 }).greeting === 'cold', 'cold still wins at nickCalls 2')

  // ── the absence boundary: reuniteMs - 1 / exactly / + 1 ───────────────
  const at = day0
  const away = (delta) => ask({ totalInteractions: 9, lastSeenAt: at - delta })
  check(away(cfg.reuniteMs - 1).greeting === 'normal', `one ms under the threshold is NOT reunited (got ${String(away(cfg.reuniteMs - 1).greeting)})`)
  check(away(cfg.reuniteMs).greeting === 'normal', `EXACTLY reuniteMs is NOT reunited — the rule is strictly greater (got ${String(away(cfg.reuniteMs).greeting)})`)
  check(away(cfg.reuniteMs + 1).greeting === 'reunited', `one ms over the threshold IS reunited (got ${String(away(cfg.reuniteMs + 1).greeting)})`)
  // A lastSeenAt of 0 means "never seen you" and must not read as a long absence.
  check(ask({ totalInteractions: 9, lastSeenAt: 0 }).greeting === 'normal', 'lastSeenAt 0 is not an absence (it means never seen)')
  check(ask({ totalInteractions: 0, lastSeenAt: 0 }).greeting === 'shy', 'a first-ever visitor with lastSeenAt 0 is shy, not reunited')

  // ── the shy boundary: shyUntil - 1 / shyUntil ─────────────────────────
  check(ask({ totalInteractions: cfg.shyUntil - 1 }).greeting === 'shy', `totalInteractions shyUntil-1 is shy (got ${String(ask({ totalInteractions: cfg.shyUntil - 1 }).greeting)})`)
  check(ask({ totalInteractions: cfg.shyUntil }).greeting === 'normal', `totalInteractions shyUntil is normal (got ${String(ask({ totalInteractions: cfg.shyUntil }).greeting)})`)
  check(ask({ totalInteractions: 0 }).greeting === 'shy', 'zero interactions is shy')

  // ── the day rollover, across midnight ─────────────────────────────────
  const beforeMidnight = midnight - 1
  const afterMidnight = midnight + 1
  const sameDay = pet.nextGreeting({ ...base, fatCalls: 3, countersDay: '2026-01-15' }, beforeMidnight, cfg)
  check(sameDay.rolledOver === false, 'one ms before midnight is still the same day')
  check(sameDay.greeting === 'cold', 'and the three fat-calls still count')
  check(countersOf(sameDay).fatCalls === 3, 'the counter is untouched before midnight')
  const rolled = pet.nextGreeting({ ...base, fatCalls: 3, nickCalls: 2, countersDay: '2026-01-15' }, afterMidnight, cfg)
  check(rolled.rolledOver === true, 'one ms after midnight rolls the counters over')
  check(countersOf(rolled).fatCalls === 0, `the fat counter resets (got ${String(countersOf(rolled).fatCalls)})`)
  check(countersOf(rolled).nickCalls === 0, `the nick counter resets (got ${String(countersOf(rolled).nickCalls)})`)
  check(countersOf(rolled).countersDay === pet.dayStamp(afterMidnight), `the new day is stamped (got ${String(countersOf(rolled).countersDay)})`)
  check(rolled.greeting !== 'cold', 'so a new day is not cold')
  // A file with no day recorded at all rolls over once, then behaves.
  const firstRun = pet.nextGreeting({ ...base, countersDay: '', fatCalls: 5 }, day0, cfg)
  check(firstRun.rolledOver === true, 'a missing day stamp counts as a rollover')
  check(countersOf(firstRun).fatCalls === 0, 'and clears the stale counter')
  check(countersOf(firstRun).countersDay === pet.dayStamp(day0), 'stamping today')
  const secondRun = pet.nextGreeting(countersOf(firstRun), day0, cfg)
  check(secondRun.rolledOver === false, 'the next call the same day does not roll over again')

  // ── purity, determinism, injected config, junk input ──────────────────
  const frozen = { ...base, fatCalls: 1 }
  const snapshotBefore = JSON.stringify(frozen)
  pet.nextGreeting(frozen, day0, cfg)
  check(JSON.stringify(frozen) === snapshotBefore, 'nextGreeting does not mutate its argument')
  check(JSON.stringify(pet.nextGreeting(frozen, day0, cfg)) === JSON.stringify(pet.nextGreeting(frozen, day0, cfg)), 'the same inputs give the same answer')

  const strictNow = pet.nextGreeting({ ...base, totalInteractions: 2 }, day0, { shyUntil: 2 })
  check(strictNow.greeting === 'normal', `an injected shyUntil of 2 makes 2 interactions enough (got ${String(strictNow.greeting)})`)
  const strictAbsence = pet.nextGreeting({ ...base, totalInteractions: 9, lastSeenAt: day0 - 5000 }, day0, { reuniteMs: 4000 })
  check(strictAbsence.greeting === 'reunited', 'an injected reuniteMs of 4s is honoured')
  const strictCold = pet.nextGreeting({ ...base, fatCalls: 1, totalInteractions: 9 }, day0, { coldAfter: 1 })
  check(strictCold.greeting === 'cold', 'an injected coldAfter of 1 is honoured')
  check(pet.greetingConfig({ coldAfter: 0, shyUntil: -3 }).coldAfter === 1, 'greetingConfig floors coldAfter at 1')
  check(pet.greetingConfig({ shyUntil: -3 }).shyUntil === 0, 'greetingConfig floors shyUntil at 0')
  check(pet.greetingConfig(null).reuniteMs === pet.GREETING_CONFIG.reuniteMs, 'an absent config falls back to the shipped defaults')
  check(pet.GREETING_CONFIG.reuniteMs === 1800000, 'the shipped absence threshold is 30 minutes')

  for (const junk of [null, undefined, 'cold', 42, [], {}, { fatCalls: 'x', nickCalls: NaN, totalInteractions: -4 }]) {
    let threw = null
    let result = null
    try {
      result = pet.nextGreeting(junk, day0, cfg)
    } catch (error) {
      threw = String(error?.message ?? error)
    }
    check(threw === null, `nextGreeting(${JSON.stringify(junk) ?? 'undefined'}) does not throw${threw === null ? '' : ` (threw: ${threw})`}`)
    check(
      result !== null && Object.prototype.hasOwnProperty.call(pet.GREETING_BUCKETS, result.greeting),
      `nextGreeting(${JSON.stringify(junk) ?? 'undefined'}) yields a known greeting`,
    )
  }
  for (const now of [NaN, Infinity, -Infinity, undefined, 'soon', 0]) {
    let threw = null
    try {
      pet.nextGreeting(base, now, cfg)
      pet.dayStamp(now)
    } catch (error) {
      threw = String(error?.message ?? error)
    }
    check(threw === null, `a clock of ${String(now)} does not throw${threw === null ? '' : ` (threw: ${threw})`}`)
  }

  // ── the day stamp itself ──────────────────────────────────────────────
  check(pet.dayStamp(day0) === '2026-01-15', `dayStamp formats a local day (got ${String(pet.dayStamp(day0))})`)
  check(/^\d{4}-\d{2}-\d{2}$/.test(pet.dayStamp(day0)), 'the day stamp is exactly YYYY-MM-DD')
  check(pet.dayStamp(midnight) !== pet.dayStamp(midnight - 1), 'midnight changes the day')
  check(pet.dayStamp(midnight + 1) === pet.dayStamp(midnight), 'and it stays changed one ms later')
  // The client and the host must agree on the format, or the rollover fights itself.
  check(pet.dayStamp(day0) === hostLimits.todayStamp(day0), `the client and the host compute the same day stamp (got ${String(pet.dayStamp(day0))} vs ${String(hostLimits.todayStamp(day0))})`)

  // ── the v2 lines must reach the picker ────────────────────────────────
  for (const bucket of ['greet-cold', 'greet-warm', 'reunited', 'shy']) {
    const pool = pet.PERSONA_LINES[bucket]
    const seen = new Set()
    for (let seed = 0; seed < pool.length; seed += 1) {
      const picked = pet.personaPick(bucket, seed, -1)
      check(picked !== null && picked.line !== undefined, `personaPick("${bucket}", ${String(seed)}) resolves a line`)
      if (picked !== null) seen.add(picked.index)
    }
    check(seen.size === pool.length, `every ${bucket} line is reachable (${String(seen.size)}/${String(pool.length)})`)
  }
}

out.log('\nthe client and the host agree on every coordinate:')
{
  /**
   * The one thing that would strand the pet: the client saving a position the host
   * then clamps to something else, or vice versa. Both halves implement clamping, so
   * both are driven here over the same grid and the results compared. The host's
   * `clampPercent` is the same function its sanitizer uses, so this is not a
   * restatement of the rule — it is the rule.
   */
  const grid = [-1e9, -100, -1, 0, 1, 1.4, 2, 2.5, 49, 50, 50.5, 97.5, 98, 99, 100, 1e9, NaN, Infinity, -Infinity, undefined, null, '50']
  let mismatches = 0
  for (const value of grid) {
    const client = pet.clampPercent(value)
    const host = hostClampPercent(value)
    if (client !== host) {
      mismatches += 1
      if (mismatches <= 5) check(false, `clampPercent(${String(value)}): client ${String(client)} vs host ${String(host)}`)
    }
  }
  check(mismatches === 0, `all ${String(grid.length)} sampled coordinates clamp identically in both halves (${String(mismatches)} mismatch(es))`)

  // The clamp is idempotent: clamping a clamped value changes nothing. Without this
  // a save/load loop could walk the pet a step at a time.
  for (const value of grid) {
    const once = pet.clampPercent(value)
    const twice = pet.clampPercent(once)
    if (once !== twice) {
      check(false, `clampPercent is not idempotent at ${String(value)}: ${String(once)} -> ${String(twice)}`)
      break
    }
  }
  check(true, 'clamping is idempotent across the whole grid')

  // The round trip a reload performs: save a position, read it back, clamp again.
  for (const start of [{ x: MIN, y: MAX }, { x: 33, y: 67 }, { x: 50, y: 50 }, { x: MAX, y: MIN }]) {
    const saved = pet.clampPosition(start)
    const restored = pet.clampPosition(saved)
    check(saved.x === restored.x && saved.y === restored.y, `a saved position survives the round trip (${JSON.stringify(saved)})`)
  }

  // Both halves must also agree on the bounds themselves, and on what a whole
  // payload looks like after validation.
  const validated = validateStatePayload({ x: 1e6, y: -50, visible: false })
  check(validated.ok === true, 'the host accepts an out-of-range position by clamping it')
  check(validated.state.x === MAX && validated.state.y === MIN, `the host clamps to the same bounds the client uses (got ${String(validated.state.x)},${String(validated.state.y)})`)
  check(
    pet.clampPosition({ x: validated.state.x, y: validated.state.y }).x === validated.state.x,
    'and the client would not move a position the host just validated',
  )
}

out.log('')
out.log('not exercised here (stated, not hidden):')
out.log('  --  rendering: the react stub returns null, so nothing is drawn. This file')
out.log('      checks the DECISIONS, which is the part that can be checked without a browser.')
out.log('  --  pointer events and the drag gesture: those need a real DOM, and they are')
out.log('      the one part of the pet this repository cannot verify from Node.')
out.log('  --  CSS: that the classes exist and are wired is verify-build.mjs\'s job.')
out.log('')

if (failures.length === 0) {
  out.log('all pet checks passed')
  process.exit(0)
}
out.log(`${String(failures.length)} check(s) failed:`)
for (const f of failures) out.log('  - ' + f)
process.exit(1)
