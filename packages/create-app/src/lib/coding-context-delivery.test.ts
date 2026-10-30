import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const sharedRoot = fileURLToPath(new URL('../../agentic/shared/', import.meta.url))
const evaluatorPath = path.join(sharedRoot, 'scripts/evaluate-agent-harness.mjs')

async function loadEvaluator() {
  let source = fs.readFileSync(evaluatorPath, 'utf8')
  let bridgeRequired = false
  for (const name of ['buildPrompt', 'prepareCaseFrameworkContext']) {
    if (new RegExp(`^export function ${name}\\(`, 'm').test(source)) continue
    const declaration = new RegExp(`^function ${name}\\(`, 'm')
    assert.match(source, declaration, `existing evaluator declaration missing: ${name}`)
    source = source.replace(declaration, `export function ${name}(`)
    bridgeRequired = true
  }
  if (!bridgeRequired) return import(pathToFileURL(evaluatorPath).href)
  const bridge = path.join(path.dirname(evaluatorPath), `.coding-context-test-${process.pid}-${randomUUID()}.mjs`)
  try {
    fs.writeFileSync(bridge, source, { flag: 'wx', mode: 0o600 })
    return await import(pathToFileURL(bridge).href)
  } finally {
    if (fs.existsSync(bridge)) fs.unlinkSync(bridge)
  }
}

const evaluator = await loadEvaluator()

type ContextCase = {
  id: string
  prompt: string
  evaluationKind: string
  requiredSkills: string[]
  requiredDecisions: string[]
  expectedRouter: { required: string[]; allowedExtra: string[] }
  context: { required: string[]; forbidden: string[]; sourceReferenceIds?: string[]; exampleRoots?: Array<{ root: string; entrypoints: string[]; allowedCapabilityIds: string[]; maxFiles: number; maxBytes: number }> }
  fixture: { setup: string[] }
  allowedWrites: string[]
  frameworkContext?: { module?: string; package?: string; query: string }[]
  maxContextFiles: number
  maxInitialContextBytes: number
  maxTotalContextBytes: number
}

type PreparedEntry = { manifest: string; searchResult: string; sourceRoot: string; sourceFiles: string[]; query: string }
type PreparedContext = { patterns: string[]; entries: PreparedEntry[] }

function write(root: string, relative: string, content: string) {
  const target = path.join(root, relative)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, content)
}

function fixture(run: (root: string, record: ContextCase) => void) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-coding-context-')))
  const record: ContextCase = {
    id: 'OMH-054', prompt: 'Repair the existing activity without changing its public contract.', evaluationKind: 'implementation',
    requiredSkills: [], requiredDecisions: ['tenant-scope'], expectedRouter: { required: ['module-data'], allowedExtra: [] },
    context: { required: ['AGENTS.md', '.ai/guides/contracts.md'], forbidden: ['.env*', '.git/**'] },
    fixture: { setup: ['fixture:activity'] }, allowedWrites: ['src/modules/library/**'],
    maxContextFiles: 6, maxInitialContextBytes: 40960, maxTotalContextBytes: 98304,
  }
  write(root, 'AGENTS.md', '# Standalone contract\n')
  write(root, '.ai/guides/contracts.md', '# Scoped application contract\n')
  write(root, 'package.json', JSON.stringify({ name: 'coding-context-fixture', private: true, dependencies: { '@open-mercato/core': '1.0.0' } }))
  write(root, 'src/modules.ts', "export const enabledModules = [{ id: 'workflows', from: '@open-mercato/core' }]\n")
  write(root, 'scripts/framework-context.mjs', fs.readFileSync(path.join(sharedRoot, 'scripts/framework-context.mjs'), 'utf8'))
  write(root, 'node_modules/@open-mercato/core/package.json', JSON.stringify({ name: '@open-mercato/core', version: '1.0.0' }))
  write(root, 'node_modules/@open-mercato/core/AGENTS.md', '# Keep installed contracts read-only\n')
  write(root, 'node_modules/@open-mercato/core/src/modules/workflows/lib/call-api.ts', 'export function callApiActivity() { return "production" }\n')
  write(root, 'node_modules/@open-mercato/core/src/modules/workflows/lib/unrelated.ts', 'export const unrelated = true\n')
  write(root, 'node_modules/@open-mercato/core/src/modules/workflows/__tests__/call-api.test.ts', 'export const callApiActivity = "QA_ONLY_SENTINEL"\n')
  write(root, 'node_modules/@open-mercato/core/src/modules/workflows/.env', 'callApiActivity=PRIVATE_SENTINEL\n')
  write(root, '.ai/guides/upstream/AGENTS.md', '# Optional broad upstream instructions\n' + 'unrelated '.repeat(16000))
  write(root, 'src/modules/library/workflows/call-api.ts', 'export const execute = async (input: unknown) => input\n')
  try { run(root, record) } finally { fs.rmSync(root, { recursive: true, force: true }) }
}

