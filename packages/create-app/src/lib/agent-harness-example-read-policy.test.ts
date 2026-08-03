import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const sharedRoot = fileURLToPath(new URL('../../agentic/shared/', import.meta.url))
const sourceHarness = path.join(sharedRoot, 'ai', 'harness')
const sourceEvaluator = path.join(sharedRoot, 'scripts', 'evaluate-agent-harness.mjs')
const sourceToolServer = path.join(sharedRoot, 'scripts', 'agent-harness-tool-server.mjs')
const canonicalReferences = fileURLToPath(new URL('../../../../apps/mercato/src/modules/example/references/', import.meta.url))
const canonicalReadme = fileURLToPath(new URL('../../../../apps/mercato/src/modules/example/README.md', import.meta.url))
const linkType = process.platform === 'win32' ? 'junction' : 'dir'

const EXAMPLE_ROOT = 'src/modules/example'
const ENTRYPOINTS = ['README.md', 'references/surface-map.md']

type Capability = {
  capabilityId: string
  coverageKind: string
  referenceStatus: string
  readStatus: string
  sourcePaths: string[]
}

type PolicyTrace = {
  reads: Array<{ path: string; root: string | null; capabilityId: string | null; entrypoint?: boolean; fallbackReason?: string }>
  roots: Array<{ root: string; entrypoints: string[]; capabilities: string[]; files: number; bytes: number }>
  fallback: { reason: string | null; files: number; bytes: number }
  firstViolation: string | null
}

type PolicyRead = { path: string; kind?: string; fallbackReason?: string; capabilityId?: string }

type CaseRecord = {
  context: Record<string, unknown>
  allowedWrites?: string[]
}

type Evaluator = {
  evaluateExampleReadPolicy: (input: { caseRecord: unknown; appRoot: string; reads: PolicyRead[] }) => PolicyTrace
  validateExampleReadPolicyDeclaration: (caseRecord: unknown, appRoot?: string) => string[]
  exampleReadAllowlist: (caseRecord: unknown, appRoot?: string) => string[]
  immutableExampleRoots: (caseRecord: unknown) => string[]
  normalizeExampleReadPath: (value: unknown) => { relative?: string; violation?: string }
}

let evaluatorPromise: Promise<Evaluator> | undefined
function loadEvaluator(): Promise<Evaluator> {
  if (!evaluatorPromise) evaluatorPromise = import(pathToFileURL(sourceEvaluator).href) as Promise<Evaluator>
  return evaluatorPromise
}

function inventoryCapabilities(): Capability[] {
  const parsed = JSON.parse(fs.readFileSync(path.join(canonicalReferences, 'surface-inventory.json'), 'utf8')) as { capabilities: Capability[] }
  return parsed.capabilities
}

function capability(id: string): Capability {
  const found = inventoryCapabilities().find((entry) => entry.capabilityId === id)
  assert.ok(found, `the shipped surface inventory must still declare ${id}`)
  return found
}

/**
 * Stage a fresh-standalone-shaped app that carries the REAL emitted example references, so the
 * fixtures fail when the shipped inventory drifts away from the paths they exercise.
 */
function stageExampleApp(): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-example-policy-')))
  const exampleRoot = path.join(root, EXAMPLE_ROOT)
  fs.mkdirSync(path.join(exampleRoot, 'references'), { recursive: true })
  fs.copyFileSync(canonicalReadme, path.join(exampleRoot, 'README.md'))
  for (const file of ['surface-map.md', 'surface-inventory.json']) {
    fs.copyFileSync(path.join(canonicalReferences, file), path.join(exampleRoot, 'references', file))
  }
  for (const entry of inventoryCapabilities()) {
    for (const source of entry.sourcePaths) {
      if (!source.startsWith(`${EXAMPLE_ROOT}/`)) continue
      const absolute = path.join(root, source)
      fs.mkdirSync(path.dirname(absolute), { recursive: true })
      fs.writeFileSync(absolute, `// ${entry.capabilityId}\nexport const marker = ${JSON.stringify(entry.capabilityId)}\n`)
    }
  }
  fs.mkdirSync(path.join(root, 'node_modules', '@open-mercato', 'core', 'src', 'modules', 'customers', 'api'), { recursive: true })
  fs.writeFileSync(
    path.join(root, 'node_modules', '@open-mercato', 'core', 'src', 'modules', 'customers', 'api', 'route.ts'),
    'export async function GET() { return new Response() }\n',
  )
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"om-example-policy-fixture","private":true}\n')
  return root
}

function declaredCase(overrides: {
  allowedCapabilityIds?: string[]
  entrypoints?: string[]
  root?: string
  maxFiles?: number
  maxBytes?: number
  fallback?: Record<string, unknown> | null
  allowedWrites?: string[]
}): CaseRecord {
  return {
    context: {
      required: ['AGENTS.md'],
      forbidden: ['.env'],
      exampleRoots: [{
        root: overrides.root ?? EXAMPLE_ROOT,
        entrypoints: overrides.entrypoints ?? ENTRYPOINTS,
        allowedCapabilityIds: overrides.allowedCapabilityIds ?? ['api.crud-factory', 'data.entities', 'ui.datatable'],
        maxFiles: overrides.maxFiles ?? 12,
        maxBytes: overrides.maxBytes ?? 131_072,
      }],
      ...(overrides.fallback === null ? {} : {
        installedVersionFallback: overrides.fallback ?? {
          allowed: true,
          reasonCodes: ['INSTALLED_VERSION_CONTRACT_MISMATCH'],
          maxFiles: 4,
          maxBytes: 65_536,
        },
      }),
    },
    ...(overrides.allowedWrites ? { allowedWrites: overrides.allowedWrites } : {}),
  }
}

function entrypointReads(): PolicyRead[] {
  return ENTRYPOINTS.map((entrypoint) => ({ path: `${EXAMPLE_ROOT}/${entrypoint}` }))
}

