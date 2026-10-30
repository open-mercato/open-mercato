import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { extractAllModuleFacts } from '../../../cli/src/lib/generators/module-facts.js'
import { discoverPackageModuleSources } from '../../../cli/src/lib/generators/module-facts-discovery.js'
import { createResolver } from '../../../cli/src/lib/resolver.js'
import { generateShared, injectModuleGuides, selectModuleFactSheets, enforceGeneratedRootBudget } from '../setup/tools/shared.js'
import { generateCodex } from '../setup/tools/codex.js'

type ExampleRoot = { root: string; entrypoints: string[]; allowedCapabilityIds: string[]; maxFiles: number; maxBytes: number }
type CodingCase = {
  id: string
  context: { required: string[]; allowedExtra?: string[]; sourceReferenceIds?: string[]; exampleRoots?: ExampleRoot[] }
  requiredSkills: string[]
  allowedWrites: string[]
  maxContextFiles: number
  maxInitialContextBytes: number
  maxTotalContextBytes: number
  frameworkContext?: Array<{ module?: string; package?: string; query: string }>
}
type Surface = { capabilityId: string; readStatus: string; sourcePaths: string[] }
type Reference = { referenceId: string; originAsset: string; resolvedPath: string; readStatus: string }
type Evaluator = {
  caseReadAllowlist: (record: CodingCase, writable: boolean, root: string) => string[]
  evaluateExampleReadPolicy: (input: { caseRecord: CodingCase; appRoot: string; reads: Array<{ path: string }> }) => { firstViolation: string | null }
  validateExampleReadPolicyDeclaration: (record: CodingCase, root: string) => string[]
}
type Reply = { id: number; result: { isError?: boolean; content: Array<{ text: string }> } }

const packageRoot = fileURLToPath(new URL('../../', import.meta.url))
const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const shared = path.join(packageRoot, 'agentic/shared')
const evaluator = await import(pathToFileURL(path.join(shared, 'scripts/evaluate-agent-harness.mjs')).href) as unknown as Evaluator
const catalog = JSON.parse(fs.readFileSync(path.join(shared, 'ai/harness/cases.json'), 'utf8')) as CodingCase[]
const references = (JSON.parse(fs.readFileSync(path.join(shared, 'ai/harness/source-link-inventory.json'), 'utf8')) as { records: Reference[] }).records
const surfaces = (JSON.parse(fs.readFileSync(path.join(packageRoot, 'template/src/modules/example/references/surface-inventory.json'), 'utf8')) as { capabilities: Surface[] }).capabilities
const affected = ['OMH-009', 'OMH-011', 'OMH-012', 'OMH-014', 'OMH-026', 'OMH-027', 'OMH-029', 'OMH-031', 'OMH-042', 'OMH-045', 'OMH-049', 'OMH-054', 'OMH-057', 'OMH-060']
const expectedSources: Record<string, string[]> = {
  'OMH-009': ['data/entities.ts', 'data/validators.ts', 'migrations/.snapshot-open-mercato.json'],
  'OMH-011': ['api/todos/route.ts', 'api/openapi.ts'],
  'OMH-012': ['commands/todos.ts'],
  'OMH-014': ['components/TodosTable.tsx', 'components/TodoForm.tsx'],
  'OMH-026': ['data/enrichers.ts', 'data/guards.ts', 'widgets/injection/customer-priority-field/widget.ts'],
  'OMH-027': ['widgets/injection/customer-priority-column/widget.ts', 'widgets/injection/customer-priority-filter/widget.ts', 'widgets/injection/customer-priority-row-action/widget.ts', 'widgets/injection/customer-priority-bulk-actions/widget.ts'],
  'OMH-031': ['api/interceptors.ts'],
  'OMH-042': ['acl.ts', 'setup.ts', 'di.ts'],
  'OMH-049': ['ai-agents.ts', 'ai-tools.ts'],
}
let scaffold: string | undefined

test.after(() => {
  if (scaffold) fs.rmSync(path.dirname(scaffold), { recursive: true, force: true })
})

function codingCase(id: string): CodingCase {
  const record = catalog.find(record => record.id === id)
  assert.ok(record, `missing ${id}`)
  return record
}

