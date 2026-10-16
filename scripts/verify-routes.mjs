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
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { apply, inject, name } from '../lib/index.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const BASE = '/dsh-pet-indesktop'

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
