/**
 * dsh-pet-indesktop — host half.
 *
 * This file owns two things: HTTP, and the ONE piece of durable state the pet
 * has. It draws nothing.
 *
 * The pet lives in the browser (see src/client/index.js). What has to live here
 * is where the pet was last seen and whether it is hidden, because that must
 * survive a page reload, a browser restart and a rebuild. Putting it in the host
 * is also what keeps the browser half free of `localStorage` guesswork, and it
 * lets `curl` inspect or move the pet without opening the GUI.
 *
 * Routes (all under /dsh-pet-indesktop):
 *
 *   GET  /dsh-pet-indesktop/status.json   name, version, behaviour, routes, services
 *   GET  /dsh-pet-indesktop/state.json    the persisted state, defaults filled in
 *   POST /dsh-pet-indesktop/state         validate a partial update and persist it
 *
 * Conventions inherited from the sibling plugin (dsh-boot-animation) and not
 * negotiable:
 *
 *   - The ONLY host service this plugin touches is `ctx.webServer`. Nothing is
 *     declared in `peerDependencies`; a DSH >= 0.2.0 host silently DROPS a plugin
 *     whose peerDependencies do not match, so `@deepseek-ai/dsh-*` must never
 *     appear there. This half is the half where a static `inject` is appropriate
 *     at all, and it names a cordis SERVICE (`webServer`), not a package.
 *   - The prefix must NOT end with a trailing slash. The webserver matches a
 *     prefix with
 *       pathname !== prefix && !pathname.startsWith(prefix + '/')
 *     so a registered path of `.../state.json/` would be tested as
 *     `.../state.json//` and never match a real request.
 *   - `no-store` on every answer, including failures. A payload with no cache
 *     directive is heuristically cacheable, and a route that 404s once while it
 *     is broken keeps 404ing in that browser long after the fix. (The
 *     `no-cache` + `ETag` rule is for MEDIA, which this plugin does not serve.)
 *   - A failure inside a route never escapes into the host. A desktop pet must
 *     not be able to take a webserver down.
 *
 * ── The state file ───────────────────────────────────────────────────────────
 *
 * `$DSH_HOME/pet-indesktop/state.json`, or `~/.dsh/pet-indesktop/state.json` when
 * DSH_HOME is unset. Three properties matter, and scripts/verify-routes.mjs
 * checks each one:
 *
 *   1. ATOMIC writes: serialize, write `<file>.tmp`, then `rename()` over the
 *      real file. `rename` inside one directory is atomic, so a crash or a
 *      concurrent writer leaves either the old file or the new one, never a
 *      half-written one. (A truncating write would leave a zero-byte file that
 *      the next read then has to self-heal from.) The temp file is a SIBLING of
 *      the real file on purpose: a temp name in the OS temp directory can sit on
 *      another filesystem, where rename() is a copy and therefore not atomic.
 *   2. SELF-HEALING reads: a missing, unreadable, oversized, malformed or
 *      hand-edited file NEVER throws and never propagates junk. Every field goes
 *      through the same sanitizer the HTTP layer uses; out-of-range values are
 *      clamped back, unusable ones fall back to the default, and the caller is
 *      told what was wrong. A hand-edited file therefore cannot make this plugin
 *      serve something it would have rejected over HTTP.
 *   3. NO PATH FROM THE PAYLOAD: the path is the state root plus the two
 *      constants below. Nothing in a request body can name a file, a directory or
 *      a path fragment — the body carries where the pet is, not where to write.
 *
 * Plain JavaScript with no DSH SDK imports, so it needs no compiler: the build
 * copies `src/host/` over `lib/host/` and writes a one-line `lib/index.js` shim.
 */
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const name = 'dsh-pet-indesktop'

/** The webserver routes are the only host service this plugin needs. */
export const inject = ['webServer']

