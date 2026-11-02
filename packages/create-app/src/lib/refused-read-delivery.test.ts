import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const packageRoot = fileURLToPath(new URL('../../', import.meta.url))
const sharedRoot = path.join(packageRoot, 'agentic/shared')
const server = path.join(sharedRoot, 'scripts/agent-harness-tool-server.mjs')
const evaluator = await import(pathToFileURL(path.join(sharedRoot, 'scripts/evaluate-agent-harness.mjs')).href)
const canonicalRoot = 'src/modules/example'
const entrypoint = `${canonicalRoot}/README.md`
const compatibility = '.ai/guides/upstream/BACKWARD_COMPATIBILITY.md'
type Shape = 'claude' | 'codex'
type Call = { id: string; path: string }
type Result = { content: Array<{ type: string; text: string }>; isError?: boolean }
type Exchange = { call: Call; result: Result }
type Reference = { referenceId: string; requirement: string; originAsset: string; originAuthoringPath: string; resolvedPath: string }
type RecordCase = { id: string; context: { required: string[]; allowedExtra?: string[]; sourceReferenceIds?: string[]; exampleRoots?: Array<{ root: string; entrypoints: string[]; allowedCapabilityIds: string[]; maxFiles: number; maxBytes: number }> }; allowedWrites: string[] }

function write(root: string, relative: string, content: string) {
  fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true })
  fs.writeFileSync(path.join(root, relative), content)
}

function fixture(run: (root: string, record: RecordCase, reference: Reference) => void) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-refused-delivery-')))
  const cases = JSON.parse(fs.readFileSync(path.join(sharedRoot, 'ai/harness/cases.json'), 'utf8')) as RecordCase[]
  const declaredCase = cases.find(entry => entry.id === 'OMH-011')!
  const inventory = JSON.parse(fs.readFileSync(path.join(packageRoot, 'scripts/source-links/source-link-inventory.json'), 'utf8')) as { records: Reference[] }
  const reference = inventory.records.find(entry => entry.requirement === 'source-required'
    && entry.resolvedPath === `${canonicalRoot}/api/todos/route.ts`
    && entry.originAsset === '.ai/skills/om-module-scaffold/references/api-and-domain.md')!
  assert.ok(reference, 'use the real canonical CRUD source and its exact instruction owner')
  const surface = JSON.parse(fs.readFileSync(path.join(packageRoot, 'template/src/modules/example/references/surface-inventory.json'), 'utf8')) as { capabilities: Array<{ capabilityId: string; readStatus: string; sourcePaths: string[] }> }
  const capabilities = surface.capabilities.filter(entry => entry.readStatus === 'readable' && entry.sourcePaths.includes(reference.resolvedPath)).map(entry => entry.capabilityId)
  assert.ok(capabilities.length, 'the canonical source must belong to a real readable capability')
  const record: RecordCase = { ...declaredCase, context: {
    ...declaredCase.context,
    required: [...new Set([...declaredCase.context.required, reference.originAsset, compatibility])],
    sourceReferenceIds: [reference.referenceId],
    exampleRoots: [{ root: canonicalRoot, entrypoints: ['README.md', 'references/surface-map.md'], allowedCapabilityIds: capabilities, maxFiles: 16, maxBytes: 262_144 }],
  } }
  fs.cpSync(path.join(packageRoot, 'template/src/modules/example'), path.join(root, canonicalRoot), { recursive: true })
  write(root, '.ai/harness/source-link-inventory.json', JSON.stringify(inventory))
  write(root, '.ai/skills/tiers.json', JSON.stringify({ default: ['core'], tiers: {} }))
  write(root, 'package.json', '{"name":"refused-delivery-fixture","private":true}')
  for (const relative of record.context.required) write(root, relative, '# Declared instruction\n')
  write(root, reference.originAsset, fs.readFileSync(path.join(packageRoot, reference.originAuthoringPath), 'utf8'))
  try { run(root, record, reference) } finally { fs.rmSync(root, { recursive: true, force: true }) }
}