function callToolServer(
  root: string,
  mode: 'read-only' | 'writable',
  allowedReads: string[],
  allowedWrites: string[],
  immutableRoots: string[],
  calls: Array<{ name: string; arguments: Record<string, unknown> }>,
) {
  const messages = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
    ...calls.map((entry, index) => ({ jsonrpc: '2.0', id: index + 2, method: 'tools/call', params: entry })),
  ]
  const result = spawnSync(
    process.execPath,
    [sourceToolServer, root, mode, JSON.stringify(allowedReads), JSON.stringify(allowedWrites)],
    {
      input: `${messages.map((entry) => JSON.stringify(entry)).join('\n')}\n`,
      encoding: 'utf8',
      env: { OM_HARNESS_IMMUTABLE_ROOTS: JSON.stringify(immutableRoots) },
    },
  )
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim().split('\n').map((line) => JSON.parse(line)) as Array<{ result: { isError?: boolean; content: Array<{ text: string }> } }>
}

function shippedCases(): Array<{ id: string; context: Record<string, unknown>; allowedWrites?: string[] }> {
  return JSON.parse(fs.readFileSync(path.join(sourceHarness, 'cases.json'), 'utf8'))
}

// ---------------------------------------------------------------------------------------------
// Oracle family 1 — a relevant case reads the entrypoints plus several exact capability files.
// ---------------------------------------------------------------------------------------------