/** lib/host/index.js -> package root */
const PKG_ROOT = new URL('../../', import.meta.url)
const BASE_ROUTE = '/dsh-pet-indesktop'
const STATUS_ROUTE = `${BASE_ROUTE}/status.json`
const STATE_ROUTE = `${BASE_ROUTE}/state.json`
/**
 * The WRITE path hangs UNDER the read path on purpose: the webserver matches a
 * prefix with `pathname !== prefix && !pathname.startsWith(prefix + '/')`, so
 * `/state.json` is the one prefix that can answer both, and the write suffix is
 * derived here rather than typed twice. See the dispatcher in `apply()`.
 */
const WRITE_SUFFIX = '/state'
const WRITE_ROUTE = `${STATE_ROUTE}${WRITE_SUFFIX}`

/** Everything the pet remembers lives under these two names. */
const STATE_DIR = 'pet-indesktop'
const STATE_FILE = 'state.json'

/**
 * Refuse to READ a state file bigger than this, and refuse to ACCEPT a body
 * bigger than this. The number is deliberately tiny: the honest payload is a few
 * dozen bytes, so 4 KiB is already ~100x the real thing — a hand-edited or
 * hostile file cannot become a memory problem on a route a browser polls.
 */
const MAX_BYTES = 4096

/** The pet's name is a label, not a document. */
const MAX_NAME = 24

/**
 * The pet is kept a few percent inside the frame. 0 would put its anchor exactly
 * on the corner, where half of a ~96px pet hangs off the edge of a small window.
 */
const MIN_POS = 2
const MAX_POS = 98

// ── the state schema ─────────────────────────────────────────────────────────

/**
 * The defaults. `version` is the schema version, not the package version: it
 * exists so a future change to this file can be recognised rather than guessed.
 * `x`/`y` are integer percentages of the viewport, NOT pixels — a percentage
 * survives a window resize and a different monitor, which pixels do not.
 */
const DEFAULT_STATE = Object.freeze({
  version: 1,
  visible: true,
  x: 92,
  y: 88,
  name: '小深',
})

/** The knobs, and the only keys a body may carry. */
const FIELD_NAMES = Object.freeze(['version', 'visible', 'x', 'y', 'name'])

/**
 * Fold one coordinate into the anchor range — the ONE clamp in this package.
 *
 * The client half has its own copy of this rule (it cannot import from here; see
 * ARCHITECTURE.md), and `scripts/verify-pet.mjs` drives both over the same grid to
 * prove they agree. That comparison is why the behaviour below is pinned the way it
 * is:
 *
 *   - unusable input (not a number, NaN, ±Infinity) folds to MAX_POS, NOT to the
 *     default. Clamping is what a range is for, and a corner is a valid answer;
 *     substituting the default here would contradict `clampPercent(undefined)`
 *     returning a bound, and the two halves would then disagree on exactly the
 *     inputs that matter.
 *   - out-of-range finite input clamps to the nearer bound.
 *   - fractional input rounds, so a saved value is one the host would accept.
 */
export function clampPercent(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return MAX_POS
  return Math.min(MAX_POS, Math.max(MIN_POS, Math.round(value)))
}

/** A one-line description of an unexpected value, for the diagnostic body. */
function describe(value) {
  if (value === undefined) return 'undefined'
  if (value === null) return 'null'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'a non-finite number'
  if (typeof value === 'string') return `a string of ${String(value.length)} characters`
  if (Array.isArray(value)) return `an array of ${String(value.length)} items`
  return `a ${typeof value}`
}

/** True only for a real number that is finite. `typeof NaN === 'number'` is the trap. */
function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Turn anything at all into a usable state, and report what had to be changed.
 *
 * This one function is used by BOTH sides of the boundary, and `strict` is the
 * only difference between them — that is the whole reason it exists:
 *
 *   strict: true   the HTTP layer. An unusable field is an ERROR (`ok: false`),
 *                  because a client that sends `{"visible":"false"}` has a bug and
 *                  quietly doing something else hides it.
 *   strict: false  the file layer. An unusable field is a WARNING: the value falls
 *                  back to its default and the read still succeeds, because losing
 *                  the pet to a fat-fingered config file is the worse outcome.
 *
 * Unknown keys are REJECTED in strict mode and dropped in file mode. Rejecting is
 * the point: `{"xpos": 10}` must not quietly do nothing while answering 200.
 *
 * A value that is merely OUT OF RANGE (`x: 1e9`) is clamped in both modes and is
 * not an error: clamping is what the range is for. A value of the WRONG TYPE is
 * an error in strict mode and a fallback in file mode.
 */
