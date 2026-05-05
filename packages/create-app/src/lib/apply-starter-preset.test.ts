import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { resolvePreset, generateModulesTs, applyStarterPreset } from './apply-starter-preset.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// resolvePreset tests

test('resolvePreset: classic returns isClassic=true and empty modules', () => {
  const result = resolvePreset('classic')
  assert.equal(result.isClassic, true)
  assert.equal(result.id, 'classic')
  assert.deepEqual(result.modules, [])
  assert.deepEqual(result.filesToRemove, [])
})

test('resolvePreset: empty returns 10-module list', () => {
  const result = resolvePreset('empty')
  assert.equal(result.isClassic, false)
  assert.equal(result.modules.length, 10)
  const ids = result.modules.map((m) => m.id)
  assert.deepEqual(ids, [
    'auth',
    'directory',
    'configs',
    'entities',
    'query_index',
    'api_docs',
    'audit_logs',
    'notifications',
    'dashboards',
    'events',
  ])
  assert.equal(result.modules.find((m) => m.id === 'events')?.from, '@open-mercato/events')
  assert.ok(result.modules.filter((m) => m.id !== 'events').every((m) => m.from === '@open-mercato/core'))
  assert.ok(result.filesToRemove.includes('src/modules/example'))
  assert.ok(result.filesToRemove.includes('src/modules/example_customers_sync'))
})

test('resolvePreset: crm returns 13-module list extending empty', () => {
  const result = resolvePreset('crm')
  assert.equal(result.isClassic, false)
  assert.equal(result.modules.length, 13)
  const ids = result.modules.map((m) => m.id)
  assert.ok(ids.includes('auth'))
  assert.ok(ids.includes('directory'))
  assert.ok(ids.includes('configs'))
  assert.ok(ids.includes('entities'))
  assert.ok(ids.includes('query_index'))
  assert.ok(ids.includes('api_docs'))
  assert.ok(ids.includes('audit_logs'))
  assert.ok(ids.includes('customers'))
  assert.ok(ids.includes('dictionaries'))
  assert.ok(ids.includes('feature_toggles'))
  assert.ok(ids.includes('notifications'))
  assert.ok(ids.includes('dashboards'))
  assert.ok(ids.includes('events'))
  // Inherits filesToRemove from empty
  assert.ok(result.filesToRemove.includes('src/modules/example'))
  assert.ok(result.filesToRemove.includes('src/modules/example_customers_sync'))
  // No duplicates
  const unique = new Set(ids)
  assert.equal(unique.size, ids.length)
})

test('resolvePreset: unknown preset throws', () => {
  assert.throws(() => resolvePreset('bogus'), /Unknown preset/)
})

// generateModulesTs tests

test('generateModulesTs: produces valid content for empty modules', () => {
  const emptyModules = resolvePreset('empty').modules
  const content = generateModulesTs(emptyModules)
  assert.ok(content.includes('parseBooleanWithDefault'))
  assert.ok(content.includes("id: 'auth'"))
  assert.ok(content.includes("id: 'api_docs'"))
  assert.ok(content.includes("id: 'audit_logs'"))
  assert.ok(content.includes("id: 'notifications'"))
  assert.ok(content.includes("id: 'dashboards'"))
  assert.ok(content.includes("id: 'events'"))
  assert.ok(content.includes("from: '@open-mercato/events'"))
  assert.ok(content.includes('enterpriseModulesEnabled'))
  assert.ok(!content.includes('example_customers_sync'))
  assert.ok(!content.includes("id: 'example'"))
  assert.ok(content.includes('export const enabledModules'))
  assert.ok(content.includes('export type ModuleEntry'))
})