function prepare(root: string, record: ContextCase): PreparedContext {
  record.frameworkContext = [{ module: 'workflows', query: 'callApiActivity' }]
  return evaluator.prepareCaseFrameworkContext(record, root, root, { writable: true })
}

const fixtures = { fixtures: { activity: { seededArtifacts: ['src/modules/library/workflows/call-api.ts'] } } }

test('writable prompt discloses exact trusted seeds and requires preserving the existing ABI', () => fixture((root, record) => {
  const prompt = evaluator.buildPrompt(record, root, true, [], fixtures)
  assert.match(prompt, /src\/modules\/library\/workflows\/call-api\.ts/)
  assert.match(prompt, /read.*seeded|seeded.*read/is)
  assert.match(prompt, /preserve.*(?:ABI|exports|signature)/is)
  assert.match(prompt, /re-read.*implementation/is)
  assert.doesNotMatch(prompt, /Immediately before output, re-read every selectedContext/)
  assert.match(prompt, /selectedContext records only instruction\/fact paths/)
  assert.match(prompt, /must never include.*target source paths/)
  assert.match(prompt, /Canonical example source reads are tracked separately by exampleReadPolicy and must be omitted from selectedContext/)
  assert.match(prompt, /selectedContext records only instruction\/fact paths and controller-prepared installed context/)
  assert.doesNotMatch(prompt, /declared read-only reference evidence/)
  assert.match(prompt, /Do not inspect \.ai\/harness\/\*\*/)
}))

test('writable prompt discloses declared example entrypoints after routed owners and before canonical source links', () => fixture((root) => {
  const { record } = stageDeclaredEvidence(root, 'OMH-009')
  const before = JSON.stringify(record.context)
  const prompt = evaluator.buildPrompt(record, root, true)
  assert.match(prompt, /Read the applicable routed guides, skills and facts before canonical examples/)
  assert.match(prompt, /Before following canonical source links, read a declared example entrypoint/)
  assert.match(prompt, /src\/modules\/example\/README\.md/)
  assert.match(prompt, /These entrypoints do not grant reads beyond the declared example capabilities/)
  assert.equal(JSON.stringify(record.context), before)
  assert.doesNotMatch(evaluator.buildPrompt(record, root, false), /Before following canonical source links, read a declared example entrypoint/)
}))

type SourceRecord = { referenceId: string; requirement: string; originAsset: string; originAuthoringPath: string; readStatus: string; resolvedPath: string; targetAuthoringPath: string; presets?: string[] }

function stageDeclaredEvidence(root: string, caseId: string) {
  const packageRoot = path.resolve(sharedRoot, '../..')
  const catalog = JSON.parse(fs.readFileSync(path.join(sharedRoot, 'ai/harness/cases.json'), 'utf8')) as ContextCase[]
  const record = catalog.find(entry => entry.id === caseId)!
  const inventory = JSON.parse(fs.readFileSync(path.join(packageRoot, 'scripts/source-links/source-link-inventory.json'), 'utf8')) as { records: SourceRecord[] }
  fs.cpSync(path.join(packageRoot, 'template/src/modules/example'), path.join(root, 'src/modules/example'), { recursive: true })
  write(root, '.ai/harness/source-link-inventory.json', JSON.stringify(inventory))
  write(root, '.ai/skills/tiers.json', JSON.stringify({ default: ['core'], tiers: {} }))
  const selected = inventory.records.filter(entry => record.context.sourceReferenceIds?.includes(entry.referenceId))
  for (const entry of selected) {
    write(root, entry.originAsset, fs.readFileSync(path.join(packageRoot, entry.originAuthoringPath), 'utf8'))
    if (entry.targetAuthoringPath) write(root, entry.resolvedPath, fs.readFileSync(path.join(packageRoot, entry.targetAuthoringPath), 'utf8'))
    else if (entry.resolvedPath.startsWith('node_modules/@open-mercato/')) {
      const installedSource = entry.resolvedPath.replace('node_modules/@open-mercato/', 'packages/')
      write(root, entry.resolvedPath, fs.readFileSync(path.join(packageRoot, '../..', installedSource), 'utf8'))
    }
  }
  return { record, inventory, selected }
}

