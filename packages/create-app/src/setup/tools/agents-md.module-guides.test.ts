import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { injectModuleGuides, readEnabledModuleIds, selectModuleFactSheets } from './shared.js'

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

test('selectModuleFactSheets returns enabled ∩ allowlisted only (T6, GAP-D6-E)', () => {
  const targetDir = makeTmpDir()
  // dashboards is enabled but NOT allowlisted (no fact-sheet); auth/etc are allowlisted but NOT enabled.
  writeModulesTs(targetDir, ['customers', 'sales', 'dashboards'])
  const modulesSubdir = makeFactSheetDir(D5_MODULES)

  const selected = selectModuleFactSheets(targetDir, modulesSubdir).sort()
  assert.deepEqual(selected, ['customers', 'sales'])
})

test('selectModuleFactSheets falls back to the full bundled set when the enabled set cannot be read (T6, R5)', () => {
  const targetDir = makeTmpDir() // no src/modules.ts written
  const modulesSubdir = makeFactSheetDir(D5_MODULES)

  const selected = selectModuleFactSheets(targetDir, modulesSubdir).sort()
  assert.deepEqual(selected, [...D5_MODULES].sort())
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
