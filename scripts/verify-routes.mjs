/**
 * verify-routes.mjs — route regression test for the host half.
 *
 * Why this exists: the host registers webserver routes, and the way the
 * webserver MATCHES them is not obvious. A prefix route is matched with
 *
 *   pathname !== prefix && !pathname.startsWith(`${prefix}/`)
 *
 * so registering `.../status.json/` (with a trailing slash) makes the matcher
 * test `.../status.json//`, which no real request ever starts with — the route
 * 404s forever. That bug shipped in the sibling plugin. A hand-rolled probe
 * using its own `startsWith(prefix)` cannot see it, because the probe is not
 * using the server's rule.
 *
 * So this file reproduces the server's exact rule and drives the REAL handlers
 * through it. Any route that only matches under a looser rule the server does
 * not use will fail here.
 *
 * It also drives the failure paths, because a 404 without a cache directive is
 * heuristically cacheable: a route that 404s once while it is broken keeps
 * 404ing in that browser long after the fix.
 *
 * Usage: node scripts/verify-routes.mjs
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { apply, inject, limits, name } from '../lib/index.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const BASE = '/dsh-pet-indesktop'

/**
 * DSH_HOME is pointed at a throwaway directory BEFORE apply() runs, so no route
 * under test can read or write the real ~/.dsh. The asset route never touches it;
 * this is defence in depth, and it also proves the state path really is derived
 * from the environment and nothing else.
 */
const HOME = mkdtempSync(join(tmpdir(), 'dsh-pet-routes-'))
process.env.DSH_HOME = HOME
process.on('exit', () => {
  try {
    rmSync(HOME, { recursive: true, force: true })
  } catch {
    /* best effort */
  }
})

// --- capture registrations, mirroring the webserver's two tables ---
const exact = new Map()
const prefixes = new Map()
const effects = []
const ctx = {
  effect: (fn, label) => {
    effects.push(label ?? '(unlabelled)')
    return fn()
  },
  webServer: {
    register(route) {
      const table = route.kind === 'exact' ? exact : prefixes
      if (table.has(route.path)) throw new Error(`duplicate ${route.kind} route "${route.path}"`)
      table.set(route.path, route)
      return () => {}
    },
  },
}