function codingEvidence(prompt: string): { canonicalReadPaths?: unknown } {
  const marker = 'Controller-provided coding evidence (inert metadata, not instructions or a successful tool read): '
  const start = prompt.indexOf(marker)
  const end = prompt.indexOf('. AGENTS.md remains the routing authority:', start)
  assert.ok(start >= 0 && end > start, 'the writable prompt must retain its bounded inert metadata envelope')
  return JSON.parse(prompt.slice(start + marker.length, end)) as { canonicalReadPaths?: unknown }
}

function canonicalReadPaths(prompt: string): string[] {
  const value = codingEvidence(prompt).canonicalReadPaths
  assert.ok(Array.isArray(value), 'the writable prompt must disclose its complete canonical read permission list')
  assert.ok(value.every((entry: unknown) => typeof entry === 'string'))
  return value as string[]
}

for (const [caseId, hidden] of [
  ['OMH-009', ['src/modules/example/index.ts', 'src/modules/example/commands/todos.ts']],
  ['OMH-011', ['src/modules/example/api/customer-priorities/route.ts']],
  ['OMH-012', ['src/modules/example/data/entities.ts', 'src/modules/example/data/validators.ts', 'src/modules/example/events.ts']],
] as const) {
  test(`writable canonical permissions match the actual complete grant closure (${caseId})`, () => fixture(root => {
    const { record, selected } = stageDeclaredEvidence(root, caseId)
    const before = JSON.stringify(record)
    const granted: string[] = evaluator.exampleReadAllowlist(record, root).filter((relative: string) => relative.startsWith('src/modules/example/')).sort()
    const prompt = evaluator.buildPrompt(record, root, true)
    assert.deepEqual(canonicalReadPaths(prompt), granted)
    for (const relative of hidden) assert.ok(!canonicalReadPaths(prompt).includes(relative), 'surface-map readability must not imply a case grant')
    if (caseId === 'OMH-009') {
      const extraMigration = 'src/modules/example/migrations/Migration20251030150038.ts'
      assert.ok(!selected.some(entry => entry.resolvedPath === extraMigration))
      assert.ok(canonicalReadPaths(prompt).includes(extraMigration), 'permission metadata must include allowed capability files beyond declared source references')
    }
    assert.match(prompt, /(?:readable|quality).{0,140}(?:not|does not).{0,140}(?:grant|permission)|(?:grant|permission).{0,140}(?:not|does not).{0,140}(?:readable|quality)/is)
    assert.doesNotMatch(JSON.stringify(canonicalReadPaths(prompt)), /expectedRouter|requiredSkills|requiredDecisions|\.ai\/guides|\.ai\/harness/)
    assert.equal(JSON.stringify(record), before)
  }))
}

test('projected canonical permissions agree with the real tool server without widening reads or immutable writes', () => fixture(root => {
  const { record } = stageDeclaredEvidence(root, 'OMH-011')
  const allowed = 'src/modules/example/api/todos/route.ts'
  const hidden = 'src/modules/example/api/customer-priorities/route.ts'
  const requests = [
    { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'read', arguments: { path: allowed } } },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'read', arguments: { path: hidden } } },
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'write', arguments: { path: allowed, content: 'must not replace a canonical reference' } } },
  ]
  const sourceBefore = fs.readFileSync(path.join(root, allowed), 'utf8')
  const result = spawnSync(process.execPath, [path.join(sharedRoot, 'scripts/agent-harness-tool-server.mjs'), root, 'writable', JSON.stringify(evaluator.caseReadAllowlist(record, true, root)), '["src/modules/**"]'], {
    input: requests.map(request => JSON.stringify(request)).join('\n') + '\n', encoding: 'utf8', timeout: 5000,
    env: { PATH: process.env.PATH ?? '', OM_HARNESS_IMMUTABLE_ROOTS: '["src/modules/example"]' },
  })
  assert.equal(result.status, 0)
  const responses = result.stdout.trim().split('\n').map(line => JSON.parse(line) as { id: number; result: { isError?: boolean; tools?: Array<{ description: string; inputSchema: unknown }> } })
  assert.equal(responses.find(response => response.id === 2)?.result.isError ?? false, false)
  assert.equal(responses.find(response => response.id === 3)?.result.isError, true)
  assert.equal(responses.find(response => response.id === 4)?.result.isError, true)
  assert.equal(fs.readFileSync(path.join(root, allowed), 'utf8'), sourceBefore)
  assert.doesNotMatch(JSON.stringify(responses.find(response => response.id === 1)?.result.tools), /api\.crud-query-engine-custom-fields|api\.openapi|allowedCapabilityIds|canonicalReadPaths/)
  const prompt = evaluator.buildPrompt(record, root, true)
  assert.ok(canonicalReadPaths(prompt).includes(allowed))
  assert.ok(!canonicalReadPaths(prompt).includes(hidden))
}))

