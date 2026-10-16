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

for (const name of ['clampPosition', 'clampPercent', 'nextPose', 'poseAt', 'stanceAt', 'pickLine', 'pickMode', 'blinkAt', 'swayAt', 'breathAt']) {
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