function sanitizeState(raw, { strict }) {
  const issues = []
  const state = { ...DEFAULT_STATE }

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    issues.push(`body: must be a JSON object (got ${describe(raw)})`)
    return { ok: false, state, issues }
  }

  const unknown = Object.keys(raw).filter((key) => !FIELD_NAMES.includes(key))
  if (unknown.length > 0) {
    issues.push(`body: unknown key(s) ${unknown.map((k) => JSON.stringify(k)).join(', ')} — allowed: ${FIELD_NAMES.join(', ')}`)
    if (strict) return { ok: false, state, issues }
  }

  let rejected = false
  /**
   * Is `key` actually PRESENT in the body?
   *
   * The `raw` argument matters: this used to be a one-argument curried helper
   * called as `has(raw, key)`, which silently returned false for every key and
   * made every field check below a no-op — the validation looked strict and
   * accepted everything. Taken as a two-argument function, the call sites and the
   * signature cannot disagree without throwing.
   */
  const has = (source, key) => Object.prototype.hasOwnProperty.call(source, key)

  if (has(raw, 'version') && (!isFiniteNumber(raw.version) || Math.round(raw.version) !== DEFAULT_STATE.version)) {
    issues.push(`version: must be ${String(DEFAULT_STATE.version)} (got ${describe(raw.version)})`)
    rejected = true
  }

  if (has(raw, 'visible')) {
    if (typeof raw.visible === 'boolean') state.visible = raw.visible
    else {
      issues.push(`visible: must be a boolean (got ${describe(raw.visible)})`)
      rejected = true
    }
  }

  for (const key of ['x', 'y']) {
    if (!has(raw, key)) continue
    const value = raw[key]
    if (!isFiniteNumber(value)) {
      issues.push(`${key}: must be a finite number (got ${describe(value)})`)
      rejected = true
      continue
    }
    const rounded = clampPercent(value)
    if (rounded !== Math.round(value)) {
      // Clamped rather than rejected: this is precisely what the range is for, and
      // the diagnostic still says it happened.
      issues.push(`${key}: outside ${String(MIN_POS)}..${String(MAX_POS)}, clamped (got ${String(value)})`)
    }
    state[key] = rounded
  }

  if (has(raw, 'name')) {
    const value = raw.name
    if (typeof value !== 'string') {
      issues.push(`name: must be a string (got ${describe(value)})`)
      rejected = true
    } else {
      const trimmed = value.trim()
      if (trimmed === '') {
        issues.push('name: must not be empty')
        rejected = true
      } else if (trimmed.length > MAX_NAME) {
        // Rejected rather than truncated: silently renaming someone's pet is worse
        // than telling them the name is too long.
        issues.push(`name: must be at most ${String(MAX_NAME)} characters (got ${String(trimmed.length)})`)
        rejected = true
      } else {
        state.name = trimmed
      }
    }
  }

  return { ok: strict ? !rejected : true, state, issues }
}

// ── the state file ───────────────────────────────────────────────────────────

/** `$DSH_HOME` when it is set and non-empty, else `~/.dsh`. */
export function defaultStateRoot(env = process.env) {
  const configured = typeof env?.DSH_HOME === 'string' ? env.DSH_HOME.trim() : ''
  return configured === '' ? join(homedir(), '.dsh') : configured
}

/**
 * The store: one small JSON file, read on demand, written atomically.
 *
 * `root` is a seam, not a test hook for its own sake: `createStateStore` is how a
 * caller decides where the pet's state lives, and `apply()` below calls it with
 * the DSH_HOME default. The routes verifier points it at a temp directory, so no
 * check ever touches the real `~/.dsh`.
 */