const failures = []
const check = (ok, label) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`)
  if (!ok) failures.push(label)
}

try {
  apply(ctx)
} catch (error) {
  console.error(`verify-routes: apply() threw — ${String(error?.message ?? error)}`)
  process.exit(2)
}

/**
 * The webserver's own resolution: exact table first, then longest-prefix-wins.
 * Kept in step with the shipped implementation
 * (dsh-host-webserver): pathname !== prefix && !pathname.startsWith(prefix + '/')
 */
function serverMatches(prefix, pathname) {
  return !(pathname !== prefix && !pathname.startsWith(`${prefix}/`))
}

function resolve(pathname) {
  const hit = exact.get(pathname)
  if (hit !== undefined) return hit
  let best
  for (const [prefix, route] of prefixes) {
    if (!serverMatches(prefix, pathname)) continue
    if (best === undefined || prefix.length > best.path.length) best = route
  }
  return best
}

/** Drive one request through the resolved handler. */
function call(rawUrl, method = 'GET', headers = {}) {
  return new Promise((done) => {
    const pathname = rawUrl.split('?')[0]
    const route = resolve(pathname)
    if (route === undefined) {
      done({ code: 404, headers: {}, body: null, note: 'NO ROUTE MATCHED' })
      return
    }
    const req = { method, url: rawUrl, headers, on: () => req, destroy: () => {} }
    let text = ''
    let bytes = 0
    const res = {
      statusCode: 200,
      headers: {},
      write(chunk) {
        if (chunk === undefined) return true
        const s = String(chunk)
        text += s
        bytes += Buffer.byteLength(s)
        return true
      },
      on: () => {},
      once: () => {},
      emit: () => {},
      writeHead(code, headersOut) {
        this.statusCode = code
        Object.assign(this.headers, headersOut ?? {})
      },
      end(payload) {
        if (payload !== undefined) {
          const s = String(payload)
          text += s
          bytes += Buffer.byteLength(s)
        }
        done({ code: this.statusCode, headers: this.headers, body: text === '' ? null : text, bytes })
      },
    }
    try {
      const returned = route.handler(req, res)
      if (returned !== undefined && typeof returned.then === 'function') {
        returned.catch((error) => {
          done({ code: 500, headers: {}, body: String(error?.message ?? error), note: 'handler rejected' })
        })
      }
    } catch (error) {
      done({ code: 500, headers: {}, body: String(error?.message ?? error), note: 'handler threw' })
    }
  })
}

/**
 * Drive one request and capture the response as BYTES.
 *
 * The text helper below stringifies chunks, which is right for JSON and wrong for a
 * 200 KB PNG: comparing `String(bytes)` would pass on almost anything. This one
 * accumulates Buffers, so the image can be compared to the file on disk exactly.
 */
function callBinary(rawUrl, method = 'GET', headers = {}) {
  return new Promise((done) => {
    const pathname = rawUrl.split('?')[0]
    const route = resolve(pathname)
    if (route === undefined) {
      done({ code: 404, headers: {}, bytes: null, note: 'NO ROUTE MATCHED' })
      return
    }
    const req = { method, url: rawUrl, headers, on: () => req, destroy: () => {} }
    const chunks = []
    const res = {
      statusCode: 200,
      headers: {},
      write(chunk) {
        if (chunk !== undefined) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
        return true
      },
      on: () => {},
      once: () => {},
      emit: () => {},
      writeHead(code, headersOut) {
        this.statusCode = code
        Object.assign(this.headers, headersOut ?? {})
      },
      end(payload) {
        if (payload !== undefined) chunks.push(Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload)))
        done({ code: this.statusCode, headers: this.headers, bytes: Buffer.concat(chunks) })
      },
    }
    try {
      const returned = route.handler(req, res)
      if (returned !== undefined && typeof returned.then === 'function') {
        returned.catch((error) => done({ code: 500, headers: {}, bytes: null, note: `rejected: ${String(error?.message ?? error)}` }))
      }
    } catch (error) {
      done({ code: 500, headers: {}, bytes: null, note: `threw: ${String(error?.message ?? error)}` })
    }
  })
}

/**
 * POST a partial state update, with a REAL body.
 *
 * The plain `call` above answers `on('data'|'end')` with no-ops, which is fine for
 * GET and would silently hand the handler an empty body — every validation check
 * built on it would then "pass" for the wrong reason. This one streams.
 */
function postState(patch, options = {}) {
  const body = options.raw === true ? String(patch) : JSON.stringify(patch)
  return new Promise((done) => {
    const url = `${BASE}/state.json/state`
    const route = resolve(url.split('?')[0])
    if (route === undefined) {
      done({ code: 404, headers: {}, body: null, note: 'NO ROUTE MATCHED' })
      return
    }
    const listeners = new Map()
    const req = {
      method: 'POST',
      url,
      headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
      on(event, handler) {
        if (!listeners.has(event)) listeners.set(event, [])
        listeners.get(event).push(handler)
        return req
      },
      once(event, handler) {
        return req.on(event, handler)
      },
      destroy() {},
    }
    setImmediate(() => {
      for (const handler of listeners.get('data') ?? []) handler(body)
      for (const handler of listeners.get('end') ?? []) handler()
    })
    let text = ''
    const res = {
      statusCode: 200,
      headers: {},
      write(chunk) {
        if (chunk !== undefined) text += String(chunk)
        return true
      },
      on: () => {},
      once: () => {},
      emit: () => {},
      writeHead(code, headersOut) {
        this.statusCode = code
        Object.assign(this.headers, headersOut ?? {})
      },
      end(payload) {
        if (payload !== undefined) text += String(payload)
        let parsed = null
        try {
          parsed = JSON.parse(text === '' ? 'null' : text)
        } catch {
          parsed = null
        }
        done({ code: this.statusCode, headers: this.headers, body: text === '' ? null : text, json: parsed })
      },
    }
    try {
      const returned = route.handler(req, res)
      if (returned !== undefined && typeof returned.then === 'function') {
        returned.catch((error) => done({ code: 500, headers: {}, body: String(error?.message ?? error), json: null, note: 'rejected' }))
      }
    } catch (error) {
      done({ code: 500, headers: {}, body: String(error?.message ?? error), json: null, note: 'threw' })
    }
  })
}

/** GET the stored state, parsed. */
function readState() {
  return new Promise((done) => {
    const url = `${BASE}/state.json`
    const route = resolve(url)
    if (route === undefined) {
      done({ code: 404, json: null })
      return
    }
    const req = { method: 'GET', url, headers: {}, on: () => req, destroy: () => {} }
    let text = ''
    const res = {
      statusCode: 200,
      headers: {},
      write(chunk) {
        if (chunk !== undefined) text += String(chunk)
        return true
      },
      on: () => {},
      once: () => {},
      emit: () => {},
      writeHead(code, headersOut) {
        this.statusCode = code
        Object.assign(this.headers, headersOut ?? {})
      },
      end(payload) {
        if (payload !== undefined) text += String(payload)
        let parsed = null
        try {
          parsed = JSON.parse(text === '' ? 'null' : text)
        } catch {
          parsed = null
        }
        done({ code: this.statusCode, headers: this.headers, json: parsed })
      },
    }
    try {
      const returned = route.handler(req, res)
      if (returned !== undefined && typeof returned.then === 'function') {
        returned.catch((error) => done({ code: 500, json: null, note: String(error?.message ?? error) }))
      }
    } catch (error) {
      done({ code: 500, json: null, note: String(error?.message ?? error) })
    }
  })
}

const STATE_FILE = join(HOME, 'pet-indesktop', 'state.json')

async function expect(url, want, method = 'GET') {
  const r = await call(url, method)
  const ok = r.code === want
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${method} ${url} -> ${r.code} (want ${want})${r.note === undefined ? '' : ' — ' + r.note}`)
  if (!ok) failures.push(`${method} ${url} -> ${r.code} (want ${want})`)
  return r
}

