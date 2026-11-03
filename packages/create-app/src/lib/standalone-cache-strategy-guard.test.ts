import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createStandaloneIntegrationEnvironment } from '../../../../scripts/lib/standalone-integration-env.mjs'

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

function collectSqlitePaths(source: string): string[] {
  const matches = source.matchAll(/CACHE_SQLITE_PATH['"]?\s*[:=]\s*['"]?([^\s'"]+)/g)
  return Array.from(matches, (match) => match[1])
}

function assertWorkflowUsesSharedCache(relativePath: string): void {
  const workflow = readRepoFile(relativePath)
  if (relativePath === '.github/workflows/snapshot.yml') {
    assert.match(workflow, /scripts\/ci\/standalone-integration\.mjs/)
    assertSharedProfileCache()
    return
  }
  const values = collectCacheStrategyValues(workflow)
  assert.equal(
    values.length,
    2,
    `${relativePath} must pin CACHE_STRATEGY once for the standalone app .env and once for the integration-test step`,
  )
  for (const value of values) {
    assert.ok(
      CROSS_PROCESS_STRATEGIES.has(value),
      `${relativePath} sets CACHE_STRATEGY=${value}; the standalone lane drains queue jobs in child processes and requires a cross-process strategy (${Array.from(CROSS_PROCESS_STRATEGIES).join(', ')})`,
    )
  }

  const sqlitePaths = collectSqlitePaths(workflow)
  assert.deepEqual(
    sqlitePaths,
    [
      '/tmp/standalone-app/.mercato/cache/cache.db',
      '/tmp/standalone-app/.mercato/cache/cache.db',
    ],
    `${relativePath} must give the standalone server and queue-drain child processes the same absolute sqlite path`,
  )
}

function assertSharedProfileCache(): void {
  const { appEnv, testEnv } = createStandaloneIntegrationEnvironment({
    appDir: '/tmp/standalone-app', repoRoot: REPO_ROOT,
    baseUrl: 'http://localhost:3001', databaseUrl: 'postgres://fixture/fixture',
  })
  assert.ok(CROSS_PROCESS_STRATEGIES.has(appEnv.CACHE_STRATEGY))
  assert.equal(testEnv.CACHE_STRATEGY, appEnv.CACHE_STRATEGY)
  assert.equal(appEnv.CACHE_SQLITE_PATH, '/tmp/standalone-app/.mercato/cache/cache.db')
  assert.equal(testEnv.CACHE_SQLITE_PATH, appEnv.CACHE_SQLITE_PATH)
}

test('published standalone workflows share cache state across server and drain processes', () => {
  for (const relativePath of [
    '.github/workflows/snapshot.yml',
    '.github/workflows/npm-snapshot-preview.yml',
  ]) {
    assertWorkflowUsesSharedCache(relativePath)
  }
})

test('local standalone integration script uses a cross-process cache strategy', () => {
  const script = readRepoFile('scripts/test-create-app-integration.ts')
  assert.match(script, /createStandaloneIntegrationEnvironment\(\{/)
  assert.match(script, /\.\.\.appEnv/)
  assert.match(script, /\.\.\.testEnv/)
  assertSharedProfileCache()
})
