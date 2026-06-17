import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

const templateRoot = resolve(import.meta.dirname, '../../template')
const templateSyncScript = resolve(import.meta.dirname, '../../../../scripts/template-sync.ts')

function matchesDirectoryIgnoreRule(rule: string, sourcePath: string): boolean {
  const directoryRule = rule.endsWith('/')
  if (!directoryRule || rule.startsWith('!')) return false

  const normalizedRule = rule.replace(/^\/+|\/+$/g, '')
  if (!normalizedRule) return false

  if (rule.startsWith('/')) {
    return sourcePath === normalizedRule || sourcePath.startsWith(`${normalizedRule}/`)
  }

  return sourcePath.split('/').includes(normalizedRule)
}

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

test('standalone template does not exclude app module data source files from local Railway uploads', () => {
  const ignoreLines = readFileSync(resolve(templateRoot, '.railwayignore'), 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))

  assert.ok(ignoreLines.includes('/data/'))
  assert.ok(ignoreLines.includes('/storage/'))
  assert.equal(ignoreLines.includes('data/'), false)
  assert.equal(ignoreLines.includes('storage/'), false)

  for (const sourceFile of [
    'src/modules/example/data/entities.ts',
    'src/modules/example/data/validators.ts',
    'src/modules/example_customers_sync/data/entities.ts',
    'src/modules/example_customers_sync/data/validators.ts',
  ]) {
    assert.doesNotThrow(() => readFileSync(resolve(templateRoot, sourceFile), 'utf8'))
    assert.equal(ignoreLines.some((line) => matchesDirectoryIgnoreRule(line, sourceFile)), false, sourceFile)
  }

  assert.equal(ignoreLines.some((line) => matchesDirectoryIgnoreRule(line, 'data/local.db')), true)
  assert.equal(ignoreLines.some((line) => matchesDirectoryIgnoreRule(line, 'storage/uploads/file.bin')), true)
})

test('template sync preserves Railway-only healthcheck routes', () => {
  const source = readFileSync(templateSyncScript, 'utf8')

  assert.match(source, /app\/api\/healthz\/route\.ts/)
  assert.match(source, /app\/api\/healthz\/__tests__\/route\.test\.ts/)
})
