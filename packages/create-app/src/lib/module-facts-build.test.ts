import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const D5_MODULES = [
  'auth',
  'catalog',
  'currencies',
  'customer_accounts',
  'customers',
  'data_sync',
  'integrations',
  'sales',
  'workflows',
]

const pkgRoot = fileURLToPath(new URL('../../', import.meta.url))
const guidesDir = join(pkgRoot, 'dist', 'agentic', 'guides')

function ensureBuilt() {
  if (!fs.existsSync(join(guidesDir, 'modules'))) {
    execSync('node build.mjs', { cwd: pkgRoot, stdio: 'ignore' })
  }
}

test('build emits the customers fact-sheet and the combined module-facts.json (T5)', () => {
  ensureBuilt()
  assert.ok(fs.existsSync(join(guidesDir, 'modules', 'customers.md')), 'customers.md fact-sheet should exist')
  assert.ok(fs.existsSync(join(guidesDir, 'module-facts.json')), 'module-facts.json sidecar should exist')
  const facts = JSON.parse(fs.readFileSync(join(guidesDir, 'module-facts.json'), 'utf8'))
  assert.ok(facts.customers, 'module-facts.json should contain the customers entry')
})

test('build emits a fact-sheet for every allowlisted D5 module (T5)', () => {
  ensureBuilt()
  for (const moduleId of D5_MODULES) {
    assert.ok(
      fs.existsSync(join(guidesDir, 'modules', `${moduleId}.md`)),
      `${moduleId}.md fact-sheet should exist`,
    )
  }
})

test('build keeps the 9 legacy core.<module>.md names bundled (BC bridge, T5)', () => {
  ensureBuilt()
  for (const moduleId of D5_MODULES) {
    assert.ok(
      fs.existsSync(join(guidesDir, `core.${moduleId}.md`)),
      `core.${moduleId}.md should be present (full guide before cleanup, redirect stub after)`,
    )
  }
})
