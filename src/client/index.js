/**
 * dsh-pet-indesktop — browser half (SOURCE OF TRUTH).
 *
 * The build copies this file to `lib/client.js` and prepends a generated banner;
 * there is no compiler in the client half. See scripts/build.mjs.
 *
 * ── Why this file is wrapped in window.__ModuleLoader__ ──────────────────────
 *
 * This is the shape the DSH web shell loads: it defines
 * `window.__ModuleLoader__`, fetches the client bundle, and evaluates it as a
 * SCRIPT. The `factory` receives the host's `require`, which is how the bundle
 * gets `react` without shipping it. The sibling plugin (dsh-boot-animation) ships
 * exactly this envelope, and this file mirrors it rather than inventing an ESM
 * artifact the loader would not know how to evaluate.
 *
 * A consequence worth stating: because the factory only receives `require` and
 * cannot import sibling files, the whole client half lives in THIS ONE FILE.
 *
 * ── The one rule that must never be broken ───────────────────────────────────
 *
 * There is NO STATIC `inject` export, deliberately. A static dependency the host
 * cannot satisfy leaves this plugin's fiber PENDING forever, and the web boot
 * treats ANY entry that is not `active` as fatal:
 *
 *   web boot: N entry did not activate
 *
 * …and the entire GUI fails to load. The sibling plugin hit exactly this in the
 * field and it read:
 *
 *   dsh-boot-animation: pending (waiting for service: uisession)
 *
 * A desktop pet must never be able to cost someone their harness. Both services
 * are therefore resolved through cordis's DYNAMIC injection —
 * `ctx.inject(deps, callback)` — where the wait happens in a CHILD fiber while
 * this entry still reaches `active` immediately. On a host that never provides
 * them, the plugin idles: the correct failure mode for an add-on like this one.
 * `scripts/verify-client-boot.mjs` asserts that invariant against the SHIPPED
 * artifact.
 *
 * ── Two seats, and the z-index ───────────────────────────────────────────────
 *
 *   shell.overlay          the pet itself
 *   sidebar.footer.action  the show/hide button, so a hidden pet is recoverable
 *                          (without it, hiding the pet would be a one-way door)
 *
 * The pet's z-index is 2147481000. It has to sit ABOVE ordinary chrome (which
 * lives in the low thousands) but BELOW a full-frame overlay: the sibling plugin
 * dsh-boot-animation draws its intro at 2147483000, and an intro that covers the
 * whole frame is meant to cover the pet too. 2000 below that leaves room for
 * another full-frame layer in between without ever outranking one. Both numbers
 * are documented in ARCHITECTURE.md; neither is arbitrary.
 *
 * ── The decision matrix is DATA ──────────────────────────────────────────────
 *
 * Everything the pet decides is a PURE function exported from this bundle:
 * `nextPose`, `poseAt`, `stanceAt`, `pickLine`, `clampPosition`, `clampPercent`,
 * `blinkAt`, `swayAt`, `pickMode`. The component is a thin renderer over them, so
 * `scripts/verify-pet.mjs` can exhaust the whole matrix — every mode, every phase,
 * every edge, an unknown mode, reduced motion — by calling them with numbers, and
 * never has to render anything to know what the pet will do. That is copied from
 * the sibling plugin's `decidePlay`, which is the pattern that survived contact
 * with a real host.
 *
 * ── Diagnostics ──────────────────────────────────────────────────────────────
 *
 * The idle lines are emitted with `console.warn` UNCONDITIONALLY (not gated by
 * DEBUG), because they are the only way to tell these two situations apart:
 *
 *   idle: host offers no dynamic injection and no uiSession   → the plugin
 *        loaded, the host is not offering the services (host/version problem)
 *   no [dsh-pet-indesktop] output at all                      → the bundle did not
 *        load at all (not installed, or the browser served a cached copy —
 *        press Ctrl+Shift+R)
 *
 * Everything else stays behind DEBUG so a healthy host sees a silent console.
 */