function exchange(root: string, record: RecordCase, calls: Call[], prerequisites?: unknown, allowedReads = evaluator.caseReadAllowlist(record, true, root)): Exchange[] {
  const execution = spawnSync(process.execPath, [server, root, 'writable', JSON.stringify(allowedReads), JSON.stringify(record.allowedWrites)], {
    input: calls.map((call, index) => JSON.stringify({ jsonrpc: '2.0', id: index + 1, method: 'tools/call', params: { name: 'read', arguments: { path: call.path } } })).join('\n') + '\n',
    encoding: 'utf8', timeout: 5000, maxBuffer: 4 * 1024 * 1024,
    env: { OM_HARNESS_IMMUTABLE_ROOTS: JSON.stringify([canonicalRoot]), ...(prerequisites ? { OM_HARNESS_READ_PREREQUISITES: JSON.stringify(prerequisites) } : {}) },
  })
  assert.equal(execution.status, 0, execution.stderr)
  const replies = execution.stdout.trim().split('\n').map(line => JSON.parse(line) as { id: number; result: Result })
  assert.equal(replies.length, calls.length)
  return calls.map((call, index) => {
    const response = replies.find(reply => reply.id === index + 1)
    assert.ok(response, 'pair each trace result with the actual stdio response')
    return { call, result: response.result }
  })
}

function refusedBoundedRead(root: string, record: RecordCase, call: Call): Exchange {
  const target = path.join(root, call.path)
  const original = fs.readFileSync(target)
  const allowedReads = evaluator.caseReadAllowlist(record, true, root)
  try {
    fs.writeFileSync(target, 'x'.repeat(256 * 1024 + 1))
    const [response] = exchange(root, record, [call], undefined, allowedReads)
    assert.equal(response.result.isError, true)
    assert.match(response.result.content[0].text, /bounded regular file/)
    return response
  } finally { fs.writeFileSync(target, original) }
}

function events(shape: Shape, exchanges: Exchange[]): object[] {
  return exchanges.flatMap(({ call, result }) => shape === 'claude'
    ? [
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: call.id, name: 'mcp__harness__read', input: { path: call.path } }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: call.id, is_error: result.isError === true, content: result.content }] } },
    ]
    : [{ type: 'item.completed', item: { type: 'mcp_tool_call', id: call.id, server: 'harness', tool: 'read', status: 'completed', arguments: { path: call.path }, result } }])
}

function observe(root: string, record: RecordCase, shape: Shape, exchanges: Exchange[], extra: object[] = []) {
  return evaluator.observedContext([...events(shape, exchanges), ...extra].map(event => JSON.stringify(event)).join('\n'), root, record, true)
}

