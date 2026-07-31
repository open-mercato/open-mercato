import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// The standalone integration lanes run the app server and the queue-drain
// helpers in SEPARATE processes (AUTO_SPAWN_WORKERS=false): mutations applied
// by a drained job can only invalidate the server's ENABLE_CRUD_API_CACHE
// entries when the cache store is shared across processes. A per-process
// `memory` strategy makes the server serve stale records forever after a
// drained job mutates them (TC-CRM-079 owner reassignment, TC-SX-001 import
// update). These guards fail the moment either lane regresses to a
// process-local cache strategy — or drops the strategy entirely, because the
// cache service defaults to `memory` when CACHE_STRATEGY is unset.

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..')

const CROSS_PROCESS_STRATEGIES = new Set(['sqlite', 'redis'])

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, ...relativePath.split('/')), 'utf8')
}

function collectCacheStrategyValues(source: string): string[] {
  const matches = source.matchAll(/CACHE_STRATEGY['"]?\s*[:=]\s*['"]?([a-z]+)['"]?/g)
  return Array.from(matches, (match) => match[1])
}

test('snapshot workflow standalone lane uses a cross-process cache strategy', () => {
  const workflow = readRepoFile('.github/workflows/snapshot.yml')
  const values = collectCacheStrategyValues(workflow)
  assert.ok(
    values.length >= 2,
    'snapshot.yml must pin CACHE_STRATEGY for both the standalone app .env and the integration-test step (drain child processes inherit the step env, not the app .env)',
  )
  for (const value of values) {
    assert.ok(
      CROSS_PROCESS_STRATEGIES.has(value),
      `snapshot.yml sets CACHE_STRATEGY=${value}; the standalone lane drains queue jobs in child processes and requires a cross-process strategy (${Array.from(CROSS_PROCESS_STRATEGIES).join(', ')})`,
    )
  }
})

test('local standalone integration script uses a cross-process cache strategy', () => {
  const script = readRepoFile('scripts/test-create-app-integration.ts')
  const values = collectCacheStrategyValues(script)
  assert.ok(
    values.length >= 2,
    'test-create-app-integration.ts must pin CACHE_STRATEGY for both the standalone app .env and the integration-test process env',
  )
  for (const value of values) {
    assert.ok(
      CROSS_PROCESS_STRATEGIES.has(value),
      `test-create-app-integration.ts sets CACHE_STRATEGY=${value}; the standalone lane drains queue jobs in child processes and requires a cross-process strategy (${Array.from(CROSS_PROCESS_STRATEGIES).join(', ')})`,
    )
  }
})