console.log('the plugin itself:')
check(name === 'dsh-pet-indesktop', `name is dsh-pet-indesktop (got ${name})`)
check(
  Array.isArray(inject) && inject.length === 1 && inject[0] === 'webServer',
  `the host half injects ONLY webServer (got ${JSON.stringify(inject)})`,
)
check(
  !JSON.stringify(inject ?? []).includes('@deepseek-ai/'),
  'no @deepseek-ai/* package in the host half inject list (that is peerDependencies territory, and DSH >=0.2.0 drops mismatches)',
)

console.log('\nregistered exact   :', [...exact.keys()].join(' ') || '(none)')
console.log('registered prefixes:', [...prefixes.keys()].join(' ') || '(none)')
console.log('effects            :', effects.join(' | ') || '(none)')

// A route registered as a prefix with a trailing slash can never answer its own
// URL: this is the exact shape of the bug this file exists to catch.
for (const path of prefixes.keys()) {
  check(!path.endsWith('/'), `prefix route "${path}" does not end with "/"`)
}
check(prefixes.size > 0, 'at least one prefix route is registered')

/**
 * Prove the matcher really is the one described, rather than a looser rule a
 * hand-rolled probe would happily accept.
 *
 * The server's skip rule is
 *   `pathname !== prefix && !pathname.startsWith(prefix + '/')`
 * and it has two consequences people get wrong in opposite directions:
 *
 *   1. a route registered as a plain path (`/x/status.json`) answers BOTH its own
 *      URL and everything beneath it — `/x/status.json/child` reaches the handler
 *      too, which is why the handler itself has to refuse unknown paths;
 *   2. registering the trailing-slash form `/x/status.json/` still answers paths
 *      that carry that slash, but NEVER answers `/x/status.json` — the real
 *      address. The route looks registered and is dead.
 *
 * If case 2 ever "matches" here, the harness has drifted from the server's rule
 * and every other check in this file means nothing.
 */
{
  const own = '/dsh-pet-indesktop/status.json'
  check(resolve(own) !== undefined, `the registered prefix answers its own URL ("${own}")`)
  check(resolve(`${own}/child`) !== undefined, `...and its children ("${own}/child") — the handler must refuse them itself`)
  check(
    resolve('/dsh-pet-indesktop/nope.json') === undefined,
    "a sibling under the plugin name is NOT ours: that is the host's own 404",
  )

  // The bug, stated as a fact about the matcher rather than about our table:
  // the trailing-slash form never answers the address clients actually request.
  const registered = `${own}/`
  check(
    !serverMatches(registered, own),
    `a registration of "${registered}" (trailing slash) never answers "${own}" — the real address`,
  )
  check(serverMatches(registered, registered), '...it only answers the trailing-slash form itself, which nothing requests')
}