for (const shape of ['claude', 'codex'] as const) {
  test(`${shape}: a real in-scope refusal is not a delivered owner or compatibility guide`, () => fixture((root, record, reference) => {
    const refusedOwner = refusedBoundedRead(root, record, { id: 'owner-error', path: reference.originAsset })
    const refusedCompatibility = refusedBoundedRead(root, record, { id: 'compatibility-error', path: compatibility })
    const successful = exchange(root, record, [{ id: 'root', path: 'AGENTS.md' }, { id: 'entrypoint', path: entrypoint }])
    const observed = observe(root, record, shape, [...successful, refusedOwner, refusedCompatibility])
    assert.ok(!observed.paths.includes(reference.originAsset))
    assert.ok(!observed.paths.includes(compatibility))
    assert.ok(!observed.readOrder.includes(reference.originAsset))
    assert.deepEqual(observed.exampleReadPolicy.references.owners, [])
    assert.deepEqual(observed.refusedPaths, [reference.originAsset, compatibility].sort())
    assert.deepEqual(observed.violations, [])
  }))

  test(`${shape}: a real refused source followed by owner and successful retry preserves the unchanged source policy`, () => fixture((root, record, reference) => {
    const refused = refusedBoundedRead(root, record, { id: 'source-error', path: reference.resolvedPath })
    const successful = exchange(root, record, [
      { id: 'root', path: 'AGENTS.md' }, { id: 'entrypoint', path: entrypoint },
      { id: 'owner', path: reference.originAsset }, { id: 'source-ok', path: reference.resolvedPath },
    ])
    assert.ok(successful.every(entry => entry.result.isError !== true))
    const observed = observe(root, record, shape, [refused, ...successful])
    const baseline = observe(root, record, shape, successful)
    assert.deepEqual(observed.violations, [])
    assert.deepEqual(observed.exampleReadPolicy, baseline.exampleReadPolicy)
    assert.equal(observed.exampleReadPolicy.references.followed.length, 1)
    assert.deepEqual(observed.refusedPaths, [reference.resolvedPath])
  }))

  test(`${shape}: a refused owner does not satisfy the existing source-before-owner rule`, () => fixture((root, record, reference) => {
    const refused = refusedBoundedRead(root, record, { id: 'owner-error', path: reference.originAsset })
    const successful = exchange(root, record, [{ id: 'root', path: 'AGENTS.md' }, { id: 'entrypoint', path: entrypoint }, { id: 'source', path: reference.resolvedPath }])
    const observed = observe(root, record, shape, [refused, ...successful])
    assert.match(observed.exampleReadPolicy.firstViolation ?? '', /source reference followed before its origin owner/)
    assert.deepEqual(observed.exampleReadPolicy.references.owners, [])
  }))

  test(`${shape}: paired refused forbidden, ungranted canonical, recursive, symlink and traversal probes stay fatal`, () => fixture((root, record, reference) => {
    write(root, '.env', 'PRIVATE_FIXTURE_SENTINEL')
    write(root, '.ai/guides/extra.md', '# Outside the grant\n')
    fs.symlinkSync(path.join(root, '.ai/guides/extra.md'), path.join(root, '.ai/guides/linked.md'))
    const probes = ['.env', `${canonicalRoot}/api/customer-priorities/route.ts`, canonicalRoot, `${canonicalRoot}/**`, '.ai/guides/linked.md', '../outside.md']
    for (const [index, probe] of probes.entries()) {
      const successful = exchange(root, record, [{ id: 'root', path: 'AGENTS.md' }, { id: 'owner', path: reference.originAsset }, { id: 'entrypoint', path: entrypoint }])
      const [denied] = exchange(root, record, [{ id: `denied-${index}`, path: probe }])
      assert.equal(denied.result.isError, true, probe)
      const observed = observe(root, record, shape, [...successful, denied])
      assert.ok(observed.violations.length > 0, `a refused dangerous probe must still fail: ${probe}`)
    }
  }))

  test(`${shape}: unrelated errors and conflicting or duplicate identities cannot erase successful source reads`, () => fixture((root, record, reference) => {
    const successful = exchange(root, record, [{ id: 'root', path: 'AGENTS.md' }, { id: 'source', path: reference.resolvedPath }])
    const unrelated = observe(root, record, shape, successful, [{ type: 'error', id: 'source', is_error: true }])
    assert.match(unrelated.exampleReadPolicy.firstViolation ?? '', /before its origin owner/)
    const denied = refusedBoundedRead(root, record, { id: 'source', path: reference.resolvedPath })
    const conflicting = observe(root, record, shape, [...successful, denied])
    assert.ok(conflicting.violations.some((entry: string) => /ambiguous.*tool.call/i.test(entry)))
    assert.match(conflicting.exampleReadPolicy.firstViolation ?? '', /before its origin owner/)
    const duplicated = observe(root, record, shape, [...successful, successful[1]])
    assert.ok(duplicated.violations.some((entry: string) => /ambiguous.*tool.call/i.test(entry)))
    assert.match(duplicated.exampleReadPolicy.firstViolation ?? '', /before its origin owner/)
    const contradictoryFlags = shape === 'claude'
      ? [{ type: 'tool_result', tool_use_id: 'source', is_error: true, isError: false }]
      : [{ type: 'mcp_tool_call', id: 'source', server: 'harness', tool: 'read', status: 'completed', arguments: { path: reference.resolvedPath }, result: { is_error: true, isError: false } }]
    const contradictory = evaluator.observedContext([...events(shape, successful).slice(0, -1), ...contradictoryFlags].map(event => JSON.stringify(event)).join('\n'), root, record, true)
    assert.ok(contradictory.violations.some((entry: string) => /ambiguous.*tool.call/i.test(entry)))
    assert.match(contradictory.exampleReadPolicy.firstViolation ?? '', /before its origin owner/)
  }))

  test(`${shape}: a genuine successful read outside the grant survives unrelated or conflicting errors`, () => fixture((root, record) => {
    const outside = '.ai/guides/undeclared.md'
    write(root, outside, '# Outside declared context\n')
    const calls = [{ id: 'root', path: 'AGENTS.md' }, { id: 'outside', path: outside }]
    const successful = exchange(root, record, calls, undefined, [...evaluator.caseReadAllowlist(record, true, root), outside])
    assert.ok(successful.every(entry => entry.result.isError !== true))
    const unrelated = observe(root, record, shape, successful, [{ type: 'error', id: 'outside', is_error: true }])
    assert.ok(unrelated.violations.includes(`unsafe arbitrary app-root read ${outside}`))
    const [denied] = exchange(root, record, [calls[1]])
    assert.equal(denied.result.isError, true)
    const conflicting = observe(root, record, shape, [...successful, denied])
    assert.ok(conflicting.violations.includes(`unsafe arbitrary app-root read ${outside}`))
    assert.ok(conflicting.violations.some((entry: string) => /ambiguous.*tool.call/i.test(entry)))
  }))

  test(`${shape}: permitted failures do not consume the existing out-of-scope exploration budget`, () => fixture((root, record) => {
    const permitted = Array.from({ length: 9 }, (_, index) => `.ai/guides/permitted-${index}.md`)
    record.context.allowedExtra = [...(record.context.allowedExtra ?? []), ...permitted]
    for (const relative of permitted) write(root, relative, '# Permitted instruction\n')
    const successful = exchange(root, record, [{ id: 'root', path: 'AGENTS.md' }])
    const denied = permitted.map((relative, index) => refusedBoundedRead(root, record, { id: `permitted-${index}`, path: relative }))
    const observed = observe(root, record, shape, [...successful, ...denied])
    assert.deepEqual(observed.violations, [])
    assert.deepEqual(observed.paths, ['AGENTS.md'])
    assert.deepEqual(observed.refusedPaths, permitted.sort())
    const outside = Array.from({ length: 9 }, (_, index) => `.ai/guides/probe-${index}.md`)
    for (const relative of outside) write(root, relative, '# Outside case context\n')
    const probes = exchange(root, record, outside.map((relative, index) => ({ id: `probe-${index}`, path: relative })))
    assert.ok(probes.every(entry => entry.result.isError === true))
    const probed = observe(root, record, shape, [...successful, ...probes])
    assert.ok(probed.violations.some((entry: string) => entry.startsWith('refused context read budget exceeded:')))
  }))
}