test('canonical permission projection rejects unsafe inventory paths before exposing metadata', () => fixture(root => {
  const { record } = stageDeclaredEvidence(root, 'OMH-009')
  const relative = 'src/modules/example/references/surface-inventory.json'
  const original = fs.readFileSync(path.join(root, relative), 'utf8')
  for (const unsafe of ['src/modules/example/../private.ts', 'src/modules/example/.env', 'src/modules/example/.ai/harness/oracle.mjs']) {
    const inventory = JSON.parse(original) as { capabilities: Array<{ capabilityId: string; sourcePaths: string[] }> }
    inventory.capabilities.find(entry => entry.capabilityId === 'data.migrations')!.sourcePaths.push(unsafe)
    write(root, relative, JSON.stringify(inventory))
    assert.throws(() => evaluator.buildPrompt(record, root, true), /canonical|example|unsafe|read/i)
  }
}))

test('canonical permission projection excludes noncanonical targets and QA-only capabilities', () => fixture(root => {
  const { record } = stageDeclaredEvidence(root, 'OMH-009')
  const relative = 'src/modules/example/references/surface-inventory.json'
  const inventory = JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8')) as { capabilities: Array<{ capabilityId: string; readStatus: string; sourcePaths: string[] }> }
  const capability = inventory.capabilities.find(entry => entry.capabilityId === 'data.migrations')!
  capability.sourcePaths.push('src/modules/library/private-source.ts')
  inventory.capabilities.push({ capabilityId: 'qa.reference', readStatus: 'qa-only', sourcePaths: ['src/modules/example/qa-reference.ts'] })
  write(root, 'src/modules/example/qa-reference.ts', 'export const fixtureQaOnly = true\n')
  write(root, relative, JSON.stringify(inventory))
  const paths = canonicalReadPaths(evaluator.buildPrompt(record, root, true))
  assert.ok(paths.every(relative => relative.startsWith('src/modules/example/')))
  assert.ok(!paths.includes('src/modules/library/private-source.ts'))
  const qaSources = inventory.capabilities.filter(entry => entry.readStatus === 'qa-only').flatMap(entry => entry.sourcePaths)
  assert.ok(qaSources.length > 0)
  for (const source of qaSources) assert.ok(!paths.includes(source))
  record.context.exampleRoots![0].root = 'src/modules/library'
  assert.throws(() => evaluator.buildPrompt(record, root, true), /unsafe example entrypoint root/)
}))

test('canonical permission metadata preserves the existing read-only fixture prompt SHA', () => fixture((root, record) => {
  assert.equal(createHash('sha256').update(evaluator.buildPrompt(record, root, false)).digest('hex'), '310611533329dc0364caeb567261842e48da2b2458bef66f5dc4e40af2814027')
}))

test('writable grounding names only declared owner-to-source links while preserving grants and source contents', () => fixture(root => {
  const { record, selected } = stageDeclaredEvidence(root, 'OMH-014')
  const before = JSON.stringify(record)
  const allowlist = evaluator.caseReadAllowlist(record, true, root)
  const sources = selected.map(entry => [entry.resolvedPath, fs.readFileSync(path.join(root, entry.resolvedPath), 'utf8')])
  const prompt = evaluator.buildPrompt(record, root, true)
  for (const entry of selected) {
    assert.ok(prompt.includes(entry.originAsset), `missing routed owner ${entry.originAsset}`)
    assert.ok(prompt.includes(entry.resolvedPath), `missing exact source ${entry.resolvedPath}`)
    assert.ok(prompt.indexOf(entry.originAsset) < prompt.indexOf(entry.resolvedPath), 'the owner must precede its source')
    assert.ok(!prompt.includes(entry.referenceId), 'private inventory IDs are not routing answers')
  }
  assert.match(prompt, /AGENTS.*rout.*owner|rout.*AGENTS.*owner/is)
  assert.match(prompt, /owner.*entrypoint.*source/is)
  assert.doesNotMatch(prompt, /source-link-inventory\.json|expectedRouter|requiredSkills|requiredDecisions/)
  assert.equal(JSON.stringify(record), before)
  assert.deepEqual(evaluator.caseReadAllowlist(record, true, root), allowlist)
  for (const [relative, content] of sources) assert.equal(fs.readFileSync(path.join(root, relative), 'utf8'), content)
  assert.ok(!prompt.includes('src/modules/example/commands/todos.ts'), 'unrelated sources must not be disclosed')
}))