test('generateModulesTs: produces valid content for crm modules', () => {
  const crmModules = resolvePreset('crm').modules
  const content = generateModulesTs(crmModules)
  assert.ok(content.includes("id: 'customers'"))
  assert.ok(content.includes("id: 'feature_toggles'"))
  assert.ok(content.includes("id: 'dictionaries'"))
  assert.ok(content.includes("id: 'notifications'"))
  assert.ok(content.includes("id: 'dashboards'"))
  assert.ok(content.includes("id: 'events'"))
  assert.ok(!content.includes('example_customers_sync'))
})

// applyStarterPreset filesystem tests

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'preset-test-'))
  // Set up minimal structure matching what scaffoldTemplateApp produces
  mkdirSync(join(dir, 'src', 'modules', 'example'), { recursive: true })
  mkdirSync(join(dir, 'src', 'modules', 'example_customers_sync'), { recursive: true })
  mkdirSync(join(dir, '.mercato'), { recursive: true })
  writeFileSync(join(dir, 'src', 'modules.ts'), '// original')
  return dir
}

test('applyStarterPreset: classic is a no-op', () => {
  const dir = makeTempDir()
  try {
    applyStarterPreset('classic', dir)
    const content = readFileSync(join(dir, 'src', 'modules.ts'), 'utf-8')
    assert.equal(content, '// original')
    assert.ok(existsSync(join(dir, 'src', 'modules', 'example')))
    assert.ok(!existsSync(join(dir, '.mercato', 'starter-preset.json')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('applyStarterPreset: empty writes 10-module modules.ts and removes example dirs', () => {
  const dir = makeTempDir()
  try {
    applyStarterPreset('empty', dir)
    const content = readFileSync(join(dir, 'src', 'modules.ts'), 'utf-8')
    assert.ok(content.includes("id: 'auth'"))
    assert.ok(content.includes("id: 'api_docs'"))
    assert.ok(content.includes("id: 'audit_logs'"))
    assert.ok(content.includes("id: 'notifications'"))
    assert.ok(content.includes("id: 'dashboards'"))
    assert.ok(content.includes("id: 'events'"))
    assert.ok(!content.includes("id: 'customers'"))
    assert.ok(!content.includes('example_customers_sync'))
    assert.ok(!existsSync(join(dir, 'src', 'modules', 'example')))
    assert.ok(!existsSync(join(dir, 'src', 'modules', 'example_customers_sync')))
    const marker = JSON.parse(readFileSync(join(dir, '.mercato', 'starter-preset.json'), 'utf-8'))
    assert.equal(marker.preset, 'empty')
    assert.ok(typeof marker.generatedAt === 'string')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('applyStarterPreset: crm writes 13-module modules.ts and removes example dirs', () => {
  const dir = makeTempDir()
  try {
    applyStarterPreset('crm', dir)
    const content = readFileSync(join(dir, 'src', 'modules.ts'), 'utf-8')
    assert.ok(content.includes("id: 'auth'"))
    assert.ok(content.includes("id: 'customers'"))
    assert.ok(content.includes("id: 'dictionaries'"))
    assert.ok(content.includes("id: 'feature_toggles'"))
    assert.ok(content.includes("id: 'notifications'"))
    assert.ok(content.includes("id: 'dashboards'"))
    assert.ok(content.includes("id: 'events'"))
    assert.ok(!content.includes('example_customers_sync'))
    assert.ok(!existsSync(join(dir, 'src', 'modules', 'example')))
    assert.ok(!existsSync(join(dir, 'src', 'modules', 'example_customers_sync')))
    const marker = JSON.parse(readFileSync(join(dir, '.mercato', 'starter-preset.json'), 'utf-8'))
    assert.equal(marker.preset, 'crm')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('template baseline modules keep example enabled for classic', () => {
  const content = readFileSync(join(__dirname, '..', '..', 'template', 'src', 'modules.ts'), 'utf-8')

  assert.ok(content.includes("id: 'example'"))
  assert.ok(content.includes("enabledModules.some((entry) => entry.id === 'example')"))
  assert.ok(content.includes("enabledModules.push({ id: 'example_customers_sync', from: '@app' })"))
})
