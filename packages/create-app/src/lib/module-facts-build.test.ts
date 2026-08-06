import assert from 'node:assert/strict'
import fs from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { requirePackageBuild } from './package-build-artifacts.js'
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

requirePackageBuild(pkgRoot)

test('build emits customers facts and the framework extension catalog (T5)', () => {
  assert.ok(fs.existsSync(join(guidesDir, 'modules', 'customers.md')), 'customers.md fact-sheet should exist')
  assert.ok(fs.existsSync(join(guidesDir, 'module-facts.json')), 'module-facts.json sidecar should exist')
  assert.ok(
    fs.existsSync(join(guidesDir, 'framework-extension-points.md')),
    'framework extension catalog should exist',
  )
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
  assert.ok(Array.isArray(facts.customers.frontendPages), 'customers facts should expose frontend pages')
  assert.ok(facts.customers.aiTools.length > 0, 'customers facts should expose AI/MCP tools')
  assert.ok(facts.customers.aiAgents.length > 0, 'customers facts should expose AI agents')
  const sourceLinkedFacts = [
    ...facts.customers.backendPages,
    ...facts.customers.frontendPages,
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
  assert.match(markdown, /## Frontend pages/)
  assert.match(markdown, /## CLI commands/)
  assert.match(markdown, /## AI tools \/ MCP capabilities/)
  assert.match(markdown, /## AI agents/)
  assert.match(markdown, /\.\.\/\.\.\/\.\.\/node_modules\/@open-mercato\/core\/src\/modules\/customers/)

  const frameworkMarkdown = fs.readFileSync(join(guidesDir, 'framework-extension-points.md'), 'utf8')
  assert.match(frameworkMarkdown, /^# Framework extension points/m)
  assert.match(frameworkMarkdown, /menu/i)
})

test('build emits a fact-sheet for every allowlisted D5 module (T5)', () => {
  for (const moduleId of D5_MODULES) {
    assert.ok(
      fs.existsSync(join(guidesDir, 'modules', `${moduleId}.md`)),
      `${moduleId}.md fact-sheet should exist`,
    )
  }
})

test('every default-controller module fact is exercised by the evaluation catalog', () => {
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
  for (const moduleId of D5_MODULES) {
    assert.ok(
      !fs.existsSync(join(guidesDir, `core.${moduleId}.md`)),
      `core.${moduleId}.md redirect stub should not be emitted`,
    )
  }
})

test('build does not emit unreachable package-level standalone guides', () => {
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
