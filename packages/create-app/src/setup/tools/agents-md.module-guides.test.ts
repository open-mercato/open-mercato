import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  enforceRootInstructionBudget,
  injectModuleGuides,
  readEnabledModuleIds,
  renderModuleGuidesBlock,
  selectModuleFactSheets,
} from './shared.js'
import {
  enforceRootInstructionBudget as cliEnforceRootInstructionBudget,
  renderModuleGuidesBlock as renderCliModuleGuidesBlock,
} from '../../../../cli/src/lib/agentic-setup.js'

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
    fs.mkdirSync(join(modulesSubdir, moduleId), { recursive: true })
    fs.writeFileSync(join(modulesSubdir, moduleId, 'index.md'), `# ${moduleId} facts\n`)
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

test('injectModuleGuides writes exactly the selected ID index, drops the hedge, and is idempotent (T6)', () => {
  const targetDir = makeTmpDir()
  const agentsPath = join(targetDir, 'AGENTS.md')
  fs.writeFileSync(agentsPath, AGENTS_TEMPLATE)

  injectModuleGuides(agentsPath, ['customers', 'sales'])
  const firstPass = fs.readFileSync(agentsPath, 'utf8')

  assert.match(firstPass, /Enabled module facts: `customers`,`sales`\./)
  assert.match(firstPass, /Load `\.ai\/guides\/modules\/<id>\/index\.md` only for a targeted installed module\/host/)
  assert.equal((firstPass.match(/\.ai\/guides\/modules\//g) ?? []).length, 1, 'the reusable path pattern appears once')
  assert.ok(!firstPass.includes('modules/customers.md'), 'module IDs must not expand into per-module paths')
  assert.ok(!firstPass.includes('modules/sales.md'), 'module IDs must not expand into per-module paths')
  assert.ok(!firstPass.includes('(if available)'))
  assert.ok(!firstPass.includes('`workflows`'), 'non-selected modules must not appear')
  assert.ok(firstPass.includes('intro prose stays untouched'), 'surrounding prose must be preserved')

  injectModuleGuides(agentsPath, ['customers', 'sales'])
  const secondPass = fs.readFileSync(agentsPath, 'utf8')
  assert.equal(secondPass, firstPass)
})

test('create-app and agentic:init render byte-identical module fact indexes', () => {
  for (const selected of [[], ['customers', 'sales'], BUNDLED_FIXTURE]) {
    assert.equal(renderModuleGuidesBlock(selected), renderCliModuleGuidesBlock(selected))
    assert.equal(
      renderModuleGuidesBlock(selected, { compact: true }),
      renderCliModuleGuidesBlock(selected, { compact: true }),
    )
  }
})

test('enforceRootInstructionBudget leaves a root that already fits untouched', () => {
  const targetDir = makeTmpDir()
  const agentsPath = join(targetDir, 'AGENTS.md')
  fs.writeFileSync(agentsPath, AGENTS_TEMPLATE)
  injectModuleGuides(agentsPath, BUNDLED_FIXTURE)
  const before = fs.readFileSync(agentsPath, 'utf8')

  const shed = enforceRootInstructionBudget(agentsPath, BUNDLED_FIXTURE, 8 * 1024)

  assert.equal(shed, false)
  assert.equal(fs.readFileSync(agentsPath, 'utf8'), before)
  assert.equal(cliEnforceRootInstructionBudget(agentsPath, BUNDLED_FIXTURE, 8 * 1024), false)
})

test('enforceRootInstructionBudget sheds the enumerated index when the root overflows (T6)', () => {
  const targetDir = makeTmpDir()
  const agentsPath = join(targetDir, 'AGENTS.md')
  fs.writeFileSync(agentsPath, AGENTS_TEMPLATE)
  const selected = Array.from({ length: 64 }, (_, index) => `module_${String(index).padStart(2, '0')}`)
  injectModuleGuides(agentsPath, selected)
  const enumerated = Buffer.byteLength(fs.readFileSync(agentsPath))

  const shed = enforceRootInstructionBudget(agentsPath, selected, enumerated - 1)
  const rendered = fs.readFileSync(agentsPath, 'utf8')

  assert.equal(shed, true)
  assert.ok(Buffer.byteLength(rendered) <= enumerated - 1)
  assert.match(rendered, /Enabled module facts: 64 sheets bundled, too many to index inline/)
  assert.ok(!rendered.includes('`module_00`'), 'the pointer form must not enumerate module ids')
  assert.ok(rendered.includes('intro prose stays untouched'), 'surrounding prose must be preserved')
  assert.equal(
    (rendered.match(/\.ai\/guides\/modules\//g) ?? []).length,
    1,
    'the reusable path pattern still appears once',
  )
})

test('injectModuleGuides keeps a large enabled set compact and never embeds fact descriptions (T6)', () => {
  const targetDir = makeTmpDir()
  const agentsPath = join(targetDir, 'AGENTS.md')
  fs.writeFileSync(agentsPath, AGENTS_TEMPLATE)
  const selected = Array.from({ length: 64 }, (_, index) => `module_${String(index).padStart(2, '0')}`)

  injectModuleGuides(agentsPath, selected)
  const rendered = fs.readFileSync(agentsPath, 'utf8')
  const block = rendered.slice(
    rendered.indexOf('<!-- om:module-guides:start -->') + '<!-- om:module-guides:start -->'.length,
    rendered.indexOf('<!-- om:module-guides:end -->'),
  ).trim()

  assert.ok(Buffer.byteLength(block) < 1_200, `compact module index is ${Buffer.byteLength(block)} bytes`)
  assert.equal(block.split('\n').length, 3)
  assert.equal((block.match(/\.ai\/guides\/modules\/<id>\/index\.md/g) ?? []).length, 1)
  assert.ok(!block.includes('Core CRM capabilities'))
  assert.ok(!block.includes('| Task | Load |'))
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