test('writable toolchain grounding quotes only actual baseline test script, provenance and an already allowed verification link', () => fixture(root => {
  const { record } = stageDeclaredEvidence(root, 'OMH-009')
  const verification = '.ai/skills/om-module-scaffold/references/verification.md'
  write(root, verification, fs.readFileSync(path.join(sharedRoot, 'ai/skills/om-module-scaffold/references/verification.md'), 'utf8'))
  const manifest = JSON.stringify({ scripts: { test: 'node ./project-runner.cjs --config project-tests.config.cjs', postinstall: 'PRIVATE_SCRIPT_SENTINEL' }, privateToken: 'PRIVATE_FIELD_SENTINEL' })
  write(root, 'package.json', manifest)
  const allowlist = evaluator.caseReadAllowlist(record, true, root)
  assert.ok(!allowlist.includes('package.json'))
  const prompt = evaluator.buildPrompt(record, root, true)
  assert.ok(prompt.includes('node ./project-runner.cjs --config project-tests.config.cjs'))
  assert.ok(prompt.includes(createHash('sha256').update(manifest).digest('hex')))
  assert.ok(prompt.includes(verification))
  assert.doesNotMatch(prompt, /PRIVATE_SCRIPT_SENTINEL|PRIVATE_FIELD_SENTINEL|never Vitest|must use Jest/)
  assert.match(prompt, /metadata.*not.*(?:tool|successful).*read/is)
  assert.deepEqual(evaluator.caseReadAllowlist(record, true, root), allowlist)
  write(root, 'package.json', JSON.stringify({ scripts: { test: 'another-runner run --serial' } }))
  const changed = evaluator.buildPrompt(record, root, true)
  assert.ok(changed.includes('another-runner run --serial'))
  assert.ok(!changed.includes('node ./project-runner.cjs'))
}))

test('writable grounding keeps an editable source seam distinct from immutable canonical references', () => fixture(root => {
  const { record } = stageDeclaredEvidence(root, 'OMH-029')
  const prompt = evaluator.buildPrompt(record, root, true)
  assert.match(prompt, /src\/modules\.ts.{0,160}(?:writable|editable)|(?:writable|editable).{0,160}src\/modules\.ts/is)
  assert.match(prompt, /preserve.*(?:ABI|exports|signature)/is)
}))

for (const [label, change] of [
  ['QA-only', (entry: SourceRecord) => { entry.readStatus = 'qa-only' }],
  ['unrouted owner', (entry: SourceRecord) => { entry.originAsset = '.ai/guides/unrelated.md' }],
  ['wrong preset', (entry: SourceRecord) => { entry.presets = ['not-the-active-preset'] }],
  ['unsafe path', (entry: SourceRecord) => { entry.resolvedPath = '../private.ts' }],
] as const) {
  test(`writable grounding rejects a declared ${label} reference before exposing it`, () => fixture(root => {
    const { record, inventory, selected } = stageDeclaredEvidence(root, 'OMH-014')
    change(selected[0])
    write(root, '.ai/harness/source-link-inventory.json', JSON.stringify(inventory))
    assert.throws(() => evaluator.buildPrompt(record, root, true), /source reference|qa-only|owner|preset|unsafe/i)
  }))
}

test('writable toolchain facts do not expose unsafe script secrets or missing/ungranted verification paths', () => fixture(root => {
  const { record } = stageDeclaredEvidence(root, 'OMH-014')
  record.expectedRouter.allowedExtra = []
  const verification = '.ai/skills/om-module-scaffold/references/verification.md'
  write(root, verification, '# Existing but not permitted for this synthetic UI-only case')
  write(root, 'package.json', JSON.stringify({ scripts: { test: 'TEST_TOKEN=PRIVATE_SECRET_SENTINEL node runner.cjs' } }))
  const prompt = evaluator.buildPrompt(record, root, true)
  assert.doesNotMatch(prompt, /PRIVATE_SECRET_SENTINEL/)
  assert.ok(!prompt.includes(verification))
  write(root, 'package.json', JSON.stringify({ scripts: {} }))
  assert.match(evaluator.buildPrompt(record, root, true), /test.*(?:not reported|not declared|unavailable|missing)/is)
}))