window.__ModuleLoader__.load({
  id: 'dsh-pet-indesktop',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    /** Flip to true to get this plugin's diagnostics on the console. */
    const DEBUG = false

    /** One diagnostic line per event, and nothing at all when DEBUG is false. */
    function debug(message, detail) {
      if (!DEBUG) return
      try {
        if (detail === undefined) console.debug('[dsh-pet-indesktop] ' + message)
        else console.debug('[dsh-pet-indesktop] ' + message, detail)
      } catch {
        /* a console that throws must not become a plugin failure */
      }
    }

    /**
     * The idle lines. `console.warn` and not `debug`: see the header. Wrapped in
     * try/catch for the same reason `debug` is — a hostile console is not a
     * plugin failure.
     */
    function idleNoServices() {
      try {
        console.warn('[dsh-pet-indesktop] idle: host offers no dynamic injection and no uiSession')
      } catch {
        /* nothing to do */
      }
    }

    function idleNoReact() {
      try {
        console.warn('[dsh-pet-indesktop] idle: react is not available from the host module loader')
      } catch {
        /* nothing to do */
      }
    }

    // ── constants ────────────────────────────────────────────────────────────

    const STYLE_ID = 'dsh-pet-indesktop-style'

    /** Where the host keeps the state. Same origin, so no CORS story exists. */
    const STATE_URL = '/dsh-pet-indesktop/state.json/state'
    const STATE_READ_URL = '/dsh-pet-indesktop/state.json'

    /**
     * How long a speech bubble stays up. Short on purpose: a pet that talks
     * forever is a modal dialog with extra steps.
     */
    const BUBBLE_MS = 2600

    /** How long to wait after the last drag movement before saving. */
    const SAVE_DEBOUNCE_MS = 600

    /** A drag has to travel this far before it stops counting as a click. */
    const CLICK_SLOP_PX = 4

    /** The anchor stays this far inside the frame, in percent. Must match the host. */
    const MIN_POS = 2
    const MAX_POS = 98

    /** The animation periods, in milliseconds. One place, so they cannot drift. */
    const BREATH_MS = 3200
    const BLINK_EVERY_MS = 4300
    const BLINK_FOR_MS = 150
    const SWAY_MS = 5200
    const HAPPY_MS = 1500

    /**
     * The pose modes. A closed set, because `nextPose` has to be exhaustible as
     * data by a test rather than inferred from rendering.
     */
    const POSES = ['idle', 'happy']

    /** The class names, in one place, so the sheet and the markup cannot drift. */
    const CLASS = {
      root: 'dpi-root',
      bubble: 'dpi-bubble',
      bubbleZh: 'dpi-bubble-zh',
      bubbleEn: 'dpi-bubble-en',
      whale: 'dpi-whale',
      body: 'dpi-body',
      tail: 'dpi-tail',
      fin: 'dpi-fin',
      spout: 'dpi-spout',
      eye: 'dpi-eye',
      blush: 'dpi-blush',
      toggle: 'dpi-toggle',
      toggleDot: 'dpi-toggle-dot',
    }

    // ── the stylesheet ───────────────────────────────────────────────────────
    //
    // Note for editors: the sheet is a template literal, so a stray backtick
    // inside a CSS comment terminates it early and the resulting error points at
    // the wrong place. scripts/check-css-template.mjs exists to catch exactly
    // that, and is part of `npm run build`.

    const CSS = `
/* dsh-pet-indesktop — the whale, in CSS. No image, no font, no network. */

/* The pet's own layer. 2147481000: above ordinary chrome, 2000 BELOW the
   full-frame overlay the sibling plugin draws at 2147483000, so an intro
   animation covers the pet rather than fighting it. See the file header. */
.dpi-root{position:fixed;inset:0;z-index:2147481000;pointer-events:none;
  display:block;overflow:hidden}

/* Only the pet's box takes clicks; the rest of the layer is transparent to them,
   so a pet sitting in the middle of the page never blocks the page. */
.dpi-pet{position:absolute;width:112px;height:92px;
  transform:translate(-50%,-100%);
  pointer-events:auto;cursor:grab;touch-action:none;
  user-select:none;-webkit-user-select:none;
  will-change:transform}
.dpi-pet.dpi-dragging{cursor:grabbing}

.dpi-whale{position:absolute;inset:0;display:block;width:100%;height:100%;
  filter:drop-shadow(0 6px 10px rgba(4,10,24,.45));
  transform-origin:50% 85%;
  animation:dpi-breathe 3.2s ease-in-out infinite}
.dpi-happy .dpi-whale{animation:dpi-hop 1.5s ease-in-out 1}

/* The tail is its own group so it can sway around its own joint, at a different
   period from the breathing. Two periods that do not divide each other read as
   alive instead of as a loop. */
.dpi-tail{transform-origin:22% 52%;animation:dpi-sway 5.2s ease-in-out infinite}
.dpi-happy .dpi-tail{animation-duration:1.5s}
.dpi-fin{transform-origin:58% 66%;animation:dpi-fin-beat 5.2s ease-in-out infinite}

/* Blinking is a class the component toggles from the pure blinkAt decision, so
   the timing lives in JS (where a test can read it) and only the shape lives
   here. NOTE for editors: no backticks anywhere inside this sheet — that is the
   exact trap scripts/check-css-template.mjs exists to catch. */
.dpi-eye{transform-origin:center;transition:transform 90ms ease-out}
.dpi-blinking .dpi-eye{transform:scaleY(.12)}
.dpi-happy .dpi-eye{transform:scaleY(.45)}

.dpi-spout{opacity:0;transform-origin:50% 100%}
.dpi-happy .dpi-spout{animation:dpi-spout 1.5s ease-out 1}

/* The speech bubble. Chinese on the first line, English under it: the product is
   bilingual, and a pet that only speaks one of them is a pet for half its users. */
.dpi-bubble{position:absolute;left:50%;bottom:100%;margin-bottom:10px;
  transform:translateX(-50%);min-width:9rem;max-width:16rem;
  padding:8px 12px;border-radius:12px;
  background:rgba(12,20,38,.94);border:1px solid rgba(125,211,252,.35);
  box-shadow:0 8px 24px rgba(0,0,0,.45);
  color:rgba(255,255,255,.94);font-family:inherit;font-size:12.5px;line-height:1.45;
  text-align:center;white-space:normal;pointer-events:none;
  animation:dpi-pop 160ms ease-out 1}
.dpi-bubble-zh{font-weight:600}
.dpi-bubble-en{opacity:.72;font-size:11.5px;margin-top:2px}

/* The toggle lives in the sidebar footer, not in this layer. */
.dpi-toggle{display:inline-flex;align-items:center;gap:7px;
  font-family:inherit;font-size:12px;line-height:1.2;
  padding:4px 10px;border-radius:999px;cursor:pointer;
  border:1px solid rgba(148,163,184,.45);
  background:rgba(148,163,184,.12);color:inherit}
.dpi-toggle:hover{background:rgba(148,163,184,.22)}
.dpi-toggle-dot{width:8px;height:8px;border-radius:999px;
  background:rgba(148,163,184,.6);box-shadow:none}
.dpi-toggle[data-on="true"] .dpi-toggle-dot{
  background:#38bdf8;box-shadow:0 0 6px rgba(56,189,248,.9)}

@keyframes dpi-breathe{
  0%{transform:translateY(0) scale(1,1)}
  50%{transform:translateY(-3px) scale(1.02,.97)}
  100%{transform:translateY(0) scale(1,1)}
}
@keyframes dpi-hop{
  0%{transform:translateY(0) scale(1,1)}
  35%{transform:translateY(-12px) scale(.98,1.04)}
  70%{transform:translateY(0) scale(1.03,.96)}
  100%{transform:translateY(0) scale(1,1)}
}
@keyframes dpi-sway{
  0%{transform:rotate(-6deg)}
  50%{transform:rotate(7deg)}
  100%{transform:rotate(-6deg)}
}
@keyframes dpi-fin-beat{
  0%{transform:rotate(0deg)}
  45%{transform:rotate(-9deg)}
  100%{transform:rotate(0deg)}
}
@keyframes dpi-spout{
  0%{opacity:0;transform:translateY(0) scale(.6)}
  25%{opacity:.9;transform:translateY(-6px) scale(1)}
  100%{opacity:0;transform:translateY(-14px) scale(1.15)}
}
@keyframes dpi-pop{
  0%{opacity:0;transform:translateX(-50%) translateY(4px) scale(.94)}
  100%{opacity:1;transform:translateX(-50%) translateY(0) scale(1)}
}

/* Respect the OS setting. A cosmetic pet is exactly the kind of thing that must
   not ignore this, so the fallback is a STILL FRAME, not a slower animation:
   "reduced" means less movement, and a slower bob is still a bob. */
@media (prefers-reduced-motion:reduce){
  .dpi-whale,.dpi-tail,.dpi-fin,.dpi-spout,.dpi-bubble{animation:none}
  .dpi-happy .dpi-whale,.dpi-happy .dpi-tail,.dpi-happy .dpi-spout{animation:none}
  .dpi-eye{transition:none}
  .dpi-pet{transition:none}
}
`

    // ── the pure decision functions ──────────────────────────────────────────
    //
    // Everything below takes numbers and returns numbers or plain data. No DOM,
    // no react, no time source of its own — `now` is always a parameter. That is
    // what lets scripts/verify-pet.mjs drive the whole matrix without a browser.

    /** Coerce to a usable finite number, or fall back. */
    function finite(value, fallback) {
      return typeof value === 'number' && Number.isFinite(value) ? value : fallback
    }

    /** True when the caller asked for less motion. Absent means "not specified". */
    function wantsReducedMotion(options) {
      if (options === null || typeof options !== 'object') return false
      return options.reducedMotion === true
    }

    /**
     * Clamp one percentage into the anchor range.
     *
     * Rounds to an integer on purpose: the host validates integers, and rounding
     * here means the value the pet saves is the value the host would accept, with
     * no rounding disagreement between the two halves.
     */
    function clampPercent(value) {
      const usable = finite(value, MAX_POS)
      return Math.min(MAX_POS, Math.max(MIN_POS, Math.round(usable)))
    }

    /**
     * Clamp a position, whatever it is.
     *
     * Every edge is explicit, and unusable input cannot produce NaN: a missing
     * axis falls back to the default anchor rather than to 0, so a partial state
     * cannot teleport the pet into the top-left corner.
     */
    function clampPosition(position) {
      const source = position === null || typeof position !== 'object' ? {} : position
      return { x: clampPercent(source.x), y: clampPercent(source.y) }
    }

    /** Where the default pet sits when nothing is stored: bottom-right, out of the way. */
    const DEFAULT_POSITION = Object.freeze({ x: 92, y: 88 })

    /** A finite `now`, floored at 0. Negative clocks are treated as "just started". */
    function clockOf(now) {
      return Math.max(0, finite(now, 0))
    }

    /**
     * Is the pet blinking at `now`?
     *
     * Deterministic: the blink schedule depends only on the clock, so a test can
     * ask "is it blinking at 4300ms" and get the same answer the renderer gets.
     * The window is short (150ms) because a blink that can be caught by a
     * screenshot is not a blink.
     */
    function blinkAt(now, options) {
      if (wantsReducedMotion(options)) return false
      const at = clockOf(now)
      if (at < BLINK_EVERY_MS) return false
      return at % BLINK_EVERY_MS < BLINK_FOR_MS
    }

    /**
     * The tail's sway, in degrees, as a number a test can read.
     *
     * A pure function of the clock rather than a CSS animation, so the amplitude
     * is assertable: reduced motion returns exactly 0 (still), not a smaller sway.
     */
    function swayAt(now, options) {
      const at = clockOf(now)
      if (wantsReducedMotion(options)) return 0
      const phase = ((at % SWAY_MS) / SWAY_MS) * Math.PI * 2
      return Math.round(Math.sin(phase) * 7)
    }

    /**
     * The vertical offset in pixels from the breathing cycle.
     *
     * 0 under reduced motion: the pet holds still and only its eyes are allowed to
     * change (and even those stop — see `nextPose`).
     */
    function breathAt(now, options) {
      const at = clockOf(now)
      if (wantsReducedMotion(options)) return 0
      const phase = ((at % BREATH_MS) / BREATH_MS) * Math.PI * 2
      return Math.round(Math.sin(phase) * 3 * 10) / 10
    }

    /**
     * Which mode the pet is in.
     *
     * `since` is when the last interaction happened (a click, a drag), or null.
     * A `happy` burst is short and self-limiting: it lasts `HAPPY_MS`, then the
     * pet goes back to `idle` on its own, so there is no timer to leak.
     */
    function pickMode(since, now) {
      const at = clockOf(now)
      const from = typeof since === 'number' && Number.isFinite(since) ? since : null
      if (from === null) return 'idle'
      const elapsed = at - from
      if (elapsed < 0) return 'idle'
      return elapsed < HAPPY_MS ? 'happy' : 'idle'
    }

    /**
     * The whole decision matrix, as one object.
     *
     * `nextPose(state, event, now)` is the only way the component asks what to do:
     * `state` carries the pet's stored data, `event` says what just happened, and
     * `now` is the clock. Nothing else is consulted, so the same three inputs
     * always produce the same pose — which is exactly what makes the matrix data.
     *
     * Unknown modes and unknown events are IGNORED (they fall back to `idle`), not
     * thrown on: a pet is decoration, and a decoration that throws takes a GUI with
     * it.
     */
    function nextPose(state, event, now) {
      const source = state === null || typeof state !== 'object' ? {} : state
      const asked = source.mode
      const mode = POSES.includes(asked) ? asked : 'idle'
      const still = wantsReducedMotion(source)
      const at = clockOf(now)

      return {
        mode,
        /** True when the renderer must not animate at all. */
        still,
        /** True when the renderer should add the blinking class. */
        blinking: !still && blinkAt(at, source),
        /** Degrees of tail sway; 0 when still. */
        sway: swayAt(at, source),
        /** Pixels of vertical offset from the breath. */
        breath: still ? 0 : breathAt(at, source),
        /** Milliseconds into the current mode, for the CSS burst animations. */
        elapsed: Math.max(0, at - clockOf(finite(source.since, at))),
        /** The event that produced this pose, echoed so a caller can log it. */
        event: typeof event === 'string' && event !== '' ? event : 'tick',
      }
    }

    /**
     * A stable, readable pose for a clock, with no state object to carry.
     *
     * This is the shape a test drives: `poseAt(4300)` is a blink, and
     * `poseAt(4300, { reducedMotion: true })` is not.
     */
    function poseAt(now, options) {
      return nextPose({ ...(options ?? {}), mode: 'idle', since: null }, 'tick', now)
    }

    /** The pet's whole visible stance: position + pose. Pure, and the renderer's only input. */
    function stanceAt(state, now) {
      const source = state === null || typeof state !== 'object' ? {} : state
      const pose = nextPose(source, 'tick', now)
      return {
        position: clampPosition(source.position ?? source),
        pose,
        mode: pickMode(source.since, now),
      }
    }

    /**
     * The speech-bubble lines, Chinese first and English under it.
     *
     * They are data, not strings buried in the renderer, so the verifier can count
     * them, walk them all and prove every index resolves.
     */
    const LINES = Object.freeze([
      Object.freeze({ id: 'hello', zh: '你好呀，我是小深。', en: "Hi, I'm Xiaoshen." }),
      Object.freeze({ id: 'drag', zh: '拖我一下，我就搬家。', en: 'Drag me and I will move.' }),
      Object.freeze({ id: 'busy', zh: '你忙你的，我在旁边看着。', en: 'Carry on — I am just watching.' }),
      Object.freeze({ id: 'break', zh: '记得站起来走两步。', en: 'Remember to stand up and stretch.' }),
      Object.freeze({ id: 'late', zh: '很晚了，早点休息。', en: 'It is late. Get some rest.' }),
      Object.freeze({ id: 'thanks', zh: '谢谢你把我放回桌面。', en: 'Thanks for keeping me around.' }),
    ])

    /**
     * Choose a line. `index` may be anything; it is folded into range.
     *
     * Negative and huge indices are wrapped rather than rejected, because the
     * caller is a clock or a counter and refusing its input would mean the pet
     * sometimes says nothing at all.
     */
    function pickLine(index) {
      const at = Math.abs(Math.trunc(finite(index, 0)))
      return LINES[at % LINES.length]
    }

    // ── react ────────────────────────────────────────────────────────────────
    //
    // Resolved from the host's loader, not imported: the bundle ships no react.
    // A host that cannot hand it over costs a pet, never a boot, so the failure is
    // caught here and turned into the idle path.
    let React = null
    try {
      React = require('react')
    } catch {
      React = null
    }

    // ── the DOM side ─────────────────────────────────────────────────────────

    /**
     * How many live mounts are holding the stylesheet open.
     *
     * A plain "remove the sheet on unmount" is wrong the moment two mounts
     * overlap — a hot reload, or a remount while the old frame is still tearing
     * down — because the first unmount would strip the sheet out from under the
     * survivor. Counting is the whole fix.
     */
    let sheetHolders = 0

    function acquireStyle() {
      sheetHolders += 1
      if (sheetHolders > 1) return
      try {
        if (document.getElementById(STYLE_ID) !== null) return
        const style = document.createElement('style')
        style.id = STYLE_ID
        style.textContent = CSS
        document.head.appendChild(style)
      } catch {
        /* no document (tests, SSR): styling is cosmetic, never fatal */
      }
    }

    function releaseStyle() {
      sheetHolders = Math.max(0, sheetHolders - 1)
      if (sheetHolders > 0) return
      try {
        const style = document.getElementById(STYLE_ID)
        if (style === null) return
        if (typeof style.remove === 'function') style.remove()
        else if (style.parentNode) style.parentNode.removeChild(style)
      } catch {
        /* nothing to remove */
      }
    }

    /** True when the host asked for less motion. Read once per render. */
    function prefersReducedMotion() {
      try {
        return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches === true
      } catch {
        return false
      }
    }

    /** The viewport, guarded: a pet must not break in an exotic embedder. */
    function viewport() {
      try {
        return { width: window.innerWidth || 1024, height: window.innerHeight || 768 }
      } catch {
        return { width: 1024, height: 768 }
      }
    }

    /**
     * The state client: read once on mount, write debounced.
     *
     * Every failure is swallowed on purpose. If the host route is missing the pet
     * still works for this session — it just forgets where it was, which is a far
     * better outcome than a plugin that stops responding because a fetch 404'd.
     */
    function createStateClient() {
      let timer = null
      let pending = null
      let lastError = null

      const flush = () => {
        timer = null
        const body = pending
        pending = null
        if (body === null) return
        try {
          const sent = fetch(STATE_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
            keepalive: true,
          })
          if (sent !== null && typeof sent.then === 'function') {
            sent.then(
              (response) => {
                if (response !== null && response.ok === false) lastError = 'host rejected the state'
                else debug('state saved', body)
              },
              (cause) => {
                lastError = String(cause?.message ?? cause)
                debug('state save failed (ignored)', lastError)
              },
            )
          }
        } catch (cause) {
          lastError = String(cause?.message ?? cause)
          debug('state save threw (ignored)', lastError)
        }
      }

      return {
        async load() {
          try {
            const response = await fetch(STATE_READ_URL, { headers: { accept: 'application/json' } })
            if (response === null || response.ok === false) return null
            const payload = await response.json()
            const value = payload?.state
            if (value === null || typeof value !== 'object') return null
            debug('state loaded', value)
            return value
          } catch (cause) {
            debug('state load failed (using defaults)', String(cause?.message ?? cause))
            return null
          }
        },
        save(patch) {
          pending = { ...(pending ?? {}), ...patch }
          if (timer !== null) return
          timer = setTimeout(flush, SAVE_DEBOUNCE_MS)
        },
        error: () => lastError,
      }
    }

    // ── the component ────────────────────────────────────────────────────────

    /** One clock for the whole pet, ticking only while it is visible. */
    function useClock(active) {
      const [now, setNow] = React.useState(() => Date.now())
      React.useEffect(() => {
        if (!active) return undefined
        const id = setInterval(() => setNow(Date.now()), 250)
        return () => clearInterval(id)
      }, [active])
      return now
    }

    /**
     * The whale. Inline SVG, so there is no asset to fetch and nothing to licence.
     *
     * Every animated part is a class; the numbers come from the pure functions, so
     * the drawing has no opinions about timing.
     */
    function Whale(props) {
      const pose = props.pose
      const style = pose.still ? undefined : { transform: `translateY(${String(pose.breath)}px)` }
      return React.createElement(
        'svg',
        {
          className: CLASS.whale,
          style,
          viewBox: '0 0 112 92',
          width: '112',
          height: '92',
          role: 'img',
          'aria-label': 'desktop pet',
        },
        // the spout, drawn first so the body overlaps it
        React.createElement('g', { className: CLASS.spout }, [
          React.createElement('circle', { key: 's1', cx: '52', cy: '16', r: '4', fill: 'rgba(186,230,253,.75)' }),
          React.createElement('circle', { key: 's2', cx: '46', cy: '9', r: '2.6', fill: 'rgba(186,230,253,.6)' }),
          React.createElement('circle', { key: 's3', cx: '58', cy: '8', r: '2.2', fill: 'rgba(186,230,253,.5)' }),
        ]),
        // the tail: its own group so it sways around its own joint
        React.createElement(
          'g',
          {
            className: CLASS.tail,
            style: pose.still ? undefined : { transform: `rotate(${String(pose.sway)}deg)` },
          },
          [
            React.createElement('path', {
              key: 't',
              d: 'M22 52 C8 40 4 24 12 14 C22 24 28 36 32 46 Z',
              fill: '#2f6fd0',
            }),
            React.createElement('path', {
              key: 't2',
              d: 'M22 52 C10 52 2 58 2 66 C14 66 24 62 30 56 Z',
              fill: '#255bb0',
            }),
          ],
        ),
        // the body
        React.createElement('path', {
          className: CLASS.body,
          d: 'M30 46 C36 24 62 14 84 22 C100 28 108 44 104 58 C100 72 84 82 64 82 C44 82 30 70 26 58 C25 54 27 49 30 46 Z',
          fill: '#3b82f6',
        }),
        React.createElement('path', {
          d: 'M44 78 C56 84 76 84 90 74 C80 86 58 90 44 78 Z',
          fill: 'rgba(191,219,254,.55)',
        }),
        // the fin
        React.createElement('path', {
          className: CLASS.fin,
          d: 'M60 66 C66 60 78 60 84 66 C78 76 66 78 60 66 Z',
          fill: '#255bb0',
        }),
        // the face
        React.createElement('circle', { className: CLASS.eye, cx: '74', cy: '42', r: '4.4', fill: '#0b1220' }),
        React.createElement('circle', { className: CLASS.blush, cx: '86', cy: '52', r: '4', fill: 'rgba(251,113,133,.45)' }),
      )
    }

    /** The pet layer: drag it, click it, or hide with the button. */
    function Pet(props) {
      const state = props.state
      const position = props.position
      const now = useClock(state.visible)
      const drag = React.useRef(null)
      const [dragging, setDragging] = React.useState(false)
      const [bubble, setBubble] = React.useState(null)

      const pose = nextPose(
        { ...state, mode: pickMode(state.since, now), since: state.since, reducedMotion: props.reducedMotion },
        'tick',
        now,
      )
      const stance = stanceAt({ position, reducedMotion: props.reducedMotion }, now)

      // A bubble is a plain timeout, cleared on unmount: no interval, no listener.
      React.useEffect(() => {
        if (bubble === null) return undefined
        const id = setTimeout(() => setBubble(null), BUBBLE_MS)
        return () => clearTimeout(id)
      }, [bubble])

      /** Percentages from a pointer position, via the anchor the pet is drawn from. */
      const percentFrom = (event) => {
        const view = viewport()
        return {
          x: clampPercent((event.clientX / view.width) * 100),
          y: clampPercent((event.clientY / view.height) * 100),
        }
      }

      const onPointerDown = (event) => {
        try {
          if (typeof event.currentTarget.setPointerCapture === 'function') {
            event.currentTarget.setPointerCapture(event.pointerId)
          }
        } catch {
          /* capture is a nicety: dragging still works without it */
        }
        drag.current = { id: event.pointerId, moved: 0, last: { x: event.clientX, y: event.clientY } }
        setDragging(true)
      }

      const onPointerMove = (event) => {
        const active = drag.current
        if (active === null || active.id !== event.pointerId) return
        const dx = event.clientX - active.last.x
        const dy = event.clientY - active.last.y
        active.moved += Math.abs(dx) + Math.abs(dy)
        active.last = { x: event.clientX, y: event.clientY }
        // The pet follows the pointer through the SAME clamp the stored value
        // uses, so it cannot be dragged somewhere it could not be restored to.
        props.onMove(percentFrom(event))
      }

      const onPointerUp = (event) => {
        const active = drag.current
        drag.current = null
        setDragging(false)
        try {
          if (typeof event.currentTarget.releasePointerCapture === 'function') {
            event.currentTarget.releasePointerCapture(event.pointerId)
          }
        } catch {
          /* nothing to release */
        }
        // A drag is not a click. Without this the pet would say something every
        // time it was moved, which is the fastest way to make it annoying.
        if (active !== null && active.moved > CLICK_SLOP_PX) return
        props.onPoke()
        setBubble({ index: Date.now() % LINES.length })
      }

      const onKeyDown = (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        props.onPoke()
        setBubble({ index: Date.now() % LINES.length })
      }

      const petStyle = {
        left: `${String(position.x)}%`,
        top: `${String(position.y)}%`,
      }
      const line = bubble === null ? null : pickLine(bubble.index)

      return React.createElement(
        'div',
        { className: `${CLASS.root}${dragging ? ' dpi-dragging' : ''}` },
        React.createElement(
          'div',
          {
            className: `${CLASS.pet}${pose.mode === 'happy' ? ' dpi-happy' : ''}${pose.blinking ? ' dpi-blinking' : ''}`,
            style: petStyle,
            role: 'button',
            tabIndex: 0,
            'aria-label': 'desktop pet',
            onPointerDown,
            onPointerMove,
            onPointerUp,
            onPointerCancel: onPointerUp,
            onKeyDown,
          },
          line === null
            ? null
            : React.createElement(
                'div',
                { className: CLASS.bubble, role: 'status' },
                React.createElement('div', { className: CLASS.bubbleZh }, line.zh),
                React.createElement('div', { className: CLASS.bubbleEn }, line.en),
              ),
          React.createElement(Whale, { pose }),
        ),
      )
    }

    /**
     * The overlay seat's root: it owns the pet's position and visibility, so the
     * pet itself stays a pure function of its props.
     */
    function PetRoot(props) {
      const position = props.position
      const state = props.state
      const reducedMotion = prefersReducedMotion()
      debug('pet mounted', { position, visible: state.visible })
      return React.createElement(Pet, {
        state,
        position,
        reducedMotion,
        onMove: props.onMove,
        onPoke: props.onPoke,
      })
    }

    /**
     * The sidebar button. It is separate from the pet on purpose: if the only way
     * to show the pet were the pet itself, hiding it would be a one-way door.
     */
    function ToggleButton(props) {
      const on = props.state.visible
      return React.createElement(
        'button',
        {
          type: 'button',
          className: CLASS.toggle,
          'data-on': on ? 'true' : 'false',
          'aria-pressed': on ? 'true' : 'false',
          title: on ? '隐藏桌宠 / Hide the pet' : '显示桌宠 / Show the pet',
          onClick: props.onToggle,
        },
        React.createElement('span', { className: CLASS.toggleDot }),
        React.createElement('span', null, on ? '桌宠 开' : '桌宠 关'),
      )
    }

    // ── the plugin entry ─────────────────────────────────────────────────────

    /**
     * Only `slots` is actually used. `uiSession` is declared alongside it for
     * parity with the sibling plugins; this one does not need that store, so a host
     * that withholds it still gets the pet.
     */
    const SERVICES = ['slots', 'uiSession']

    /** The slots service, when the host provided one that behaves. */
    function slotsOf(ready) {
      const candidate = ready.slots
      if (candidate === undefined || candidate === null) return null
      return typeof candidate.inject === 'function' && typeof candidate.register === 'function' ? candidate : null
    }

    function apply(ctx) {
      const wire = (ready) => {
        const slots = slotsOf(ready)
        if (slots === null) {
          // The field report: the host offers nothing this plugin can attach to.
          idleNoServices()
          return
        }
        if (React === null) {
          idleNoReact()
          return
        }

        debug('services ready', { hasUiSession: ready.uiSession !== undefined })

        /**
         * Claim the two seats. `slots.register({ name, id, order }, component)` is
         * the whole contract, and both slots are `kind: list` — ADDED cells, never
         * replacements — which is why this plugin cannot displace official UI.
         *
         * The returned disposer releases the stylesheet; `ctx.effect` is what calls
         * it when the fiber unloads. Styling is the only thing this plugin has to
         * tear down by hand, because the pet owns no timers, no listeners and no
         * media outside its own component tree.
         */
        const register = () => {
          acquireStyle()
          const client = createStateClient()
          const store = { current: { ...DEFAULT_STATE_LIKE } }

          /** One place where a position change becomes state + a debounced save. */
          const moveTo = (next) => {
            const clamped = clampPosition(next)
            if (clamped.x === store.current.x && clamped.y === store.current.y) return
            store.current = { ...store.current, ...clamped }
            mounted.setPosition({ ...clamped })
            client.save(clamped)
          }

          const mounted = mountPet(slots, store, client, moveTo)

          // Restore what the host remembers. The pet renders at the default spot
          // for at most one round trip, and only moves if the host disagrees.
          const loaded = client.load()
          if (loaded !== null && typeof loaded.then === 'function') {
            loaded.then((saved) => {
              if (saved === null) return
              const next = { ...store.current, ...sanitizeRemote(saved) }
              store.current = next
              mounted.setPosition(clampPosition(next))
              mounted.setVisible(next.visible)
            })
          }

          return () => {
            releaseStyle()
          }
        }

        if (typeof ready.effect === 'function') ready.effect(register, 'dsh-pet-indesktop: mounts')
        else register()
      }

      if (typeof ctx.inject === 'function') {
        // cordis dynamic injection: the wait happens in a CHILD fiber, so this
        // entry is `active` immediately even when the services never arrive.
        ctx.inject(SERVICES, wire)
        return
      }

      // A host without dynamic injection. Mounting eagerly is only safe when the
      // service is already there; otherwise stay idle rather than risk the
      // pending-forever state that takes the whole GUI down.
      if (slotsOf(ctx) !== null) wire(ctx)
      else idleNoServices()
    }

    /** The default state, mirrored here so the client renders before it has heard from the host. */
    const DEFAULT_STATE_LIKE = Object.freeze({ version: 1, visible: true, x: 92, y: 88 })

    /**
     * Keep only what the host would accept.
     *
     * The host is the authority, but a client that trusts a payload blindly would
     * happily render at `x: null`. Same rules, same order, no throwing.
     */
    function sanitizeRemote(raw) {
      const source = raw === null || typeof raw !== 'object' ? {} : raw
      const out = {}
      if (typeof source.visible === 'boolean') out.visible = source.visible
      out.x = clampPercent(source.x)
      out.y = clampPercent(source.y)
      return out
    }

    /**
     * Mount both seats and hand back the two setters the rest of the entry needs.
     *
     * Kept as a small explicit function rather than inline so the ownership is
     * obvious: this is the only place that talks to the slot service.
     */
    function mountPet(slots, store, client, moveTo) {
      let position = { x: store.current.x, y: store.current.y }
      let visible = store.current.visible
      const subscribers = new Set()

      const emit = () => {
        for (const notify of subscribers) {
          try {
            notify()
          } catch {
            /* a broken subscriber is not the pet's problem */
          }
        }
      }

      // A tiny external store: the seats re-render from it, and react never has to
      // know that the pet's state lives outside its own tree.
      const subscribe = (notify) => {
        subscribers.add(notify)
        return () => subscribers.delete(notify)
      }

      const snapshot = () => ({ position, visible })
      const getVisible = () => visible
      const getPosition = () => position

      const setPosition = (next) => {
        position = clampPosition(next)
        emit()
      }
      const setVisible = (next) => {
        visible = next === true
        emit()
      }

      const useSnapshot = () => React.useSyncExternalStore(subscribe, snapshot, snapshot)

      const PetSeat = () => {
        const snapshotValue = useSnapshot()
        if (snapshotValue.visible !== true) return null
        return React.createElement(Pet, {
          state: { ...store.current, visible: true, mode: pickMode(store.current.since, Date.now()) },
          position: snapshotValue.position,
          reducedMotion: prefersReducedMotion(),
          onMove: moveTo,
          onPoke: () => {
            store.current = { ...store.current, since: Date.now() }
            emit()
          },
        })
      }

      const ToggleSeat = () => {
        const snapshotValue = useSnapshot()
        return React.createElement(ToggleButton, {
          state: { visible: snapshotValue.visible },
          onToggle: () => {
            const next = !getVisible()
            store.current = { ...store.current, visible: next }
            setVisible(next)
            client.save({ visible: next })
          },
        })
      }

      slots.inject('shell.overlay', () =>
        slots.register({ name: 'shell.overlay', id: 'dsh-pet-indesktop', order: 700 }, () =>
          React.createElement(PetSeat, null),
        ),
      )
      slots.inject('sidebar.footer.action', () =>
        slots.register(
          { name: 'sidebar.footer.action', id: 'dsh-pet-indesktop-toggle', order: 40, label: () => '桌宠 / Pet' },
          () => React.createElement(ToggleSeat, null),
        ),
      )

      void getPosition
      return { setPosition, setVisible }
    }

    exports.apply = apply
    exports.CSS = CSS
    exports.STYLE_ID = STYLE_ID
    exports.CLASS = CLASS
    // The decision matrix, exported as data so scripts/verify-pet.mjs can exhaust
    // it without rendering anything. See the header.
    exports.POSES = POSES
    exports.LINES = LINES
    exports.BUBBLE_MS = BUBBLE_MS
    exports.MIN_POS = MIN_POS
    exports.MAX_POS = MAX_POS
    exports.DEFAULT_POSITION = DEFAULT_POSITION
    exports.clampPercent = clampPercent
    exports.clampPosition = clampPosition
    exports.blinkAt = blinkAt
    exports.swayAt = swayAt
    exports.breathAt = breathAt
    exports.pickMode = pickMode
    exports.nextPose = nextPose
    exports.poseAt = poseAt
    exports.stanceAt = stanceAt
    exports.pickLine = pickLine

    return module.exports
  },
})