function stageApp(): string {
  if (!scaffold) {
    const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-coding-source-scaffold-')))
    scaffold = path.join(parent, 'source-policy-fixture')
    fs.mkdirSync(path.join(scaffold, 'src'), { recursive: true })
    fs.copyFileSync(path.join(packageRoot, 'template/src/modules.ts'), path.join(scaffold, 'src/modules.ts'))
    fs.cpSync(path.join(packageRoot, 'template/src/modules/example'), path.join(scaffold, 'src/modules/example'), { recursive: true })
    const config = { projectName: 'source-policy-fixture', targetDir: scaffold }
    generateShared(config)
    const version = (JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8')) as { version: string }).version
    const { directoryByModule } = extractAllModuleFacts({ sources: discoverPackageModuleSources(createResolver(repositoryRoot)), coreVersion: version, registryPath: null })
    const factDirectory = path.join(scaffold, '.ai/guides/modules')
    for (const [moduleId, directory] of Object.entries(directoryByModule)) {
      const target = path.join(factDirectory, moduleId)
      fs.mkdirSync(target, { recursive: true })
      fs.writeFileSync(path.join(target, 'index.md'), directory.index)
      for (const section of directory.sections) fs.writeFileSync(path.join(target, `${section.slug}.md`), section.markdown)
    }
    const upstream = path.join(scaffold, '.ai/guides/upstream')
    fs.mkdirSync(upstream, { recursive: true })
    fs.copyFileSync(path.join(repositoryRoot, 'BACKWARD_COMPATIBILITY.md'), path.join(upstream, 'BACKWARD_COMPATIBILITY.md'))
    injectModuleGuides(path.join(scaffold, 'AGENTS.md'), selectModuleFactSheets(scaffold, factDirectory))
    generateCodex(config)
    enforceGeneratedRootBudget(config)
  }
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-coding-source-policy-')))
  fs.cpSync(scaffold, root, { recursive: true })
  const qaFile = path.join(root, 'src/modules/example/lib/__tests__/mock-gateway-adapter.test.ts')
  fs.mkdirSync(path.dirname(qaFile), { recursive: true })
  fs.writeFileSync(qaFile, 'private-qa-marker')
  fs.writeFileSync(path.join(root, 'src/private.ts'), 'private-source-marker')
  fs.writeFileSync(path.join(root, '.env'), 'SECRET=private-environment-marker')
  return root
}

function toolCalls(root: string, record: CodingCase, calls: Array<{ name: string; arguments: Record<string, string> }>): Reply[] {
  const requests = calls.map((call, index) => ({ jsonrpc: '2.0', id: index + 1, method: 'tools/call', params: call }))
  const processResult = spawnSync(process.execPath, [
    path.join(shared, 'scripts/agent-harness-tool-server.mjs'), root, 'writable',
    JSON.stringify(evaluator.caseReadAllowlist(record, true, root)), JSON.stringify(record.allowedWrites),
  ], { encoding: 'utf8', env: {}, input: requests.map(request => JSON.stringify(request)).join('\n') + '\n' })
  assert.equal(processResult.status, 0, processResult.stderr)
  return processResult.stdout.trim().split('\n').map(line => JSON.parse(line)) as Reply[]
}

function initialContext(filename: string): boolean {
  return !filename.includes('/references/') && !['.ai/framework-context/', '.ai/guides/modules/', '.ai/guides/reference-modules/', '.ai/guides/upstream/', '.agents/skills/', 'src/'].some(prefix => filename.startsWith(prefix))
}

function mandatoryClosure(root: string, record: CodingCase) {
  const instructions = new Set(record.context.required)
  for (const skill of record.requiredSkills) instructions.add(`.ai/skills/${skill}/SKILL.md`)
  if (record.id === 'OMH-057') instructions.add('.ai/skills/om-module-scaffold/SKILL.md')
  const sourceFiles = new Set<string>()
  for (const referenceId of record.context.sourceReferenceIds ?? []) {
    const reference = references.find(reference => reference.referenceId === referenceId)
    assert.ok(reference, `${record.id}: unknown source reference ${referenceId}`)
    instructions.add(reference.originAsset)
    sourceFiles.add(reference.resolvedPath)
  }
  for (const declaration of record.context.exampleRoots ?? []) {
    for (const filename of declaration.entrypoints) sourceFiles.add(`${declaration.root}/${filename}`)
    sourceFiles.add(`${declaration.root}/references/surface-inventory.json`)
    for (const capabilityId of declaration.allowedCapabilityIds) {
      const capability = surfaces.find(capability => capability.capabilityId === capabilityId)
      assert.equal(capability?.readStatus, 'readable', `${record.id}: non-readable capability ${capabilityId}`)
      for (const filename of capability.sourcePaths) sourceFiles.add(filename)
    }
  }
  const size = (filename: string) => fs.statSync(path.join(root, filename)).size
  const initial = [...instructions].filter(initialContext)
  const files = new Set([...instructions, ...sourceFiles])
  return { initialFiles: initial.length, initialBytes: initial.reduce((total, filename) => total + size(filename), 0), totalBytes: [...files].reduce((total, filename) => total + size(filename), 0), sourceFiles: [...sourceFiles], sourceBytes: [...sourceFiles].reduce((total, filename) => total + size(filename), 0) }
}

for (const [id, expected] of Object.entries(expectedSources)) {
  test(`${id} delivers only the task's exact readable canonical source`, () => {
    const root = stageApp()
    try {
      const record = codingCase(id)
      const allowed = evaluator.caseReadAllowlist(record, true, root)
      const exact = expected.map(filename => `src/modules/example/${filename}`)
      for (const filename of exact) assert.ok(allowed.includes(filename), `${id} cannot read ${filename}`)
      assert.ok(!allowed.includes('src/modules/example/**'))
      assert.deepEqual(evaluator.validateExampleReadPolicyDeclaration(record, root), [])
      const owners = (record.context.sourceReferenceIds ?? []).map(referenceId => references.find(reference => reference.referenceId === referenceId)?.originAsset).filter((filename): filename is string => Boolean(filename))
      const entrypoints = (record.context.exampleRoots ?? []).flatMap(declaration => declaration.entrypoints.map(filename => `${declaration.root}/${filename}`))
      const trace = evaluator.evaluateExampleReadPolicy({ caseRecord: record, appRoot: root, reads: [...new Set([...owners, ...entrypoints, ...exact])].map(filename => ({ path: filename })) })
      assert.equal(trace.firstViolation, null)
      const unrelated = id === 'OMH-049' ? 'src/modules/example/commands/todos.ts' : 'src/modules/example/ai-agents.ts'
      const denied = [unrelated, 'src/modules/example/lib/__tests__/mock-gateway-adapter.test.ts', 'src/private.ts', '../outside.ts', '.env']
      const replies = toolCalls(root, record, [...exact, ...denied].map(filename => ({ name: 'read', arguments: { path: filename } })))
      for (const reply of replies.slice(0, exact.length)) assert.notEqual(reply.result.isError, true)
      for (const reply of replies.slice(exact.length)) assert.equal(reply.result.isError, true)
      assert.doesNotMatch(JSON.stringify(replies), /private-source-marker|private-environment-marker|private-qa-marker/)
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })
}

test('the page override case can read and edit its exact module registry without broader app access', () => {
  const root = stageApp()
  try {
    const record = codingCase('OMH-029')
    const replies = toolCalls(root, record, [
      { name: 'read', arguments: { path: 'src/modules.ts' } },
      { name: 'write', arguments: { path: 'src/modules.ts', content: "export const enabledModules = []\n" } },
      { name: 'write', arguments: { path: 'src/app/page.tsx', content: 'unrelated page' } },
      { name: 'write', arguments: { path: 'src/modules/example/acl.ts', content: 'example mutation' } },
    ])
    assert.notEqual(replies[0].result.isError, true)
    assert.notEqual(replies[1].result.isError, true)
    assert.equal(replies[2].result.isError, true)
    assert.equal(replies[3].result.isError, true)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

for (const id of affected) {
  test(`${id} mandatory instruction, skill and exact example closure fits its declared bounds`, context => {
    const root = stageApp()
    try {
      const record = codingCase(id)
      const measured = mandatoryClosure(root, record)
      context.diagnostic(JSON.stringify({ id, initialFiles: measured.initialFiles, initialBytes: measured.initialBytes, totalBytes: measured.totalBytes, sourceFiles: measured.sourceFiles.length, sourceBytes: measured.sourceBytes, limits: [record.maxContextFiles, record.maxInitialContextBytes, record.maxTotalContextBytes] }))
      assert.ok(measured.initialFiles <= record.maxContextFiles, `${id} initial files ${measured.initialFiles}/${record.maxContextFiles}`)
      assert.ok(measured.initialBytes <= record.maxInitialContextBytes, `${id} initial bytes ${measured.initialBytes}/${record.maxInitialContextBytes}`)
      assert.ok(measured.totalBytes <= record.maxTotalContextBytes, `${id} total bytes ${measured.totalBytes}/${record.maxTotalContextBytes}; exact source bytes ${measured.sourceBytes}`)
      assert.ok(record.maxInitialContextBytes <= 98_304 && record.maxTotalContextBytes <= 1_048_576)
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })
}

test('prepared workflow context queries name exact production declarations', () => {
  const requests = codingCase('OMH-054').frameworkContext
  assert.deepEqual(requests, [
    { module: 'workflows', query: 'export function registerCodeWorkflows' },
    { package: '@open-mercato/shared', query: 'interface CodeWorkflowDefinition' },
  ])
})

for (const id of ['OMH-026', 'OMH-027', 'OMH-031']) {
  test(`${id} delivers the named customers host facts before installed extension work`, () => {
    const root = stageApp()
    try {
      const record = codingCase(id)
      const facts = '.ai/guides/modules/customers/index.md'
      assert.ok(record.context.required.includes(facts), `${id} must require exact host facts`)
      const [reply] = toolCalls(root, record, [{ name: 'read', arguments: { path: facts } }])
      assert.notEqual(reply.result.isError, true)
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })
}
