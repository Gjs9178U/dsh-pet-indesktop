/**
 * check-css-template.mjs — fail loudly if the CSS sheet is broken in the one way
 * that is easy to do and hard to read.
 *
 * The plugin's stylesheet lives in a template literal inside the client half. A
 * single backtick inside its comments ends that literal early, and the damage
 * does not look like a CSS problem at the point of failure: the loader reports a
 * JavaScript parse error pointing at a CSS line, and a stale lib/client.js is
 * left in place, so the change silently does not ship.
 *
 * That happened twice in the sibling plugin (dsh-boot-animation), once reaching
 * a commit. This check names the real problem in one line, before anything else
 * gets a chance to mislead.
 *
 * It checks BOTH copies of the sheet: src/client/index.js is the source of truth
 * and lib/client.js is what actually reaches the browser (the build copies the
 * former to the latter and prepends a banner), and a guard that read only one of
 * them would happily bless a sheet nobody loads.
 *
 * Usage: node scripts/check-css-template.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

const TARGETS = [
  join(ROOT, 'src', 'client', 'index.js'),
  join(ROOT, 'lib', 'client.js'),
]

const failures = []

for (const target of TARGETS) {
  let text
  try {
    text = readFileSync(target, 'utf8')
  } catch {
    failures.push(`${target}: missing (cannot check it)`)
    continue
  }

  const lines = text.split(/\r?\n/)
  let inside = false
  let opened = 0
  const problems = []

  lines.forEach((line, index) => {
    const at = index + 1
    if (!inside) {
      if (/^\s*export const CSS = `\s*$/.test(line) || /^\s*const CSS = `\s*$/.test(line)) {
        inside = true
        opened += 1
      }
      return
    }
    // A line that is only a backtick (plus whitespace) closes the sheet.
    if (/^\s*`\s*;?\s*$/.test(line)) {
      inside = false
      return
    }
    if (line.includes('`')) problems.push(`${at}: ${line.trim()}`)
  })

  const label = target.slice(ROOT.length + 1)
  if (inside) {
    failures.push(`${label}: the CSS template literal is never closed`)
    continue
  }
  if (opened === 0) {
    failures.push(`${label}: no \`const CSS = \` line found — the sheet moved and this guard is blind`)
    continue
  }
  if (problems.length > 0) {
    console.error(`check-css-template: backtick inside the CSS template literal in ${label}.`)
    console.error('The sheet is a template literal, so a backtick in a comment ends it early')
    console.error('and the loader will report a confusing parse error on a CSS line.')
    for (const p of problems) console.error('  ' + p)
    failures.push(`${label}: ${String(problems.length)} stray backtick(s)`)
    continue
  }
  console.log(`  ok   ${label} (CSS sheet intact, no stray backticks)`)
}

if (failures.length > 0) {
  console.error('check-css-template: FAILED')
  for (const f of failures) console.error('  - ' + f)
  process.exit(1)
}

console.log('check-css-template: ok (no stray backticks in the CSS sheet)')