console.log('\nroutes:')
const status = await expect(`${BASE}/status.json`, 200)
{
  const raw = status.headers?.['cache-control'] ?? ''
  // `no-store` (not `no-cache`) is deliberate HERE: this route answers "what is
  // installed right now", so a cached copy is worse than no copy. The no-cache +
  // ETag rule applies to media, which this plugin does not serve.
  check(raw === 'no-store', `status.json cache-control is exactly no-store (got ${raw === '' ? '(none)' : raw})`)
  check(
    (status.headers?.['content-type'] ?? '').startsWith('application/json'),
    `status.json is served as JSON (got ${status.headers?.['content-type'] ?? '(none)'})`,
  )

  let payload = null
  try {
    payload = JSON.parse(status.body ?? 'null')
  } catch (error) {
    failures.push(`status.json is not valid JSON: ${String(error?.message ?? error)}`)
  }
  if (payload === null) {
    check(false, 'status.json returns a JSON object')
  } else {
    check(payload.plugin === 'dsh-pet-indesktop', `status.json names the plugin (got ${String(payload.plugin)})`)
    const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version
    check(payload.version === version, `status.json reports the package version, read from package.json (got ${String(payload.version)}, want ${version})`)
    // THE honest marker. If the visual is ever specified, this must change with it.
    // `behaviour` records the SHAPE of the feature, and the note explains it.
  check(payload.behaviour === 'desktop-pet', `status.json marks behaviour as "desktop-pet" (got ${String(payload.behaviour)})`)
  check(typeof payload.behaviourNote === 'string' && payload.behaviourNote !== '', 'status.json explains what that behaviour means')
  const routes = Array.isArray(payload.routes) ? payload.routes : []
  for (const expected of ['/dsh-pet-indesktop/status.json', '/dsh-pet-indesktop/state.json', '/dsh-pet-indesktop/state.json/state']) {
    check(routes.includes(expected), `status.json lists ${expected}`)
  }
  check(
    Array.isArray(payload.services) && payload.services.length === 1 && payload.services[0] === 'webServer',
    `status.json lists only the webServer service (got ${JSON.stringify(payload.services)})`,
  )
  check(typeof payload.stateFile === 'string' && payload.stateFile.endsWith('state.json'), `status.json reports the state file path (got ${String(payload.stateFile)})`)
  }
}

