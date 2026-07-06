import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

// Regression guard for issue #2402: `yarn test` peak memory fan-out must stay
// bounded below the `yarn dev` budget. The bound is enforced by three pinned
// factors — turbo test concurrency, per-package jest `maxWorkers`, and a V8
// old-space cap on the test path. These tests fail if any factor is removed.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const require = createRequire(import.meta.url)

const MAX_WORKERS_BOUND = 2

function findJestConfigs() {
  const roots = [path.join(REPO_ROOT, 'packages'), path.join(REPO_ROOT, 'apps')]
  const found = []
  for (const root of roots) {
    if (!fs.existsSync(root)) continue
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const cfg = path.join(root, entry.name, 'jest.config.cjs')
      if (fs.existsSync(cfg)) found.push(cfg)
    }
  }
  return found
}

test('a shared jest base config exists with bounded worker memory knobs', () => {
  const basePath = path.join(REPO_ROOT, 'jest.config.base.cjs')
  assert.ok(fs.existsSync(basePath), 'jest.config.base.cjs must exist at repo root')
  const base = require(basePath)
  assert.ok(
    typeof base.maxWorkers === 'number' && base.maxWorkers <= MAX_WORKERS_BOUND,
    `base maxWorkers must be a number <= ${MAX_WORKERS_BOUND}, got ${base.maxWorkers}`,
  )
  assert.ok(
    typeof base.workerIdleMemoryLimit === 'string' && base.workerIdleMemoryLimit.length > 0,
    'base must set workerIdleMemoryLimit so bloated workers are recycled',
  )
})

test('every package jest config inherits the bounded worker caps', () => {
  const configs = findJestConfigs()
  assert.ok(configs.length >= 18, `expected the full set of package jest configs, found ${configs.length}`)
  for (const cfg of configs) {
    const resolved = require(cfg)
    const rel = path.relative(REPO_ROOT, cfg)
    assert.ok(
      typeof resolved.maxWorkers === 'number' && resolved.maxWorkers <= MAX_WORKERS_BOUND,
      `${rel}: maxWorkers must be <= ${MAX_WORKERS_BOUND}, got ${resolved.maxWorkers}`,
    )
    assert.ok(
      typeof resolved.workerIdleMemoryLimit === 'string' && resolved.workerIdleMemoryLimit.length > 0,
      `${rel}: must inherit workerIdleMemoryLimit from the shared base`,
    )
  }
})

test('the root test script caps turbo concurrency and the V8 heap', () => {
  const pkg = require(path.join(REPO_ROOT, 'package.json'))
  const script = pkg.scripts.test
  assert.ok(script, 'root package.json must define a test script')
  assert.match(
    script,
    /--concurrency=\d+/,
    'root test script must cap turbo test concurrency (e.g. --concurrency=4)',
  )
  const concurrency = Number(script.match(/--concurrency=(\d+)/)[1])
  assert.ok(concurrency <= 8, `turbo test concurrency must stay small, got ${concurrency}`)
  assert.match(
    script,
    /--max-old-space-size=\d+/,
    'root test script must pin a V8 old-space cap on the test path',
  )
})
