/**
 * Checks that no package appears at conflicting major versions in production `dependencies`
 * across workspace package.json files.
 *
 * Run with: yarn check:dep-versions
 *
 * Background: with Yarn node-modules hoisting, a mismatch in major versions between a full dev
 * install and a production-focused install (`yarn workspaces focus --production`) can cause
 * different versions to be hoisted, leading to runtime errors in Docker that don't reproduce
 * locally. This script catches such drift before it reaches the CI/Docker build.
 *
 * Only production `dependencies` are checked — devDependencies and peerDependencies are excluded
 * because they cannot cause Docker hoisting issues.
 */

import fs from 'fs'
import { globSync } from 'glob'

// Exclude apps that are not part of the production Docker image (e.g. docs site)
const WORKSPACE_PATTERNS = ['package.json', 'packages/*/package.json', 'apps/mercato/package.json']

function majorOf(version: string): string | null {
  const cleaned = version.replace(/^[\^~>=<\s]+/, '').trim()
  const match = cleaned.match(/^(\d+)/)
  return match ? match[1] : null
}

function collectVersions(): Map<string, Map<string, string[]>> {
  // package → major → [sources]
  const index = new Map<string, Map<string, string[]>>()

  for (const pattern of WORKSPACE_PATTERNS) {
    const files = globSync(pattern, { cwd: process.cwd() })
    for (const file of files) {
      const raw = JSON.parse(fs.readFileSync(file, 'utf-8'))
      const deps: Record<string, string> = raw['dependencies'] ?? {}

      for (const [pkg, version] of Object.entries(deps)) {
        if (version.startsWith('workspace:')) continue
        const major = majorOf(version)
        if (!major) continue

        if (!index.has(pkg)) index.set(pkg, new Map())
        const majors = index.get(pkg)!
        if (!majors.has(major)) majors.set(major, [])
        majors.get(major)!.push(`${file} (${version})`)
      }
    }
  }

  return index
}

const index = collectVersions()
let failed = false

for (const [pkg, majors] of index.entries()) {
  if (majors.size <= 1) continue

  failed = true
  console.error(`\n✖ Major version conflict in production dependencies: ${pkg}`)
  for (const [major, sources] of majors.entries()) {
    console.error(`  v${major}:`)
    for (const src of sources) console.error(`    - ${src}`)
  }
}

if (failed) {
  console.error(
    '\nFix: align all usages to the same major version across workspaces.\n' +
      'If a conflict is unavoidable, add a "resolutions" entry in root package.json to pin the version.',
  )
  process.exit(1)
} else {
  console.log('✔ No major version conflicts found in production dependencies.')
}