export function createStateStore({ root = defaultStateRoot() } = {}) {
  const dir = join(root, STATE_DIR)
  const file = join(dir, STATE_FILE)
  const temp = `${file}.tmp`

  const defaults = (why) => ({ state: { ...DEFAULT_STATE }, issues: why === null ? [] : [why], healed: why !== null })

  /**
   * Read the state, healing anything this plugin would not have written.
   *
   * Never throws: every failure mode ends in the defaults plus an explanation.
   */
  async function read() {
    let text
    try {
      const info = await stat(file)
      if (!info.isFile()) {
        return defaults('state file is not a regular file — using defaults')
      }
      if (info.size > MAX_BYTES) {
        return defaults(`state file is ${String(info.size)} bytes, over the ${String(MAX_BYTES)}-byte cap — using defaults`)
      }
      text = await readFile(file, 'utf8')
    } catch (cause) {
      // A missing file is the ordinary first run: not a problem, not a warning.
      if (cause?.code === 'ENOENT') return defaults(null)
      return defaults(`state file could not be read (${String(cause?.code ?? cause?.message ?? cause)}) — using defaults`)
    }

    let parsed
    try {
      parsed = JSON.parse(text)
    } catch (cause) {
      return defaults(`state file is not valid JSON (${String(cause?.message ?? cause)}) — using defaults`)
    }

    const { state, issues } = sanitizeState(parsed, { strict: false })
    return { state, issues, healed: issues.length > 0 }
  }

  /**
   * Replace the stored state atomically.
   *
   * Returns `{ ok, issues }` rather than throwing: the route turns a failure into
   * a 500, and a caller that ignores it still gets a plugin that keeps running.
   */
  async function write(next) {
    const { state, issues } = sanitizeState(next, { strict: false })
    const text = `${JSON.stringify(state, null, 2)}\n`
    if (Buffer.byteLength(text) > MAX_BYTES) {
      return { ok: false, state, issues, error: `serialized state is over the ${String(MAX_BYTES)}-byte cap` }
    }
    try {
      await mkdir(dir, { recursive: true })
      await writeFile(temp, text, 'utf8')
      await rename(temp, file)
      return { ok: true, state, issues }
    } catch (cause) {
      // Best effort: never leave a stray temp file behind after a failed write.
      try {
        await rm(temp, { force: true })
      } catch {
        /* nothing to clean */
      }
      return { ok: false, state, issues, error: `state file could not be written (${String(cause?.code ?? cause?.message ?? cause)})` }
    }
  }

  /**
   * Apply a partial update on top of what is stored.
   *
   * The merge happens BEFORE validation, so a body of `{"x": 10}` keeps the stored
   * `visible`/`y`/`name` instead of resetting them — a partial update that resets
   * the other fields is the classic way to lose the pet's position.
   */
  async function update(patch) {
    const current = await read()
    if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
      const { ok, state, issues } = sanitizeState(patch, { strict: true })
      return { ok, state, issues, error: 'body must be a JSON object' }
    }
    const checked = sanitizeState({ ...current.state, ...patch }, { strict: true })
    if (!checked.ok) {
      // A rejected update must not half-apply, so nothing is written and the
      // reply carries what is still on disk.
      return { ok: false, state: current.state, issues: checked.issues }
    }
    const written = await write(checked.state)
    return { ...written, issues: [...current.issues, ...written.issues] }
  }

  return { dir, file, temp, read, write, update }
}

// ── HTTP plumbing ────────────────────────────────────────────────────────────

/**
 * The version, read from the installed package rather than duplicated here.
 *
 * A hard-coded version string drifts from package.json the first time someone
 * bumps one and not the other, and the drift is invisible until a bug report
 * quotes a version that was never shipped.
 */
async function readPackage() {
  try {
    const { readFileSync } = await import('node:fs')
    const pkg = JSON.parse(readFileSync(new URL('package.json', PKG_ROOT), 'utf8'))
    return {
      name: typeof pkg.name === 'string' ? pkg.name : name,
      version: typeof pkg.version === 'string' ? pkg.version : '0',
    }
  } catch {
    return { name, version: '0' }
  }
}

