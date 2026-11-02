import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { extractAllModuleFacts } from '../../../cli/src/lib/generators/module-facts.js'
import { discoverPackageModuleSources } from '../../../cli/src/lib/generators/module-facts-discovery.js'
import { createResolver } from '../../../cli/src/lib/resolver.js'

type ContractCase = {
  id: string
  evaluationKind: string
  context: { required: string[]; allowedExtra?: string[] }
  allowedWrites?: string[]
  maxContextFiles: number
  maxInitialContextBytes: number
  maxTotalContextBytes: number
}
type ToolReply = { id: number; result: { isError?: boolean; content: Array<{ type: string; text: string }> } }
const packageRoot = fileURLToPath(new URL('../../', import.meta.url))
const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const shared = path.join(packageRoot, 'agentic/shared')
const compatibility = '.ai/guides/upstream/BACKWARD_COMPATIBILITY.md'
const verification = '.ai/skills/om-module-scaffold/references/verification.md'
const catalog = JSON.parse(fs.readFileSync(path.join(shared, 'ai/harness/cases.json'), 'utf8')) as ContractCase[]
const registry = JSON.parse(fs.readFileSync(path.join(shared, 'ai/harness/validators.json'), 'utf8')) as {
  catalog: { compatibilityRequiredCaseIds: string[]; compatibilityExcludedCaseIds: string[] }
}
const { caseReadAllowlist } = await import(pathToFileURL(path.join(shared, 'scripts/evaluate-agent-harness.mjs')).href) as {
  caseReadAllowlist: (record: ContractCase, writable: boolean, root: string) => string[]
}
const candidates = ['OMH-011', 'OMH-012', 'OMH-018']
const unchangedInitialBounds: Record<string, { files: number; bytes: number }> = {
  'OMH-011': { files: 6, bytes: 40960 },
  'OMH-012': { files: 6, bytes: 40960 },
  'OMH-018': { files: 6, bytes: 45056 },
}
const digest = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex')

function caseRecord(id: string): ContractCase {
  const record = catalog.find(entry => entry.id === id)
  assert.ok(record, `catalog case ${id} must exist`)
  return record
}

function fixture(run: (root: string) => void) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-bc-delivery-')))
  const write = (relative: string, content: string | Buffer) => {
    const file = path.join(root, relative)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, content)
  }
  write(compatibility, fs.readFileSync(path.join(repositoryRoot, 'BACKWARD_COMPATIBILITY.md')))
  write('AGENTS.md', fs.readFileSync(path.join(shared, 'AGENTS.md.template')))
  write('.ai/guides/upstream/AGENTS.md', 'UNRELATED_UPSTREAM_SENTINEL')
  write('.env', 'SECRET_SENTINEL')
  write('src/private.ts', 'UNRELATED_SOURCE_SENTINEL')
  try { run(root) } finally { fs.rmSync(root, { recursive: true, force: true }) }
}

function readTools(root: string, record: ContractCase, paths: string[]): ToolReply[] {
  const writable = ['implementation', 'regression'].includes(record.evaluationKind)
  const messages = paths.map((relative, index) => ({ jsonrpc: '2.0', id: index + 1, method: 'tools/call', params: { name: 'read', arguments: { path: relative } } }))
  const execution = spawnSync(process.execPath, [
    path.join(shared, 'scripts/agent-harness-tool-server.mjs'), root, writable ? 'writable' : 'read-only',
    JSON.stringify(caseReadAllowlist(record, writable, root)), JSON.stringify(writable ? record.allowedWrites ?? [] : []),
  ], { input: `${messages.map(message => JSON.stringify(message)).join('\n')}\n`, encoding: 'utf8', env: {}, timeout: 10000 })
  assert.equal(execution.status, 0, execution.stderr)
  return execution.stdout.trim().split('\n').map(line => JSON.parse(line)) as ToolReply[]
}

for (const id of candidates) {
  test(`${id} delivers the exact required public-contract policy without opening unrelated context`, () => fixture(root => {
    const record = caseRecord(id)
    const replies = readTools(root, record, [compatibility, '.ai/guides/upstream/AGENTS.md', '.env', 'src/private.ts'])
    assert.equal(replies[0].result.isError, undefined, `${id}: the literal compatibility pointer must be readable`)
    const expected = fs.readFileSync(path.join(root, compatibility))
    const delivered = replies[0].result.content[0].text
    assert.equal(Buffer.byteLength(delivered), expected.length)
    assert.equal(digest(delivered), digest(expected))
    assert.ok(record.context.required.includes(compatibility))
    assert.ok(registry.catalog.compatibilityRequiredCaseIds.includes(id))
    assert.ok(!registry.catalog.compatibilityExcludedCaseIds.includes(id))
    for (const reply of replies.slice(1)) assert.equal(reply.result.isError, true)
    assert.doesNotMatch(JSON.stringify(replies), /UNRELATED_UPSTREAM_SENTINEL|SECRET_SENTINEL|UNRELATED_SOURCE_SENTINEL/)
  }))
}