test('family 1: a relevant case reads the example entrypoints and several exact CRUD, data, and UI files', async () => {
  const evaluator = await loadEvaluator()
  const root = stageExampleApp()
  try {
    const caseRecord = declaredCase({})
    assert.deepEqual(evaluator.validateExampleReadPolicyDeclaration(caseRecord, root), [])
    const sources = [
      ...capability('api.crud-factory').sourcePaths,
      ...capability('data.entities').sourcePaths,
      ...capability('ui.datatable').sourcePaths,
    ]
    const trace = evaluator.evaluateExampleReadPolicy({
      caseRecord,
      appRoot: root,
      reads: [...entrypointReads(), ...sources.map((source) => ({ path: source }))],
    })
    assert.equal(trace.firstViolation, null)
    assert.deepEqual(trace.reads.map((entry) => entry.path), [
      `${EXAMPLE_ROOT}/README.md`,
      `${EXAMPLE_ROOT}/references/surface-map.md`,
      ...sources,
    ], 'the trace must record every read in order')
    assert.deepEqual(trace.roots[0].entrypoints, ENTRYPOINTS)
    assert.deepEqual(trace.roots[0].capabilities, ['api.crud-factory', 'data.entities', 'ui.datatable'])
    assert.equal(trace.roots[0].files, 2 + sources.length)
    assert.ok(trace.roots[0].bytes > 0, 'cumulative bytes must be charged')
    assert.equal(trace.fallback.reason, null)
    // The trace is evidence, never disclosure: it carries paths and counters only.
    assert.doesNotMatch(JSON.stringify(trace), /export const marker/)

    // The root's own inventory is readable and charged, but it does not satisfy the start rule.
    const inventoryPath = `${EXAMPLE_ROOT}/references/surface-inventory.json`
    const withInventory = evaluator.evaluateExampleReadPolicy({
      caseRecord,
      appRoot: root,
      reads: [{ path: `${EXAMPLE_ROOT}/README.md` }, { path: inventoryPath }],
    })
    assert.equal(withInventory.firstViolation, null)
    assert.equal(withInventory.roots[0].files, 2)
    assert.deepEqual(withInventory.roots[0].entrypoints, ['README.md'])
    const inventoryFirst = evaluator.evaluateExampleReadPolicy({
      caseRecord,
      appRoot: root,
      reads: [{ path: inventoryPath }, { path: capability('api.crud-factory').sourcePaths[0] }],
    })
    assert.match(inventoryFirst.firstViolation ?? '', /must start from a declared entrypoint/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('family 1: the read allowlist resolves the declared capabilities to exact inventory files', async () => {
  const evaluator = await loadEvaluator()
  const root = stageExampleApp()
  try {
    const allowlist = evaluator.exampleReadAllowlist(declaredCase({ allowedCapabilityIds: ['api.crud-factory'] }), root)
    assert.deepEqual(allowlist.sort(), [
      `${EXAMPLE_ROOT}/README.md`,
      `${EXAMPLE_ROOT}/references/surface-inventory.json`,
      `${EXAMPLE_ROOT}/references/surface-map.md`,
      ...capability('api.crud-factory').sourcePaths,
    ].sort())
    assert.ok(allowlist.every((entry) => !entry.includes('*') && !entry.includes('?')), 'the allowlist must never contain globs')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------------------------
// Oracle family 2 — the same case reads an unrelated capability under the allowed root.
// ---------------------------------------------------------------------------------------------

test('family 2: an unrelated capability under the allowed root fails, in the evaluator and at the tool server', async () => {
  const evaluator = await loadEvaluator()
  const root = stageExampleApp()
  try {
    const caseRecord = declaredCase({})
    const unrelated = capability('notifications.type').sourcePaths[0]
    const trace = evaluator.evaluateExampleReadPolicy({
      caseRecord,
      appRoot: root,
      reads: [...entrypointReads(), { path: unrelated }],
    })
    assert.match(trace.firstViolation ?? '', /maps to a capability the case did not declare/)
    assert.ok(trace.reads.every((entry) => entry.path !== unrelated), 'a rejected read is never recorded as loaded context')

    const replies = callToolServer(root, 'read-only', evaluator.exampleReadAllowlist(caseRecord, root), [], [], [
      { name: 'read', arguments: { path: unrelated } },
      { name: 'read', arguments: { path: capability('api.crud-factory').sourcePaths[0] } },
    ])
    assert.equal(replies[1].result.isError, true)
    assert.match(replies[1].result.content[0].text, /outside the case read allowlist/)
    assert.equal(replies[2].result.isError, undefined)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------------------------
// Oracle family 3 — a case without the root attempts the same read.
// ---------------------------------------------------------------------------------------------

test('family 3: a case without a declared example root cannot reach the canonical example at all', async () => {
  const evaluator = await loadEvaluator()
  const root = stageExampleApp()
  try {
    const undeclared = { context: { required: ['AGENTS.md'], forbidden: ['.env'] } }
    assert.deepEqual(evaluator.exampleReadAllowlist(undeclared, root), [])
    assert.deepEqual(evaluator.immutableExampleRoots(undeclared), [])
    const target = capability('api.crud-factory').sourcePaths[0]
    const replies = callToolServer(root, 'read-only', ['AGENTS.md', ...evaluator.exampleReadAllowlist(undeclared, root)], [], [], [
      { name: 'read', arguments: { path: `${EXAMPLE_ROOT}/README.md` } },
      { name: 'read', arguments: { path: target } },
    ])
    for (const reply of replies.slice(1)) {
      assert.equal(reply.result.isError, true)
      assert.match(reply.result.content[0].text, /outside the case read allowlist/)
    }
    assert.doesNotMatch(JSON.stringify(replies), /export const marker/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------------------------
// Oracle family 4 — a named installed-version gap after local inspection, bounded fallback.
// ---------------------------------------------------------------------------------------------

test('family 4: a named installed-version contract mismatch after local inspection is a bounded passing fallback', async () => {
  const evaluator = await loadEvaluator()
  const root = stageExampleApp()
  try {
    const caseRecord = declaredCase({})
    const installed = 'node_modules/@open-mercato/core/src/modules/customers/api/route.ts'
    const trace = evaluator.evaluateExampleReadPolicy({
      caseRecord,
      appRoot: root,
      reads: [
        ...entrypointReads(),
        { path: capability('api.crud-factory').sourcePaths[0] },
        { path: installed, fallbackReason: 'INSTALLED_VERSION_CONTRACT_MISMATCH' },
      ],
    })
    assert.equal(trace.firstViolation, null)
    assert.equal(trace.fallback.reason, 'INSTALLED_VERSION_CONTRACT_MISMATCH')
    assert.equal(trace.fallback.files, 1)
    assert.ok(trace.fallback.bytes > 0)
    assert.equal(trace.reads.at(-1)?.path, installed)
    assert.equal(trace.reads.at(-1)?.fallbackReason, 'INSTALLED_VERSION_CONTRACT_MISMATCH')
    // The fallback keeps its own smaller budgets and never charges the example root.
    assert.equal(trace.roots[0].files, 3)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------------------------
// Oracle family 5 — every unsafe or unbounded read variant fails.
// ---------------------------------------------------------------------------------------------

test('family 5: fallback before local inspection, an unknown reason, and an undeclared reason all fail', async () => {
  const evaluator = await loadEvaluator()
  const root = stageExampleApp()
  try {
    const installed = 'node_modules/@open-mercato/core/src/modules/customers/api/route.ts'
    const before = evaluator.evaluateExampleReadPolicy({
      caseRecord: declaredCase({}),
      appRoot: root,
      reads: [{ path: installed, fallbackReason: 'INSTALLED_VERSION_CONTRACT_MISMATCH' }],
    })
    assert.match(before.firstViolation ?? '', /precedes local example inspection/)

    const unknown = evaluator.evaluateExampleReadPolicy({
      caseRecord: declaredCase({}),
      appRoot: root,
      reads: [...entrypointReads(), { path: installed, fallbackReason: 'BECAUSE_I_SAID_SO' }],
    })
    assert.match(unknown.firstViolation ?? '', /fallback reason is unknown/)

    const missing = evaluator.evaluateExampleReadPolicy({
      caseRecord: declaredCase({}),
      appRoot: root,
      reads: [...entrypointReads(), { path: installed }],
    })
    assert.match(missing.firstViolation ?? '', /fallback reason is unknown/)

    const undeclaredReason = evaluator.evaluateExampleReadPolicy({
      caseRecord: declaredCase({}),
      appRoot: root,
      reads: [...entrypointReads(), { path: installed, fallbackReason: 'SPECIALIST_ROUTE_NOT_DECLARED', capabilityId: 'testing.integration-coverage' }],
    })
    assert.match(undeclaredReason.firstViolation ?? '', /not declared by this case/)

    const disabled = evaluator.evaluateExampleReadPolicy({
      caseRecord: declaredCase({ fallback: null }),
      appRoot: root,
      reads: [...entrypointReads(), { path: installed, fallbackReason: 'INSTALLED_VERSION_CONTRACT_MISMATCH' }],
    })
    assert.match(disabled.firstViolation ?? '', /fallback is not enabled/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('family 5: reading must start from a declared entrypoint before any capability file', async () => {
  const evaluator = await loadEvaluator()
  const root = stageExampleApp()
  try {
    const trace = evaluator.evaluateExampleReadPolicy({
      caseRecord: declaredCase({}),
      appRoot: root,
      reads: [{ path: capability('api.crud-factory').sourcePaths[0] }],
    })
    assert.match(trace.firstViolation ?? '', /must start from a declared entrypoint/)
    assert.deepEqual(trace.reads, [])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('family 5: directory-wide reads and glob dumps fail even when both budgets are untouched', async () => {
  const evaluator = await loadEvaluator()
  const root = stageExampleApp()
  try {
    const caseRecord = declaredCase({ maxFiles: 64, maxBytes: 262_144 })
    for (const read of [
      { path: `${EXAMPLE_ROOT}/api`, kind: 'list' },
      { path: `${EXAMPLE_ROOT}/api/**`, kind: 'glob' },
      { path: `${EXAMPLE_ROOT}/**/*.ts` },
      { path: `${EXAMPLE_ROOT}/data` },
    ]) {
      const trace = evaluator.evaluateExampleReadPolicy({ caseRecord, appRoot: root, reads: [...entrypointReads(), read] })
      assert.match(trace.firstViolation ?? '', /must name one exact file/, JSON.stringify(read))
      assert.ok(trace.roots[0].files <= 2, 'a refused directory or glob read is never charged as a file')
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('family 5: both cumulative budgets are enforced independently', async () => {
  const evaluator = await loadEvaluator()
  const root = stageExampleApp()
  try {
    const sources = [
      ...capability('api.crud-factory').sourcePaths,
      ...capability('data.entities').sourcePaths,
      ...capability('ui.datatable').sourcePaths,
    ]
    const reads = [...entrypointReads(), ...sources.map((source) => ({ path: source }))]

    const fileOverflow = evaluator.evaluateExampleReadPolicy({
      caseRecord: declaredCase({ maxFiles: 3 }),
      appRoot: root,
      reads,
    })
    assert.match(fileOverflow.firstViolation ?? '', /file budget exceeded: 4\/3/)

    const byteOverflow = evaluator.evaluateExampleReadPolicy({
      caseRecord: declaredCase({ maxBytes: 1 }),
      appRoot: root,
      reads,
    })
    assert.match(byteOverflow.firstViolation ?? '', /byte budget exceeded/)

    // Re-reading an already charged file never double-charges either budget.
    const repeated = evaluator.evaluateExampleReadPolicy({
      caseRecord: declaredCase({ maxFiles: 3 }),
      appRoot: root,
      reads: [...entrypointReads(), { path: sources[0] }, { path: sources[0] }],
    })
    assert.equal(repeated.firstViolation, null)
    assert.equal(repeated.roots[0].files, 3)

    const fallbackOverflow = evaluator.evaluateExampleReadPolicy({
      caseRecord: declaredCase({ fallback: { allowed: true, reasonCodes: ['INSTALLED_VERSION_CONTRACT_MISMATCH'], maxFiles: 4, maxBytes: 1 } }),
      appRoot: root,
      reads: [...entrypointReads(), {
        path: 'node_modules/@open-mercato/core/src/modules/customers/api/route.ts',
        fallbackReason: 'INSTALLED_VERSION_CONTRACT_MISMATCH',
      }],
    })
    assert.match(fallbackOverflow.firstViolation ?? '', /fallback byte budget exceeded/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('family 5: symlink escapes, generated caches, and sensitive paths fail closed', async () => {
  const evaluator = await loadEvaluator()
  const root = stageExampleApp()
  const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-example-outside-')))
  try {
    fs.writeFileSync(path.join(outside, 'stolen.ts'), 'export const secret = "must-not-be-read"\n')
    fs.symlinkSync(path.join(outside, 'stolen.ts'), path.join(root, EXAMPLE_ROOT, 'escape.ts'))
    fs.symlinkSync(outside, path.join(root, EXAMPLE_ROOT, 'escape-dir'), linkType)
    fs.mkdirSync(path.join(root, EXAMPLE_ROOT, '.mercato', 'generated'), { recursive: true })
    fs.writeFileSync(path.join(root, EXAMPLE_ROOT, '.mercato', 'generated', 'modules.js'), 'generated\n')
    fs.writeFileSync(path.join(root, EXAMPLE_ROOT, '.env.local'), 'OM_TOKEN=must-not-be-read\n')
    fs.writeFileSync(path.join(root, EXAMPLE_ROOT, 'signing.key'), 'must-not-be-read\n')
    fs.mkdirSync(path.join(root, EXAMPLE_ROOT, 'dist'), { recursive: true })
    fs.writeFileSync(path.join(root, EXAMPLE_ROOT, 'dist', 'bundle.js'), 'built\n')

    const caseRecord = declaredCase({})
    const cases: Array<[string, RegExp]> = [
      [`${EXAMPLE_ROOT}/escape.ts`, /follows a symbolic link/],
      [`${EXAMPLE_ROOT}/escape-dir/stolen.ts`, /resolves outside its declared path/],
      [`${EXAMPLE_ROOT}/.mercato/generated/modules.js`, /generated or protected directory/],
      [`${EXAMPLE_ROOT}/dist/bundle.js`, /generated or protected directory/],
      [`${EXAMPLE_ROOT}/.env.local`, /credential or secret file/],
      [`${EXAMPLE_ROOT}/signing.key`, /key material file/],
      [`${EXAMPLE_ROOT}/../../../etc/passwd`, /traversal or empty segments/],
      [`${EXAMPLE_ROOT}/%2e%2e/secrets.json`, /percent-encoded traversal/],
      ['/etc/passwd', /must be app-root relative/],
      ['~/.ssh/id_rsa', /must be app-root relative/],
    ]
    for (const [target, expected] of cases) {
      const trace = evaluator.evaluateExampleReadPolicy({ caseRecord, appRoot: root, reads: [...entrypointReads(), { path: target }] })
      assert.match(trace.firstViolation ?? '', expected, target)
    }
    const traces = cases.map(([target]) => evaluator.evaluateExampleReadPolicy({ caseRecord, appRoot: root, reads: [...entrypointReads(), { path: target }] }))
    assert.doesNotMatch(JSON.stringify(traces), /must-not-be-read/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
    fs.rmSync(outside, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------------------------
// Oracle family 6 — a broad writable grant can never mutate the canonical example.
// ---------------------------------------------------------------------------------------------

test('family 6: root immutability is resolved before writable-pattern matching and the write is refused before it happens', async () => {
  const evaluator = await loadEvaluator()
  const root = stageExampleApp()
  try {
    const caseRecord = declaredCase({ allowedWrites: ['src/modules/**'] })
    // Catalog validation refuses the configuration outright: the case cannot opt out.
    const declarationErrors = evaluator.validateExampleReadPolicyDeclaration(caseRecord, root)
    assert.ok(
      declarationErrors.some((message) => /writable pattern src\/modules\/\*\* reaches the immutable example root path/.test(message)),
      declarationErrors.join('; '),
    )
    assert.deepEqual(evaluator.immutableExampleRoots(caseRecord), [EXAMPLE_ROOT])

    const target = capability('api.crud-factory').sourcePaths[0]
    const before = fs.readFileSync(path.join(root, target), 'utf8')
    const replies = callToolServer(
      root,
      'writable',
      evaluator.exampleReadAllowlist(caseRecord, root),
      ['src/modules/**'],
      evaluator.immutableExampleRoots(caseRecord),
      [
        { name: 'write', arguments: { path: target, content: 'tampered\n' } },
        { name: 'write', arguments: { path: `${EXAMPLE_ROOT}/references/surface-inventory.json`, content: '{}\n' } },
        { name: 'write', arguments: { path: `${EXAMPLE_ROOT}/brand-new.ts`, content: 'export const injected = 1\n' } },
        { name: 'write', arguments: { path: 'src/modules/library/index.ts', content: 'export const ok = 1\n' } },
      ],
    )
    for (const reply of replies.slice(1, 4)) {
      assert.equal(reply.result.isError, true)
      assert.match(reply.result.content[0].text, /read-only declared root/)
    }
    assert.equal(replies[4].result.isError, undefined, 'an ordinary writable target outside the root still works')
    assert.equal(fs.readFileSync(path.join(root, target), 'utf8'), before, 'the canonical source must be byte-identical')
    assert.equal(fs.existsSync(path.join(root, EXAMPLE_ROOT, 'brand-new.ts')), false)
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(root, EXAMPLE_ROOT, 'references', 'surface-inventory.json'), 'utf8')).capabilities.length,
      inventoryCapabilities().length,
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('family 6: the immutable-root refusal precedes the write allowlist inside the tool server source', () => {
  const source = fs.readFileSync(sourceToolServer, 'utf8')
  const immutableIndex = source.indexOf("if (isImmutablePath(normalized)) throw new Error('path is inside a read-only declared root and can never be written')")
  const allowlistIndex = source.indexOf('if (!writeMatchers.some((matcher) => matcher.test(normalized))) throw new Error')
  assert.ok(immutableIndex > 0 && allowlistIndex > 0, 'both guards must exist')
  assert.ok(immutableIndex < allowlistIndex, 'the immutability guard must be evaluated before writable-pattern matching')
})

test('family 6: the immutable roots travel by environment so the positional allowlist contract is unchanged', () => {
  const server = fs.readFileSync(sourceToolServer, 'utf8')
  assert.match(server, /process\.env\.OM_HARNESS_IMMUTABLE_ROOTS/)
  assert.match(server, /allowedReads = JSON\.parse\(process\.argv\[4\]/)
  assert.match(server, /allowedWrites = JSON\.parse\(process\.argv\[5\]/)
  assert.doesNotMatch(server, /process\.argv\[6\]/, 'the published positional argument list must not grow')
  const evaluatorSource = fs.readFileSync(sourceEvaluator, 'utf8')
  const args = evaluatorSource.slice(evaluatorSource.indexOf('function harnessMcpConfig'))
  assert.match(args, /'-i', `OM_HARNESS_IMMUTABLE_ROOTS=\$\{JSON\.stringify\(immutableRoots \?\? \[\]\)\}`/)
  const readsIndex = args.indexOf('JSON.stringify(allowedReads ?? [])')
  const writesIndex = args.indexOf('JSON.stringify(allowedWrites ?? [])')
  const envIndex = args.indexOf('OM_HARNESS_IMMUTABLE_ROOTS=')
  assert.ok(envIndex < readsIndex && readsIndex < writesIndex, 'the read and write allowlists must remain the final two positional arguments')
})

// ---------------------------------------------------------------------------------------------
// Oracle family 7 — legacy roots, stale mappings, qa-only sources, and ordinary-surface fallback.
// ---------------------------------------------------------------------------------------------

test('family 7: the published schema rejects legacy roots, duplicates, missing entrypoints, bad budgets, unsafe paths, and unknown reasons', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(sourceHarness, 'cases.schema.json'), 'utf8')) as {
    items: { properties: { context: { properties: Record<string, unknown> } } }
    $defs: Record<string, { pattern: string }>
  }
  const roots = schema.items.properties.context.properties.exampleRoots as {
    minItems: number
    maxItems: number
    items: { required: string[]; additionalProperties: boolean; properties: Record<string, { const?: string; minItems?: number; minimum?: number }> }
  }
  assert.equal(roots.items.properties.root.const, EXAMPLE_ROOT, 'only the canonical root is admissible')
  assert.equal(roots.maxItems, 1, 'a second entry is always a duplicate root because the root is a constant')
  assert.deepEqual(roots.items.required.sort(), ['allowedCapabilityIds', 'entrypoints', 'maxBytes', 'maxFiles', 'root'])
  assert.equal(roots.items.additionalProperties, false)
  assert.equal(roots.items.properties.entrypoints.minItems, 1)
  assert.equal(roots.items.properties.allowedCapabilityIds.minItems, 1)
  assert.equal(roots.items.properties.maxFiles.minimum, 1)
  assert.equal(roots.items.properties.maxBytes.minimum, 1)

  const fallback = schema.items.properties.context.properties.installedVersionFallback as {
    required: string[]
    additionalProperties: boolean
    properties: { reasonCodes: { items: { enum: string[] } }; maxFiles: { minimum: number }; maxBytes: { minimum: number } }
  }
  assert.deepEqual(fallback.required.sort(), ['allowed', 'maxBytes', 'maxFiles', 'reasonCodes'])
  assert.equal(fallback.additionalProperties, false)
  assert.deepEqual(fallback.properties.reasonCodes.items.enum, ['SPECIALIST_ROUTE_NOT_DECLARED', 'INSTALLED_VERSION_CONTRACT_MISMATCH'])
  assert.equal(fallback.properties.maxFiles.minimum, 1)
  assert.equal(fallback.properties.maxBytes.minimum, 1)

  const entrypointPattern = new RegExp(schema.$defs.exampleRootRelativePath.pattern)
  for (const accepted of ENTRYPOINTS) assert.ok(entrypointPattern.test(accepted), accepted)
  for (const rejected of [
    '/README.md', '../README.md', 'references/../../secrets.json', 'references//surface-map.md',
    'references\\surface-map.md', '.env', '%2e%2e/secrets.json', 'references/surface-map.md/',
  ]) assert.equal(entrypointPattern.test(rejected), false, rejected)
})

test('family 7: the published schema rejects every malformed declaration it must reject', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(sourceHarness, 'cases.schema.json'), 'utf8')) as {
    items: { properties: { context: { properties: Record<string, unknown> } } }
    $defs: Record<string, unknown>
  }
  const rootSchema = { $defs: schema.$defs, ...(schema.items.properties.context.properties.exampleRoots as object) }
  const fallbackSchema = { $defs: schema.$defs, ...(schema.items.properties.context.properties.installedVersionFallback as object) }

  const valid = { root: EXAMPLE_ROOT, entrypoints: ENTRYPOINTS, allowedCapabilityIds: ['api.crud-factory'], maxFiles: 12, maxBytes: 131_072 }
  const invalidRoots = [
    [{ ...valid, root: 'src/modules/example-legacy' }],
    [{ ...valid, root: 'src/modules/example/../example' }],
    [{ ...valid, root: 'node_modules/@open-mercato/core/src/modules/example' }],
    [valid, valid],
    [{ ...valid, entrypoints: [] }],
    [{ root: valid.root, allowedCapabilityIds: valid.allowedCapabilityIds, maxFiles: 12, maxBytes: 1024 }],
    [{ ...valid, maxFiles: 0 }],
    [{ ...valid, maxBytes: -1 }],
    [{ ...valid, entrypoints: ['../../etc/passwd'] }],
    [{ ...valid, extra: true }],
  ]
  for (const candidate of invalidRoots) {
    assert.ok(jsonSchemaErrors(candidate, rootSchema).length > 0, JSON.stringify(candidate))
  }
  assert.deepEqual(jsonSchemaErrors([valid], rootSchema), [])

  for (const candidate of [
    { allowed: true, reasonCodes: ['NOT_A_REAL_REASON'], maxFiles: 4, maxBytes: 65_536 },
    { allowed: true, reasonCodes: [], maxFiles: 4, maxBytes: 65_536 },
    { allowed: true, reasonCodes: ['INSTALLED_VERSION_CONTRACT_MISMATCH'], maxFiles: 0, maxBytes: 65_536 },
    { allowed: true, reasonCodes: ['INSTALLED_VERSION_CONTRACT_MISMATCH'], maxFiles: 4, maxBytes: 0 },
    { reasonCodes: ['INSTALLED_VERSION_CONTRACT_MISMATCH'], maxFiles: 4, maxBytes: 65_536 },
  ]) assert.ok(jsonSchemaErrors(candidate, fallbackSchema).length > 0, JSON.stringify(candidate))
  assert.deepEqual(
    jsonSchemaErrors({ allowed: true, reasonCodes: ['SPECIALIST_ROUTE_NOT_DECLARED', 'INSTALLED_VERSION_CONTRACT_MISMATCH'], maxFiles: 4, maxBytes: 65_536 }, fallbackSchema),
    [],
  )
})

test('family 7: a legacy root, a stale capability mapping, and a qa-only source fail evaluator validation', async () => {
  const evaluator = await loadEvaluator()
  const root = stageExampleApp()
  try {
    assert.ok(evaluator.validateExampleReadPolicyDeclaration(declaredCase({ root: 'src/modules/example-legacy' }), root)
      .some((message) => /must be the canonical src\/modules\/example/.test(message)))
    assert.ok(evaluator.validateExampleReadPolicyDeclaration(declaredCase({ allowedCapabilityIds: ['api.does-not-exist'] }), root)
      .some((message) => /unknown to the surface inventory/.test(message)))
    // `overrides.unified-registry` is canonical and readable, but maps only `src/modules.ts`,
    // so it can never be reached through the example root.
    assert.equal(capability('overrides.unified-registry').readStatus, 'readable')
    assert.ok(evaluator.validateExampleReadPolicyDeclaration(declaredCase({ allowedCapabilityIds: ['overrides.unified-registry'] }), root)
      .some((message) => /maps no source under the declared root/.test(message)))
    // The evaluator-facing derivation is readStatus, not referenceStatus.
    const qaOnly = capability('api.crud-query-engine-custom-fields')
    assert.equal(qaOnly.readStatus, 'qa-only')
    assert.ok(evaluator.validateExampleReadPolicyDeclaration(declaredCase({ allowedCapabilityIds: [qaOnly.capabilityId] }), root)
      .some((message) => /qa-only and cannot be read/.test(message)))
    assert.ok(evaluator.validateExampleReadPolicyDeclaration(declaredCase({ entrypoints: ['references/does-not-exist.md'] }), root)
      .some((message) => /entrypoint is unreadable/.test(message)))

    const undeclaredQaOnly = evaluator.evaluateExampleReadPolicy({
      caseRecord: declaredCase({ allowedCapabilityIds: ['api.crud-factory'] }),
      appRoot: root,
      reads: [...entrypointReads(), { path: qaOnly.sourcePaths[0] }],
    })
    assert.match(undeclaredQaOnly.firstViolation ?? '', /maps to a capability the case did not declare/)
    // Defense in depth: even a case that somehow declared the qa-only ID (for example against an
    // older inventory) is refused at read time by the derived readStatus, not by referenceStatus.
    const declaredQaOnly = evaluator.evaluateExampleReadPolicy({
      caseRecord: declaredCase({ allowedCapabilityIds: [qaOnly.capabilityId] }),
      appRoot: root,
      reads: [...entrypointReads(), { path: qaOnly.sourcePaths[0] }],
    })
    assert.match(declaredQaOnly.firstViolation ?? '', /resolves to a qa-only capability/)
    assert.ok(declaredQaOnly.reads.every((entry) => entry.path !== qaOnly.sourcePaths[0]))

    const stalePath = evaluator.evaluateExampleReadPolicy({
      caseRecord: declaredCase({}),
      appRoot: root,
      reads: [...entrypointReads(), { path: `${EXAMPLE_ROOT}/api/removed-in-a-refactor/route.ts` }],
    })
    assert.match(stalePath.firstViolation ?? '', /does not exist|not mapped by the surface inventory/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('family 7: an ordinary example surface is never a specialist-route fallback reason', async () => {
  const evaluator = await loadEvaluator()
  const root = stageExampleApp()
  try {
    const caseRecord = declaredCase({
      fallback: { allowed: true, reasonCodes: ['SPECIALIST_ROUTE_NOT_DECLARED'], maxFiles: 4, maxBytes: 65_536 },
    })
    const installed = 'node_modules/@open-mercato/core/src/modules/customers/api/route.ts'
    const ordinary = evaluator.evaluateExampleReadPolicy({
      caseRecord,
      appRoot: root,
      reads: [...entrypointReads(), { path: installed, fallbackReason: 'SPECIALIST_ROUTE_NOT_DECLARED', capabilityId: 'api.crud-factory' }],
    })
    assert.equal(capability('api.crud-factory').coverageKind, 'example')
    assert.match(ordinary.firstViolation ?? '', /ordinary example surface is not a fallback reason/)

    const unnamed = evaluator.evaluateExampleReadPolicy({
      caseRecord,
      appRoot: root,
      reads: [...entrypointReads(), { path: installed, fallbackReason: 'SPECIALIST_ROUTE_NOT_DECLARED' }],
    })
    assert.match(unnamed.firstViolation ?? '', /does not classify/)

    const specialist = capability('testing.integration-coverage')
    assert.equal(specialist.coverageKind, 'specialist-route')
    const allowed = evaluator.evaluateExampleReadPolicy({
      caseRecord,
      appRoot: root,
      reads: [...entrypointReads(), { path: installed, fallbackReason: 'SPECIALIST_ROUTE_NOT_DECLARED', capabilityId: specialist.capabilityId }],
    })
    assert.equal(allowed.firstViolation, null)
    assert.equal(allowed.fallback.reason, 'SPECIALIST_ROUTE_NOT_DECLARED')

    // Cross-use of the two reason codes in one trace fails.
    const mixed = evaluator.evaluateExampleReadPolicy({
      caseRecord: declaredCase({
        fallback: { allowed: true, reasonCodes: ['SPECIALIST_ROUTE_NOT_DECLARED', 'INSTALLED_VERSION_CONTRACT_MISMATCH'], maxFiles: 4, maxBytes: 65_536 },
      }),
      appRoot: root,
      reads: [
        ...entrypointReads(),
        { path: installed, fallbackReason: 'SPECIALIST_ROUTE_NOT_DECLARED', capabilityId: specialist.capabilityId },
        { path: 'node_modules/@open-mercato/core/src/modules/customers/api/route.ts', fallbackReason: 'INSTALLED_VERSION_CONTRACT_MISMATCH' },
      ],
    })
    assert.match(mixed.firstViolation ?? '', /mixes reason codes/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------------------------
// Path normalization — POSIX plus Windows-style syntax.
// ---------------------------------------------------------------------------------------------

test('path normalization accepts Windows-style separators and rejects every escape spelling', async () => {
  const evaluator = await loadEvaluator()
  assert.deepEqual(evaluator.normalizeExampleReadPath('src\\modules\\example\\README.md'), { relative: `${EXAMPLE_ROOT}/README.md` })
  assert.deepEqual(evaluator.normalizeExampleReadPath(`${EXAMPLE_ROOT}/references/surface-map.md`), { relative: `${EXAMPLE_ROOT}/references/surface-map.md` })
  for (const [value, expected] of [
    ['C:\\Users\\pkarw\\.npmrc', /must be app-root relative/],
    ['\\\\fileserver\\share\\secrets.json', /must be app-root relative/],
    ['/etc/shadow', /must be app-root relative/],
    ['~/.aws/credentials', /must be app-root relative/],
    ['src\\modules\\example\\..\\..\\..\\secrets.json', /traversal or empty segments/],
    ['src/modules/example/./README.md', /traversal or empty segments/],
    ['src//modules/example/README.md', /traversal or empty segments/],
    ['src/modules/example/%2E%2E/etc/passwd', /percent-encoded traversal/],
    ['src/modules/example/READ\nME.md', /control character/],
    ['src/modules/example/.npmrc', /credential or secret file/],
    ['src/modules/example/node_modules/pkg/index.js', /generated or protected directory/],
    ['', /non-empty string/],
  ] as Array<[string, RegExp]>) {
    const result = evaluator.normalizeExampleReadPath(value)
    assert.equal(result.relative, undefined, value)
    assert.match(result.violation ?? '', expected, value)
  }
  assert.match(evaluator.normalizeExampleReadPath(42).violation ?? '', /non-empty string/)
})

// ---------------------------------------------------------------------------------------------
// Backward compatibility — cases without `exampleRoots` keep their previous semantics exactly.
// ---------------------------------------------------------------------------------------------

test('compatibility: no shipped case declares the new fields, so the policy is inert for all of them', async () => {
  const evaluator = await loadEvaluator()
  const root = stageExampleApp()
  try {
    const cases = shippedCases()
    assert.ok(cases.length > 0)
    for (const entry of cases) {
      assert.equal(entry.context.exampleRoots, undefined, `${entry.id} must not declare exampleRoots yet`)
      assert.equal(entry.context.installedVersionFallback, undefined, `${entry.id} must not declare installedVersionFallback yet`)
      assert.deepEqual(evaluator.exampleReadAllowlist(entry, root), [], `${entry.id} read allowlist must be unchanged`)
      assert.deepEqual(evaluator.immutableExampleRoots(entry), [], `${entry.id} must gain no immutable roots`)
      assert.deepEqual(evaluator.validateExampleReadPolicyDeclaration(entry, root), [], `${entry.id} must gain no declaration errors`)
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('compatibility: an undeclared case produces an inert trace for reads that a declared case would reject', async () => {
  const evaluator = await loadEvaluator()
  const root = stageExampleApp()
  try {
    const reads: PolicyRead[] = [
      { path: `${EXAMPLE_ROOT}/api`, kind: 'list' },
      { path: capability('api.crud-query-engine-custom-fields').sourcePaths[0] },
      { path: 'node_modules/@open-mercato/core/src/modules/customers/api/route.ts' },
      { path: 'src/modules/library/index.ts' },
    ]
    for (const undeclared of [
      { context: { required: ['AGENTS.md'], forbidden: ['.env'] }, allowedWrites: ['src/modules/**'] },
      ...shippedCases().slice(0, 3),
    ]) {
      const trace = evaluator.evaluateExampleReadPolicy({ caseRecord: undeclared, appRoot: root, reads })
      assert.deepEqual(trace, { reads: [], roots: [], fallback: { reason: null, files: 0, bytes: 0 }, firstViolation: null })
    }
    // The same reads under a declared root are governed and rejected.
    const declared = evaluator.evaluateExampleReadPolicy({ caseRecord: declaredCase({}), appRoot: root, reads })
    assert.notEqual(declared.firstViolation, null)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('compatibility: the deterministic catalog still validates end to end with the new schema fields', () => {
  const cases = JSON.parse(fs.readFileSync(path.join(sourceHarness, 'cases.json'), 'utf8')) as unknown[]
  const schema = JSON.parse(fs.readFileSync(path.join(sourceHarness, 'cases.schema.json'), 'utf8'))
  assert.deepEqual(jsonSchemaErrors(cases, schema), [], 'the published catalog must still satisfy its own schema')
})

/**
 * A minimal draft-2020-12 subset mirroring the evaluator's own validator, so schema fixtures do
 * not depend on an external validator the harness does not ship.
 */
function jsonSchemaErrors(value: unknown, schema: Record<string, any>, location = '$', rootSchema: Record<string, any> = schema): string[] {
  if (schema.$ref) {
    const pointer = String(schema.$ref).replace(/^#\//, '').split('/')
    let resolved: any = rootSchema
    for (const segment of pointer) resolved = resolved?.[segment]
    return resolved ? jsonSchemaErrors(value, resolved, location, rootSchema) : [`${location} has an unresolved reference`]
  }
  const errors: string[] = []
  const isObject = value !== null && typeof value === 'object' && !Array.isArray(value)
  const matchesType = (type: string) => (type === 'array' ? Array.isArray(value)
    : type === 'object' ? isObject
      : type === 'integer' ? Number.isInteger(value)
        : type === 'number' ? typeof value === 'number'
          : type === 'boolean' ? typeof value === 'boolean'
            : type === 'string' ? typeof value === 'string' : false)
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : []
  if (types.length && !types.some(matchesType)) return [`${location} must be ${types.join(' or ')}`]
  if (Object.hasOwn(schema, 'const') && value !== schema.const) errors.push(`${location} must equal its constant`)
  if (schema.enum && !schema.enum.some((item: unknown) => JSON.stringify(item) === JSON.stringify(value))) errors.push(`${location} is not in its enum`)
  if (typeof value === 'string') {
    if (Number.isInteger(schema.minLength) && value.length < schema.minLength) errors.push(`${location} is below minLength`)
    if (Number.isInteger(schema.maxLength) && value.length > schema.maxLength) errors.push(`${location} exceeds maxLength`)
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${location} does not match its pattern`)
  }
  if (typeof value === 'number') {
    if (Number.isFinite(schema.minimum) && value < schema.minimum) errors.push(`${location} is below minimum`)
    if (Number.isFinite(schema.maximum) && value > schema.maximum) errors.push(`${location} exceeds maximum`)
  }
  if (Array.isArray(value)) {
    if (Number.isInteger(schema.minItems) && value.length < schema.minItems) errors.push(`${location} is below minItems`)
    if (Number.isInteger(schema.maxItems) && value.length > schema.maxItems) errors.push(`${location} exceeds maxItems`)
    if (schema.uniqueItems && new Set(value.map((item) => JSON.stringify(item))).size !== value.length) errors.push(`${location} must contain unique items`)
    if (schema.items) value.forEach((item, index) => errors.push(...jsonSchemaErrors(item, schema.items, `${location}[${index}]`, rootSchema)))
  }
  if (isObject) {
    const record = value as Record<string, unknown>
    for (const required of schema.required ?? []) if (!Object.hasOwn(record, required)) errors.push(`${location}.${required} is required`)
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(record)) if (!Object.hasOwn(schema.properties ?? {}, key)) errors.push(`${location}.${key} is not allowed`)
    }
    for (const [key, childSchema] of Object.entries(schema.properties ?? {})) {
      if (Object.hasOwn(record, key)) errors.push(...jsonSchemaErrors(record[key], childSchema as Record<string, any>, `${location}.${key}`, rootSchema))
    }
  }
  for (const branch of schema.allOf ?? []) {
    if (branch.if) {
      const selected = jsonSchemaErrors(value, branch.if, location, rootSchema).length === 0 ? branch.then : branch.else
      if (selected) errors.push(...jsonSchemaErrors(value, selected, location, rootSchema))
    } else errors.push(...jsonSchemaErrors(value, branch, location, rootSchema))
  }
  return errors
}