/**
 * A JSON reply that is never cached.
 *
 * `no-store` (not `no-cache`): every answer from these routes is a statement
 * about the pet right now, and a stale copy is worse than no copy.
 */
function sendJson(res, payload, status = 200) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(payload, null, 2))
}

/** Plain-text reply, also never cached. See the note on `sendJson`. */
function sendText(res, status, body) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
  res.end(body)
}

/**
 * The pathname of a request, without the query string.
 *
 * Each route is registered as a PREFIX (the server's matcher requires
 * `kind: 'prefix'`; an exact route would be a different table and a different
 * guarantee), and a prefix answers for everything beneath it. So the handler
 * still has to say no: anything that is not exactly one of this plugin's
 * addresses gets a plain 404 rather than a state payload under an address that
 * does not exist.
 */
function pathnameOf(req) {
  const raw = typeof req.url === 'string' ? req.url : ''
  const at = raw.indexOf('?')
  const path = at === -1 ? raw : raw.slice(0, at)
  return path === '' ? '/' : path
}

/**
 * Read a request body, bounded.
 *
 * Bounded means bounded BEFORE parsing: the cap is applied to the bytes as they
 * arrive, so a huge body costs memory up to the cap and then a 413 — not the
 * whole body. A body that never ends is bounded by the caller's socket timeout,
 * which this plugin neither knows nor changes.
 */
function readBody(req, limit) {
  return new Promise((settle) => {
    if (req === null || typeof req !== 'object' || typeof req.on !== 'function') {
      settle({ ok: true, text: '' })
      return
    }
    let size = 0
    let text = ''
    let done = false
    const finish = (result) => {
      if (done) return
      done = true
      settle(result)
    }

    req.on('data', (chunk) => {
      if (done) return
      const piece = typeof chunk === 'string' ? chunk : String(chunk)
      size += Buffer.byteLength(piece)
      if (size > limit) {
        finish({ ok: false, status: 413, error: `body is over the ${String(limit)}-byte cap` })
        try {
          if (typeof req.destroy === 'function') req.destroy()
        } catch {
          /* already gone */
        }
        return
      }
      text += piece
    })
    req.on('end', () => finish({ ok: true, text }))
    req.on('error', (cause) => finish({ ok: false, status: 400, error: `body could not be read (${String(cause?.message ?? cause)})` }))
    if (typeof req.once === 'function') {
      req.once('aborted', () => finish({ ok: false, status: 400, error: 'request aborted before the body arrived' }))
    }
  })
}