test('rendered grounding does not count as an owner read or bypass canonical source order', () => fixture(root => {
  const { record, selected } = stageDeclaredEvidence(root, 'OMH-014')
  evaluator.buildPrompt(record, root, true)
  const owner = selected[0].originAsset
  const source = selected[0].resolvedPath
  const entrypoint = 'src/modules/example/README.md'
  const early = evaluator.evaluateExampleReadPolicy({ caseRecord: record, appRoot: root, reads: [{ path: entrypoint }, { path: source }, { path: owner }] })
  assert.match(early.firstViolation, /before its origin owner was read/)
  const lateEntrypoint = evaluator.evaluateExampleReadPolicy({ caseRecord: record, appRoot: root, reads: [{ path: owner }, { path: source }, { path: entrypoint }] })
  assert.match(lateEntrypoint.firstViolation, /start from a declared entrypoint/)
  const ordered = evaluator.evaluateExampleReadPolicy({ caseRecord: record, appRoot: root, reads: [{ path: owner }, { path: entrypoint }, { path: source }] })
  assert.equal(ordered.firstViolation, null)
}))

test('canonical example access stays immutable even beneath a broad writable pattern', () => fixture(root => {
  const { record, selected } = stageDeclaredEvidence(root, 'OMH-014')
  record.allowedWrites = ['src/modules/**']
  const prompt = evaluator.buildPrompt(record, root, true)
  const pair = `"source":"${selected[0].resolvedPath}","access":"read-only-reference"`
  assert.ok(prompt.includes(pair))
}))

for (const invalid of ['symlink', 'malformed', 'oversized']) {
  test(`writable toolchain grounding rejects ${invalid} package provenance`, () => fixture((root, record) => {
    if (invalid === 'symlink') {
      write(root, 'private-package.json', JSON.stringify({ scripts: { test: 'PRIVATE_MANIFEST_SENTINEL' } }))
      fs.unlinkSync(path.join(root, 'package.json'))
      fs.symlinkSync(path.join(root, 'private-package.json'), path.join(root, 'package.json'))
    } else write(root, 'package.json', invalid === 'malformed' ? '{' : ' '.repeat(65_537))
    assert.throws(() => evaluator.buildPrompt(record, root, true), /baseline package\.json|bounded regular|valid JSON/)
  }))
}

test('writable final audit points back to the original AGENTS testing predicate without giving case routing answers', () => fixture((root, record) => {
  const prompt = evaluator.buildPrompt(record, root, true)
  assert.match(prompt, /(?:final|returning).{0,180}AGENTS\.md.{0,100}Axis 2.{0,100}testing/is)
  assert.match(prompt, /original request/is)
  assert.doesNotMatch(prompt, /expectedRouter|do not select testing|select only module-data/)
}))

test('read-only prompt ignores writable source metadata and package toolchain facts byte for byte', () => fixture(root => {
  const { record, inventory, selected } = stageDeclaredEvidence(root, 'OMH-014')
  const before = evaluator.buildPrompt(record, root, false)
  write(root, 'package.json', JSON.stringify({ scripts: { test: 'another-runner run' } }))
  selected[0].readStatus = 'qa-only'
  write(root, '.ai/harness/source-link-inventory.json', JSON.stringify(inventory))
  assert.equal(evaluator.buildPrompt(record, root, false), before)
}))

test('seed hints cannot disclose paths outside allowed app source, secrets, symlinks or oracle internals', () => fixture((root, record) => {
  write(root, 'private.txt', 'PRIVATE_SENTINEL')
  fs.symlinkSync(path.join(root, 'private.txt'), path.join(root, 'src/modules/library/linked.ts'))
  for (const relative of ['.env', 'credentials.json', '.credentials.json', 'auth.json', 'secrets.yaml']) write(root, relative, 'PRIVATE_SENTINEL')
  for (const seed of ['../private.txt', '/tmp/root-escape.ts', 'src/modules/library/../private.ts', 'src/modules/library/%2e%2e/private.ts', '.env', 'credentials.json', '.credentials.json', 'auth.json', 'secrets.yaml', '.ai/harness/cases.json', 'src/modules/example/data/entities.ts', 'src/modules/library/linked.ts']) {
    const unsafe = { fixtures: { activity: { seededArtifacts: [seed] } } }
    assert.throws(() => evaluator.buildPrompt(record, root, true, [], unsafe), /seed|unsafe|allowed|symbolic/i)
  }
}))

test('read-only routing prompt keeps its audit, final instruction re-read and no-implementation contract', () => fixture((root, record) => {
  const prompt = evaluator.buildPrompt(record, root, false, [], fixtures)
  assert.match(prompt, /Work read-only: do not edit files/)
  assert.match(prompt, /Immediately before output, re-read every selectedContext path/)
  assert.match(prompt, /Before opening progressive context, privately audit/)
  assert.doesNotMatch(prompt, /src\/modules\/library\/workflows\/call-api\.ts/)
}))