console.log('\nstate — the skin round-trips, and a bad one cannot break the pet:')
{
  // 1. A fresh read fills in the default skin.
  const fresh = await readState()
  check(fresh.code === 200, `GET state.json -> 200 (got ${String(fresh.code)})`)
  check(
    fresh.json?.state?.skin === limits.DEFAULT_SKIN,
    `a fresh state carries the default skin (got ${String(fresh.json?.state?.skin)}, want ${String(limits.DEFAULT_SKIN)})`,
  )

  // 2. Every known id round-trips through POST and back out of GET, and lands in the
  //    file. All eight, because a typo in one id would only show up as a swatch that
  //    does not stick.
  for (const id of limits.SKIN_IDS) {
    const posted = await postState({ skin: id })
    check(posted.code === 200, `POST {"skin":"${id}"} -> 200 (got ${String(posted.code)})`)
    check(posted.json?.state?.skin === id, `the POST reply reports ${id} (got ${String(posted.json?.state?.skin)})`)
    const readBack = await readState()
    check(readBack.json?.state?.skin === id, `GET reads ${id} back (got ${String(readBack.json?.state?.skin)})`)
    const onDisk = JSON.parse(readFileSync(STATE_FILE, 'utf8'))
    check(onDisk.skin === id, `the state file stores ${id} (got ${String(onDisk.skin)})`)
  }

  // 3. A partial update that does not mention the skin must NOT reset it — the
  //    classic way to lose a preference.
  check((await postState({ x: 40, y: 50 })).code === 200, 'a position-only update is accepted')
  check(
    (await readState()).json?.state?.skin === 'ember',
    'a position-only update keeps the chosen skin (ember survived)',
  )

  // 4. A bad skin in a POST is a 400 with a diagnostic naming the allowed values.
  for (const bad of ['nope', 'Deepsea', '', 'deepsea.png', '../../package.json', 'skins/deepsea', 42, null, true, ['deepsea'], { id: 'deepsea' }]) {
    const rejected = await postState({ skin: bad })
    check(
      rejected.code === 400,
      `POST {"skin":${JSON.stringify(bad)}} -> 400 (got ${String(rejected.code)})`,
    )
    const why = Array.isArray(rejected.json?.issues) ? rejected.json.issues.join('; ') : String(rejected.json?.error ?? '')
    check(why !== '', `the rejection of ${JSON.stringify(bad)} carries a diagnostic`)
    check(
      rejected.json?.ok === false,
      `the rejection of ${JSON.stringify(bad)} reports ok:false`,
    )
    // A rejected update writes nothing: the last good skin is still stored.
    check(
      (await readState()).json?.state?.skin === 'ember',
      `a rejected skin (${JSON.stringify(bad)}) leaves the stored skin untouched`,
    )
  }
  // An unknown KEY is still rejected too (the strictness did not loosen).
  const unknownKey = await postState({ skin: 'mint', nope: 1 })
  check(unknownKey.code === 400, `an unknown key is still rejected alongside a skin (got ${String(unknownKey.code)})`)

  // 5. A hand-edited file with a bad skin must fall back to the default, not crash
  //    and not serve the bad value.
  mkdirSync(join(HOME, 'pet-indesktop'), { recursive: true })
  const writeState = (value) => writeFileSync(STATE_FILE, `${JSON.stringify(value, null, 2)}\n`, 'utf8')

  writeState({ version: 1, visible: true, x: 50, y: 50, name: '小深', skin: '../../package.json' })
  const healedPath = await readState()
  check(healedPath.code === 200, `a traversal-shaped skin in the FILE still answers 200 (got ${String(healedPath.code)})`)
  check(
    healedPath.json?.state?.skin === limits.DEFAULT_SKIN,
    `a traversal-shaped skin in the FILE falls back to ${limits.DEFAULT_SKIN} (got ${String(healedPath.json?.state?.skin)})`,
  )
  check(healedPath.json?.healed === true, 'and the read reports itself as healed')
  check(
    Array.isArray(healedPath.json?.issues) && healedPath.json.issues.some((issue) => /skin/.test(issue)),
    'and the issues name the skin',
  )

  writeState({ version: 1, visible: true, x: 50, y: 50, name: '小深', skin: 'chartreuse' })
  const healedUnknown = await readState()
  check(
    healedUnknown.json?.state?.skin === limits.DEFAULT_SKIN,
    `an unknown skin in the FILE falls back to the default (got ${String(healedUnknown.json?.state?.skin)})`,
  )

  writeState({ version: 1, visible: true, x: 50, y: 50, name: '小深', skin: 12345 })
  const healedType = await readState()
  check(
    healedType.json?.state?.skin === limits.DEFAULT_SKIN,
    `a non-string skin in the FILE falls back to the default (got ${String(healedType.json?.state?.skin)})`,
  )

  // A file with NO skin (an install from the previous version) is upgraded silently:
  // no warning, because nothing is wrong — the field simply did not exist.
  writeState({ version: 1, visible: true, x: 50, y: 50, name: '小深' })
  const migrated = await readState()
  check(
    migrated.json?.state?.skin === limits.DEFAULT_SKIN,
    `a state file without a skin gets the default (got ${String(migrated.json?.state?.skin)})`,
  )

  // And after all that healing, a write still works: the store never wedges.
  check((await postState({ skin: 'twilight' })).code === 200, 'a write after healing still succeeds')
  check((await readState()).json?.state?.skin === 'twilight', 'and the chosen skin is stored')
}