test('published CLI compatibility remains required while additive installed form extension remains excluded', () => fixture(root => {
  const published = caseRecord('OMH-022')
  const approved = readTools(root, published, [compatibility])[0]
  assert.equal(approved.result.isError, undefined)
  assert.equal(digest(approved.result.content[0].text), digest(fs.readFileSync(path.join(root, compatibility))))
  assert.ok(published.context.required.includes(compatibility))
  assert.ok(registry.catalog.compatibilityRequiredCaseIds.includes(published.id))
  for (const id of ['OMH-006', 'OMH-014', 'OMH-026', 'OMH-091', 'OMH-172', 'OMH-177']) {
    const excluded = caseRecord(id)
    assert.equal(readTools(root, excluded, [compatibility])[0].result.isError, true, `${id} must not gain blanket compatibility context`)
    assert.ok(registry.catalog.compatibilityExcludedCaseIds.includes(id))
  }
}))

let factIndexes: Record<string, string> | undefined
function sourceContext(relative: string): Buffer {
  if (relative === 'AGENTS.md') return Buffer.alloc(12 * 1024)
  if (relative === compatibility) return fs.readFileSync(path.join(repositoryRoot, 'BACKWARD_COMPATIBILITY.md'))
  const module = /^\.ai\/guides\/modules\/([a-z0-9_]+)\/index\.md$/.exec(relative)
  if (module) {
    if (!factIndexes) {
      const modules = new Set(['events', 'api_docs', 'search', 'query_index'])
      const version = (JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8')) as { version: string }).version
      const sources = discoverPackageModuleSources(createResolver(repositoryRoot)).filter(source => modules.has(source.moduleId))
      const { directoryByModule } = extractAllModuleFacts({ sources, coreVersion: version, registryPath: null })
      factIndexes = Object.fromEntries(Object.entries(directoryByModule).map(([id, directory]) => [id, directory.index]))
    }
    assert.ok(factIndexes[module[1]], `missing actual source-derived fact index ${module[1]}`)
    return Buffer.from(factIndexes[module[1]])
  }
  if (relative.startsWith('.ai/guides/')) return fs.readFileSync(path.join(packageRoot, 'agentic/guides', relative.slice('.ai/guides/'.length)))
  assert.ok(relative.startsWith('.ai/skills/'), `unexpected ordinary context source ${relative}`)
  return fs.readFileSync(path.join(shared, 'ai', relative.slice('.ai/'.length)))
}

function initialContext(relative: string): boolean {
  return !relative.includes('/references/') && !['.ai/framework-context/', '.ai/guides/modules/', '.ai/guides/reference-modules/', '.ai/guides/upstream/', '.agents/skills/'].some(prefix => relative.startsWith(prefix))
}

for (const id of candidates) {
  test(`${id} fits mandatory compatibility and legitimate verification within total context, preserving initial bounds`, () => {
    const record = caseRecord(id)
    const paths = [...new Set([
      ...record.context.required, ...(record.context.allowedExtra ?? []), compatibility,
      ...(['implementation', 'regression'].includes(record.evaluationKind) ? [verification] : []),
    ])]
    const initial = paths.filter(initialContext)
    const initialBytes = initial.reduce((bytes, relative) => bytes + sourceContext(relative).length, 0)
    const totalBytes = paths.reduce((bytes, relative) => bytes + sourceContext(relative).length, 0)
    assert.equal(record.maxContextFiles, unchangedInitialBounds[id].files)
    assert.equal(record.maxInitialContextBytes, unchangedInitialBounds[id].bytes)
    assert.ok(initial.length <= record.maxContextFiles)
    assert.ok(initialBytes <= record.maxInitialContextBytes)
    assert.ok(totalBytes <= record.maxTotalContextBytes, `${id}: ${totalBytes} ordinary bytes exceed total cap ${record.maxTotalContextBytes}`)
    assert.ok(record.maxTotalContextBytes - totalBytes < 1024, `${id} must not fund unrelated context beyond the measured 1KiB rounding`)
  })
}
