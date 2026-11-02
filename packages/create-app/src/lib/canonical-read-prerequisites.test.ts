import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const server = fileURLToPath(new URL('../../agentic/shared/scripts/agent-harness-tool-server.mjs', import.meta.url))
const source = 'src/modules/example/api/items/route.ts'
const owner = '.ai/skills/om-module-scaffold/references/api-and-domain.md'
const entrypoint = 'src/modules/example/README.md'
const target = 'src/modules/library/api/items/route.ts'
const sourceBody = 'export const canonicalSource = "EXACT_SOURCE_BODY"\n'
const policy = [{ path: source, owner, entrypoints: [entrypoint] }]
type Call = { name: string; arguments: Record<string, unknown> }
type Reply = { id: number; result: { isError?: boolean; content?: Array<{ type: string; text?: string }>; tools?: unknown[] } }
type InvocationOptions = {
  runner: string; root: string; schemaPath: string; outputPath: string; writable: boolean;
  allowedReads: string[]; allowedWrites: string[]; immutableRoots: string[]; readPrerequisites: typeof policy;
}

async function invocationBuilder() {
  const evaluator = path.join(path.dirname(server), 'evaluate-agent-harness.mjs')
  const declaration = /^function buildRunnerInvocation\(/m
  const sourceText = fs.readFileSync(evaluator, 'utf8')
  assert.match(sourceText, declaration)
  const bridge = path.join(path.dirname(evaluator), `.canonical-prerequisite-test-${process.pid}.mjs`)
  try {
    fs.writeFileSync(bridge, sourceText.replace(declaration, 'export function buildRunnerInvocation('), { flag: 'wx', mode: 0o600 })
    return await import(pathToFileURL(bridge).href) as { buildRunnerInvocation: (options: InvocationOptions) => { command: string; args: string[] } }
  } finally {
    if (fs.existsSync(bridge)) fs.unlinkSync(bridge)
  }
}

function write(root: string, relative: string, content: string) {
  fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true })
  fs.writeFileSync(path.join(root, relative), content)
}

function fixture(run: (root: string) => void) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-canonical-prerequisites-')))
  write(root, source, sourceBody)
  write(root, owner, '# Public source owner\n')
  write(root, entrypoint, '# Canonical navigation\n')
  try { run(root) } finally { fs.rmSync(root, { recursive: true, force: true }) }
}

