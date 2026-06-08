import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

const templateRoot = resolve(import.meta.dirname, '../../template')
const templateSyncScript = resolve(import.meta.dirname, '../../../../scripts/template-sync.ts')

test('standalone template keeps app and worker Railway deploy contracts separate', () => {
  const appConfig = readFileSync(resolve(templateRoot, 'railway.toml'), 'utf8')
  const workerConfig = readFileSync(resolve(templateRoot, 'railway.worker.toml'), 'utf8')

  assert.match(appConfig, /healthcheckPath = "\/api\/healthz"/)
  assert.match(appConfig, /railway-start\.sh/)
  assert.doesNotMatch(workerConfig, /healthcheckPath/)
  assert.match(workerConfig, /railway-worker\.sh/)
})

test('standalone template excludes deployment secrets from local Railway uploads', () => {
  const ignore = readFileSync(resolve(templateRoot, '.railwayignore'), 'utf8')

  for (const requiredEntry of [
    '.env',
    '*.pem',
    '*.key',
    'id_rsa',
    'id_ed25519',
    '.git/',
    '.railway/',
    'node_modules/',
    '.yarn/cache/',
    '*.db',
    '*.sqlite',
    '*.sqlite3',
  ]) {
    assert.match(ignore, new RegExp(requiredEntry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
})

test('template sync preserves Railway-only healthcheck routes', () => {
  const source = readFileSync(templateSyncScript, 'utf8')

  assert.match(source, /app\/api\/healthz\/route\.ts/)
  assert.match(source, /app\/api\/healthz\/__tests__\/route\.test\.ts/)
})
