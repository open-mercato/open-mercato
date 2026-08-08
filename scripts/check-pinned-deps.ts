/**
 * Ensures all dependency versions in workspace package.json files are pinned
 * to exact versions — no ^ (caret) or ~ (tilde) range prefixes allowed.
 *
 * Run with: yarn check:pinned-deps
 *
 * Background: version ranges create supply-chain exposure windows. Even with a
 * committed lockfile, ranges allow silent drift during `yarn add` / lockfile
 * regeneration. Exact pinning makes every version bump an explicit, reviewable
 * change.
 */

import fs from 'fs'
import { globSync } from 'glob'

const WORKSPACE_PATTERNS = [
  'package.json',
  'packages/*/package.json',
  'apps/*/package.json',
]

const DEP_SECTIONS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const

const RANGE_PREFIX = /^[\^~]/

let violations = 0

for (const pattern of WORKSPACE_PATTERNS) {
  const files = globSync(pattern, { cwd: process.cwd() })
  for (const file of files) {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'))

    for (const section of DEP_SECTIONS) {
      const deps: Record<string, string> | undefined = raw[section]
      if (!deps) continue

      for (const [pkg, version] of Object.entries(deps)) {
        if (version.startsWith('workspace:')) continue
        if (RANGE_PREFIX.test(version)) {
          console.error(`  ✖ ${file} → ${section}.${pkg}: "${version}" (range prefix not allowed)`)
          violations++
        }
      }
    }
  }
}

if (violations > 0) {
  console.error(
    `\n✖ Found ${violations} dependency version(s) with range prefixes (^ or ~).` +
      '\n  All versions must be pinned to exact values for supply-chain safety.' +
      '\n  Fix: remove the ^ or ~ prefix from each flagged entry.\n',
  )
  process.exit(1)
} else {
  console.log('✔ All dependency versions are pinned to exact values.')
}
