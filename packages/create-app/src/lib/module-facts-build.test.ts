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
  assert.equal(
    facts.customers.sourceRoot,
    'node_modules/@open-mercato/core/src/modules/customers',
  )
  assert.deepEqual(
    facts.customers.cliCommands.map((command: { command: string }) => command.command),
    facts.customers.cli,
  )
  assert.ok(facts.customers.backendPages.length > 0, 'customers facts should expose backend pages')
  assert.ok(facts.customers.aiTools.length > 0, 'customers facts should expose AI/MCP tools')
  assert.ok(facts.customers.aiAgents.length > 0, 'customers facts should expose AI agents')
  const sourceLinkedFacts = [
    ...facts.customers.backendPages,
    ...facts.customers.cliCommands,
    ...facts.customers.aiTools,
    ...facts.customers.aiAgents,
  ] as Array<{ sourcePath: string }>
  assert.equal(
    sourceLinkedFacts.every((fact) => fact.sourcePath.startsWith(`${facts.customers.sourceRoot}/`)),
    true,
  )

  const markdown = fs.readFileSync(join(guidesDir, 'modules', 'customers.md'), 'utf8')
  assert.match(markdown, /## Backend pages/)
  assert.match(markdown, /## CLI commands/)
  assert.match(markdown, /## AI tools \/ MCP capabilities/)
  assert.match(markdown, /## AI agents/)
  assert.match(markdown, /\.\.\/\.\.\/\.\.\/node_modules\/@open-mercato\/core\/src\/modules\/customers/)
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
