import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const sharedRoot = fileURLToPath(new URL('../../agentic/shared/', import.meta.url))
const evaluatorPath = path.join(sharedRoot, 'scripts/evaluate-agent-harness.mjs')
const evaluator = await import(pathToFileURL(evaluatorPath).href)

type ContextCase = {
  id: string
  prompt: string
  evaluationKind: string
  requiredSkills: string[]
  requiredDecisions: string[]
  expectedRouter: { required: string[]; allowedExtra: string[] }
  context: { required: string[]; forbidden: string[] }
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
    for (const declaration of record.fixture.setup) {
      const fixtureId = declaration.slice('fixture:'.length)
      for (const [relative, content] of Object.entries(seeds.fixtures[fixtureId])) write(root, relative, String(content))
    }
    assert.doesNotThrow(() => evaluator.buildPrompt(record, root, true, [], actualFixtures), caseId)
    assert.equal(JSON.stringify(record.allowedWrites), permissions, caseId)
  }
}))