function invoke(root: string, calls: Call[], prerequisites: unknown = policy, reads = [source, owner, entrypoint]) {
  const input = [
    { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
    ...calls.map((params, index) => ({ jsonrpc: '2.0', id: index + 2, method: 'tools/call', params })),
  ].map((entry) => JSON.stringify(entry)).join('\n') + '\n'
  const execution = spawnSync(process.execPath, [server, root, 'writable', JSON.stringify(reads), JSON.stringify([target])], {
    encoding: 'utf8', input, timeout: 5000, maxBuffer: 2 * 1024 * 1024,
    env: {
      PATH: process.env.PATH ?? '',
      OM_HARNESS_IMMUTABLE_ROOTS: '["src/modules/example"]',
      ...(prerequisites === null ? {} : { OM_HARNESS_READ_PREREQUISITES: typeof prerequisites === 'string' ? prerequisites : JSON.stringify(prerequisites) }),
    },
  })
  const replies = execution.stdout.split('\n').filter(Boolean).map((line) => JSON.parse(line) as Reply)
  return { execution, replies }
}

function read(relative: string, extra: Record<string, unknown> = {}): Call {
  return { name: 'read', arguments: { path: relative, ...extra } }
}

function reply(replies: Reply[], index: number) {
  const found = replies.find((entry) => entry.id === index + 2)
  assert.ok(found, 'the server must answer the exact call')
  return found.result
}

test('canonical source bytes are withheld until the exact owner and an entrypoint have both succeeded', () => fixture(root => {
  const { execution, replies } = invoke(root, [read(source), read(owner), read(source), read(entrypoint), read(source)])
  assert.equal(execution.status, 0)
  for (const index of [0, 2]) {
    assert.equal(reply(replies, index).isError, true)
    assert.ok(!JSON.stringify(reply(replies, index)).includes('EXACT_SOURCE_BODY'))
  }
  assert.ok(JSON.stringify(reply(replies, 0)).includes(owner))
  assert.ok(JSON.stringify(reply(replies, 2)).includes(entrypoint))
  assert.deepEqual(reply(replies, 4), { content: [{ type: 'text', text: sourceBody }] })
}))

test('README navigation may precede the exact source owner and a fresh server resets the prerequisites', () => fixture(root => {
  const ordered = invoke(root, [read(entrypoint), read(owner), read(source)])
  assert.equal(ordered.execution.status, 0)
  assert.equal(reply(ordered.replies, 2).isError, undefined)
  const restarted = invoke(root, [read(source)])
  assert.equal(restarted.execution.status, 0)
  assert.equal(reply(restarted.replies, 0).isError, true)
}))

test('an unsuccessful owner read never unlocks canonical source delivery', () => fixture(root => {
  const { execution, replies } = invoke(root, [read(entrypoint), read(owner, { reason: 'UNDECLARED_REASON' }), read(source), read(owner), read(source)])
  assert.equal(execution.status, 0)
  assert.equal(reply(replies, 1).isError, true)
  assert.equal(reply(replies, 2).isError, true)
  assert.deepEqual(reply(replies, 4), { content: [{ type: 'text', text: sourceBody }] })
}))

test('optional policy preserves the tool schema, ordinary target writes and canonical immutability', () => fixture(root => {
  const calls = [read(source), { name: 'write', arguments: { path: target, content: 'export const target = true\n' } }, { name: 'write', arguments: { path: source, content: 'modified' } }]
  const guarded = invoke(root, calls)
  const legacy = invoke(root, [read(source)], null)
  assert.equal(guarded.execution.status, 0)
  assert.equal(legacy.execution.status, 0)
  assert.deepEqual(guarded.replies[0].result.tools, legacy.replies[0].result.tools)
  assert.deepEqual(reply(legacy.replies, 0), { content: [{ type: 'text', text: sourceBody }] })
  assert.equal(reply(guarded.replies, 1).isError, undefined)
  assert.equal(reply(guarded.replies, 2).isError, true)
  assert.equal(fs.readFileSync(path.join(root, source), 'utf8'), sourceBody)
  assert.equal(fs.readFileSync(path.join(root, target), 'utf8'), 'export const target = true\n')
}))

for (const [label, invalid] of [
  ['malformed JSON', '{'],
  ['non-array', {}],
  ['extra property', [{ ...policy[0], arbitrary: 'not-policy' }]],
  ['wildcard', [{ ...policy[0], path: 'src/modules/example/**' }]],
  ['traversal', [{ ...policy[0], owner: '.ai/../private.md' }]],
  ['non-canonical spelling', [{ ...policy[0], entrypoints: ['src/modules/example/./README.md'] }]],
  ['empty entrypoints', [{ ...policy[0], entrypoints: [] }]],
  ['self prerequisite', [{ ...policy[0], entrypoints: [source] }]],
  ['duplicate target', [policy[0], policy[0]]],
  ['out-of-grant owner', [{ ...policy[0], owner: '.ai/guides/unknown.md' }]],
  ['oversized policy', ' '.repeat(16_385)],
] as const) {
  test(`invalid internal prerequisite policy fails closed: ${label}`, () => fixture(root => {
    const { execution, replies } = invoke(root, [read(source)], invalid)
    assert.equal(execution.status, 2)
    assert.deepEqual(replies, [])
    assert.ok(!execution.stdout.includes('EXACT_SOURCE_BODY'))
  }))
}

test('prerequisite owners must be bounded regular files rather than symbolic links', () => fixture(root => {
  write(root, '.ai/real-owner.md', '# Real owner\n')
  fs.unlinkSync(path.join(root, owner))
  fs.symlinkSync(path.join(root, '.ai/real-owner.md'), path.join(root, owner))
  const linked = invoke(root, [read(source)])
  assert.equal(linked.execution.status, 2)
  assert.deepEqual(linked.replies, [])
  fs.unlinkSync(path.join(root, owner))
  write(root, owner, 'x'.repeat(256 * 1024 + 1))
  const oversized = invoke(root, [read(source)])
  assert.equal(oversized.execution.status, 2)
  assert.deepEqual(oversized.replies, [])
}))

test('ungranted source requests are refused before any prerequisite path is disclosed', () => fixture(root => {
  const { execution, replies } = invoke(root, [read('src/modules/example/api/unknown.ts')])
  assert.equal(execution.status, 0)
  assert.equal(reply(replies, 0).isError, true)
  assert.ok(!JSON.stringify(reply(replies, 0)).includes(owner))
}))

test('the supported runner invocation forwards the trusted prerequisite policy to its cleared MCP environment', async () => {
  const { buildRunnerInvocation } = await invocationBuilder()
  fixture(root => {
    const schemaPath = path.join(root, 'response.schema.json')
    fs.writeFileSync(schemaPath, JSON.stringify({ type: 'object' }))
    const invocation = buildRunnerInvocation({
      runner: 'claude', root, schemaPath, outputPath: path.join(root, 'response.json'), writable: true,
      allowedReads: [source, owner, entrypoint], allowedWrites: [target], immutableRoots: ['src/modules/example'], readPrerequisites: policy,
    })
    const configIndex = invocation.args.indexOf('--mcp-config')
    assert.ok(configIndex >= 0)
    const config = JSON.parse(invocation.args[configIndex + 1]) as { mcpServers: { harness: { command: string; args: string[] } } }
    const mcp = config.mcpServers.harness
    assert.equal(mcp.command, '/usr/bin/env')
    assert.equal(mcp.args[0], '-i')
    assert.equal(mcp.args.filter(value => value.startsWith('OM_HARNESS_READ_PREREQUISITES=')).length, 1)
    const requests = [read(source), read(entrypoint), read(owner), read(source)].map((params, index) => ({ jsonrpc: '2.0', id: index + 2, method: 'tools/call', params }))
    const execution = spawnSync(mcp.command, mcp.args, {
      encoding: 'utf8', input: requests.map(value => JSON.stringify(value)).join('\n') + '\n',
      timeout: 5000, env: {}, maxBuffer: 1024 * 1024,
    })
    assert.equal(execution.status, 0)
    const replies = execution.stdout.split('\n').filter(Boolean).map(line => JSON.parse(line) as Reply)
    assert.equal(reply(replies, 0).isError, true)
    assert.deepEqual(reply(replies, 3), { content: [{ type: 'text', text: sourceBody }] })
    const legacy = buildRunnerInvocation({
      runner: 'claude', root, schemaPath, outputPath: path.join(root, 'response.json'), writable: false,
      allowedReads: [source, owner, entrypoint], allowedWrites: [], immutableRoots: ['src/modules/example'], readPrerequisites: [],
    })
    assert.ok(!JSON.stringify(legacy.args).includes('OM_HARNESS_READ_PREREQUISITES'))
  })
})