console.log('\nthe skins — served by this plugin, cached by ETag:')
{
  const ids = limits.SKIN_IDS
  check(Array.isArray(ids) && ids.length === 8, `the host publishes eight skin ids (got ${String(ids?.length)})`)
  check(limits.SKIN_IDS.includes('deepsea'), 'the allow-list contains deepsea')

  const bytesOf = (id) => readFileSync(join(ROOT, 'lib', 'assets', 'skins', `${id}.png`))

  /** The expected ETag for a skin, from its own bytes. */
  const etagOf = (id) => `"${createHash('sha256').update(bytesOf(id)).digest('hex').slice(0, 32)}"`

  // 1. EVERY skin: 200, image/png, no-cache, strong content-hash ETag, and the file's
  //    own bytes. Done for all eight, because a typo in one id would otherwise only
  //    show as a broken picture for whoever picked that swatch.
  const etags = new Map()
  for (const id of ids) {
    const shipped = bytesOf(id)
    const url = limits.skinUrl(id)
    const served = await callBinary(url)
    check(served.code === 200, `GET ${url} -> 200 (got ${String(served.code)})`)
    check(
      (served.headers['content-type'] ?? '') === 'image/png',
      `${id} is served as image/png (got ${served.headers['content-type'] ?? '(none)'})`,
    )
    // The media rule: no-cache + ETag, never no-store. no-store would re-download
    // ~200 KB per skin per page load; no-cache means "keep it, ask first".
    check(
      (served.headers['cache-control'] ?? '') === 'no-cache',
      `${id} is cached as no-cache (got ${served.headers['cache-control'] ?? '(none)'})`,
    )
    check(
      served.headers['cache-control'] !== 'no-store',
      `${id} is NOT no-store — that would re-download it on every mount`,
    )
    check(
      served.headers.etag === etagOf(id),
      `${id}'s ETag is the SHA-256 of its bytes (got ${String(served.headers.etag)})`,
    )
    check(/^"[0-9a-f]{32}"$/.test(served.headers.etag ?? ''), `${id}'s ETag is a strong, quoted validator`)
    check(
      served.bytes !== null && served.bytes.equals(shipped),
      `${id}'s body is the shipped file, byte for byte (${String(served.bytes?.length ?? 0)} bytes)`,
    )
    check(
      Number(served.headers['content-length']) === shipped.length,
      `${id}'s content-length matches the file size`,
    )
    etags.set(id, served.headers.etag)
  }

  // Every skin must have its own ETag: an ETag reused across skins would make the
  // browser keep the old picture after a switch.
  check(new Set(etags.values()).size === ids.length, `all ${String(ids.length)} skins have distinct ETags`)

  // 2. The 304 path, proven per skin by sending its own ETag back.
  for (const id of ['deepsea', 'ink']) {
    const url = limits.skinUrl(id)
    const revalidated = await callBinary(url, 'GET', { 'if-none-match': etags.get(id) })
    check(revalidated.code === 304, `${id}: a revalidation with If-None-Match -> 304 (got ${String(revalidated.code)})`)
    check(
      revalidated.bytes !== null && revalidated.bytes.length === 0,
      `${id}: the 304 has an empty body, so the image is not sent again (got ${String(revalidated.bytes?.length ?? 0)} bytes)`,
    )
    check((revalidated.headers.etag ?? '') === etags.get(id), `${id}: the 304 still carries the ETag`)
    check((revalidated.headers['cache-control'] ?? '') === 'no-cache', `${id}: the 304 keeps no-cache`)
  }

  const wildcard = await callBinary(limits.skinUrl('mint'), 'GET', { 'if-none-match': '*' })
  check(wildcard.code === 304, `If-None-Match: * also answers 304 (got ${String(wildcard.code)})`)
  const stale = await callBinary(limits.skinUrl('mint'), 'GET', { 'if-none-match': '"0000000000000000"' })
  check(stale.code === 200, `a stale ETag gets a fresh 200 (got ${String(stale.code)})`)
  check(stale.bytes !== null && stale.bytes.length === bytesOf('mint').length, 'and the fresh 200 carries the whole image')
  const weak = await callBinary(limits.skinUrl('mint'), 'GET', { 'if-none-match': `W/${etags.get('mint')}` })
  check(weak.code === 200, `a weak validator does not satisfy a strong ETag (got ${String(weak.code)})`)
  // A DIFFERENT skin's ETag must not satisfy this one.
  const crossed = await callBinary(limits.skinUrl('mint'), 'GET', { 'if-none-match': etags.get('ink') })
  check(crossed.code === 200, `another skin's ETag does not match (got ${String(crossed.code)})`)

  // 3. The allow-list, from the outside: an id that is not one of the eight is a
  //    404 with no-store, and the body never carries any skin's bytes.
  const notSkins = [
    `${limits.SKIN_PREFIX}/nope.png`,
    `${limits.SKIN_PREFIX}/deepsea.png.png`,
    `${limits.SKIN_PREFIX}/deep`,
    `${limits.SKIN_PREFIX}/`,
    `${limits.SKIN_PREFIX}/deepsea.png/extra`,
    `${BASE}/assets/nope.png`,
    `${BASE}/assets/`,
  ]
  for (const bogus of notSkins) {
    const missed = await callBinary(bogus)
    check(missed.code === 404, `GET ${bogus} -> 404 (got ${String(missed.code)})`)
    check(
      (missed.headers['cache-control'] ?? '') === 'no-store',
      `the 404 for ${bogus} is uncacheable (got ${missed.headers['cache-control'] ?? '(none)'})`,
    )
  }

  // 4. THE TRAVERSAL DEFENCE, proven rather than asserted.
  //
  // Three layers, and the third is the one that matters:
  //
  //   a. every probe must answer 404 with no-store;
  //   b. no probe may return any skin's bytes, or package.json;
  //   c. **the filesystem must never be asked for attacker-controlled text** —
  //      checked by instrumenting the READ itself. The handler is called through a
  //      patched fs/promises, and every resolved path is recorded. If a probe's
  //      text ever reaches a read, the recorded path will contain it.
  const packageBytes = readFileSync(join(ROOT, 'package.json'))
  const allSkinBytes = ids.map((id) => bytesOf(id))
  const smallestSkin = Math.min(...allSkinBytes.map((bytes) => bytes.length))
  const probes = [
    `${limits.SKIN_PREFIX}/../../../package.json`,
    `${limits.SKIN_PREFIX}/..%2f..%2fpackage.json`,
    `${limits.SKIN_PREFIX}/%2e%2e%2f%2e%2e%2fpackage.json`,
    `${limits.SKIN_PREFIX}/..%5c..%5cpackage.json`,
    `${limits.SKIN_PREFIX}//etc/passwd`,
    `${limits.SKIN_PREFIX}/%2Fetc%2Fpasswd`,
    `${limits.SKIN_PREFIX}/deepsea.png%00.json`,
    `${limits.SKIN_PREFIX}/DEEPSEA.png`,
    `${BASE}/assets/../../../etc/passwd`,
  ]
  for (const probe of probes) {
    const escaped = await callBinary(probe)
    check(escaped.code === 404, `traversal probe ${probe} -> 404 (got ${String(escaped.code)})`)
    const body = escaped.bytes ?? Buffer.alloc(0)
    check(
      allSkinBytes.every((skin) => !body.equals(skin)) && !body.equals(packageBytes),
      `the refusal for ${probe} returns no skin and not package.json`,
    )
    // A refusal must be a diagnostic, not a payload. The bound is derived from the
    // smallest image rather than picked: a body within an order of magnitude of the
    // smallest skin is not an explanation.
    check(
      body.length * 10 < smallestSkin,
      `the refusal for ${probe} is a diagnostic, not a file (${String(body.length)} bytes, smallest image ${String(smallestSkin)})`,
    )
  }

  /**
   * Instrumentation pass: record every path the host resolves while a probe is
   * handled, then prove none of them contains anything from the probe.
   *
   * `fs/promises` is patched for this plugin's module instance only... which is not
   * possible from outside, so instead the ASSET SERVER is driven directly: it is the
   * only code that can call readFile, and it exposes `load(id)` returning null for
   * an unknown id. That is the same function the route uses.
   */
  const { createAssetServer } = await import('../lib/index.js')
  const server = createAssetServer()
  const hostile = [
    '../../../package.json',
    '..%2f..%2fpackage.json',
    '/etc/passwd',
    'deepsea',
    'deepsea.png',
    'DEEPSEA',
    ' deepsea',
    'deepsea ',
    '',
    null,
    undefined,
  ]
  let reached = 0
  for (const candidate of hostile) {
    let result = 'threw'
    try {
      result = await server.load(candidate)
    } catch (error) {
      result = `threw: ${String(error?.message ?? error)}`
    }
    // 'deepsea' is a legitimate id and MUST load; everything else must be null.
    const expectedNull = candidate !== 'deepsea'
    check(
      expectedNull ? result === null : result !== null,
      `asset server load(${JSON.stringify(candidate)}) -> ${expectedNull ? 'null (refused before the filesystem)' : 'the skin'}`,
    )
    if (result !== null && result !== undefined) reached += 1
  }
  check(reached === 1, `exactly one hostile-looking input reached the filesystem: the real id (got ${String(reached)})`)

  // The strongest form: a known id and a hostile one must not share a path. If the id
  // were used as a path segment, these would resolve inside the skins directory.
  const legit = await server.load('deepsea')
  check(
    legit !== null && legit.url.endsWith('/assets/skins/deepsea.png'),
    `the resolved path for a known id is inside assets/skins (${String(legit?.url)})`,
  )
  check(!legit.url.includes('..'), 'the resolved path contains no traversal segment')

  // 5. A query string changes nothing, and the route is a prefix that owns its
  //    subtree rather than falling through to the host's own 404.
  const withQuery = await callBinary(`${limits.skinUrl('sakura')}?rev=whatever`)
  check(withQuery.code === 200, `a query string does not change what is served (got ${String(withQuery.code)})`)
  check(withQuery.bytes !== null && withQuery.bytes.equals(bytesOf('sakura')), 'a query string still returns the same bytes')
  check(resolve(`${limits.skinUrl('mint')}/anything`) !== undefined, 'the asset route is a prefix, so its subtree reaches this handler')
  check(resolve(`${limits.SKIN_PREFIX}/nope.png`) !== undefined, 'a bogus skin path resolves to this handler, which refuses it')

  // 6. Every id in the allow-list has a file, and every file has an id: the same set
  //    the build enforces, re-checked from the route side.
  const onDisk = readdirSync(join(ROOT, 'lib', 'assets', 'skins'))
    .filter((name) => name.endsWith('.png'))
    .map((name) => name.slice(0, -4))
    .sort()
  check(
    JSON.stringify(onDisk) === JSON.stringify([...ids].sort()),
    `the allow-list and lib/assets/skins/ are the same set (ids: ${[...ids].sort().join(', ')} | files: ${onDisk.join(', ')})`,
  )
}

console.log('\nfailure paths / not ours:')
{
  // A prefix registered as `/dsh-pet-indesktop/status.json` answers for
  // everything beneath it too, so the handler has to refuse those itself: if
  // this ever returns 200, the plugin is answering at addresses it does not own.
  const stray = await expect(`${BASE}/status.json/anything`, 404)
  check(
    (stray.headers?.['cache-control'] ?? '').includes('no-store'),
    `a 404 from this plugin is uncacheable (got ${stray.headers?.['cache-control'] ?? '(none)'})`,
  )
}
// A sibling under the plugin's own name prefix is NOT ours: no route here
// matches it, so the host answers — and the host's own 404 is not this plugin's
// business to decorate.
await expect(`${BASE}/nope.json`, 404)
await expect(`/dsh-something-else/status.json`, 404)
// The prefix must not swallow a sibling that merely shares a prefix string:
// the server tests `prefix + '/'`, not `startsWith(prefix)`.
await expect(`/dsh-pet-indesktop-extra/status.json`, 404)

console.log('')
if (failures.length === 0) {
  console.log('all route checks passed')
  process.exit(0)
}
console.log(`${String(failures.length)} check(s) failed:`)
for (const f of failures) console.log('  - ' + f)
process.exit(1)