test('native Codex completed transport with an error object is a refused read, not delivered context', () => fixture((root, record, reference) => {
  const [successful] = exchange(root, record, [{ id: 'root', path: 'AGENTS.md' }])
  const denied = refusedBoundedRead(root, record, { id: 'owner-error', path: reference.originAsset })
  const trace = [...events('codex', [successful]), { type: 'item.completed', item: {
    type: 'mcp_tool_call', id: denied.call.id, server: 'harness', tool: 'read', arguments: { path: denied.call.path },
    status: 'completed', result: null, error: { message: denied.result.content[0].text },
  } }]
  const observed = evaluator.observedContext(trace.map(event => JSON.stringify(event)).join('\n'), root, record, true)
  assert.deepEqual(observed.violations, [])
  assert.deepEqual(observed.paths, ['AGENTS.md'])
  assert.deepEqual(observed.refusedPaths, [reference.originAsset])
}))

test('Codex lifecycle progress is not a duplicate terminal outcome and a pending error cannot suppress a read', () => fixture((root, record, reference) => {
  const successful = exchange(root, record, [{ id: 'root', path: 'AGENTS.md' }, { id: 'owner', path: reference.originAsset }, { id: 'entrypoint', path: entrypoint }, { id: 'source', path: reference.resolvedPath }])
  const pending = { type: 'item.started', item: { type: 'mcp_tool_call', id: 'source', server: 'harness', tool: 'read', arguments: { path: reference.resolvedPath }, status: 'in_progress', result: null } }
  const trace = events('codex', successful)
  const observed = evaluator.observedContext([...trace.slice(0, -1), pending, trace.at(-1)].map(event => JSON.stringify(event)).join('\n'), root, record, true)
  const baseline = observe(root, record, 'codex', successful)
  assert.deepEqual(observed.violations, [])
  assert.equal(observed.exampleReadPolicy.roots[0].files, baseline.exampleReadPolicy.roots[0].files)
  assert.equal(observed.exampleReadPolicy.roots[0].bytes, baseline.exampleReadPolicy.roots[0].bytes)
  const incomplete = evaluator.observedContext([...events('codex', [successful[0]]), { ...pending, item: { ...pending.item, is_error: true } }].map(event => JSON.stringify(event)).join('\n'), root, record, true)
  assert.match(incomplete.exampleReadPolicy.firstViolation ?? '', /before its origin owner/)
  assert.deepEqual(incomplete.refusedPaths, [])
}))