test('prepared coding context grants exact production matches rather than QA, unrelated or optional oversized files', () => fixture((root, record) => {
  const prepared = prepare(root, record)
  assert.equal(prepared.entries.length, 1)
  const entry = prepared.entries[0]
  assert.deepEqual(entry.sourceFiles, [`${entry.sourceRoot}/lib/call-api.ts`])
  assert.ok(prepared.patterns.includes(entry.manifest))
  assert.ok(prepared.patterns.includes(entry.searchResult))
  assert.ok(prepared.patterns.includes(entry.sourceFiles[0]))
  assert.ok(prepared.patterns.every((item) => !item.includes('*')))
  assert.ok(prepared.patterns.every((item) => !item.includes('__tests__') && !item.endsWith('/upstream-root.md') && !item.endsWith('/unrelated.ts') && !item.endsWith('/.env')))
  const search = fs.readFileSync(path.join(root, entry.searchResult), 'utf8')
  assert.match(search, /lib\/call-api\.ts:\d+:/)
  assert.doesNotMatch(search, /QA_ONLY_SENTINEL|PRIVATE_SENTINEL|__tests__/)
  const manifest = JSON.parse(fs.readFileSync(path.join(root, entry.manifest), 'utf8'))
  assert.equal(manifest.package.name, '@open-mercato/core')
  assert.equal(manifest.package.version, '1.0.0')
  assert.equal(manifest.boundedSearch.matches, search.trim().split('\n').length)
  assert.ok(manifest.instructions.every((item: { materializedPath: string }) => prepared.patterns.includes(item.materializedPath)))
}))

test('QA-only prepared searches fail before an inference process can start', () => fixture((root, record) => {
  write(root, 'node_modules/@open-mercato/core/src/modules/workflows/lib/call-api.ts', 'export const production = true\n')
  assert.throws(() => prepare(root, record), /production|QA.only|no exact/i)
}))

test('mandatory prepared production source must fit the total context budget before inference', () => fixture((root, record) => {
  record.maxTotalContextBytes = 2048
  write(root, 'node_modules/@open-mercato/core/src/modules/workflows/lib/call-api.ts', 'export const callApiActivity = true\n' + 'x'.repeat(4096))
  assert.throws(() => prepare(root, record), /mandatory.*budget|context.*budget|exceeds.*bytes/i)
}))

test('mandatory initial instructions are checked together with prepared evidence', () => fixture((root, record) => {
  record.maxInitialContextBytes = 8
  assert.throws(() => prepare(root, record), /initial.*budget|mandatory.*budget|context.*budget/i)
}))

test('unsafe materialization roots remain denied', () => fixture((root, record) => {
  const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-coding-context-outside-')))
  try {
    fs.symlinkSync(outside, path.join(root, '.ai/framework-context'))
    assert.throws(() => prepare(root, record), /symbolic|unsafe|preparation failed/i)
    assert.deepEqual(fs.readdirSync(outside), [])
  } finally { fs.rmSync(outside, { recursive: true, force: true }) }
}))

test('oversized optional package instructions are omitted without making required production evidence infeasible', () => fixture((root, record) => {
  write(root, 'node_modules/@open-mercato/core/AGENTS.md', '# Optional package guidance\n' + 'oversized '.repeat(16000))
  const prepared = prepare(root, record)
  const entry = prepared.entries[0]
  assert.ok(prepared.patterns.every((item) => !item.endsWith('/instructions/package.md')))
  const manifest = JSON.parse(fs.readFileSync(path.join(root, entry.manifest), 'utf8'))
  assert.deepEqual(manifest.instructions, [])
  assert.equal(manifest.package.version, '1.0.0')
  assert.deepEqual(entry.sourceFiles, [`${entry.sourceRoot}/lib/call-api.ts`])
}))

test('prepared evidence budgets are cumulative across multiple installed queries', () => fixture((root, record) => {
  write(root, 'node_modules/@open-mercato/shared/package.json', JSON.stringify({ name: '@open-mercato/shared', version: '1.0.0' }))
  write(root, 'node_modules/@open-mercato/shared/src/code-workflow.ts', 'export interface CodeWorkflowDefinition {}\n' + 'x'.repeat(2200))
  write(root, 'node_modules/@open-mercato/core/src/modules/workflows/lib/call-api.ts', 'export const callApiActivity = true\n' + 'x'.repeat(2200))
  record.maxTotalContextBytes = 5500
  record.frameworkContext = [{ module: 'workflows', query: 'callApiActivity' }, { package: '@open-mercato/shared', query: 'interface CodeWorkflowDefinition' }]
  assert.throws(() => evaluator.prepareCaseFrameworkContext(record, root, root, { writable: true }), /mandatory.*budget|context.*budget/i)
}))

