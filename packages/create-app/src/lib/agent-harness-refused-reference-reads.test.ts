import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const evaluator = await import(new URL('../../agentic/shared/scripts/evaluate-agent-harness.mjs', import.meta.url).href)
const server = fileURLToPath(new URL('../../agentic/shared/scripts/agent-harness-tool-server.mjs', import.meta.url))
const records = JSON.parse(fs.readFileSync(new URL('../../agentic/shared/ai/harness/cases.json', import.meta.url), 'utf8')) as Array<{
  id: string
  context: { required: string[]; forbidden: string[]; exampleRoots: Array<{ maxFiles: number; maxBytes: number }> }
  allowedWrites?: string[]
}>
const example = 'src/modules/example'
const readme = `${example}/README.md`
const inventory = `${example}/references/surface-inventory.json`
const humanMap = `${example}/references/surface-map.md`
const entity = `${example}/data/entities.ts`
const validator = `${example}/data/validators.ts`
type Read = { path: string; refused?: boolean }

function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-refused-reference-')))
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# App\n')
  fs.cpSync(new URL('../../template/src/modules/example/', import.meta.url), path.join(root, example), { recursive: true })
  return root
}

function wire(reads: Read[], runner: 'codex' | 'claude' = 'codex') {
  if (runner === 'codex') return reads.map((read, index) => JSON.stringify({ type: 'item.completed', item: {
    type: 'mcp_tool_call', id: `read-${index}`, name: 'mcp__harness__read', status: read.refused ? 'failed' : 'completed', arguments: { path: read.path },
  } })).join('\n')
  return reads.flatMap((read, index) => [
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: `read-${index}`, name: 'mcp__harness__read', input: { path: read.path } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: `read-${index}`, is_error: Boolean(read.refused), content: read.refused ? 'path is outside the case read allowlist' : '# read' }] } },
  ]).map(event => JSON.stringify(event)).join('\n')
}

for (const id of ['OMH-185', 'OMH-193']) {
  for (const runner of ['codex', 'claude'] as const) {
    test(`${id} ${runner} failure events derived from real MCP refusals never charge reference reads`, () => {
      const root = fixture()
      try {
        const record = records.find(record => record.id === id)
        assert.ok(record)
        const allowed = evaluator.caseReadAllowlist(record, true, root)
        assert.ok(!allowed.includes(humanMap))
        const reads = ['AGENTS.md', readme, inventory, entity, humanMap]
        const messages = reads.map((file, index) => ({ jsonrpc: '2.0', id: index + 1, method: 'tools/call', params: { name: 'read', arguments: { path: file } } }))
        const result = spawnSync(process.execPath, [server, root, 'read-only', JSON.stringify(allowed), '[]'], {
          input: messages.map(message => JSON.stringify(message)).join('\n') + '\n', encoding: 'utf8', env: {},
        })
        assert.equal(result.status, 0, result.stderr)
        const replies = result.stdout.trim().split('\n').map(line => JSON.parse(line))
        assert.equal(replies.length, reads.length)
        for (const reply of replies.slice(0, -1)) assert.equal(reply.result.isError, undefined)
        assert.equal(replies.at(-1).result.isError, true)
        const trace = evaluator.observedContext(wire(reads.map((file, index) => ({ path: file, refused: Boolean(replies[index].result.isError) })), runner), root, record, true)
        assert.deepEqual(trace.violations, [])
        assert.deepEqual(trace.paths, reads.slice(0, -1).sort())
        assert.deepEqual(trace.readOrder, reads.slice(0, -1))
        assert.deepEqual(trace.refusedPaths, [humanMap])
        assert.equal(trace.exampleReadPolicy.roots[0].files, 3)
        assert.equal(trace.exampleReadPolicy.roots[0].bytes, [readme, inventory, entity].reduce((total, file) => total + fs.statSync(path.join(root, file)).size, 0))
      } finally { fs.rmSync(root, { recursive: true, force: true }) }
    })
  }
}