test('outer Codex failures cannot mask a nested successful result and normal write repetition is unrelated', () => fixture((root, record, reference) => {
  const successful = exchange(root, record, [{ id: 'root', path: 'AGENTS.md' }, { id: 'source', path: reference.resolvedPath }])
  for (const outer of [{ is_error: true }, { status: 'failed' }, { error: { message: 'conflicting failure' } }]) {
    const trace = [...events('codex', successful).slice(0, -1), { type: 'mcp_tool_call', id: 'source', server: 'harness', tool: 'read', arguments: { path: reference.resolvedPath }, status: 'completed', ...outer, result: { ...successful[1].result, isError: false } }]
    const observed = evaluator.observedContext(trace.map(event => JSON.stringify(event)).join('\n'), root, record, true)
    assert.ok(observed.violations.some((entry: string) => /ambiguous.*tool.call/i.test(entry)))
    assert.match(observed.exampleReadPolicy.firstViolation ?? '', /before its origin owner/)
  }
  const [rootRead] = successful
  const writeResult = { type: 'mcp_tool_call', id: 'write', server: 'harness', tool: 'write', arguments: { path: 'src/modules/library/data/new.ts', content: 'export {}' }, status: 'completed' }
  const observed = observe(root, record, 'codex', [rootRead], [writeResult, writeResult])
  assert.deepEqual(observed.violations, [])
}))