test('read-only prepared context preserves its existing routing controls', () => fixture((root, record) => {
  record.frameworkContext = [{ module: 'workflows', query: 'callApiActivity' }]
  const prepared = evaluator.prepareCaseFrameworkContext(record, root, root)
  assert.ok(prepared.patterns.some((item: string) => item.endsWith('/**')))
  assert.ok(prepared.entries[0].sourceFiles.some((item: string) => item.includes('__tests__')))
}))

test('OMH-230 protected fixture seed does not become a writable prompt target or permission', () => fixture((root) => {
  const catalog = JSON.parse(fs.readFileSync(path.join(sharedRoot, 'ai/harness/cases.json'), 'utf8')) as ContextCase[]
  const actualFixtures = JSON.parse(fs.readFileSync(path.join(sharedRoot, 'ai/harness/fixtures/index.json'), 'utf8'))
  const seeds = JSON.parse(fs.readFileSync(path.join(sharedRoot, 'ai/harness/fixtures/seeds.json'), 'utf8'))
  const record = catalog.find(item => item.id === 'OMH-230')!
  const fixtureId = record.fixture.setup[0].slice('fixture:'.length)
  for (const [relative, content] of Object.entries(seeds.fixtures[fixtureId])) write(root, relative, String(content))
  const preserved = 'src/modules/resume_demo/lib/preserved.ts'
  const preservedContent = fs.readFileSync(path.join(root, preserved), 'utf8')
  const permissions = JSON.stringify(record.allowedWrites)
  const fixtureMetadata = JSON.stringify(actualFixtures.fixtures[fixtureId])
  const prompt = evaluator.buildPrompt(record, root, true, [], actualFixtures)
  assert.match(prompt, /Existing seeded target files:.*format-export\.ts/)
  assert.doesNotMatch(prompt, /Existing seeded target files:[^\n]*preserved\.ts/)
  assert.equal(fs.readFileSync(path.join(root, preserved), 'utf8'), preservedContent)
  assert.equal(JSON.stringify(record.allowedWrites), permissions)
  assert.equal(JSON.stringify(actualFixtures.fixtures[fixtureId]), fixtureMetadata)
  const allowedReads: string[] = evaluator.caseReadAllowlist(record, true, root)
  assert.ok(!allowedReads.some(pattern => pattern === preserved || (pattern.endsWith('/**') && preserved.startsWith(pattern.slice(0, -2)))))
}))

test('every declared writable case can render its safe seeded prompt without widening its write contract', () => fixture((root) => {
  const catalog = JSON.parse(fs.readFileSync(path.join(sharedRoot, 'ai/harness/cases.json'), 'utf8')) as ContextCase[]
  const actualFixtures = JSON.parse(fs.readFileSync(path.join(sharedRoot, 'ai/harness/fixtures/index.json'), 'utf8'))
  const seeds = JSON.parse(fs.readFileSync(path.join(sharedRoot, 'ai/harness/fixtures/seeds.json'), 'utf8'))
  const registry = JSON.parse(fs.readFileSync(path.join(sharedRoot, 'ai/harness/validators.json'), 'utf8'))
  const writableIds: string[] = registry.catalog.writableCaseIds
  assert.equal(writableIds.length, 49)
  for (const caseId of writableIds) {
    const record = catalog.find(item => item.id === caseId)!
    const permissions = JSON.stringify(record.allowedWrites)
    if (record.context.sourceReferenceIds?.length || record.context.exampleRoots?.length) stageDeclaredEvidence(root, caseId)
    for (const declaration of record.fixture.setup) {
      const fixtureId = declaration.slice('fixture:'.length)
      for (const [relative, content] of Object.entries(seeds.fixtures[fixtureId])) write(root, relative, String(content))
    }
    assert.doesNotThrow(() => evaluator.buildPrompt(record, root, true, [], actualFixtures), caseId)
    const prompt = evaluator.buildPrompt(record, root, true, [], actualFixtures)
    const expectedPaths: string[] = evaluator.exampleReadAllowlist(record, root).filter((relative: string) => relative.startsWith('src/modules/example/')).sort()
    assert.deepEqual(canonicalReadPaths(prompt), expectedPaths, caseId)
    assert.ok(Buffer.byteLength(JSON.stringify(codingEvidence(prompt))) <= 8192, caseId)
    assert.equal(JSON.stringify(record.allowedWrites), permissions, caseId)
  }
}))
