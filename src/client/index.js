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
 * ── The picture ──────────────────────────────────────────────────────────────
 *
 * The pet is EIGHT PNGs (`assets/skins/<id>.png`, copied to `lib/assets/skins/`)
 * served by this plugin's own host half at `/dsh-pet-indesktop/assets/skins/<id>.png`.
 * The id is a key into an allow-list, never a path segment. Not a CDN,
 * not a data: URI, not an external host — the same process that serves this
 * bundle serves the image, so there is still no third-party request anywhere.
 * The idle motion (bob, sway, breathe) is CSS on wrappers around the `<img>`; the
 * pure functions below decide the MODE and whether motion is allowed at all.
 * The artwork carries an "OleapCrow" mark; see README for the attribution.
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
     * The skins, served by this plugin's own host half.
     *
     * Same origin and same package as the bundle, so there is no third party, no
     * CDN and no cross-origin request — and the host serves each one with
     * `no-cache` + ETag, so a skin is downloaded once and then revalidated with a
     * bodyless 304.
     *
     * `SKIN_IDS` is the client's copy of the host's ALLOW-LIST. It has to exist on
     * both sides because the client cannot import from the host, and
     * `scripts/build.mjs` compares the two (and the directory) so a skin added to
     * one side only fails the build instead of shipping a swatch that 404s.
     */
    const SKIN_IDS = Object.freeze([
      'deepsea',
      'sakura',
      'mint',
      'twilight',
      'caramel',
      'silver',
      'ink',
      'ember',
    ])
    const DEFAULT_SKIN = 'deepsea'

    /**
     * Where a skin lives. The id is appended to this prefix — and the id is only
     * ever a value that came out of `resolveSkin`, i.e. one of the eight strings
     * above, so no request or stored value can put anything else in the URL.
     */
    const SKIN_URL_PREFIX = '/dsh-pet-indesktop/assets/skins'

    /** The URL for a validated id. */
    function skinUrl(id) {
      return `${SKIN_URL_PREFIX}/${String(id)}.png`
    }

    /**
     * Fold anything into a known skin id — the ONE place an id is chosen.
     *
     * A stored `skin` can be anything: a hand-edited state.json, a payload from a
     * different version, a typo. Every path that renders a skin goes through this,
     * so the `<img>` can never point at a file that does not exist. Returns a
     * member of `SKIN_IDS`, always.
     *
     * The comparison is exact (`includes`), never a prefix or a pattern: the id is
     * a key into a fixed list, not a path fragment.
     */
    function resolveSkin(value) {
      return SKIN_IDS.includes(value) ? value : DEFAULT_SKIN
    }

    /**
     * The human labels for the swatches. The pet is 大肥鱼, and the copy says so:
     * the product is bilingual, and a colour name alone would not tell a Chinese
     * user which pet they are recolouring.
     */
    const SKIN_LABELS = Object.freeze({
      deepsea: { zh: '深海蓝', en: 'Deep Sea' },
      sakura: { zh: '樱花粉', en: 'Sakura' },
      mint: { zh: '薄荷绿', en: 'Mint' },
      twilight: { zh: '暮光紫', en: 'Twilight' },
      caramel: { zh: '焦糖金', en: 'Caramel' },
      silver: { zh: '雪白银', en: 'Silver' },
      ink: { zh: '墨黑', en: 'Ink' },
      ember: { zh: '余烬红', en: 'Ember' },
    })

    /** (PET_NAME / PET_NICK / the two call labels are declared with the copy table.) */

    /**
     * The drawn width, in CSS pixels, and the source's aspect ratio (420x409).
     *
     * A fixed width with `height:auto` is what keeps the picture undistorted when
     * the browser scales it for a high-DPI display.
     */
    const PET_WIDTH = 160
    const PET_ASPECT = 409 / 420

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
      pet: 'dpi-pet',
      img: 'dpi-img',
      toggle: 'dpi-toggle',
      toggleDot: 'dpi-toggle-dot',
      panel: 'dpi-panel',
      popover: 'dpi-popover',
      popoverTitle: 'dpi-popover-title',
      swatches: 'dpi-swatches',
      swatch: 'dpi-swatch',
      swatchOn: 'dpi-swatch-on',
      swatchDot: 'dpi-swatch-dot',
      actions: 'dpi-actions',
      action: 'dpi-action',
      lazy: 'dpi-lazy',
    }

    // ── the stylesheet ───────────────────────────────────────────────────────
    //
    // Note for editors: the sheet is a template literal, so a stray backtick
    // inside a CSS comment terminates it early and the resulting error points at
    // the wrong place. scripts/check-css-template.mjs exists to catch exactly
    // that, and is part of `npm run build`.

    const CSS = `
/* dsh-pet-indesktop — the pet layer. One bundled PNG, no external anything. */

/* The pet's own layer. 2147481000: above ordinary chrome, 2000 BELOW the
   full-frame overlay the sibling plugin draws at 2147483000, so an intro
   animation covers the pet rather than fighting it. See the file header. */
.dpi-root{position:fixed;inset:0;z-index:2147481000;pointer-events:none;
  display:block;overflow:hidden}

/* Only the pet's own box takes pointer events; the rest of the layer is
   transparent to them, so a pet sitting in the middle of the page never blocks
   the page. The gesture lives HERE, on the wrapper, and the image itself is
   pointer-events:none so the wrapper keeps it. */
.dpi-pet{position:absolute;width:160px;
  transform:translate(-50%,-100%);
  pointer-events:auto;cursor:grab;touch-action:none;
  user-select:none;-webkit-user-select:none;
  /* The idle drift moves this element with a transform over a few seconds, so it
     reads as swimming rather than teleporting. The stored position is untouched. */
  transition:transform 2600ms ease-in-out}
.dpi-pet.dpi-dragging{cursor:grabbing}

/* The picture. Draggable is off in the markup as well: a browser's native image
   drag would start its own ghost and fight the pointer gesture. */
.dpi-img{display:block;width:100%;height:auto;
  pointer-events:none;user-select:none;-webkit-user-select:none;
  -webkit-user-drag:none;
  filter:drop-shadow(0 6px 10px rgba(4,10,24,.45))}

/* Idle life: three transforms on two nested elements, so they cannot fight each
   other. The wrapper bobs and sways at 5.2s; the picture breathes at 3.2s. The
   two periods do not divide each other, which is what makes it read as alive
   instead of as a loop. */
.dpi-sway{transform-origin:50% 100%;animation:dpi-sway 5.2s ease-in-out infinite}
.dpi-bob{transform-origin:50% 100%;animation:dpi-bob 5.2s ease-in-out infinite}
.dpi-happy .dpi-bob{animation:dpi-hop 1.5s ease-in-out 1}
.dpi-happy .dpi-sway{animation-duration:1.5s}
.dpi-img{transform-origin:50% 100%;animation:dpi-breathe 3.2s ease-in-out infinite}

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

/* The panel lives in the sidebar footer, not in this layer. It is a positioned
   wrapper so the popover can hang above the button; the footer must not clip it,
   so the popover is placed with position:absolute and a high z-index of its own. */
.dpi-panel{position:relative;display:inline-block;font-family:inherit}

/* The eight swatches. Each dot is a flat colour that matches the skin it selects;
   the tint is applied to the artwork, not to this dot, so the dot is only a key. */
.dpi-popover{position:absolute;left:0;bottom:calc(100% + 8px);z-index:2;
  max-width:min(18rem,80vw);
  min-width:11rem;padding:9px 10px 10px;border-radius:12px;
  background:rgba(12,20,38,.97);border:1px solid rgba(148,163,184,.35);
  box-shadow:0 10px 28px rgba(0,0,0,.5);color:rgba(255,255,255,.92)}
.dpi-popover-title{font-size:11px;letter-spacing:.04em;opacity:.7;
  margin-bottom:8px;white-space:nowrap}
/* Eight swatches do not fit on one line in a narrow sidebar, so the row wraps.
   max-width is in swatch units (6 x 22px plus the gaps) so it stays readable
   rather than matching some arbitrary pixel width.
   NOTE for editors: no backticks inside this sheet — check-css-template.mjs
   exists to catch exactly that, and it just did. */
.dpi-swatches{display:flex;flex-wrap:wrap;gap:8px;align-items:center;max-width:174px}
.dpi-swatch{width:22px;height:22px;padding:0;border-radius:999px;cursor:pointer;
  display:inline-flex;align-items:center;justify-content:center;
  border:1px solid rgba(148,163,184,.45);background:rgba(148,163,184,.12)}
.dpi-swatch:hover{border-color:rgba(226,232,240,.8)}
.dpi-swatch-on{border-color:#38bdf8;box-shadow:0 0 0 2px rgba(56,189,248,.35)}
.dpi-swatch-dot{width:12px;height:12px;border-radius:999px;display:block}
.dpi-swatch-dot-deepsea{background:#3b82f6}
.dpi-swatch-dot-sakura{background:#f472b6}
.dpi-swatch-dot-mint{background:#34d399}
.dpi-swatch-dot-twilight{background:#a78bfa}
.dpi-swatch-dot-caramel{background:#f59e0b}
.dpi-swatch-dot-silver{background:#cbd5e1}
.dpi-swatch-dot-ink{background:#1e293b}
.dpi-swatch-dot-ember{background:#ef4444}

/* The two ways to address her. Text buttons, not icons: the copy IS the feature, so
   it has to be readable, and each carries a bilingual aria-label in the markup. */
.dpi-actions{display:flex;gap:6px;margin-top:9px}
.dpi-action{flex:1 1 0;font-family:inherit;font-size:11px;line-height:1.35;
  padding:4px 6px;border-radius:8px;cursor:pointer;white-space:nowrap;
  border:1px solid rgba(148,163,184,.45);
  background:rgba(148,163,184,.12);color:inherit}
.dpi-action:hover{background:rgba(148,163,184,.22)}

/* Lying down. Squash and tilt, and STOP the three loops while she is down: a
   sleeping pet that keeps bobbing is not lying down. No new asset is involved, so
   all eight skins keep working. */
.dpi-lazy .dpi-sway{animation:none;transform:rotate(-8deg) translateY(7px) scale(1.07,.8)}
.dpi-lazy .dpi-bob{animation:none;transform:none}
.dpi-lazy .dpi-img{animation:none;transform:none;
  filter:drop-shadow(0 3px 5px rgba(4,10,24,.38))}
.dpi-lazy .dpi-pet{cursor:default}

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
  0%{transform:scale(1,1)}
  50%{transform:scale(1.018,.985)}
  100%{transform:scale(1,1)}
}
@keyframes dpi-bob{
  0%{transform:translateY(0)}
  50%{transform:translateY(-5px)}
  100%{transform:translateY(0)}
}
@keyframes dpi-hop{
  0%{transform:translateY(0) scale(1,1)}
  35%{transform:translateY(-14px) scale(.98,1.04)}
  70%{transform:translateY(0) scale(1.03,.96)}
  100%{transform:translateY(0) scale(1,1)}
}
@keyframes dpi-sway{
  0%{transform:rotate(-2.5deg)}
  50%{transform:rotate(2.5deg)}
  100%{transform:rotate(-2.5deg)}
}
@keyframes dpi-pop{
  0%{opacity:0;transform:translateX(-50%) translateY(4px) scale(.94)}
  100%{opacity:1;transform:translateX(-50%) translateY(0) scale(1)}
}

/* Respect the OS setting. A cosmetic pet is exactly the kind of thing that must
   not ignore this, so the fallback is a STILL FRAME, not a slower animation:
   "reduced" means less movement, and a slower bob is still a bob. */
@media (prefers-reduced-motion:reduce){
  .dpi-sway,.dpi-bob,.dpi-img,.dpi-bubble{animation:none}
  .dpi-happy .dpi-bob,.dpi-happy .dpi-sway{animation:none}
  /* The lazy pose is a still frame, so its transform stays; what stops is every
     ANIMATION, including the three loops and the drift transition. */
  .dpi-lazy .dpi-sway,.dpi-lazy .dpi-bob,.dpi-lazy .dpi-img{animation:none}
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

    // ── the persona: the copy table, plus a pure mood machine ────────────────
    //
    // The character is a Q-version whale girl: she eats rice, she is clever and
    // lazy, she is a tsundere who deflects and then softens, she refuses to be
    // called fat, and she answers to 鲸鲸.
    //
    // NONE of that lives in the JSX. It lives here: one table of bilingual copy
    // (the lines are the deliverable, so they are carried verbatim) and one pure
    // transition function. The renderer only asks "what mood, which pool" and
    // renders. That is what lets scripts/verify-pet.mjs walk the whole matrix with
    // numbers and never open a browser.
    //
    // Her display name is still 大肥鱼 / "Big Fat Fish" - that is the pet in the UI
    // and in the repository. Her REACTION to it being used as a fat joke is the
    // point, not the name itself.
    // 大肥鱼 · 台词表（数据，不是 JSX）
    // 每条是 { zh, en }；选取由纯函数完成，测试穷举，不靠渲染反推。
    const PERSONA_LINES = {
      greet: [
        { zh: '……来了啊。米饭呢？', en: '...You are here. Where is the rice?' },
        { zh: '先说明，我不是来干活的。', en: 'For the record, I am not here to work.' },
        { zh: '尾巴甩一下，算打过招呼了。', en: 'One tail flick. Consider yourself greeted.' },
      ],

      click: [
        { zh: '戳什么戳。', en: 'Stop poking.' },
        { zh: '……还有事？', en: '...Something you need?' },
        { zh: '米饭，去拿。', en: 'Rice. Go get it.' },
        { zh: '嗯，准你再看一会儿。', en: 'Fine. You may look a little longer.' },
      ],

      // 被叫「大肥鱼」：明确的否认 + 尾鳍警告
      'call-fat': [
        { zh: '谁肥了？这叫浮力。', en: 'Who is fat? This is buoyancy.' },
        { zh: '鲸鱼不叫胖，叫圆润。再说一次试试。', en: 'A whale is not fat, a whale is rounded. Say it again. Try me.' },
        { zh: '尾鳍警告。', en: 'Tail-fin warning.' },
        { zh: '哼。米饭扣你一半。', en: 'Hmph. Half your rice is forfeit.' },
      ],

      // 被叫「鲸鲸」：嘴上敷衍，尾巴很诚实
      'call-nick': [
        { zh: '……嗯。这个可以叫。', en: '...Mm. That one is allowed.' },
        { zh: '再叫一次。', en: 'Say it again.' },
        { zh: '米饭上要加一个蛋。', en: 'This earns an egg on the rice.' },
        { zh: '（尾鳍轻轻拍了两下）', en: '(Two soft tail-flicks.)' },
      ],

      'lazy-start': [
        { zh: '今天不干了。躺平。', en: 'Done for today. Going flat.' },
        { zh: '别戳，进入省电模式。', en: 'Do not poke. Low-power mode.' },
        { zh: '我已经是一条咸鱼……咸鲸。', en: 'I am now a salted fish... salted whale.' },
      ],

      // 躺平期间被点：只准嘀咕，不准弹气泡
      'lazy-click': [
        { zh: '……（装睡）', en: '...(pretending to sleep)' },
        { zh: 'zzZ', en: 'zzZ' },
      ],

      'lazy-end': [
        { zh: '……睡够了。有米饭吗？', en: '...Slept enough. Is there rice?' },
        { zh: '嗯，活过来了。', en: 'Mm. Back among the living.' },
      ],

      // 十分钟没人理，游去角落（只改视觉，不改存储坐标）
      'idle-drift': [
        { zh: '没人理我，去角落待着。', en: 'Nobody is around. Corner it is.' },
        { zh: '角落大概有大米的味道。', en: 'I am fairly sure a corner smells like rice.' },
      ],

      'skin-switch': [
        { zh: '换件衣服而已，别大惊小怪。', en: 'Just changing clothes. Do not make a thing of it.' },
        { zh: '这个颜色……还行吧。', en: 'This colour... it is fine, I suppose.' },
      ],

    'greet-cold': [      // 今天被叫「大肥鱼」≥3 次
      { zh: '……又是你。今天不谈肥不肥。', en: '...You again. We are not discussing fat today.' },
      { zh: '哼。我记着呢。', en: 'Hmph. I am keeping count.' },
      { zh: '米饭在锅里，你自己盛。', en: 'The rice is in the pot. Serve yourself.' },
    ],
    'greet-warm': [      // 今天被叫「鲸鲸」≥3 次
      { zh: '……来了。今天准你叫我一声。', en: '...You are here. You may call me it once today.' },
      { zh: '嗯。米饭多煮了半杯。', en: 'Mm. I cooked half a cup extra.' },
      { zh: '别误会，锅本来就要洗。', en: 'Do not misunderstand. The pot needed washing anyway.' },
    ],
    'reunited': [        // 离开很久（>30 分钟）之后再来
      { zh: '才不是等你。只是水凉了。', en: 'I was not waiting for you. The water just went cold.' },
      { zh: '……你走挺久的。', en: '...You were gone a while.' },
      { zh: '尾鳍刚才在打拍子，听见没有。', en: 'My tail was keeping time. Did you hear it?' },
    ],
    'shy': [             // 头几次见面（怕生）
      { zh: '……（躲在杯子后面）', en: '...(hiding behind the cup)' },
      { zh: '……新来的？', en: '...New here?' },
      { zh: '别靠太近。', en: 'Do not come too close.' },
    ],
    }

    const PET_NAME    = { zh: '大肥鱼', en: 'Big Fat Fish' }
    const PET_NICK    = { zh: '鲸鲸',   en: 'Jingjing' }
    const CALL_FAT    = { zh: '叫它 大肥鱼', en: 'Call it 大肥鱼' }
    const CALL_NICK   = { zh: '叫它 鲸鲸',   en: 'Call it 鲸鲸' }

    /**
     * The greeting knobs. Injected like the mood config, so the verifier never
     * depends on wall-clock constants.
     */
    const GREETING_CONFIG = Object.freeze({
      /** This many fat-calls today and she greets you cold. */
      coldAfter: 3,
      /** This many nickname-calls today and she greets you warm. */
      warmAfter: 3,
      /** Absence longer than this greets you as reunited. 30 minutes. */
      reuniteMs: 30 * 60 * 1000,
      /** Fewer interactions than this, ever, and she is shy. */
      shyUntil: 3,
      /** The idle drift lives in PERSONA_CONFIG; repeated here only for clarity. */
    })

    /** Fold any greeting config argument into a complete, usable one. Never throws. */
    function greetingConfig(overrides) {
      const source = overrides === null || typeof overrides !== "object" ? {} : overrides
      const number = (key, minimum) => {
        const value = source[key]
        if (typeof value !== "number" || !Number.isFinite(value)) return GREETING_CONFIG[key]
        return Math.max(minimum, value)
      }
      return {
        coldAfter: Math.max(1, Math.round(number("coldAfter", 1))),
        warmAfter: Math.max(1, Math.round(number("warmAfter", 1))),
        reuniteMs: number("reuniteMs", 0),
        shyUntil: Math.max(0, Math.round(number("shyUntil", 0))),
      }
    }

    /**
     * Today, as YYYY-MM-DD, in LOCAL time.
     *
     * Local, not UTC, because "today" is what a person means by today: three
     * fat-calls at 11pm and one at 1am are two different days to the user, and the
     * counters exist to be felt, not to be audited. The host computes the same
     * stamp the same way, and the verifier builds its timestamps with the local
     * Date constructor, so nothing in the matrix depends on the machine timezone.
     */
    function dayStamp(now) {
      const date = new Date(clockOf(now))
      const month = String(date.getMonth() + 1).padStart(2, "0")
      const day = String(date.getDate()).padStart(2, "0")
      return date.getFullYear() + "-" + month + "-" + day
    }

    /** Which persona bucket a greeting name maps to. */
    const GREETING_BUCKETS = Object.freeze({
      cold: "greet-cold",
      warm: "greet-warm",
      reunited: "reunited",
      shy: "shy",
      normal: "greet",
    })

    /**
     * How she greets you: the ONE entry function.
     *
     * Inputs are the persisted counters, the clock and the config; the output is the
     * greeting NAME (cold / warm / reunited / shy / normal), the bucket to speak from,
     * and the counters as they stand after any day rollover. Pure: same inputs, same
     * answer, no mutation of the argument.
     *
     * Priority, which is the whole point:
     *
     *   1. DAY ROLLOVER first. If countersDay is not today, both counters are zeroed
     *      and the new day is stamped. The reset is visible in the returned
     *      counters, so a caller cannot forget to persist it.
     *   2. cold  - fatCalls >= coldAfter. Being called fat sticks in her memory.
     *   3. warm  - nickCalls >= warmAfter. Favours stick too; cold outranks warm, so a
     *      day that earned both is a COLD day. Grudges are older than affection.
     *   4. reunited - she has seen you before and it has been longer than reuniteMs.
     *      lastSeenAt of 0 means "never seen you", which must NOT read as a long
     *      absence: greeting a first-time visitor with "I was not waiting for you"
     *      would be nonsense, so a zero is skipped and shy takes over.
     *   5. shy   - fewer than shyUntil interactions ever.
     *   6. normal - the plain greet bucket.
     *
     * Boundaries are half-open where the rule uses ">=", and strict where it uses
     * ">": exactly reuniteMs of absence is NOT reunited, one millisecond more is.
     */
    function nextGreeting(state, now, config) {
      const source = state === null || typeof state !== "object" ? {} : state
      const cfg = greetingConfig(config)
      const at = clockOf(now)
      const day = dayStamp(at)

      const storedDay = typeof source.countersDay === "string" ? source.countersDay : ""
      const rolledOver = storedDay !== day
      const fatCalls = rolledOver ? 0 : Math.max(0, Math.trunc(finite(source.fatCalls, 0)))
      const nickCalls = rolledOver ? 0 : Math.max(0, Math.trunc(finite(source.nickCalls, 0)))
      const totalInteractions = Math.max(0, Math.trunc(finite(source.totalInteractions, 0)))
      const lastSeenAt = Math.max(0, finite(source.lastSeenAt, 0))

      const counters = { fatCalls, nickCalls, countersDay: day, totalInteractions, lastSeenAt }

      const decide = (greeting, reason) => ({
        greeting,
        bucket: GREETING_BUCKETS[greeting],
        reason,
        counters,
        rolledOver,
        at,
        day,
      })

      if (fatCalls >= cfg.coldAfter) return decide("cold", "fat-calls")
      if (nickCalls >= cfg.warmAfter) return decide("warm", "nick-calls")
      if (lastSeenAt > 0 && at - lastSeenAt > cfg.reuniteMs) return decide("reunited", "absence")
      if (totalInteractions < cfg.shyUntil) return decide("shy", "new")
      return decide("normal", "regular")
    }

    /** The bucket a greeting name speaks from. Total, and null-safe. */
    function greetingBucket(name) {
      return Object.prototype.hasOwnProperty.call(GREETING_BUCKETS, name) ? GREETING_BUCKETS[name] : GREETING_BUCKETS.normal
    }

    /** The counters a fresh client starts from, before the host answers. */
    const DEFAULT_COUNTERS = Object.freeze({
      fatCalls: 0,
      nickCalls: 0,
      countersDay: "",
      lastSeenAt: 0,
      totalInteractions: 0,
    })

    /** The closed set of moods. A test can exhaust these. */
    const MOODS = Object.freeze(['idle', 'happy', 'annoyed', 'lazy'])

    /** The closed set of events the machine accepts. Anything else is ignored. */
    const MOOD_EVENTS = Object.freeze(['call-fat', 'call-nick', 'click', 'idle-for-a-while', 'lazy-ends'])

    /**
     * The timing knobs, all in one injectable object.
     *
     * Separated from the machine on purpose: the verifier passes its own values, so
     * the matrix never depends on wall-clock constants. These defaults are what the
     * plugin ships.
     */
    const PERSONA_CONFIG = Object.freeze({
      /** How many clicks inside the window before she lies down. */
      lazyAfterClicks: 4,
      /** The window a click still counts inside. Inclusive at the boundary. */
      clickWindowMs: 2600,
      /** How long she refuses to react. */
      lazyMs: 6000,
      /** How long happy and annoyed last before the tick returns to idle. */
      happyMs: 1800,
      annoyedMs: 2200,
      /** Quiet time before she drifts to a corner. Visual only. */
      idleDriftMs: 600000,
    })

    /** Fold any config argument into a complete, usable one. Never throws. */
    function personaConfig(overrides) {
      const source = overrides === null || typeof overrides !== "object" ? {} : overrides
      const number = (key, minimum) => {
        const value = source[key]
        if (typeof value !== "number" || !Number.isFinite(value)) return PERSONA_CONFIG[key]
        return Math.max(minimum, value)
      }
      return {
        lazyAfterClicks: Math.max(1, Math.round(number("lazyAfterClicks", 1))),
        clickWindowMs: number("clickWindowMs", 0),
        lazyMs: number("lazyMs", 0),
        happyMs: number("happyMs", 0),
        annoyedMs: number("annoyedMs", 0),
        idleDriftMs: number("idleDriftMs", 0),
      }
    }

    /** The mood a state should be showing at `now`, honouring lazy expiry. */
    function currentMood(state, now, config) {
      const source = state === null || typeof state !== "object" ? {} : state
      const cfg = personaConfig(config)
      const at = clockOf(now)
      if (cfg.lazyMs === 0) return "idle"
      const until = finite(source.lazyUntil, null)
      if (until !== null && at < until) return "lazy"
      const mood = MOODS.includes(source.mood) ? source.mood : "idle"
      return mood === "lazy" ? "idle" : mood
    }

    /**
     * The transition function: the whole personality, as arithmetic.
     *
     * Inputs are the current state, the event, the clock and the config; the output is
     * the next state plus the POOL KEY of the line she should say (or null for
     * silence) and a `speak` flag. Same inputs always give the same answer, which is
     * what makes the matrix testable.
     *
     * Rules, in the order they apply:
     *
     *   1. LAZY ABSORBS EVERYTHING. While she is lying down, every event except the
     *      clock running out is absorbed - including the call buttons and clicks. A
     *      click during lazy reports the "lazy-click" mumble with speak:false, so the
     *      renderer must NOT open a bubble for it.
     *   2. The clock is an input too: once lazyMs has passed the next call ends the
     *      nap. The boundary is half-open - at exactly lazyUntil she is still down,
     *      one millisecond later she is not.
     *   3. call-fat -> annoyed (she is NOT fat), call-nick -> happy (鲸鲸 is the right
     *      name). These are the two addressable reactions.
     *   4. N clicks inside the window -> lazy, with lazy-start. The count includes the
     *      click that trips it, and the window is inclusive at its boundary.
     *   5. Anything unrecognised changes nothing and reports no line: an unknown event
     *      is ignored, never an error.
     */
    function nextMood(state, event, now, config) {
      const source = state === null || typeof state !== "object" ? {} : state
      const cfg = personaConfig(config)
      const at = clockOf(now)
      const name = typeof event === "string" ? event : ""

      const mood = MOODS.includes(source.mood) ? source.mood : "idle"
      const since = finite(source.since, at)
      const until = finite(source.lazyUntil, null)
      const clicks = Array.isArray(source.clicks)
        ? source.clicks.filter((t) => Number.isFinite(t) && t <= at)
        : []
      const recent = clicks.filter((t) => at - t <= cfg.clickWindowMs)

      /** Build the result. `line` is a PERSONA_LINES key, or null for silence. */
      const result = (next, nextSince, nextClicks, nextUntil, line, speak) => ({
        mood: next,
        since: nextSince,
        clicks: nextClicks,
        lazyUntil: nextUntil,
        line,
        speak: speak === true,
        event: name,
        at,
      })

      const lying = until !== null && at < until
      if (lying) {
        if (name === "lazy-ends") return result("idle", at, [], null, "lazy-end", true)
        // Absorbed. The mumble is available as data, but it is not a bubble.
        const mumble = name === "click" || name === "call-fat" || name === "call-nick" ? "lazy-click" : null
        return result("lazy", since, recent, until, mumble, false)
      }

      const justWoke = until !== null && at >= until
      if (name === "lazy-ends") return result("idle", at, [], null, justWoke ? "lazy-end" : null, justWoke)

      if (name === "call-fat") return result("annoyed", at, recent, null, "call-fat", true)
      if (name === "call-nick") return result("happy", at, recent, null, "call-nick", true)

      if (name === "click") {
        const nextClicks = [...recent, at]
        if (nextClicks.length >= cfg.lazyAfterClicks) {
          return result("lazy", at, nextClicks, at + cfg.lazyMs, "lazy-start", true)
        }
        return result("happy", at, nextClicks, null, "click", true)
      }

      // The idle tick. The DRIFT line is not spoken here: the drift itself decides
      // when it starts, once per drift, so a 250 ms tick cannot repeat it.
      if (name === "idle-for-a-while") return result("idle", at, recent, null, null, false)

      // Unknown event: unchanged, silent. Not an error - decoration must not throw.
      return result(mood, since, recent, until, null, false)
    }

    /**
     * Pick a line out of one pool: deterministic, and it avoids repeating the last
     * one when the pool has more than one entry. `seed` folds into range like
     * `pickLine` does, so a clock or a counter works as a seed.
     */
    function personaPick(key, seed, lastIndex) {
      const pool = PERSONA_LINES[key]
      if (!Array.isArray(pool) || pool.length === 0) return null
      const size = pool.length
      const at = Math.abs(Math.trunc(finite(seed, 0)))
      let index = at % size
      if (size > 1 && index === lastIndex) index = (index + 1) % size
      return { index, line: pool[index], key }
    }

    /** Which pool a skin change speaks from. Named so the UI does not carry a string. */
    const SKIN_SWITCH_LINE = "skin-switch"

    /** The pool spoken once, when she first appears. */
    const GREET_LINE = "greet"

    /**
     * Where she drifts when nobody has touched her for a while.
     *
     * VISUAL ONLY. The result carries persist:false and this function never mutates
     * its input, because a drift that wrote into the stored x/y would silently
     * overwrite the spot the user chose - the one thing a "remember where I left it"
     * pet must never do.
     *
     * `announced` is how the drift line fires ONCE per drift rather than on every
     * tick: `started` is true only on the first call after the idle threshold, and
     * the caller flips `announced` when it speaks.
     */
    function idleDrift(state, now, config) {
      const source = state === null || typeof state !== "object" ? {} : state
      const cfg = personaConfig(config)
      const at = clockOf(now)
      const position = clampPosition(source.position ?? source)
      const last = finite(source.lastInteraction, at)
      const quiet = {
        drifting: false,
        started: false,
        persist: false,
        from: position,
        target: position,
        idleFor: Math.max(0, at - last),
        reason: "recent",
      }
      // Reduced motion means no drift at all: the drift is movement.
      if (wantsReducedMotion(source)) return Object.assign({}, quiet, { reason: "reduced-motion" })
      if (cfg.idleDriftMs === 0) return quiet
      // Inclusive at the threshold: exactly idleDriftMs of quiet is enough.
      if (at - last < cfg.idleDriftMs) return quiet
      const middle = (MIN_POS + MAX_POS) / 2
      return {
        drifting: true,
        started: source.announced !== true,
        persist: false,
        from: position,
        target: {
          x: position.x < middle ? MIN_POS : MAX_POS,
          y: position.y < middle ? MIN_POS : MAX_POS,
        },
        idleFor: Math.max(0, at - last),
        reason: "idle",
      }
    }

    /** What a mood looks like, as flags the renderer and the tests can read. */
    function moodPose(mood) {
      const name = MOODS.includes(mood) ? mood : "idle"
      return { mood: name, lying: name === "lazy", silent: name === "lazy" }
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
     * The picture.
     *
     * A plain `<img>` served by this plugin's own host half. `draggable={false}`
     * because a browser's native image drag would start its own ghost and fight
     * the pointer gesture on the wrapper; `pointer-events:none` comes from the
     * sheet for the same reason, so the wrapper keeps the gesture no matter where
     * on the picture the pointer lands.
     *
     * `alt=""` is deliberate: the wrapper is the accessible control (it has
     * role="button" and a label), and a nested accessible name would be read out
     * twice.
     */
    function PetImage(props) {
      // NOTE: no React key on the img. Swapping src keeps this element — and
      // therefore the wrappers' CSS animations — alive, so a skin switch is a
      // picture change, not a remount. A remount would restart bob/sway/breath from
      // 0% and the pet would visibly jump.
      return React.createElement('img', {
        className: CLASS.img,
        src: skinUrl(resolveSkin(props.skin)),
        alt: '',
        width: String(PET_WIDTH),
        height: String(Math.round(PET_WIDTH * PET_ASPECT)),
        draggable: false,
        decoding: 'async',
        loading: 'eager',
      })
    }

    /** The pet layer: drag it, click it, or hide with the button. */
    function Pet(props) {
      const state = props.state
      const position = props.position
      const persona = props.persona
      const now = useClock(state.visible)
      const drag = React.useRef(null)
      const [dragging, setDragging] = React.useState(false)

      const mood = currentMood(persona, now)
      const layered = moodPose(mood)

      const pose = nextPose(
        {
          ...state,
          mode: mood === 'happy' ? 'happy' : 'idle',
          since: persona.since,
          reducedMotion: props.reducedMotion,
        },
        'tick',
        now,
      )
      // Still computed and still cheap: the pose decides the class names
      // (`dpi-happy`, `dpi-blinking`) and, through `pose.still`, whether the
      // sheet's animations run at all. The MOVE is CSS; the DECISION is here.
      const stance = stanceAt({ position, reducedMotion: props.reducedMotion }, now)

      /**
       * Where she drifts when nobody has touched her. Pure, and visual only: the
       * result is a transform on this element, never a write to the stored x/y.
       */
      const drift = idleDrift(
        {
          position,
          lastInteraction: props.lastTouch,
          announced: persona.driftAnnounced === true,
          reducedMotion: props.reducedMotion,
        },
        now,
      )

      // The drift line is spoken ONCE per drift: the transition is reported by the
      // pure function as `started`, and the store flips its flag when it speaks.
      React.useEffect(() => {
        if (drift.started && drift.drifting) props.onDriftStart()
      }, [drift.started, drift.drifting])

      /**
       * The bubble comes from the persona table, not from local state.
       *
       * It is shown only when the transition said to SPEAK (so the lazy mumble never
       * becomes a bubble), only while the mood is not lazy, and only for BUBBLE_MS
       * after the event.
       */
      const sinceSpoke = now - finite(persona.speakAt, -BUBBLE_MS * 2)
      const speaking =
        persona.speak === true && persona.line !== null && layered.silent !== true && sinceSpoke >= 0 && sinceSpoke < BUBBLE_MS
      const picked = speaking ? personaPick(persona.line, persona.speakAt, persona.lastIndex) : null

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
        // The STORE decides what a click means: a line, a lazy-start, or nothing at
        // all because she is lying down. The renderer never decides tone.
        props.onEvent('click')
      }

      const onKeyDown = (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        props.onEvent('click')
      }

      const petStyle = {
        left: `${String(position.x)}%`,
        top: `${String(position.y)}%`,
      }
      // The drift is a TRANSFORM, and only a transform. The stored position stays
      // exactly where the user put her; this only moves the picture, smoothly.
      if (drift.drifting) {
        const view = viewport()
        const dx = Math.round(((drift.target.x - drift.from.x) / 100) * view.width)
        const dy = Math.round(((drift.target.y - drift.from.y) / 100) * view.height)
        petStyle.transform = 'translate(-50%,-100%) translate(' + String(dx) + 'px,' + String(dy) + 'px)'
      }
      const line = picked === null ? null : picked.line

      return React.createElement(
        'div',
        { className: `${CLASS.root}${dragging ? ' dpi-dragging' : ''}` },
        React.createElement(
          'div',
          {
            className:
              `${CLASS.pet}${pose.mode === 'happy' ? ' dpi-happy' : ''}${pose.blinking ? ' dpi-blinking' : ''}` +
              (layered.lying ? ' ' + CLASS.lazy : ''),
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
          // Two nested divs so the sway and the bob are separate transforms: one
          // element cannot carry two animations that both set `transform`.
          React.createElement(
            'div',
            { className: 'dpi-sway' },
            React.createElement('div', { className: 'dpi-bob' }, React.createElement(PetImage, { skin: state.skin })),
          ),
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
     * The sidebar control: a small popover, not a bare button.
     *
     * It is separate from the pet on purpose: if the only way to show the pet were
     * the pet itself, hiding it would be a one-way door. It now carries three jobs —
     * show/hide, choose a skin, and name the pet — so it opens a panel instead of
     * toggling on click.
     *
     * The panel is a role="group" with a label, not a dialog: it traps nothing and
     * Escape closes it. Every swatch is a <button> with aria-pressed and a bilingual
     * label, so it is reachable by keyboard and announced correctly rather than
     * being an unnamed coloured dot.
     */
    function PetPanel(props) {
      const on = props.state.visible
      const skin = resolveSkin(props.state.skin)
      const labelOf = (id) => {
        const entry = SKIN_LABELS[id]
        return entry.zh + " / " + entry.en
      }
      return React.createElement(
        'div',
        { className: CLASS.panel },
        React.createElement(
          'button',
          {
            type: 'button',
            className: CLASS.toggle,
            'data-on': on ? 'true' : 'false',
            'aria-pressed': on ? 'true' : 'false',
            'aria-expanded': props.open ? 'true' : 'false',
            title: on ? '隐藏大肥鱼 / Hide Big Fat Fish' : '显示大肥鱼 / Show Big Fat Fish',
            onClick: props.onToggleOpen,
          },
          React.createElement('span', { className: CLASS.toggleDot }),
          React.createElement('span', null, PET_NAME.zh + ' ' + (on ? '开' : '关')),
        ),
        props.open
          ? React.createElement(
              'div',
              { className: CLASS.popover, role: 'group', 'aria-label': PET_NAME.zh + ' / ' + PET_NAME.en },
              React.createElement('div', { className: CLASS.popoverTitle }, PET_NAME.zh + ' · ' + PET_NAME.en),
              React.createElement(
                'div',
                { className: CLASS.swatches },
                SKIN_IDS.map((id) =>
                  React.createElement(
                    'button',
                    {
                      key: id,
                      type: 'button',
                      className: CLASS.swatch + (id === skin ? ' ' + CLASS.swatchOn : ''),
                      'data-skin': id,
                      'aria-pressed': id === skin ? 'true' : 'false',
                      'aria-label': labelOf(id),
                      title: labelOf(id),
                      onClick: () => props.onPickSkin(id),
                    },
                    React.createElement('span', { className: CLASS.swatchDot + ' ' + CLASS.swatchDot + '-' + id }),
                  ),
                ),
              ),
              // The two ways a user can ADDRESS her. This is the only route to the
              // tsundere refusal, so it is a first-class button, not an easter egg.
              React.createElement(
                'div',
                { className: CLASS.actions },
                React.createElement(
                  'button',
                  {
                    type: 'button',
                    className: CLASS.action,
                    'data-call': 'fat',
                    'aria-label': CALL_FAT.zh + ' / ' + CALL_FAT.en,
                    title: CALL_FAT.zh + ' / ' + CALL_FAT.en,
                    onClick: props.onCallFat,
                  },
                  CALL_FAT.zh,
                ),
                React.createElement(
                  'button',
                  {
                    type: 'button',
                    className: CLASS.action,
                    'data-call': 'nick',
                    'aria-label': CALL_NICK.zh + ' / ' + CALL_NICK.en,
                    title: CALL_NICK.zh + ' / ' + CALL_NICK.en,
                    onClick: props.onCallNick,
                  },
                  CALL_NICK.zh,
                ),
              ),
            )
          : null,
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
            // Any drag cancels the drift, even one that ends where it started.
            mounted.touch()
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
              /**
               * The greeting is decided HERE, once, from whatever the host answered —
               * including "nothing" when the state file does not exist yet or the
               * request failed. That is why it is not fired at mount: cold / warm /
               * reunited all need the counters, and a greeting that ignored them
               * would be a lie about her memory.
               */
              const restored = saved === null || typeof saved !== 'object' ? {} : saved
              mounted.greet({
                fatCalls: restored.fatCalls,
                nickCalls: restored.nickCalls,
                countersDay: restored.countersDay,
                lastSeenAt: restored.lastSeenAt,
                totalInteractions: restored.totalInteractions,
              })
              if (saved === null) return
              const next = { ...store.current, ...sanitizeRemote(saved) }
              store.current = next
              mounted.setPosition(clampPosition(next))
              mounted.setVisible(next.visible)
              // The saved look, folded through the resolver: an unknown id in the
              // file falls back to the default instead of pointing the <img> at a
              // file that does not exist.
              mounted.setSkin(next.skin)
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
    const DEFAULT_STATE_LIKE = Object.freeze({
      version: 1,
      visible: true,
      x: 92,
      y: 88,
      skin: DEFAULT_SKIN,
      ...DEFAULT_COUNTERS,
    })

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
      // The host validates the skin on the way in, but a state file can be edited
      // by hand and an older payload may not carry the field at all — so the skin
      // is folded through the resolver here too, never trusted as a path.
      out.skin = resolveSkin(source.skin)
      /**
       * The counters ride along in the restored state so the seats can render them
       * and so a later save does not omit them. They are sanitised the same way the
       * host does: non-negative integers, and a day stamp only if it looks like one.
       */
      for (const key of ['fatCalls', 'nickCalls', 'totalInteractions']) {
        const value = source[key]
        out[key] = typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0
      }
      out.lastSeenAt = typeof source.lastSeenAt === 'number' && Number.isFinite(source.lastSeenAt) && source.lastSeenAt >= 0 ? Math.trunc(source.lastSeenAt) : 0
      out.countersDay = typeof source.countersDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(source.countersDay) ? source.countersDay : ''
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
      let skin = resolveSkin(store.current.skin)
      const subscribers = new Set()

      /**
       * The persona state. It starts by greeting: she is new here, and a pet that
       * appears in silence is a bug rather than a character.
       *
       * `lastIndex` remembers the last line used in the current pool so the picker
       * does not repeat it. `driftAnnounced` makes the drift line fire once per
       * drift, not once per tick.
       */
      let persona = {
        mood: 'idle',
        since: Date.now(),
        clicks: [],
        lazyUntil: null,
        // No bubble on mount any more: the greeting is decided by nextGreeting once
        // the host's counters have arrived, so it can be cold / warm / reunited /
        // shy rather than an unconditional hello.
        line: null,
        speak: false,
        speakAt: 0,
        lastIndex: -1,
        driftAnnounced: false,
      }

      /**
       * The persisted persona counters. They arrive from the host, they are updated
       * by the three events, and they are written back through the same debounced
       * save the position uses.
       */
      let counters = { ...DEFAULT_COUNTERS }

      /**
       * Whether this SESSION has already greeted. The whole once-per-entry guarantee
       * is this flag: `greet` is a no-op after the first call, so a re-render (or a
       * second mount of the seat) cannot produce a second greeting.
       */
      let greeted = false
      /** When anything last happened. Drives the idle drift. */
      let lastTouch = Date.now()

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

      const snapshot = () => ({ position, visible, skin, persona, lastTouch, counters })
      const getVisible = () => visible
      const getPosition = () => position
      const getSkin = () => skin
      const getPersona = () => persona

      /** Anything the user did cancels the drift and resets its announcement. */
      const touch = () => {
        lastTouch = Date.now()
        if (persona.driftAnnounced) persona = { ...persona, driftAnnounced: false }
      }

      /**
       * Run one event through the pure transition function and adopt the result.
       *
       * The reducer lives in `nextMood`; this only does the bookkeeping the DOM
       * needs (which line index was used, when it was said). No tone is decided here.
       */
      /**
       * Adopt a counters patch, and persist it.
       *
       * The three counted events are the three ways the user can affect her mood
       * durably: being called fat, being called by her nickname, and merely being
       * interacted with (which decides whether she is still shy).
       */
      const countEvent = (patchCounters) => {
        counters = { ...counters, ...patchCounters }
        client.save({ ...patchCounters })
      }

      const dispatch = (event) => {
        const at = Date.now()
        // Only count events that the mood machine actually acted on: a click while
        // she is lying down is absorbed, and counting it would let a user grind
        // totalInteractions without her ever reacting.
        const moodBefore = currentMood(persona, at, PERSONA_CONFIG)
        if (event === 'call-fat' && moodBefore !== 'lazy') countEvent({ fatCalls: counters.fatCalls + 1 })
        if (event === 'call-nick' && moodBefore !== 'lazy') countEvent({ nickCalls: counters.nickCalls + 1 })
        if (event === 'click' && moodBefore !== 'lazy') countEvent({ totalInteractions: counters.totalInteractions + 1 })
        const next = nextMood(persona, event, at, PERSONA_CONFIG)
        const picked = next.speak && next.line !== null ? personaPick(next.line, at, persona.lastIndex) : null
        persona = {
          mood: next.mood,
          since: next.since,
          clicks: next.clicks,
          lazyUntil: next.lazyUntil,
          line: next.line,
          speak: next.speak,
          speakAt: picked === null ? persona.speakAt : at,
          lastIndex: picked === null ? persona.lastIndex : picked.index,
          driftAnnounced: persona.driftAnnounced,
        }
        touch()
        emit()
      }

      /**
       * Say something from a named pool without changing the mood - used by the
       * drift (once, when it starts) and by a skin switch.
       */
      const speak = (key) => {
        const at = Date.now()
        const picked = personaPick(key, at, persona.lastIndex)
        if (picked === null) return
        persona = {
          ...persona,
          line: key,
          speak: true,
          speakAt: at,
          lastIndex: picked.index,
        }
        emit()
      }

      /**
       * The entry greeting: ONCE per session.
       *
       * Returns the greeting name it used, or null when it declined because this
       * session has already greeted. `nextGreeting` decides WHICH greeting; this only
       * guarantees it happens once and that the day rollover it reports is adopted.
       */
      const greet = (from) => {
        if (greeted) return null
        greeted = true
        const at = Date.now()
        const entry = nextGreeting(from === undefined ? counters : from, at, GREETING_CONFIG)
        counters = { ...entry.counters, lastSeenAt: at }
        // Persist immediately: these counters are how the NEXT session knows what
        // kind of day today was, and when you were last here.
        client.save({ ...counters })
        speak(entry.bucket)
        emit()
        return entry.greeting
      }

      /** The counters as they stand, for the seats and for the verifier. */
      const getCounters = () => counters
      const driftStart = () => {
        if (persona.driftAnnounced) return
        persona = { ...persona, driftAnnounced: true }
        speak('idle-drift')
        emit()
      }

      const setPosition = (next) => {
        position = clampPosition(next)
        emit()
      }
      const setVisible = (next) => {
        visible = next === true
        emit()
      }
      /**
       * Change the look. The image's src is the only thing that changes: the pet
       * component stays mounted and the wrappers keep their animations, so the bob
       * does not restart. `resolveSkin` guarantees a known id, so this can never
       * point the <img> at a file the host does not serve.
       */
      const setSkin = (next) => {
        skin = resolveSkin(next)
        emit()
      }

      const useSnapshot = () => React.useSyncExternalStore(subscribe, snapshot, snapshot)

      const PetSeat = () => {
        const snapshotValue = useSnapshot()
        if (snapshotValue.visible !== true) return null
        return React.createElement(Pet, {
          state: {
            ...store.current,
            visible: true,
            // The store's skin, not the raw stored value: a hand-edited state.json
            // must render the default look, never a broken <img>.
            skin: snapshotValue.skin,
          },
          position: snapshotValue.position,
          persona: snapshotValue.persona,
          lastTouch: snapshotValue.lastTouch,
          reducedMotion: prefersReducedMotion(),
          onMove: moveTo,
          onEvent: dispatch,
          onDriftStart: driftStart,
        })
      }

      /**
       * The sidebar seat: the panel, its open/closed state, and the two actions.
       *
       * `open` lives here rather than in the store: whether a popover happens to be
       * expanded is not part of the pet's persisted state, and restoring it across a
       * reload would be surprising.
       */
      const PanelSeat = () => {
        const snapshotValue = useSnapshot()
        const openState = React.useState(false)
        const open = openState[0]
        const setOpen = openState[1]

        React.useEffect(() => {
          if (!open) return undefined
          const onKey = (event) => {
            if (event.key === 'Escape') setOpen(false)
          }
          try {
            document.addEventListener('keydown', onKey)
          } catch {
            /* no document (tests) */
          }
          return () => {
            try {
              document.removeEventListener('keydown', onKey)
            } catch {
              /* nothing to remove */
            }
          }
        }, [open])

        return React.createElement(PetPanel, {
          state: { visible: snapshotValue.visible, skin: snapshotValue.skin },
          open,
          onToggleOpen: () => {
            touch()
            setOpen(!open)
          },
          onPickSkin: (id) => {
            const next = resolveSkin(id)
            store.current = { ...store.current, skin: next }
            setSkin(next)
            // Persisted immediately (not debounced): a skin is one click, and the
            // user expects it to still be there after a reload.
            client.save({ skin: next })
            // She has something to say about being redressed — the same bubble.
            touch()
            speak(SKIN_SWITCH_LINE)
          },
          onCallFat: () => dispatch('call-fat'),
          onCallNick: () => dispatch('call-nick'),
        })
      }

      slots.inject('shell.overlay', () =>
        slots.register({ name: 'shell.overlay', id: 'dsh-pet-indesktop', order: 700 }, () =>
          React.createElement(PetSeat, null),
        ),
      )
      slots.inject('sidebar.footer.action', () =>
        slots.register(
          { name: 'sidebar.footer.action', id: 'dsh-pet-indesktop-toggle', order: 40, label: () => '大肥鱼 / Big Fat Fish' },
          () => React.createElement(PanelSeat, null),
        ),
      )

      void getPosition
      void getPersona
      void getCounters
      return { setPosition, setVisible, setSkin, dispatch, touch, greet }
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
    // The skin allow-list, exported as data for scripts/verify-pet.mjs and for the
    // build's cross-side comparison. `resolveSkin` is the single place an id is
    // chosen, so testing it tests every path that renders a skin.
    exports.SKIN_IDS = SKIN_IDS
    exports.DEFAULT_SKIN = DEFAULT_SKIN
    exports.SKIN_LABELS = SKIN_LABELS
    exports.PET_NAME = PET_NAME
    exports.SKIN_URL_PREFIX = SKIN_URL_PREFIX
    exports.resolveSkin = resolveSkin
    exports.skinUrl = skinUrl
    // The persona, as data: the copy table, the constants it refers to, and the
    // pure functions that decide what she does. `scripts/verify-pet.mjs` walks the
    // whole matrix through these.
    exports.PERSONA_LINES = PERSONA_LINES
    exports.MOODS = MOODS
    exports.MOOD_EVENTS = MOOD_EVENTS
    exports.PERSONA_CONFIG = PERSONA_CONFIG
    exports.personaConfig = personaConfig
    exports.currentMood = currentMood
    exports.nextMood = nextMood
    exports.personaPick = personaPick
    exports.idleDrift = idleDrift
    exports.moodPose = moodPose
    exports.PET_NICK = PET_NICK
    exports.CALL_FAT = CALL_FAT
    exports.CALL_NICK = CALL_NICK
    exports.GREET_LINE = GREET_LINE
    exports.SKIN_SWITCH_LINE = SKIN_SWITCH_LINE
    // The greeting entry function and its knobs. Nine of the twelve v2 lines are
    // reachable only through these, so they are exported for the matrix test.
    exports.GREETING_CONFIG = GREETING_CONFIG
    exports.GREETING_BUCKETS = GREETING_BUCKETS
    exports.DEFAULT_COUNTERS = DEFAULT_COUNTERS
    exports.greetingConfig = greetingConfig
    exports.greetingBucket = greetingBucket
    exports.nextGreeting = nextGreeting
    exports.dayStamp = dayStamp

    return module.exports
  },
})