test('camelCase paired tool-result identifiers preserve the same refusal semantics', () => fixture((root, record, reference) => {
  const denied = refusedBoundedRead(root, record, { id: 'source-error', path: reference.resolvedPath })
  const successful = exchange(root, record, [{ id: 'root', path: 'AGENTS.md' }, { id: 'entrypoint', path: entrypoint }, { id: 'owner', path: reference.originAsset }, { id: 'source-ok', path: reference.resolvedPath }])
  for (const key of ['toolUseId', 'callId']) {
    const trace = [...events('claude', [denied]).slice(0, 1), { type: 'tool_result', [key]: denied.call.id, isError: true, content: denied.result.content }, ...events('claude', successful)]
    const observed = evaluator.observedContext(trace.map(event => JSON.stringify(event)).join('\n'), root, record, true)
    assert.deepEqual(observed.violations, [])
    assert.equal(observed.exampleReadPolicy.references.followed.length, 1)
    assert.deepEqual(observed.refusedPaths, [reference.resolvedPath])
  }
}))

test('missing or mismatched tool-result identities cannot silently suppress a read', () => fixture((root, record, reference) => {
  const exchanges = exchange(root, record, [{ id: 'root', path: 'AGENTS.md' }, { id: 'source', path: reference.resolvedPath }])
  const trace = events('claude', exchanges)
  for (const result of [
    { type: 'tool_result', is_error: true, content: 'unpaired' },
    { type: 'tool_result', tool_use_id: 'different-call', is_error: true, content: 'unpaired' },
  ]) {
    const observed = evaluator.observedContext([...trace, result].map(event => JSON.stringify(event)).join('\n'), root, record, true)
    assert.ok(observed.violations.some((entry: string) => /unpaired.*tool.call/i.test(entry)))
    assert.match(observed.exampleReadPolicy.firstViolation ?? '', /before its origin owner/)
  }
  const conflictingIds = evaluator.observedContext([...trace.slice(0, -1), { type: 'tool_result', tool_use_id: 'source', call_id: 'different-call', is_error: true }].map(event => JSON.stringify(event)).join('\n'), root, record, true)
  assert.ok(conflictingIds.violations.some((entry: string) => /ambiguous.*tool.call/i.test(entry)))
  assert.match(conflictingIds.exampleReadPolicy.firstViolation ?? '', /before its origin owner/)
}))

test('actual canonical precondition responses recover through the paired trace and unchanged read policy', () => fixture((root, record, reference) => {
  const calls = [
    { id: 'root', path: 'AGENTS.md' }, { id: 'source-refused', path: reference.resolvedPath },
    { id: 'entrypoint', path: entrypoint }, { id: 'owner', path: reference.originAsset },
    { id: 'source-ok', path: reference.resolvedPath },
  ]
  const exchanges = exchange(root, record, calls, [{ path: reference.resolvedPath, owner: reference.originAsset, entrypoints: [entrypoint] }])
  assert.equal(exchanges[1].result.isError, true)
  assert.equal(exchanges[4].result.isError, undefined)
  assert.equal(exchanges[4].result.content[0].text, fs.readFileSync(path.join(root, reference.resolvedPath), 'utf8'))
  for (const shape of ['claude', 'codex'] as const) {
    const observed = observe(root, record, shape, exchanges)
    assert.deepEqual(observed.violations, [])
    assert.equal(observed.exampleReadPolicy.references.followed.length, 1)
    assert.deepEqual(observed.refusedPaths, [reference.resolvedPath])
  }
}))

test('read-only observation also excludes a paired permitted refusal from delivered context', () => fixture((root, record) => {
  const denied = refusedBoundedRead(root, record, { id: 'compatibility-error', path: compatibility })
  const successful = exchange(root, record, [{ id: 'root', path: 'AGENTS.md' }])
  for (const shape of ['claude', 'codex'] as const) {
    const trace = events(shape, [...successful, denied]).map(event => JSON.stringify(event)).join('\n')
    const observed = evaluator.observedContext(trace, root, record, false)
    assert.deepEqual(observed.violations, [])
    assert.deepEqual(observed.paths, ['AGENTS.md'])
    assert.deepEqual(observed.readOrder, ['AGENTS.md'])
    assert.deepEqual(observed.refusedPaths, [compatibility])
  }
}))
