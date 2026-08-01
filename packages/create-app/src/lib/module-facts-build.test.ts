import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { selectModuleFactSheets } from '../setup/tools/shared.js'

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
const templateRoot = join(pkgRoot, 'template')
const LEGACY_PACKAGE_GUIDES = ['cache', 'core', 'events', 'queue', 'search', 'shared', 'ui']
let buildComplete = false

function ensureBuilt() {
  if (buildComplete) return
  execSync('node build.mjs', { cwd: pkgRoot, stdio: 'ignore' })
  buildComplete = true
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

test('every default-controller module fact is exercised by the evaluation catalog', () => {
  ensureBuilt()
  const moduleGuidesDir = join(guidesDir, 'modules')
  const selectedModuleIds = selectModuleFactSheets(templateRoot, moduleGuidesDir)
  const cases = JSON.parse(fs.readFileSync(
    join(pkgRoot, 'dist', 'agentic', 'shared', 'ai', 'harness', 'cases.json'),
    'utf8',
  )) as Array<{
    owner: { path: string }
    context: { required: string[]; allowedExtra?: string[] }
  }>
  const catalogReferences = new Set(cases.flatMap((caseRecord) => [
    caseRecord.owner.path,
    ...caseRecord.context.required,
    ...(caseRecord.context.allowedExtra ?? []),
  ]))
  const uncovered = selectedModuleIds
    .map((moduleId) => `.ai/guides/modules/${moduleId}.md`)
    .filter((guide) => !catalogReferences.has(guide))
    .sort()

  assert.deepEqual(uncovered, [], `module facts without an evaluation case:\n${uncovered.join('\n')}`)
})

test('build no longer emits legacy core.<module>.md redirect stubs (#3754)', () => {
  ensureBuilt()
  for (const moduleId of D5_MODULES) {
    assert.ok(
      !fs.existsSync(join(guidesDir, `core.${moduleId}.md`)),
      `core.${moduleId}.md redirect stub should not be emitted`,
    )
  }
})

test('build does not emit unreachable package-level standalone guides', () => {
  ensureBuilt()
  for (const guide of LEGACY_PACKAGE_GUIDES) {
    assert.ok(
      !fs.existsSync(join(guidesDir, `${guide}.md`)),
      `${guide}.md should not compete with routed conceptual guides`,
    )
  }
})

// A fact-sheet no case routes at all is a capability the catalog cannot even offer an agent.
// This guard closes that tier only: an `allowedExtra` reference counts as routed, and it never
// fails a run that skips the read, so being routed is weaker than being asserted (#4603 tracks
// tightening this to "required by some case"). Selection uses the same production intersection
// the scaffold applies, so enabling a module in the template without a case fails here (#4565).
test('every module fact-sheet a scaffold ships is routed by at least one catalog case', () => {
  ensureBuilt()
  const shipped = selectModuleFactSheets(join(pkgRoot, 'template'), join(guidesDir, 'modules'))
  assert.ok(shipped.length > 0, 'the scaffold must ship at least one module fact-sheet')

  const cases = JSON.parse(
    fs.readFileSync(join(pkgRoot, 'agentic', 'shared', 'ai', 'harness', 'cases.json'), 'utf8'),
  ) as Array<{ context: { required: string[]; allowedExtra?: string[] } }>
  const routed = new Set(cases.flatMap((entry) => [...entry.context.required, ...(entry.context.allowedExtra ?? [])]))

  const uncovered = shipped.filter((moduleId) => !routed.has(`.ai/guides/modules/${moduleId}.md`))
  assert.deepEqual(
    uncovered,
    [],
    `these shipped module fact-sheets are absent from every case context: ${uncovered.join(', ')}. `
    + 'Add a case that requires .ai/guides/modules/<id>.md, or stop enabling the module in the template.',
  )
})
