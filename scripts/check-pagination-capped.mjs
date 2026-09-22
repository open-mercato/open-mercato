#!/usr/bin/env node
/**
 * Guard for #4552 Phase 3: every server-backed `pagination={{ … }}` DataTable
 * site must forward `totalIsCapped`, or a capped total renders as exact and
 * pagination silently ends at the floor. Client-side tables (deriving totals
 * from a locally filtered array) are allowlisted with a reason.
 *
 * Usage: node scripts/check-pagination-capped.mjs [--fail]
 * Modeled on scripts/check-client-boundaries.mjs.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SCAN_DIRS = ['packages', 'apps']
const SKIP = new Set(['node_modules', 'dist', '.next', '.turbo'])
const ALLOWLIST_PATH = join(ROOT, 'scripts', 'pagination-capped-allowlist.json')

const allowlist = new Map(
  JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf8')).map((entry) => [entry.file, entry.reason]),
)

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) yield* walk(full)
    else if (/\.(tsx|ts)$/.test(name) && !full.includes('__tests__')) yield full
  }
}

const offenders = []
let sites = 0
for (const dir of SCAN_DIRS) {
  for (const file of walk(join(ROOT, dir))) {
    const src = readFileSync(file, 'utf8')
    let idx = 0
    for (;;) {
      const at = src.indexOf('pagination={{', idx)
      if (at === -1) break
      sites += 1
      // Capture the balanced {{ … }} block.
      let depth = 0, end = at + 'pagination={'.length
      for (; end < src.length; end++) {
        if (src[end] === '{') depth += 1
        else if (src[end] === '}') { depth -= 1; if (depth === 0) break }
      }
      const block = src.slice(at, end + 1)
      const rel = relative(ROOT, file)
      const line = src.slice(0, at).split('\n').length
      if (!allowlist.has(rel)) {
        if (!block.includes('totalIsCapped')) {
          offenders.push({ at: `${rel}:${line}`, why: 'not forwarded to DataTable' })
        } else if (/const \[totalIsCapped,\s*setTotalIsCapped\]/.test(src) && !/setTotalIsCapped\s*\(/.test(src)) {
          // Forwarding a flag that nothing ever assigns is worse than not
          // forwarding it: the site reads as adopted, the guard reads green,
          // and the value is hard-`false`, so a capped list silently loses
          // every row past the floor. Presence is not wiring.
          offenders.push({ at: `${rel}:${line}`, why: 'declared and forwarded, but setTotalIsCapped is never called' })
        }
      }
      idx = end
    }
  }
}

console.log(`pagination={{ sites scanned: ${sites}; allowlisted files: ${allowlist.size}`)
if (offenders.length) {
  console.log(`\nUnwired capped-count sites (${offenders.length}):`)
  for (const o of offenders) console.log(`  ${o.at} — ${o.why}`)
  if (process.argv.includes('--fail')) process.exit(1)
} else {
  console.log('All server-backed pagination sites forward totalIsCapped, and assign it.')
}