export function apply(ctx) {
  /**
   * Built on first use, from DSH_HOME. Nothing else about the store is captured,
   * and in particular nothing comes from a request.
   */
  let cached = null
  const store = () => {
    if (cached === null) cached = createStateStore({})
    return cached
  }

  const status = async (req, res) => {
    if (pathnameOf(req) !== STATUS_ROUTE) {
      sendText(res, 404, `dsh-pet-indesktop: no such route (this plugin serves ${STATUS_ROUTE})`)
      return
    }
    try {
      const pkg = await readPackage()
      sendJson(res, {
        plugin: pkg.name,
        version: pkg.version,
        /**
         * `behaviour` records the SHAPE of the feature, so a client or a monitoring
         * script can tell what it is talking to without guessing from the visuals.
         */
        behaviour: 'desktop-pet',
        behaviourNote: 'a draggable SVG whale overlay with a durable position; no media, no network, no external assets',
        routes: [STATUS_ROUTE, STATE_ROUTE, WRITE_ROUTE],
        services: ['webServer'],
        stateFile: store().file,
      })
    } catch (cause) {
      // A failure inside a route is not allowed to escape into the host: a
      // decorative plugin must never be able to take the server down.
      sendText(res, 500, `dsh-pet-indesktop: status failed (${String(cause?.message ?? cause)})`)
    }
  }

  const state = async (req, res) => {
    const path = pathnameOf(req)
    const method = typeof req.method === 'string' ? req.method.toUpperCase() : 'GET'

    /**
     * Reading and writing share ONE registered prefix, and the prefix is
     * `/state.json` with the write hanging UNDER it at `/state.json/state`.
     *
     * That shape is forced by the webserver's matcher,
     * `pathname !== prefix && !pathname.startsWith(prefix + '/')`, in a way that is
     * easy to get wrong:
     *
     *   - `/state.json` does NOT start with `/state/`, so registering `/state` would
     *     leave `POST .../state` unanswered (the pet would forget where it was);
     *   - worse, if BOTH `/state` and `/state.json` were registered, `/state` would
     *     win by longest-prefix for the path `/state.json`, because
     *     `'/dsh-pet-indesktop/state.json'.startsWith('/dsh-pet-indesktop/state' + '/')`
     *     is false but the plain-prefix test is greedy — which is why this plugin
     *     registers exactly one state prefix and dispatches beneath it.
     *
     * The write path is derived from the prefix here rather than written out twice,
     * so the two can never drift apart.
     */
    const writes = path === WRITE_ROUTE
    const reads = path === STATE_ROUTE

    if (!reads && !writes) {
      sendText(res, 404, `dsh-pet-indesktop: no such route (this plugin serves ${STATE_ROUTE} and ${STATE_ROUTE}/state)`)
      return
    }

    if (writes && method === 'POST') {
      try {
        const body = await readBody(req, MAX_BYTES)
        if (!body.ok) {
          sendJson(res, { ok: false, error: body.error, state: null }, body.status)
          return
        }
        let patch
        try {
          patch = JSON.parse(body.text === '' ? 'null' : body.text)
        } catch (cause) {
          sendJson(res, { ok: false, error: `body is not valid JSON (${String(cause?.message ?? cause)})`, state: null }, 400)
          return
        }
        if (patch === null) {
          sendJson(res, { ok: false, error: 'body must be a JSON object with at least one field', state: null }, 400)
          return
        }
        const result = await store().update(patch)
        if (!result.ok) {
          sendJson(res, { ok: false, error: 'state rejected', issues: result.issues, state: result.state }, 400)
          return
        }
        sendJson(res, { ok: true, state: result.state, issues: result.issues }, 200)
      } catch (cause) {
        sendText(res, 500, `dsh-pet-indesktop: state write failed (${String(cause?.message ?? cause)})`)
      }
      return
    }

    if (writes) {
      sendText(res, 405, `dsh-pet-indesktop: ${method} is not allowed on ${WRITE_ROUTE} (use POST)`)
      return
    }

    if (method !== 'GET' && method !== 'HEAD') {
      sendText(res, 405, `dsh-pet-indesktop: ${method} is not allowed on ${STATE_ROUTE} (use GET)`)
      return
    }

    try {
      const { state: value, issues, healed } = await store().read()
      sendJson(res, { plugin: name, state: value, healed, issues })
    } catch (cause) {
      sendText(res, 500, `dsh-pet-indesktop: state read failed (${String(cause?.message ?? cause)})`)
    }
  }

  /**
   * Two prefix routes: `/status.json` and `/state.json`. Each handler still
   * dispatches on the exact pathname, because a prefix answers for everything
   * beneath it.
   *
   * A failure while REGISTERING is the plugin boundary: report it and stop, never
   * let it escape into the host boot.
   */
  ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: STATUS_ROUTE, handler: status }),
    'dsh-pet-indesktop: status route',
  )
  ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: STATE_ROUTE, handler: state }),
    'dsh-pet-indesktop: pet routes',
  )
}

/**
 * Exported for the verifier and for any future host setting: the exact rules a
 * payload must satisfy, with no store and no HTTP involved.
 */
export function validateStatePayload(raw) {
  return sanitizeState(raw, { strict: true })
}

/** Exported so the verifier can assert the caps instead of re-typing them. */
export const limits = Object.freeze({
  MAX_BYTES,
  MAX_NAME,
  MIN_POS,
  MAX_POS,
  STATE_DIR,
  STATE_FILE,
  FIELD_NAMES,
  DEFAULT_STATE,
  routes: { STATUS_ROUTE, STATE_ROUTE, WRITE_ROUTE, BASE_ROUTE },
})