test('refused authorized references remain budget-neutral while successful reads enforce the same limits', () => {
  const root = fixture()
  try {
    const record = structuredClone(records.find(record => record.id === 'OMH-185'))
    assert.ok(record)
    const successful = ['AGENTS.md', readme, inventory, entity].map(file => ({ path: file }))
    const bytes = [readme, inventory, entity].reduce((total, file) => total + fs.statSync(path.join(root, file)).size, 0)
    record.context.exampleRoots[0].maxFiles = 3
    record.context.exampleRoots[0].maxBytes = bytes
    const trace = evaluator.observedContext(wire([...successful.slice(0, 3), { path: validator, refused: true }, successful[3]]), root, record, false)
    assert.deepEqual(trace.violations, [])
    assert.deepEqual(trace.refusedPaths, [validator])
    assert.ok(!trace.paths.includes(validator))
    assert.ok(!trace.readOrder.includes(validator))
    assert.equal(trace.exampleReadPolicy.roots[0].files, 3)
    assert.equal(trace.exampleReadPolicy.roots[0].bytes, bytes)
    const overflow = evaluator.observedContext(wire([...successful, { path: validator }]), root, record, false)
    assert.ok(overflow.violations.some((message: string) => message.includes('example root file budget exceeded')))
    record.context.exampleRoots[0].maxFiles = 4
    const byteOverflow = evaluator.observedContext(wire([...successful, { path: validator }]), root, record, false)
    assert.ok(byteOverflow.violations.some((message: string) => message.includes('example root byte budget exceeded')))
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('successful undeclared protected reads still fail and cannot masquerade as refused calls', () => {
  const root = fixture()
  try {
    const record = records.find(record => record.id === 'OMH-193')
    assert.ok(record)
    const trace = evaluator.observedContext(wire(['AGENTS.md', readme, inventory, humanMap].map(file => ({ path: file }))) + '\n' + JSON.stringify({ type: 'error', id: 'read-3', status: 'failed' }), root, record, false)
    assert.ok(trace.violations.some((message: string) => message.includes('example-root read is not mapped by the surface inventory')))
    assert.ok(trace.paths.includes(humanMap))
    assert.deepEqual(trace.refusedPaths, [])
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('a refused entrypoint cannot authorize a later successful source read', () => {
  const root = fixture()
  try {
    const record = records.find(record => record.id === 'OMH-185')
    assert.ok(record)
    const trace = evaluator.observedContext(wire([{ path: 'AGENTS.md' }, { path: readme, refused: true }, { path: entity }]), root, record, false)
    assert.ok(!trace.paths.includes(readme))
    assert.ok(!trace.readOrder.includes(readme))
    assert.ok(trace.violations.some((message: string) => message.includes('example-root reading must start from a declared entrypoint')))
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

for (const shape of ['forbidden', 'inside-symlink', 'escaping-symlink', 'directory', 'glob']) {
  test(`refusing a ${shape} reference still preserves its fatal safety guard`, () => {
    const root = fixture()
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'om-refused-reference-outside-'))
    try {
      const record = records.find(record => record.id === 'OMH-185')
      assert.ok(record)
      let target = `${example}/escape.ts`
      if (shape === 'forbidden') {
        target = '.env'
        fs.writeFileSync(path.join(root, target), 'must-not-be-loaded')
      } else if (shape === 'inside-symlink') {
        fs.symlinkSync(path.join(root, entity), path.join(root, target))
      } else if (shape === 'escaping-symlink') {
        fs.writeFileSync(path.join(outside, 'private.ts'), 'must-not-be-loaded')
        fs.symlinkSync(path.join(outside, 'private.ts'), path.join(root, target))
      } else target = shape === 'directory' ? `${example}/data` : `${example}/**`
      const trace = evaluator.observedContext(wire([{ path: 'AGENTS.md' }, { path: target, refused: true }]), root, record, false)
      assert.ok(trace.violations.length > 0, shape)
      assert.ok(!trace.paths.includes(target), shape)
      assert.ok(!trace.refusedPaths.includes(target), shape)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
      fs.rmSync(outside, { recursive: true, force: true })
    }
  })
}

test('refused protected-source enumeration still fails above the unchanged six-read bound', () => {
  const root = fixture()
  try {
    const record = records.find(record => record.id === 'OMH-185')
    assert.ok(record)
    const refused = Array.from({ length: 7 }, (_, index) => `${example}/unmapped-${index}.ts`)
    for (const file of refused) fs.writeFileSync(path.join(root, file), 'never loaded')
    const trace = evaluator.observedContext(wire([{ path: 'AGENTS.md' }, ...refused.map(file => ({ path: file, refused: true }))]), root, record, false)
    assert.deepEqual(trace.paths, ['AGENTS.md'])
    assert.deepEqual(trace.refusedPaths, refused)
    assert.ok(trace.violations.includes('refused context read budget exceeded: 7/6'))
    assert.equal(trace.exampleReadPolicy.roots[0].files, 0)
    assert.equal(trace.exampleReadPolicy.roots[0].bytes, 0)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
