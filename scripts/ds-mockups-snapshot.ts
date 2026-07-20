/**
 * `yarn ds:mockups:snapshot <slug> <label>` — copies the current mockup
 * document to `.ai/mockups/versions/<slug>@<label>.mockup.json` (spec
 * `.ai/specs/2026-07-05-ds-live-mockup-composer.md`, Phase 2). Snapshots are
 * ordinary schema-valid files covered by the design_system registry-integrity
 * test; view a delta at
 * `/backend/design-system/mockups/<slug>?compare=<label>`.
 */
import { createSnapshot } from '../packages/core/src/modules/design_system/mockups/snapshots'
import { findRepoRoot, getMockupBySlug } from '../packages/core/src/modules/design_system/mockups/loader'

function fail(message: string): never {
  console.error(`ds:mockups:snapshot: ${message}`)
  process.exit(1)
}

const [slug, label] = process.argv.slice(2)
if (!slug || !label) fail('usage: yarn ds:mockups:snapshot <slug> <label>')

const repoRoot = findRepoRoot(__dirname)
if (!repoRoot) fail('could not locate the repo root (yarn.lock not found)')

const mockup = getMockupBySlug(slug, repoRoot)
if (!mockup) fail(`no mockup with slug "${slug}" — check .ai/mockups and module mockups folders`)

const result = createSnapshot(slug, label, repoRoot)
if (!result.ok) fail(result.error)

console.log(`Snapshot created: ${result.filePath}`)
console.log(`Compare it at /backend/design-system/mockups/${slug}?compare=${result.label}`)
