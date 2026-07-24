import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  injectModuleGuides,
  readEnabledModuleIds,
  readModuleGuideLabels,
  selectModuleFactSheets,
} from './shared.js'

// A fixture bundle of fact-sheets that build.mjs would have written to
// dist/agentic/guides/modules/. Post-auto-discovery the real bundle is every
// package module; these tests exercise the enabled ∩ bundled intersection with a
// controlled subset so a module can be enabled-but-not-bundled (and vice versa).
const BUNDLED_FIXTURE = [
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

function makeTmpDir(): string {
  return fs.mkdtempSync(join(os.tmpdir(), 'om-module-guides-'))
}

function writeModulesTs(targetDir: string, ids: string[], extraTail = ''): void {
  fs.mkdirSync(join(targetDir, 'src'), { recursive: true })
  const entries = ids.map((id) => `  { id: '${id}', from: '@open-mercato/core' },`).join('\n')
  fs.writeFileSync(
    join(targetDir, 'src', 'modules.ts'),
    `type ModuleEntry = { id: string; from: string }\nexport const enabledModules: ModuleEntry[] = [\n${entries}\n]\n${extraTail}`,
  )
}

function makeFactSheetDir(modules: string[]): string {
  const modulesSubdir = join(makeTmpDir(), 'modules')
  fs.mkdirSync(modulesSubdir, { recursive: true })
  for (const moduleId of modules) {
    fs.writeFileSync(join(modulesSubdir, `${moduleId}.md`), `# ${moduleId} facts\n`)
  }
  return modulesSubdir
}

const AGENTS_TEMPLATE = [
  '## Module-Specific Guides',
  '',
  'intro prose stays untouched',
  '',
  '<!-- om:module-guides:start -->',
  '<!-- om:module-guides:end -->',
  '',
  '### Quality & Process',
  '',
].join('\n')

test('readEnabledModuleIds reads the static literal and ignores conditional .push() entries (T6)', () => {
  const targetDir = makeTmpDir()
  writeModulesTs(
    targetDir,
    ['customers', 'sales', 'dashboards'],
    'if (cond) enabledModules.push({ id: "should_not_appear", from: "@app" })\n',
  )
  const ids = readEnabledModuleIds(join(targetDir, 'src', 'modules.ts'))
  assert.deepEqual(ids, ['customers', 'sales', 'dashboards'])
  assert.ok(!ids.includes('should_not_appear'))
})

test('selectModuleFactSheets returns enabled ∩ bundled only (T5)', () => {
  const targetDir = makeTmpDir()
  // `dashboards` is enabled but NOT in this fixture's bundle (so no row); auth/etc are
  // bundled but NOT enabled (so no row either). Only the intersection is selected.
  writeModulesTs(targetDir, ['customers', 'sales', 'dashboards'])
  const modulesSubdir = makeFactSheetDir(BUNDLED_FIXTURE)

  const selected = selectModuleFactSheets(targetDir, modulesSubdir).sort()
  assert.deepEqual(selected, ['customers', 'sales'])
})

test('selectModuleFactSheets keeps a valid empty intersection empty', () => {
  const targetDir = makeTmpDir()
  writeModulesTs(targetDir, ['app_only_module'])
  const modulesSubdir = makeFactSheetDir(BUNDLED_FIXTURE)

  assert.deepEqual(selectModuleFactSheets(targetDir, modulesSubdir), [])
})

test('selectModuleFactSheets falls back to the full bundled set when the enabled set cannot be read (T5, R5)', () => {
  const targetDir = makeTmpDir() // no src/modules.ts written
  const modulesSubdir = makeFactSheetDir(BUNDLED_FIXTURE)

  const selected = selectModuleFactSheets(targetDir, modulesSubdir).sort()
  assert.deepEqual(selected, [...BUNDLED_FIXTURE].sort())
})

test('injectModuleGuides writes exactly the selected rows, drops the hedge, and is idempotent (T6)', () => {
  const targetDir = makeTmpDir()
  const agentsPath = join(targetDir, 'AGENTS.md')
  fs.writeFileSync(agentsPath, AGENTS_TEMPLATE)

  injectModuleGuides(agentsPath, ['customers', 'sales'])
  const firstPass = fs.readFileSync(agentsPath, 'utf8')

  assert.match(firstPass, /\| .* \| `\.ai\/guides\/modules\/customers\.md` \|/)
  assert.match(firstPass, /\| .* \| `\.ai\/guides\/modules\/sales\.md` \|/)
  assert.ok(!firstPass.includes('(if available)'))
  assert.ok(!firstPass.includes('modules/workflows.md'), 'non-selected modules must not appear')
  assert.ok(firstPass.includes('intro prose stays untouched'), 'surrounding prose must be preserved')

  injectModuleGuides(agentsPath, ['customers', 'sales'])
  const secondPass = fs.readFileSync(agentsPath, 'utf8')
  assert.equal(secondPass, firstPass)
})

test('readModuleGuideLabels sources labels from module-facts.json (description → title → skip) (T6)', () => {
  const guidesDir = makeTmpDir()
  fs.writeFileSync(
    join(guidesDir, 'module-facts.json'),
    JSON.stringify({
      customers: { title: 'Customer Relationship Management', description: 'Core CRM capabilities.' },
      sales: { title: 'Sales Management', description: null },
      auth: { title: null, description: null },
    }),
  )

  const labels = readModuleGuideLabels(guidesDir)
  assert.equal(labels.customers, 'Core CRM capabilities.')
  assert.equal(labels.sales, 'Sales Management')
  assert.ok(!('auth' in labels), 'a module with neither description nor title must be omitted')
})

test('readModuleGuideLabels degrades to an empty map when the sidecar is missing or malformed (T6)', () => {
  const missingDir = makeTmpDir()
  assert.deepEqual(readModuleGuideLabels(missingDir), {})

  const malformedDir = makeTmpDir()
  fs.writeFileSync(join(malformedDir, 'module-facts.json'), '{ not valid json')
  assert.deepEqual(readModuleGuideLabels(malformedDir), {})
})

test('injectModuleGuides renders labels from the facts map and falls back to a generic label (T6)', () => {
  const targetDir = makeTmpDir()
  const agentsPath = join(targetDir, 'AGENTS.md')
  fs.writeFileSync(agentsPath, AGENTS_TEMPLATE)

  injectModuleGuides(agentsPath, ['customers', 'sales'], { customers: 'Core CRM capabilities.' })
  const rendered = fs.readFileSync(agentsPath, 'utf8')

  assert.match(rendered, /\| Core CRM capabilities\. \| `\.ai\/guides\/modules\/customers\.md` \|/)
  assert.match(rendered, /\| Use the sales module \| `\.ai\/guides\/modules\/sales\.md` \|/)
})

test('injectModuleGuides warns and leaves the file unchanged when the markers are absent (T6)', () => {
  const targetDir = makeTmpDir()
  const agentsPath = join(targetDir, 'AGENTS.md')
  const original = '# AGENTS\n\nThis file has no module-guides markers.\n'
  fs.writeFileSync(agentsPath, original)

  const warnings: string[] = []
  const realWarn = console.warn
  console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(' '))
  try {
    injectModuleGuides(agentsPath, ['customers', 'sales'])
  } finally {
    console.warn = realWarn
  }

  assert.equal(fs.readFileSync(agentsPath, 'utf8'), original)
  assert.ok(warnings.some((warning) => warning.includes('markers') && warning.includes('not found')))
})
