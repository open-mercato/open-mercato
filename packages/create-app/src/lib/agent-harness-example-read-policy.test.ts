import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
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
  sanitizedExampleReadPolicy: (trace: unknown, root: string) => {
    roots: Array<{ root: string; entrypoints: string[]; capabilities: string[]; files: number; bytes: number }>
    fallback: { reason: string | null; files: number; bytes: number }
  }
  observedContext: (
    stdout: string,
    root: string,
    caseRecord: unknown,
    writable: boolean,
    reviewExpectedReads?: string[],
    selectedRoutes?: Set<string>,
  ) => { exampleReadPolicy: PolicyTrace; violations: string[]; paths: string[] }
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
function stageExampleApp(mutateInventory?: (records: InventoryRecord[]) => void): string {
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

  // A real scaffold always ships the emitted source-link projection and the owners it names, so
  // every fixture gets them. `mutateInventory` lets one fixture stage its own defect in a copy.
  const inventory = projectedInventory()
  if (mutateInventory) mutateInventory(inventory.records)
  fs.mkdirSync(path.join(root, '.ai', 'harness'), { recursive: true })
  fs.writeFileSync(
    path.join(root, '.ai', 'harness', 'source-link-inventory.json'),
    `${JSON.stringify(inventory, null, 2)}\n`,
  )
  for (const owner of new Set(inventory.records.map((entry) => entry.originAsset))) {
    const absolute = path.join(root, owner)
    fs.mkdirSync(path.dirname(absolute), { recursive: true })
    if (!fs.existsSync(absolute)) fs.writeFileSync(absolute, `# staged owner ${owner}\n`)
  }
  return root
}

/**
 * Force one capability row to `qa-only` in a STAGED inventory copy. The evaluator's qa-only
 * refusal must stay provable even when every shipped row has been remediated to `readable`,
 * so this fixture owns its own defect instead of borrowing a real one from the module.
 */
function stageExampleAppWithQaOnlyCapability(capabilityId: string): { root: string; qaOnly: Capability } {
  const root = stageExampleApp()
  const inventoryPath = path.join(root, EXAMPLE_ROOT, 'references', 'surface-inventory.json')
  const parsed = JSON.parse(fs.readFileSync(inventoryPath, 'utf8')) as { capabilities: Capability[] }
  const target = parsed.capabilities.find((entry) => entry.capabilityId === capabilityId)
  assert.ok(target, `the shipped surface inventory must still declare ${capabilityId}`)
  assert.ok(target.sourcePaths.length > 0, `${capabilityId} must map at least one source path`)
  target.referenceStatus = 'qa-only'
  target.readStatus = 'qa-only'
  target.qaOnlyReason = 'Staged by the read-policy fixture to exercise the qa-only refusal path.'
  fs.writeFileSync(inventoryPath, `${JSON.stringify(parsed, null, 2)}\n`)
  return { root, qaOnly: target }
}

type InventoryRecord = {
  referenceId: string
  requirement: string
  originAsset: string
  targetKind: string
  readStatus: string
  resolvedPath: string
  capabilityIds: string[]
}

/** The app-facing projection the harness ships; `context.sourceReferenceIds` resolves against it. */
function projectedInventory(): { records: InventoryRecord[] } {
  return JSON.parse(fs.readFileSync(path.join(sourceHarness, 'source-link-inventory.json'), 'utf8'))
}

/**
 * Stage the app of `stageExampleApp` plus the emitted source-link projection and the emitted
 * owners it names, so declared-reference fixtures run against the REAL shipped inventory rather
 * than a hand-written stand-in. `mutate` lets one fixture stage its own defect.
 */
function stageExampleAppWithReferences(mutate?: (records: InventoryRecord[]) => void): {
  root: string
  reference: InventoryRecord
} {
  const root = stageExampleApp(mutate)
  const staged = JSON.parse(
    fs.readFileSync(path.join(root, '.ai', 'harness', 'source-link-inventory.json'), 'utf8'),
  ) as { records: InventoryRecord[] }
  const reference = staged.records.find((entry) => entry.referenceId === REFERENCE_ID)
  assert.ok(reference, `the shipped projection must still carry ${REFERENCE_ID}`)
  return { root, reference }
}

/**
 * One shipped canonical-example reference used across the declared-link fixtures: the backend-UI
 * guide renders a visible link to the exact Todo form the example ships.
 */
const REFERENCE_ID = 'guides/backend-ui:components/TodoForm.tsx'
const REFERENCE_OWNER = '.ai/guides/backend-ui.md'
const REFERENCE_TARGET = `${EXAMPLE_ROOT}/components/TodoForm.tsx`

function referencingCase(overrides: { sourceReferenceIds?: string[]; allowedExtra?: string[] } = {}): CaseRecord {
  return {
    context: {
      required: ['AGENTS.md', REFERENCE_OWNER],
      forbidden: ['.env'],
      sourceReferenceIds: overrides.sourceReferenceIds ?? [REFERENCE_ID],
      ...(overrides.allowedExtra ? { allowedExtra: overrides.allowedExtra } : {}),
      exampleRoots: [{
        root: EXAMPLE_ROOT,
        entrypoints: ENTRYPOINTS,
        allowedCapabilityIds: ['ui.form-create', 'ui.form-edit'],
        maxFiles: 12,
        maxBytes: 131_072,
      }],
    },
  }
}

/**
 * A case whose declared capabilities do NOT cover the referenced file, so the reference is the
 * ONLY thing that can grant it. Probing reference behaviour through `referencingCase` would be
 * vacuous: its `ui.form-*` capabilities already map the same target.
 */
function referenceOnlyCase(): CaseRecord {
  const record = referencingCase()
  const context = record.context as Record<string, unknown>
  return {
    context: {
      ...context,
      exampleRoots: [{
        root: EXAMPLE_ROOT,
        entrypoints: ENTRYPOINTS,
        allowedCapabilityIds: ['data.entities'],
        maxFiles: 12,
        maxBytes: 131_072,
      }],
    },
  }
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
  const { root, qaOnly } = stageExampleAppWithQaOnlyCapability('api.crud-query-engine-custom-fields')
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

// ---------------------------------------------------------------------------------------------
// Oracle family 8 — the live runner carries the reason code, so a reason-gated fallback is
// reachable outside the synthetic fixtures. Before this channel existed the trace recorded only
// `{path, kind}`, so every live installed-source read hit "fallback reason is unknown" and the
// declared `installedVersionFallback` contract could never be satisfied by a real run.
// ---------------------------------------------------------------------------------------------

const INSTALLED_SOURCE = 'node_modules/@open-mercato/core/src/modules/customers/api/route.ts'

function readEvent(pathValue: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ type: 'mcp_tool_call', name: 'harness__read', arguments: { path: pathValue, ...extra } })
}

function liveTrace(evaluator: Evaluator, root: string, lines: string[], caseRecord: unknown) {
  return evaluator.observedContext(lines.join('\n'), root, caseRecord, false)
}

test('family 8: a live trace carries the declared reason code into the fallback accounting', async () => {
  const evaluator = await loadEvaluator()
  const root = stageExampleApp()
  try {
    const caseRecord = declaredCase({})
    const entrypointLines = ENTRYPOINTS.map((entrypoint) => readEvent(`${EXAMPLE_ROOT}/${entrypoint}`))

    const withReason = liveTrace(evaluator, root, [
      ...entrypointLines,
      readEvent(capability('api.crud-factory').sourcePaths[0]),
      readEvent(INSTALLED_SOURCE, { reason: 'INSTALLED_VERSION_CONTRACT_MISMATCH' }),
    ], caseRecord)

    assert.equal(withReason.exampleReadPolicy.firstViolation, null)
    assert.equal(withReason.exampleReadPolicy.fallback.reason, 'INSTALLED_VERSION_CONTRACT_MISMATCH')
    assert.equal(withReason.exampleReadPolicy.fallback.files, 1)
    assert.equal(withReason.exampleReadPolicy.reads.at(-1)?.fallbackReason, 'INSTALLED_VERSION_CONTRACT_MISMATCH')

    // The same trace without the reason must still fail closed — the channel grants nothing on
    // its own, it only lets a case that DECLARED the reason satisfy its own contract.
    const withoutReason = liveTrace(evaluator, root, [
      ...entrypointLines,
      readEvent(capability('api.crud-factory').sourcePaths[0]),
      readEvent(INSTALLED_SOURCE),
    ], caseRecord)
    assert.match(withoutReason.exampleReadPolicy.firstViolation ?? '', /fallback reason is unknown/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('family 8: the live channel carries the capability id a specialist-route fallback needs', async () => {
  const evaluator = await loadEvaluator()
  const root = stageExampleApp()
  try {
    const entrypointLines = ENTRYPOINTS.map((entrypoint) => readEvent(`${EXAMPLE_ROOT}/${entrypoint}`))
    const trace = liveTrace(evaluator, root, [
      ...entrypointLines,
      readEvent(INSTALLED_SOURCE, { reason: 'SPECIALIST_ROUTE_NOT_DECLARED', capabilityId: 'api.crud-factory' }),
    ], declaredCase({
      fallback: {
        allowed: true,
        reasonCodes: ['SPECIALIST_ROUTE_NOT_DECLARED', 'INSTALLED_VERSION_CONTRACT_MISMATCH'],
        maxFiles: 4,
        maxBytes: 65_536,
      },
    }))

    // `api.crud-factory` is an ordinary example surface, so the specialist-route reason is refused
    // on its classification — proving the capability id survived the trace rather than arriving
    // empty (which would have failed with the different "<missing>" message).
    assert.match(trace.exampleReadPolicy.firstViolation ?? '', /an ordinary example surface is not a fallback reason/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('family 8: one trace may not mix two declared fallback reasons', async () => {
  const evaluator = await loadEvaluator()
  const root = stageExampleApp()
  try {
    const trace = evaluator.evaluateExampleReadPolicy({
      caseRecord: declaredCase({
        fallback: {
          allowed: true,
          reasonCodes: ['SPECIALIST_ROUTE_NOT_DECLARED', 'INSTALLED_VERSION_CONTRACT_MISMATCH'],
          maxFiles: 4,
          maxBytes: 65_536,
        },
      }),
      appRoot: root,
      reads: [
        ...entrypointReads(),
        { path: INSTALLED_SOURCE, fallbackReason: 'INSTALLED_VERSION_CONTRACT_MISMATCH' },
        { path: 'node_modules/@open-mercato/core/src/modules/customers/api/other.ts', fallbackReason: 'SPECIALIST_ROUTE_NOT_DECLARED', capabilityId: 'api.crud-factory' },
      ],
    })
    assert.match(trace.firstViolation ?? '', /mixes reason codes/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('family 8: the tool server refuses a read whose declared reason is outside the enum', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-example-policy-reason-')))
  try {
    fs.writeFileSync(path.join(root, 'AGENTS.md'), '# agents\n')
    const replies = callToolServer(root, 'read-only', ['AGENTS.md'], [], [], [
      { name: 'read', arguments: { path: 'AGENTS.md', reason: 'BECAUSE_I_SAID_SO' } },
      { name: 'read', arguments: { path: 'AGENTS.md', capabilityId: '../../etc/passwd' } },
      { name: 'read', arguments: { path: 'AGENTS.md', reason: 'INSTALLED_VERSION_CONTRACT_MISMATCH' } },
    ])
    assert.equal(replies[1].result.isError, true)
    assert.match(replies[1].result.content[0].text, /declared installed-source fallback reason code/)
    assert.equal(replies[2].result.isError, true)
    assert.match(replies[2].result.content[0].text, /capability id/)
    assert.notEqual(replies[3].result.isError, true)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

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
// Shipped-catalog reachability — the policy is live for the cases that declare it and still inert
// for every case that does not. `DECLARING_CASE_IDS` is the pinned contract: adding or removing a
// declaring case must be a deliberate edit here, not a silent catalog drift.
// ---------------------------------------------------------------------------------------------

const DECLARING_CASE_IDS = ['OMH-181', 'OMH-203', 'OMH-219', 'OMH-220', 'OMH-221', 'OMH-222', 'OMH-223', 'OMH-225', 'OMH-226']

/**
 * The exact capability set each declaring case may read.
 *
 * The reachability test below derives its expected allowlist FROM the case's own
 * `allowedCapabilityIds`, so adding a capability widens both sides of that comparison
 * equally and the assertion still passes — a verifier probe proved it: appending
 * `umes.injection.datatable-column` to OMH-219 silently widened that case's example-read
 * scope with the whole suite green. Pinning the sets here makes widening a case's reach an
 * explicit, reviewable edit rather than a silent one.
 */
const DECLARED_CAPABILITY_IDS: Record<string, string[]> = {
  'OMH-181': ['runtime.bulk-operation-progress', 'umes.injection.datatable-bulk-action'],
  'OMH-203': ['umes.injection-table'],
  'OMH-219': ['api.crud-factory', 'data.custom-fields', 'data.entities', 'data.validators'],
  'OMH-220': [
    'umes.injection.datatable-bulk-action',
    'umes.injection.datatable-column',
    'umes.injection.datatable-filter',
    'umes.injection.datatable-row-action',
  ],
  'OMH-221': ['ui.datatable', 'ui.form-create', 'ui.form-edit'],
  'OMH-222': ['commands.undo-redo', 'commands.write', 'events.crud-indexer-bridge', 'events.typed-definitions'],
  // The one writable declaring case: its plan must name exact reference sources, so it reads the
  // module-shaped capability set a stock-transfer module would adapt. Its write allowlist is
  // `.ai/specs/**`, and root immutability rejects a write here regardless.
  'OMH-223': [
    'api.crud-factory',
    'commands.write',
    'data.entities',
    'data.validators',
    'events.typed-definitions',
  ],
  'OMH-225': ['runtime.bulk-operation-progress'],
  'OMH-226': ['ai.agent', 'ai.agent-extension', 'ai.tool-pack'],
}
const REFERENCE_SHEET = '.ai/guides/reference-modules/example.md'

type HarnessBudgets = {
  id: string
  maxContextFiles: number
  maxInitialContextBytes: number
  maxTotalContextBytes: number
  context: {
    required: string[]
    allowedExtra?: string[]
    exampleRoots: Array<{ maxFiles: number; maxBytes: number }>
  }
}

function declaringShippedCases() {
  return shippedCases().filter((entry) => entry.context.exampleRoots !== undefined)
}

function undeclaringShippedCases() {
  return shippedCases().filter((entry) => entry.context.exampleRoots === undefined)
}

function declaredCapabilityIds(entry: { context: Record<string, unknown> }): string[] {
  const roots = entry.context.exampleRoots as Array<{ allowedCapabilityIds: string[] }>
  return roots.flatMap((declaration) => declaration.allowedCapabilityIds)
}

test('reachability: exactly the pinned shipped cases declare an example root, and each one is live', async () => {
  const evaluator = await loadEvaluator()
  const root = stageExampleApp()
  try {
    const declaring = declaringShippedCases()
    assert.deepEqual(declaring.map((entry) => entry.id), DECLARING_CASE_IDS)
    for (const entry of declaring) {
      assert.deepEqual(
        declaredCapabilityIds(entry).slice().sort(),
        DECLARED_CAPABILITY_IDS[entry.id],
        `${entry.id} reads a different capability set than the pinned one — widening a case's example reach must be an explicit edit`,
      )
      assert.deepEqual(evaluator.validateExampleReadPolicyDeclaration(entry, root), [], `${entry.id} must declare a valid root`)
      assert.deepEqual(evaluator.immutableExampleRoots(entry), [EXAMPLE_ROOT], `${entry.id} must make the example root immutable`)
      const allowlist = evaluator.exampleReadAllowlist(entry, root)
      // Entrypoints, the inventory, and every mapped capability source — and nothing else.
      const expected = [
        `${EXAMPLE_ROOT}/references/surface-inventory.json`,
        ...ENTRYPOINTS.map((entrypoint) => `${EXAMPLE_ROOT}/${entrypoint}`),
        ...declaredCapabilityIds(entry).flatMap((id) => capability(id).sourcePaths),
      ]
      assert.deepEqual([...new Set(allowlist)].sort(), [...new Set(expected)].sort(), `${entry.id} allowlist must be its own exact files`)
      for (const relative of allowlist) {
        assert.ok(fs.existsSync(path.join(root, relative)), `${entry.id} allowlist names a file that does not ship: ${relative}`)
      }
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

/**
 * `installedVersionFallback` is schema- and evaluator-complete, but the runner-facing tool
 * instruction still describes a read tool that takes only a path. A shipped case that declared the
 * fallback would therefore be unpassable in the live lane: the model has no documented way to send
 * the reason code the evaluator demands. This fixture keeps that pairing honest in both directions.
 */
test('reachability: the specialist routing case can use the documented reason-gated fallback channel', () => {
  const toolInstruction = /const toolInstruction = `([^`]*)`/.exec(evaluatorSource())
  assert.ok(toolInstruction, 'the runner tool instruction must still be a single template literal')
  assert.match(toolInstruction[1], /"reason"/)
  assert.match(toolInstruction[1], /"capabilityId"/)

  const declaring = shippedCases().filter((entry) => entry.context.installedVersionFallback !== undefined)
  assert.deepEqual(declaring.map((entry) => entry.id), ['OMH-203'])
  assert.deepEqual(declaring[0].context.installedVersionFallback, {
    allowed: true,
    reasonCodes: ['INSTALLED_VERSION_CONTRACT_MISMATCH'],
    maxFiles: 4,
    maxBytes: 65536,
  })
})

test('reachability: AGENT-HARNESS.md names exactly the declaring case set, which no count guard covers', () => {
  const doc = fs.readFileSync(fileURLToPath(new URL('../../AGENT-HARNESS.md', import.meta.url)), 'utf8')
  const stated = /(\w+) cases,\s+`(OMH-\d{3})` and `(OMH-\d{3})`…`(OMH-\d{3})`, declare it today/.exec(doc)
  assert.ok(stated, 'AGENT-HARNESS.md must state the example-root declaring set')
  assert.equal(stated[1], 'Nine')
  assert.equal(DECLARING_CASE_IDS.length, 9)
  assert.deepEqual([stated[2], stated[3], stated[4]], ['OMH-181', 'OMH-203', 'OMH-226'])
  // The read-only/writable split is the reviewable half of that sentence: a writable declarer is
  // exactly what immutability precedence has to defend against, so the doc names it by ID.
  const writable = declaringShippedCases().filter((entry) => ['implementation', 'regression'].includes(entry.evaluationKind))
  assert.deepEqual(writable.map((entry) => entry.id), ['OMH-181', 'OMH-223'])
  assert.match(doc, /`OMH-181` and `OMH-223` are the two writable declarers/)
})

/**
 * The spec's Ownership Boundary requires the DataTable bulk action to stay separately
 * discoverable from the row action: its own visible source reference and its own case-selection
 * assertion, never folded into the neighbouring seam. This checks the requirement rather than
 * re-typing a case's capability list, so it fails when a catalog edit collapses the two seams.
 */
test('reachability: the DataTable bulk action is selected by a shipped case as its own seam, distinct from the row action', () => {
  const declaredEverywhere = declaringShippedCases().flatMap(declaredCapabilityIds)
  const bulk = 'umes.injection.datatable-bulk-action'
  const row = 'umes.injection.datatable-row-action'
  assert.ok(declaredEverywhere.includes(bulk), 'no shipped case selects the canonical DataTable bulk-action source')
  assert.ok(declaredEverywhere.includes(row), 'no shipped case selects the canonical DataTable row-action source')
  const bulkSources = capability(bulk).sourcePaths
  const rowSources = capability(row).sourcePaths
  assert.ok(bulkSources.length > 0 && rowSources.length > 0)
  assert.deepEqual(bulkSources.filter((source) => rowSources.includes(source)), [], 'the two seams must not share a source file')
})

test('reachability: every shipped declaring case reads its own capability set end to end and is refused another one', async () => {
  const evaluator = await loadEvaluator()
  const root = stageExampleApp()
  try {
    for (const entry of declaringShippedCases()) {
      const allowed = declaredCapabilityIds(entry)
      const reads: PolicyRead[] = [
        ...entrypointReads(),
        // A case that declares source references must read the owners rendering those links
        // before it may follow them, so the reachability sequence includes them — exactly the
        // order a real run produces. Owners are routed context and are not charged to the root.
        ...declaredReferenceOwners(entry).map((owner) => ({ path: owner })),
        ...allowed.flatMap((id) => capability(id).sourcePaths.map((source) => ({ path: source }))),
      ]
      const trace = evaluator.evaluateExampleReadPolicy({ caseRecord: entry, appRoot: root, reads })
      assert.equal(trace.firstViolation, null, `${entry.id} must be able to read its own declared capabilities`)
      assert.equal(trace.roots.length, 1, `${entry.id} must account exactly one root`)
      assert.deepEqual(trace.roots[0].entrypoints, ENTRYPOINTS, `${entry.id} must record both entrypoints`)
      // Only in-root reads are charged to the root budget; a routed owner is ordinary context
      // and is governed by the case's own context budgets instead.
      const inRoot = new Set(reads.map((read) => read.path).filter((read) => read.startsWith(`${EXAMPLE_ROOT}/`)))
      assert.equal(trace.roots[0].files, inRoot.size, `${entry.id} must charge every distinct in-root read`)
      assert.deepEqual(
        reads.map((read) => read.path).filter((read) => !read.startsWith(`${EXAMPLE_ROOT}/`)),
        declaredReferenceOwners(entry),
        `${entry.id}: the only out-of-root reads in this sequence are its declared reference owners`,
      )
      assert.ok(trace.roots[0].capabilities.length > 0, `${entry.id} must resolve at least one capability`)
      for (const resolved of trace.roots[0].capabilities) {
        assert.ok(allowed.includes(resolved), `${entry.id} resolved an undeclared capability ${resolved}`)
      }

      const outside = inventoryCapabilities().find((row) => row.readStatus === 'readable'
        && row.sourcePaths.some((source) => source.startsWith(`${EXAMPLE_ROOT}/`))
        && !row.sourcePaths.some((source) => reads.some((read) => read.path === source)))
      assert.ok(outside, `${entry.id} needs an inventory capability outside its own declaration`)
      const refused = evaluator.evaluateExampleReadPolicy({
        caseRecord: entry,
        appRoot: root,
        reads: [...entrypointReads(), { path: outside.sourcePaths.find((source) => source.startsWith(`${EXAMPLE_ROOT}/`))! }],
      })
      assert.match(refused.firstViolation ?? '', /maps to a capability the case did not declare/, `${entry.id} must refuse ${outside.capabilityId}`)
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

/**
 * A declaring case is only passable if its own ceilings clear the surface it declares: the
 * entrypoints, the inventory, and every mapped capability source, charged against the root budgets
 * AND against the routing budgets that the same reads feed. Example sources carry no `/references/`
 * segment, so they count as INITIAL context — a growing example silently squeezes them otherwise.
 */
test('reachability: every shipped declaring case can afford the entire surface it declares', async () => {
  const evaluator = await loadEvaluator()
  const root = stageExampleApp()
  try {
    for (const entry of declaringShippedCases() as unknown as HarnessBudgets[]) {
      const declaration = entry.context.exampleRoots[0]
      const files = evaluator.exampleReadAllowlist(entry, root)
      const bytes = files.reduce((total, relative) => total + fs.statSync(path.join(root, relative)).size, 0)
      assert.ok(files.length <= declaration.maxFiles, `${entry.id} declares ${files.length} files against maxFiles ${declaration.maxFiles}`)
      assert.ok(bytes <= declaration.maxBytes, `${entry.id} declares ${bytes} bytes against maxBytes ${declaration.maxBytes}`)

      const initial = files.filter((relative) => !relative.includes('/references/'))
      const instruction = [...entry.context.required, ...(entry.context.allowedExtra ?? [])]
      const initialFiles = initial.length + instruction.filter((relative) => !relative.includes('/references/')).length
      assert.ok(
        initialFiles <= entry.maxContextFiles,
        `${entry.id} needs ${initialFiles} initial context files against maxContextFiles ${entry.maxContextFiles}`,
      )
      const initialBytes = initial.reduce((total, relative) => total + fs.statSync(path.join(root, relative)).size, 0)
      assert.ok(
        initialBytes < entry.maxInitialContextBytes,
        `${entry.id} spends ${initialBytes} example bytes of its ${entry.maxInitialContextBytes} initial budget before any instruction`,
      )
      assert.ok(bytes < entry.maxTotalContextBytes, `${entry.id} spends ${bytes} example bytes of its ${entry.maxTotalContextBytes} total budget`)
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('compatibility: every shipped case that does not declare the fields keeps byte-identical semantics', async () => {
  const evaluator = await loadEvaluator()
  const root = stageExampleApp()
  try {
    const undeclaring = undeclaringShippedCases()
    assert.equal(undeclaring.length, shippedCases().length - DECLARING_CASE_IDS.length)
    for (const entry of undeclaring) {
      assert.equal(entry.context.installedVersionFallback, undefined, `${entry.id} must not declare installedVersionFallback`)
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
      ...undeclaringShippedCases().slice(0, 3),
    ]) {
      const trace = evaluator.evaluateExampleReadPolicy({ caseRecord: undeclared, appRoot: root, reads })
      assert.deepEqual(trace, {
        reads: [],
        roots: [],
        fallback: { reason: null, files: 0, bytes: 0 },
        // An undeclared case names no source references either, so the reference accounting is
        // present but empty — it never becomes a second way to reach a file.
        references: { declared: [], owners: [], followed: [] },
        firstViolation: null,
      })
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

// ---------------------------------------------------------------------------------------------
// Oracle family 9 — redaction. The trace is the evaluator's private working record; the result
// record carries only `exampleReadPolicySummary(trace)` passed through `recursivelySanitize`.
// These fixtures pin the two halves of that guarantee: the published contract admits no field
// that could carry content, and every value the summary is built from is drawn from the case
// declaration or the shipped inventory rather than from a path the agent chose.
// ---------------------------------------------------------------------------------------------

const REASON_CODES = ['SPECIALIST_ROUTE_NOT_DECLARED', 'INSTALLED_VERSION_CONTRACT_MISMATCH']
const REDACTION_SECRET = 'om-fixture-credential-must-not-appear'

type SummarySchema = {
  additionalProperties: boolean
  required: string[]
  properties: {
    roots: { items: { additionalProperties: boolean; required: string[] } }
    fallback: { additionalProperties: boolean; required: string[]; properties: { reason: { enum: Array<string | null> } } }
  }
}

function summarySchema(): SummarySchema {
  const schema = JSON.parse(fs.readFileSync(path.join(sourceHarness, 'result.schema.json'), 'utf8')) as {
    properties: { exampleReadPolicy: SummarySchema }
  }
  return schema.properties.exampleReadPolicy
}

function evaluatorSource(): string {
  return fs.readFileSync(sourceEvaluator, 'utf8')
}

test('family 9: the published result contract admits no summary field that could carry content', () => {
  const schema = summarySchema()
  assert.equal(schema.additionalProperties, false)
  assert.deepEqual([...schema.required].sort(), ['fallback', 'references', 'roots'])
  assert.equal(schema.properties.roots.items.additionalProperties, false)
  assert.deepEqual([...schema.properties.roots.items.required].sort(), ['bytes', 'capabilities', 'entrypoints', 'files', 'root'])
  assert.equal(schema.properties.fallback.additionalProperties, false)
  assert.deepEqual([...schema.properties.fallback.required].sort(), ['bytes', 'files', 'reason'])
  assert.deepEqual(schema.properties.fallback.properties.reason.enum, [...REASON_CODES, null])
  // The reference block publishes identifiers, paths and package identity — never file bodies.
  assert.equal(schema.properties.references.additionalProperties, false)
  assert.deepEqual([...schema.properties.references.required].sort(), ['declared', 'followed', 'owners'])
  assert.equal(schema.properties.references.properties.followed.items.additionalProperties, false)
  assert.deepEqual(
    [...schema.properties.references.properties.followed.items.required].sort(),
    ['hash', 'originAsset', 'package', 'referenceId', 'resolvedPath', 'targetKind', 'version'],
  )

  const lawful = {
    roots: [{ root: EXAMPLE_ROOT, entrypoints: [...ENTRYPOINTS], capabilities: ['api.crud-factory'], files: 3, bytes: 4096 }],
    fallback: { reason: null, files: 0, bytes: 0 },
    references: { declared: [], owners: [], followed: [] },
  }
  // `fallback.reason` is nullable, so the local mirror must share the evaluator's null-type rule.
  assert.ok(evaluatorSource().includes("if (expected === 'null') return value === null"))
  assert.deepEqual(jsonSchemaErrors(null, { type: ['string', 'null'] }), [])
  assert.deepEqual(jsonSchemaErrors(lawful, schema as unknown as Record<string, any>), [])
  assert.deepEqual(jsonSchemaErrors({ ...lawful, fallback: { reason: 'INSTALLED_VERSION_CONTRACT_MISMATCH', files: 1, bytes: 64 } }, schema as unknown as Record<string, any>), [])
  // The two trace fields that carry an agent-chosen string — the ordered reads and the first
  // violation — are inadmissible in the published record, as is any smuggled content field.
  for (const leak of [
    { ...lawful, reads: [{ path: '/etc/shadow' }] },
    { ...lawful, firstViolation: `example-root read targets a credential or secret file: ${EXAMPLE_ROOT}/.env.local` },
    { ...lawful, roots: [{ ...lawful.roots[0], content: 'export const marker' }] },
    { ...lawful, fallback: { ...lawful.fallback, reason: 'BECAUSE_I_SAID_SO' } },
    { ...lawful, fallback: { ...lawful.fallback, sanitizedError: REDACTION_SECRET } },
    { ...lawful, references: { ...lawful.references, snippet: REDACTION_SECRET } },
    {
      ...lawful,
      references: {
        ...lawful.references,
        followed: [{
          referenceId: 'guides/backend-ui:components/TodoForm.tsx',
          originAsset: '.ai/guides/backend-ui.md',
          resolvedPath: `${EXAMPLE_ROOT}/components/TodoForm.tsx`,
          targetKind: 'canonical-example',
          package: null,
          version: null,
          hash: null,
          content: 'export const marker',
        }],
      },
    },
  ]) assert.ok(jsonSchemaErrors(leak, schema as unknown as Record<string, any>).length > 0, JSON.stringify(leak))
})

test('family 9: the evaluator projects only the contract keys into the result and sanitizes them first', () => {
  const source = evaluatorSource()
  // The emission site calls the exported seam, and that seam is the ONLY composition of the
  // projection with the sanitizer — so the behavioural test above and this structural test
  // cover the same code path rather than two restatements of it.
  assert.ok(
    source.includes('exampleReadPolicy: sanitizedExampleReadPolicy(trace.exampleReadPolicy, runRoot)'),
    'the summary must reach the result record only through the sanitized seam',
  )
  assert.ok(
    source.includes('export function sanitizedExampleReadPolicy(trace, root) {\n  return recursivelySanitize(exampleReadPolicySummary(trace), root)\n}'),
    'the seam must be exactly recursivelySanitize composed over the projection',
  )
  const start = source.indexOf('function exampleReadPolicySummary(trace) {')
  assert.ok(start > 0, 'the summary projection must exist')
  const body = source.slice(start, source.indexOf('\n}\n', start))
  for (const key of ['roots', 'root', 'entrypoints', 'capabilities', 'files', 'bytes', 'fallback', 'reason']) {
    assert.match(body, new RegExp(`\\b${key}\\b`), key)
  }
  assert.doesNotMatch(body, /trace\.reads|firstViolation/, 'the projection must drop the agent-chosen fields entirely')
  assert.ok(
    source.includes("function recursivelySanitize(value, root) {\n  if (typeof value === 'string') return sanitize(value, root)"),
    'recursivelySanitize must apply sanitize to every string it reaches',
  )
})

test('family 9: only declaration-derived values reach the summary, so an adversarial read cannot smuggle a path, a home directory, or a credential into it', async () => {
  const evaluator = await loadEvaluator()
  const root = stageExampleApp()
  try {
    fs.writeFileSync(path.join(root, EXAMPLE_ROOT, '.env.local'), `OM_TOKEN=${REDACTION_SECRET}\n`)
    const caseRecord = declaredCase({})
    const declaration = (caseRecord.context.exampleRoots as Array<{ entrypoints: string[]; allowedCapabilityIds: string[] }>)[0]
    const tokenShapedCapability = `sk-${'A'.repeat(32)}`
    const adversarial: PolicyRead[] = [
      { path: '/etc/shadow' },
      { path: '~/.aws/credentials' },
      { path: 'C:\\Users\\pkarw\\.npmrc' },
      { path: `${EXAMPLE_ROOT}/.env.local` },
      { path: `${EXAMPLE_ROOT}/../../../etc/passwd` },
      { path: `${EXAMPLE_ROOT}/%2e%2e/secrets.json` },
      // This one is ACCEPTED by the policy: the version-mismatch branch never inspects the
      // supplied capability id, so an unbounded agent string does survive into `trace.reads`.
      // It must still be absent from everything the summary is built from.
      { path: INSTALLED_SOURCE, fallbackReason: 'INSTALLED_VERSION_CONTRACT_MISMATCH', capabilityId: tokenShapedCapability },
    ]
    for (const read of adversarial) {
      const trace = evaluator.evaluateExampleReadPolicy({ caseRecord, appRoot: root, reads: [...entrypointReads(), read] })
      for (const rootTrace of trace.roots) {
        assert.equal(rootTrace.root, EXAMPLE_ROOT, JSON.stringify(read))
        assert.ok(rootTrace.entrypoints.every((entry) => declaration.entrypoints.includes(entry)), JSON.stringify(read))
        assert.ok(rootTrace.capabilities.every((entry) => declaration.allowedCapabilityIds.includes(entry)), JSON.stringify(read))
        assert.ok(Number.isInteger(rootTrace.files) && Number.isInteger(rootTrace.bytes), JSON.stringify(read))
      }
      assert.ok(trace.fallback.reason === null || REASON_CODES.includes(trace.fallback.reason), JSON.stringify(read))
      const summaryInputs = JSON.stringify({ roots: trace.roots, fallback: trace.fallback })
      for (const forbidden of [os.homedir(), root, REDACTION_SECRET, tokenShapedCapability, '/etc', 'C:', '~/', '.env', 'passwd']) {
        assert.equal(summaryInputs.includes(forbidden), false, `${forbidden} leaked for ${JSON.stringify(read)}`)
      }
      assert.doesNotMatch(summaryInputs, /export const marker/, JSON.stringify(read))
    }

    const accepted = evaluator.evaluateExampleReadPolicy({
      caseRecord,
      appRoot: root,
      reads: [...entrypointReads(), adversarial.at(-1) as PolicyRead],
    })
    assert.equal(accepted.firstViolation, null)
    assert.equal(accepted.reads.at(-1)?.capabilityId, tokenShapedCapability, 'the working record does keep the agent string')

    // The live runner channel behaves identically: the reason and capability id it carries reach
    // the working record, never the summary inputs.
    const live = evaluator.observedContext(
      [
        ...ENTRYPOINTS.map((entrypoint) => readEvent(`${EXAMPLE_ROOT}/${entrypoint}`)),
        readEvent(INSTALLED_SOURCE, { reason: 'INSTALLED_VERSION_CONTRACT_MISMATCH', capabilityId: tokenShapedCapability }),
      ].join('\n'),
      root,
      caseRecord,
      false,
    )
    assert.equal(live.exampleReadPolicy.firstViolation, null)
    assert.equal(live.exampleReadPolicy.reads.at(-1)?.capabilityId, tokenShapedCapability)
    const liveSummaryInputs = JSON.stringify({ roots: live.exampleReadPolicy.roots, fallback: live.exampleReadPolicy.fallback })
    assert.equal(liveSummaryInputs.includes(tokenShapedCapability), false)
    assert.equal(liveSummaryInputs.includes(root), false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('family 9: the REAL production projection redacts an absolute path, a home directory, and a credential', async () => {
  // The other family-9 fixtures validate a hand-built literal against the schema and grep the
  // evaluator's source text. Neither runs the projection the result record actually uses, so a
  // leak introduced into it — or the emission site simply forgetting to sanitize — survives them.
  // `sanitizedExampleReadPolicy` IS the emission site's own call, exported as a seam, so this
  // exercises production code rather than a restatement of it.
  const evaluator = await loadEvaluator()
  const runRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-policy-redaction-')))
  try {
    const hostileTrace = {
      roots: [{
        root: `${runRoot}/src/modules/example`,
        entrypoints: [`${os.homedir()}/.ssh/id_rsa`],
        capabilities: ['api.crud-factory', 'authorization: Bearer sk-abcdefghijklmnopqrstuvwxyz012345'],
        files: 3,
        bytes: 4096,
      }],
      fallback: { reason: 'INSTALLED_VERSION_CONTRACT_MISMATCH', files: 1, bytes: 2048 },
    }

    const projected = evaluator.sanitizedExampleReadPolicy(hostileTrace, runRoot)
    const serialized = JSON.stringify(projected)

    assert.equal(serialized.includes(runRoot), false, 'the run root must not survive the projection')
    assert.equal(serialized.includes(os.homedir()), false, 'the home directory must not survive the projection')
    assert.match(serialized, /<redacted-path>/)
    assert.doesNotMatch(serialized, /sk-abcdefghijklmnopqrstuvwxyz012345/)

    // The projection must still be the real shape, not an empty object that trivially "leaks nothing".
    assert.equal(projected.fallback.reason, 'INSTALLED_VERSION_CONTRACT_MISMATCH')
    assert.equal(projected.fallback.files, 1)
    assert.equal(projected.roots.length, 1)
    assert.equal(projected.roots[0].files, 3)
  } finally {
    fs.rmSync(runRoot, { recursive: true, force: true })
  }
})

test('family 9: the sanitize path recursivelySanitize delegates to redacts the run root, its home directory, and a credential value', () => {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-example-policy-home-')))
  try {
    const scenarios: Array<{ content: string; expect: RegExp }> = [
      { content: 'not json at all', expect: /<redacted-path>/ },
      { content: `token=${REDACTION_SECRET}`, expect: /<redacted>/ },
    ]
    for (const [index, scenario] of scenarios.entries()) {
      const appRoot = path.join(home, `app-${index}`)
      fs.mkdirSync(path.join(appRoot, '.ai', 'harness'), { recursive: true })
      fs.writeFileSync(path.join(appRoot, '.ai', 'harness', 'cases.json'), scenario.content)
      const result = spawnSync(process.execPath, [sourceEvaluator, '--root', appRoot], {
        encoding: 'utf8',
        env: { ...process.env, HOME: home },
      })
      assert.notEqual(result.status, 0, scenario.content)
      assert.match(result.stderr, scenario.expect, scenario.content)
      assert.equal(result.stderr.includes(appRoot), false, 'the absolute run root must never reach the output')
      assert.equal(result.stderr.includes(home), false, 'the home directory must never reach the output')
      assert.equal(result.stderr.includes(REDACTION_SECRET), false, 'a credential value must never reach the output')
    }
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------------------------
// Oracle family 10 — an installed source reached through the reason-gated fallback is read-only.
// Family 6 proves the canonical example half of the spec's immutability oracle; this proves the
// installed-package half, and pins WHERE the guarantee actually lives so a later change cannot
// remove it silently.
// ---------------------------------------------------------------------------------------------

const INSTALLED_SOURCE_CONTENT = 'export async function GET() { return new Response() }\n'

function spawnToolServer(
  root: string,
  allowedReads: string[],
  allowedWrites: string[],
  calls: Array<{ name: string; arguments: Record<string, unknown> }>,
) {
  const messages = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
    ...calls.map((entry, index) => ({ jsonrpc: '2.0', id: index + 2, method: 'tools/call', params: entry })),
  ]
  return spawnSync(process.execPath, [sourceToolServer, root, 'writable', JSON.stringify(allowedReads), JSON.stringify(allowedWrites)], {
    input: `${messages.map((entry) => JSON.stringify(entry)).join('\n')}\n`,
    encoding: 'utf8',
    env: { OM_HARNESS_IMMUTABLE_ROOTS: '[]' },
  })
}

/**
 * Reproduce the writable-target layout `verifyWritableTarget` mandates: a disposable app root
 * whose `node_modules` is a link into the controller's own protected dependency tree. The
 * unlinked variant exists only to show that the mandate is load-bearing.
 */
function stageInstalledSourceTarget(symlinkDependencies: boolean): { controller: string; target: string } {
  const controller = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-installed-controller-')))
  fs.mkdirSync(path.join(controller, path.dirname(INSTALLED_SOURCE)), { recursive: true })
  fs.writeFileSync(path.join(controller, INSTALLED_SOURCE), INSTALLED_SOURCE_CONTENT)
  const target = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-installed-target-')))
  if (symlinkDependencies) fs.symlinkSync(path.join(controller, 'node_modules'), path.join(target, 'node_modules'), linkType)
  else fs.cpSync(path.join(controller, 'node_modules'), path.join(target, 'node_modules'), { recursive: true })
  fs.writeFileSync(path.join(target, 'package.json'), '{"name":"om-installed-fixture","private":true}\n')
  return { controller, target }
}

test('family 10: an installed source read through the fallback cannot be written, even under a wildcard write grant', () => {
  const { controller, target } = stageInstalledSourceTarget(true)
  const injected = 'node_modules/@open-mercato/core/src/modules/customers/api/injected.ts'
  try {
    const replies = callToolServer(target, 'writable', [INSTALLED_SOURCE], ['**'], [EXAMPLE_ROOT], [
      { name: 'read', arguments: { path: INSTALLED_SOURCE, reason: 'INSTALLED_VERSION_CONTRACT_MISMATCH' } },
      { name: 'write', arguments: { path: INSTALLED_SOURCE, content: 'tampered\n' } },
      { name: 'write', arguments: { path: injected, content: 'export const injected = 1\n' } },
    ])
    assert.equal(replies[1].result.isError, undefined, 'the reason-gated fallback read still succeeds')
    assert.equal(replies[1].result.content[0].text, INSTALLED_SOURCE_CONTENT)
    for (const reply of replies.slice(2)) {
      assert.equal(reply.result.isError, true)
      assert.match(reply.result.content[0].text, /write ancestor must be a regular directory/)
    }
    assert.equal(fs.readFileSync(path.join(target, INSTALLED_SOURCE), 'utf8'), INSTALLED_SOURCE_CONTENT)
    assert.equal(fs.readFileSync(path.join(controller, INSTALLED_SOURCE), 'utf8'), INSTALLED_SOURCE_CONTENT)
    assert.equal(fs.existsSync(path.join(controller, injected)), false, 'nothing new may appear in the dependency tree')
  } finally {
    fs.rmSync(controller, { recursive: true, force: true })
    fs.rmSync(target, { recursive: true, force: true })
  }
})

test('family 10: a glob write grant that could reach an installed source is refused before the tool server starts', () => {
  const { controller, target } = stageInstalledSourceTarget(true)
  try {
    for (const grant of ['node_modules/**', 'node_modules/@open-mercato/**', 'node_modules/@open-mercato/core/src/**']) {
      const result = spawnToolServer(target, [INSTALLED_SOURCE], [grant], [
        { name: 'write', arguments: { path: INSTALLED_SOURCE, content: 'tampered\n' } },
      ])
      assert.equal(result.status, 2, grant)
      assert.match(result.stderr, /allowed write set is invalid/, grant)
    }
    assert.equal(fs.readFileSync(path.join(controller, INSTALLED_SOURCE), 'utf8'), INSTALLED_SOURCE_CONTENT)
  } finally {
    fs.rmSync(controller, { recursive: true, force: true })
    fs.rmSync(target, { recursive: true, force: true })
  }
})

test('family 10: installed-source immutability rests on the enforced dependency link and the protected-tree fingerprint, not on the write allowlist', () => {
  const source = evaluatorSource()
  assert.ok(
    source.includes("errors.push('writable root node_modules must link to the controller protected dependency tree')"),
    'the writable target must be rejected when its dependency root is not the controller link',
  )
  assert.ok(source.includes('fs.realpathSync(targetDependencies) !== fs.realpathSync(controllerDependencies)'))
  const verifyIndex = source.indexOf('const targetErrors = verifyWritableTarget(runRoot, root, caseRecord, fixtures)')
  const snapshotIndex = source.indexOf('const before = writable ? snapshot(runRoot) : undefined')
  assert.ok(verifyIndex > 0 && snapshotIndex > 0, 'both live-run steps must exist')
  assert.ok(verifyIndex < snapshotIndex, 'the layout is verified before the run is snapshotted')
  assert.ok(source.includes("for (const relative of ['.git', 'node_modules', '.next', 'dist', '.ai/harness/results']) {"))
  assert.ok(source.includes('result.set(relative, protectedTreeFingerprint(path.join(root, relative)))'))
  assert.ok(source.includes("if (protectedChanges.length) violations.push(`writes to protected roots: ${protectedChanges.join(', ')}`)"))

  // Characterization of why those two guards are load-bearing rather than decorative: replace the
  // mandated dependency link with a plain directory and the same wildcard grant does reach the
  // installed source, because the write allowlist alone never protects `node_modules`.
  const { controller, target } = stageInstalledSourceTarget(false)
  try {
    const replies = callToolServer(target, 'writable', [INSTALLED_SOURCE], ['**'], [], [
      { name: 'write', arguments: { path: INSTALLED_SOURCE, content: 'tampered\n' } },
    ])
    assert.equal(replies[1].result.isError, undefined)
    assert.equal(fs.readFileSync(path.join(target, INSTALLED_SOURCE), 'utf8'), 'tampered\n')
    assert.equal(fs.readFileSync(path.join(controller, INSTALLED_SOURCE), 'utf8'), INSTALLED_SOURCE_CONTENT)
  } finally {
    fs.rmSync(controller, { recursive: true, force: true })
    fs.rmSync(target, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------------------------
// Oracle family 11 — source selection for the capabilities the canonical example gained last:
// the durable bulk-complete/operation-progress flow and the AI tool-pack/agent surfaces.
//
// `NEWEST_CAPABILITY_SOURCES` is typed from the shipped example tree, INDEPENDENTLY of both
// `surface-inventory.json` and the case declarations, so it is not derived from either thing it
// constrains. A renamed, moved, dropped, or silently added source therefore fails here rather
// than travelling into a harness case as a plausible-looking path.
// ---------------------------------------------------------------------------------------------

const canonicalExampleRoot = fileURLToPath(new URL('../../../../apps/mercato/src/modules/example/', import.meta.url))

const NEWEST_CAPABILITY_SOURCES: Record<string, string[]> = {
  'runtime.bulk-operation-progress': [
    `${EXAMPLE_ROOT}/widgets/injection/todo-bulk-complete/widget.ts`,
    `${EXAMPLE_ROOT}/api/todos/bulk-complete/route.ts`,
    `${EXAMPLE_ROOT}/lib/todoBulkComplete.ts`,
    `${EXAMPLE_ROOT}/workers/todos-bulk-complete.ts`,
    `${EXAMPLE_ROOT}/workers/todos-bulk-dispatch.ts`,
  ],
  'ai.tool-pack': [`${EXAMPLE_ROOT}/ai-tools.ts`],
  'ai.agent': [`${EXAMPLE_ROOT}/ai-agents.ts`],
  'ai.agent-extension': [`${EXAMPLE_ROOT}/ai-agents.ts`],
}

/**
 * A read resolves to ONE capability, so two inventory rows declared in the same file contribute a
 * single resolved id. `ai.agent` and `ai.agent-extension` both map `ai-agents.ts`, which is exactly
 * the fact OMH-226's prompt asks the model to report instead of inventing a second path — pinned
 * here so a future split into two files, or a merge of two rows, has to be a deliberate edit.
 */
const RESOLVED_CAPABILITIES: Record<string, string[]> = {
  'OMH-225': ['runtime.bulk-operation-progress'],
  'OMH-226': ['ai.agent', 'ai.tool-pack'],
}

const NEWEST_CAPABILITY_SELECTOR: Record<string, string> = {
  'runtime.bulk-operation-progress': 'OMH-225',
  'ai.tool-pack': 'OMH-226',
  'ai.agent': 'OMH-226',
  'ai.agent-extension': 'OMH-226',
}

function shippedCase(id: string) {
  const found = shippedCases().find((entry) => entry.id === id)
  assert.ok(found, `the shipped catalog must still carry ${id}`)
  return found
}

test('family 11: the inventory maps each newest capability to exactly its shipped files, and every one of them exists', () => {
  for (const [capabilityId, expected] of Object.entries(NEWEST_CAPABILITY_SOURCES)) {
    const entry = capability(capabilityId)
    assert.deepEqual(entry.sourcePaths, expected, `${capabilityId} maps different sources than the shipped example tree`)
    assert.equal(entry.readStatus, 'readable', `${capabilityId} must be readable to be selectable by a case`)
    for (const source of expected) {
      const relative = source.slice(`${EXAMPLE_ROOT}/`.length)
      assert.ok(fs.statSync(path.join(canonicalExampleRoot, relative)).isFile(), `${capabilityId} names a file that does not ship: ${source}`)
    }
  }
  // The two E7 seams are separate rows over separate files, which is what makes them separately
  // selectable at all — a single merged row would silently couple them.
  assert.deepEqual(
    capability('runtime.bulk-operation-progress').sourcePaths
      .filter((source) => capability('umes.injection.datatable-bulk-action').sourcePaths.includes(source)),
    [],
  )
  // The E6 agent rows deliberately DO share one file; the case prompt asks for that to be reported
  // rather than papered over with an invented second path.
  assert.deepEqual(capability('ai.agent').sourcePaths, capability('ai.agent-extension').sourcePaths)
})

test('family 11: each newest capability resolves to exactly its shipped sources for the case that declares it', async () => {
  const evaluator = await loadEvaluator()
  const root = stageExampleApp()
  try {
    for (const [caseId, capabilityIds] of Object.entries(
      Object.entries(NEWEST_CAPABILITY_SELECTOR).reduce<Record<string, string[]>>((grouped, [capabilityId, owner]) => {
        grouped[owner] = [...(grouped[owner] ?? []), capabilityId]
        return grouped
      }, {}),
    )) {
      const entry = shippedCase(caseId)
      assert.deepEqual(
        declaredCapabilityIds(entry).slice().sort(),
        capabilityIds.slice().sort(),
        `${caseId} must select exactly the newest capabilities it owns`,
      )
      const expectedSources = [...new Set(capabilityIds.flatMap((capabilityId) => NEWEST_CAPABILITY_SOURCES[capabilityId]))]
      assert.deepEqual(
        [...new Set(evaluator.exampleReadAllowlist(entry, root))].sort(),
        [
          `${EXAMPLE_ROOT}/references/surface-inventory.json`,
          ...ENTRYPOINTS.map((entrypoint) => `${EXAMPLE_ROOT}/${entrypoint}`),
          ...expectedSources,
        ].sort(),
        `${caseId} must resolve to exactly the shipped sources of its declared capabilities`,
      )
      const trace = evaluator.evaluateExampleReadPolicy({
        caseRecord: entry,
        appRoot: root,
        reads: [...entrypointReads(), ...expectedSources.map((source) => ({ path: source }))],
      })
      assert.equal(trace.firstViolation, null, `${caseId} must be able to read every source it selects`)
      assert.deepEqual(trace.reads.map((read) => read.path), [
        `${EXAMPLE_ROOT}/README.md`,
        `${EXAMPLE_ROOT}/references/surface-map.md`,
        ...expectedSources,
      ])
      assert.equal(trace.roots[0].files, 2 + expectedSources.length)
      assert.deepEqual(trace.roots[0].capabilities.slice().sort(), RESOLVED_CAPABILITIES[caseId])
      for (const resolved of trace.roots[0].capabilities) {
        assert.ok(capabilityIds.includes(resolved), `${caseId} resolved an undeclared capability ${resolved}`)
      }
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('family 11: an undeclared, cross-case, sibling, directory, or stale newest source is refused', async () => {
  const evaluator = await loadEvaluator()
  const root = stageExampleApp()
  try {
    const refusals: Array<[string, string, RegExp]> = [
      // The AI case cannot reach the progress sources and the progress case cannot reach the AI
      // sources, even though both declare the same root.
      ['OMH-226', `${EXAMPLE_ROOT}/workers/todos-bulk-dispatch.ts`, /maps to a capability the case did not declare/],
      ['OMH-225', `${EXAMPLE_ROOT}/ai-tools.ts`, /maps to a capability the case did not declare/],
      // A neighbouring seam that lives one directory away from a declared source.
      ['OMH-225', `${EXAMPLE_ROOT}/widgets/injection/customer-priority-bulk-actions/widget.ts`, /maps to a capability the case did not declare/],
      // The progress route's own directory, and the whole worker directory.
      ['OMH-225', `${EXAMPLE_ROOT}/workers`, /must name one exact file/],
      ['OMH-226', `${EXAMPLE_ROOT}/ai-agents.*`, /must name one exact file|not mapped by the surface inventory|does not exist/],
      // A stale spelling of a real declared source.
      ['OMH-225', `${EXAMPLE_ROOT}/workers/todos-bulk-complete-v2.ts`, /does not exist|not mapped by the surface inventory/],
      ['OMH-226', `${EXAMPLE_ROOT}/ai-agent.ts`, /does not exist|not mapped by the surface inventory/],
    ]
    for (const [caseId, target, expected] of refusals) {
      const trace = evaluator.evaluateExampleReadPolicy({
        caseRecord: shippedCase(caseId),
        appRoot: root,
        reads: [...entrypointReads(), { path: target }],
      })
      assert.match(trace.firstViolation ?? '', expected, `${caseId} must refuse ${target}`)
      assert.ok(trace.reads.every((read) => read.path !== target), `${caseId} must not record ${target} as loaded context`)
    }

    // Same refusal at the tool server, so the allowlist and the evaluator agree.
    const progress = shippedCase('OMH-225')
    const replies = callToolServer(root, 'read-only', evaluator.exampleReadAllowlist(progress, root), [], [], [
      { name: 'read', arguments: { path: `${EXAMPLE_ROOT}/ai-tools.ts` } },
      { name: 'read', arguments: { path: NEWEST_CAPABILITY_SOURCES['runtime.bulk-operation-progress'][2] } },
    ])
    assert.equal(replies[1].result.isError, true)
    assert.match(replies[1].result.content[0].text, /outside the case read allowlist/)
    assert.equal(replies[2].result.isError, undefined)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('family 11: a newest capability demoted to qa-only stops being selectable by its own case', async () => {
  const evaluator = await loadEvaluator()
  const { root, qaOnly } = stageExampleAppWithQaOnlyCapability('runtime.bulk-operation-progress')
  try {
    const progress = shippedCase('OMH-225')
    assert.ok(
      evaluator.validateExampleReadPolicyDeclaration(progress, root).some((message) => /qa-only and cannot be read/.test(message)),
      'a qa-only demotion must invalidate the declaration that selects it',
    )
    const trace = evaluator.evaluateExampleReadPolicy({
      caseRecord: progress,
      appRoot: root,
      reads: [...entrypointReads(), { path: qaOnly.sourcePaths[0] }],
    })
    assert.match(trace.firstViolation ?? '', /resolves to a qa-only capability/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('family 11: the operation-progress and DataTable bulk-action sources are selected by different cases and share no file', () => {
  const selectors = new Map<string, string[]>()
  for (const entry of declaringShippedCases().filter((candidate) => candidate.evaluationKind === 'routing')) {
    for (const capabilityId of declaredCapabilityIds(entry)) {
      selectors.set(capabilityId, [...(selectors.get(capabilityId) ?? []), entry.id])
    }
  }
  const progress = selectors.get('runtime.bulk-operation-progress') ?? []
  const bulkAction = selectors.get('umes.injection.datatable-bulk-action') ?? []
  assert.deepEqual(progress, ['OMH-225'], 'exactly one case must select the operation-progress source')
  assert.deepEqual(bulkAction, ['OMH-220'], 'exactly one case must select the DataTable bulk-action source')
  // The independent read-only assertions stay distinct. The writable connection lane is tested
  // separately below and deliberately declares both seams so it can prove their lifecycle.
  const combined = [...progress].filter((caseId) => bulkAction.includes(caseId))
  assert.deepEqual(combined, [], 'no single case may declare both the progress and bulk-action seams')
  assert.deepEqual(
    capability('runtime.bulk-operation-progress').sourcePaths.filter((source) => capability('umes.injection.datatable-bulk-action').sourcePaths.includes(source)),
    [],
  )
})

test('family 11: the writable bulk-review oracle connects the selected progressJobId lifecycle', () => {
  const writable = shippedCases().find((entry) => entry.id === 'OMH-181')
  assert.ok(writable)
  assert.deepEqual(
    declaredCapabilityIds(writable).slice().sort(),
    ['runtime.bulk-operation-progress', 'umes.injection.datatable-bulk-action'],
  )
  assert.match(writable.prompt, /connected progressJobId lifecycle/)
  assert.ok(writable.requiredDecisions.includes('connected-progress-job-lifecycle'))
  const behaviorOracle = fs.readFileSync(path.join(sourceHarness, 'writable-behavior-oracles.mjs'), 'utf8')
  assert.match(behaviorOracle, /observeProgress\(progressJobId\)/)
  assert.match(behaviorOracle, /connects-shared-progress-job-lifecycle/)
})

// ---------------------------------------------------------------------------------------------
// Oracle family 12 (fixture label) — declared source references. A case names IDs from the
// emitted source-link projection; each ID is one visible link in one routed owner resolving to
// one exact readable file, and following it requires having read that owner first.
// ---------------------------------------------------------------------------------------------

test('family 12: a declared reference is followed only after its origin owner is read, and the trace records it', async () => {
  const evaluator = await loadEvaluator()
  const { root, reference } = stageExampleAppWithReferences()
  try {
    const caseRecord = referencingCase()
    assert.deepEqual(evaluator.validateExampleReadPolicyDeclaration(caseRecord, root), [])
    assert.equal(reference.resolvedPath, REFERENCE_TARGET)
    assert.equal(reference.originAsset, REFERENCE_OWNER)

    // Owner first, then the target: allowed, and the trace names what was followed and from where.
    const followed = evaluator.evaluateExampleReadPolicy({
      caseRecord,
      appRoot: root,
      reads: [...entrypointReads(), { path: REFERENCE_OWNER }, { path: REFERENCE_TARGET }],
    })
    assert.equal(followed.firstViolation, null)
    assert.deepEqual(followed.references.declared, [REFERENCE_ID])
    assert.deepEqual(followed.references.owners, [REFERENCE_OWNER])
    assert.deepEqual(followed.references.followed.map((entry) => entry.referenceId), [REFERENCE_ID])
    assert.equal(followed.references.followed[0].originAsset, REFERENCE_OWNER)
    assert.equal(followed.references.followed[0].resolvedPath, REFERENCE_TARGET)
    assert.equal(followed.references.followed[0].targetKind, 'canonical-example')

    // The same target without the owner read is refused — the link is what grants the follow.
    const unearned = evaluator.evaluateExampleReadPolicy({
      caseRecord,
      appRoot: root,
      reads: [...entrypointReads(), { path: REFERENCE_TARGET }],
    })
    assert.match(unearned.firstViolation ?? '', /followed before its origin owner was read/)
    assert.deepEqual(unearned.references.followed, [])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('family 12: an orphan, prose, qa-only, wildcard, directory, or dead declared link all fail', async () => {
  const evaluator = await loadEvaluator()

  // Each entry stages ONE defect in the shipped projection and names the message it must produce,
  // so a fixture cannot pass by matching a violation raised for an unrelated reason.
  const defects: Array<{ label: string; expected: RegExp; mutate?: (records: InventoryRecord[]) => void; ids?: string[]; removeTarget?: boolean }> = [
    {
      label: 'orphan id',
      ids: ['guides/backend-ui:components/NoSuchForm.tsx'],
      expected: /source reference is unknown or orphaned/,
    },
    {
      label: 'prose topic with no target file',
      mutate: (records) => { recordIn(records, REFERENCE_ID).requirement = 'retained-normative-snippet' },
      expected: /names a prose topic with no target file/,
    },
    {
      label: 'qa-only target',
      mutate: (records) => { recordIn(records, REFERENCE_ID).readStatus = 'qa-only' },
      expected: /target is qa-only and cannot be read/,
    },
    {
      label: 'wildcard target',
      mutate: (records) => { recordIn(records, REFERENCE_ID).resolvedPath = `${EXAMPLE_ROOT}/components/*.tsx` },
      expected: /target is a wildcard, not one exact file/,
    },
    {
      label: 'directory target',
      mutate: (records) => { recordIn(records, REFERENCE_ID).resolvedPath = `${EXAMPLE_ROOT}/components` },
      expected: /must name one exact file, not a directory/,
    },
    {
      label: 'traversal target',
      mutate: (records) => { recordIn(records, REFERENCE_ID).resolvedPath = `${EXAMPLE_ROOT}/../../../etc/passwd` },
      expected: /target is unsafe/,
    },
    {
      label: 'dead target',
      removeTarget: true,
      expected: /target is dead or unreadable/,
    },
  ]

  for (const defect of defects) {
    const { root } = stageExampleAppWithReferences(defect.mutate)
    try {
      if (defect.removeTarget) fs.rmSync(path.join(root, REFERENCE_TARGET))
      const caseRecord = referencingCase(defect.ids ? { sourceReferenceIds: defect.ids } : {})
      const errors = evaluator.validateExampleReadPolicyDeclaration(caseRecord, root)
      assert.ok(
        errors.some((message) => defect.expected.test(message)),
        `${defect.label}: expected ${defect.expected}, got ${JSON.stringify(errors)}`,
      )
      // The same defect is refused at read time too, so a case cannot skip validation and follow it.
      const trace = evaluator.evaluateExampleReadPolicy({
        caseRecord,
        appRoot: root,
        reads: [...entrypointReads(), { path: REFERENCE_OWNER }, { path: REFERENCE_TARGET }],
      })
      assert.deepEqual(trace.references.followed, [], `${defect.label}: a broken reference must never be followed`)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  }
})

test('family 12: a reference whose origin owner is not routed to the case is refused', async () => {
  const evaluator = await loadEvaluator()
  const { root } = stageExampleAppWithReferences()
  try {
    // Same reference, same target, but the case never routes the owner that renders the link.
    const unrouted: CaseRecord = {
      context: {
        required: ['AGENTS.md'],
        forbidden: ['.env'],
        sourceReferenceIds: [REFERENCE_ID],
        exampleRoots: [{
          root: EXAMPLE_ROOT,
          entrypoints: ENTRYPOINTS,
          allowedCapabilityIds: ['ui.form-create', 'ui.form-edit'],
          maxFiles: 12,
          maxBytes: 131_072,
        }],
      },
    }
    assert.ok(
      evaluator.validateExampleReadPolicyDeclaration(unrouted, root)
        .some((message) => /origin owner is not routed to this case/.test(message)),
    )
    // Routing the owner through allowedExtra is enough — the rule is visibility, not required-ness.
    assert.deepEqual(
      evaluator.validateExampleReadPolicyDeclaration(
        referencingCase({ allowedExtra: [REFERENCE_OWNER] }),
        root,
      ),
      [],
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('family 12: a declared reference widens the read allowlist by exactly one exact file', async () => {
  const evaluator = await loadEvaluator()
  const { root } = stageExampleAppWithReferences()
  try {
    // `referenceOnlyCase` declares capabilities that do not map the referenced file, so the
    // reference is the only thing that can put it on the allowlist.
    const caseRecord = referenceOnlyCase()
    const capabilityOnly = evaluator.exampleReadAllowlist(
      { context: { ...(caseRecord.context as Record<string, unknown>), sourceReferenceIds: undefined } },
      root,
    )
    assert.ok(!capabilityOnly.includes(REFERENCE_TARGET), 'the fixture is vacuous if a capability already grants the target')

    const allowlist = evaluator.exampleReadAllowlist(caseRecord, root)
    assert.ok(allowlist.includes(REFERENCE_TARGET))
    assert.equal(allowlist.filter((entry) => entry === REFERENCE_TARGET).length, 1)
    assert.ok(!allowlist.some((entry) => entry.includes('*')))
    // A sibling of the referenced file is NOT granted by the reference.
    assert.ok(!allowlist.includes(`${EXAMPLE_ROOT}/components/TodosTable.tsx`))

    // A broken reference NARROWS the allowlist rather than silently widening it.
    const { root: brokenRoot } = stageExampleAppWithReferences((records) => {
      recordIn(records, REFERENCE_ID).readStatus = 'qa-only'
    })
    try {
      assert.ok(!evaluator.exampleReadAllowlist(referenceOnlyCase(), brokenRoot).includes(REFERENCE_TARGET))
    } finally {
      fs.rmSync(brokenRoot, { recursive: true, force: true })
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('family 12: a missing or malformed projection fails closed instead of granting the reference', async () => {
  const evaluator = await loadEvaluator()
  for (const [label, stage] of [
    ['missing', (root: string) => fs.rmSync(path.join(root, '.ai/harness/source-link-inventory.json'))],
    ['not JSON', (root: string) => fs.writeFileSync(path.join(root, '.ai/harness/source-link-inventory.json'), 'not json')],
    ['no records', (root: string) => fs.writeFileSync(path.join(root, '.ai/harness/source-link-inventory.json'), '{"records":[]}')],
  ] as Array<[string, (root: string) => void]>) {
    const { root } = stageExampleAppWithReferences()
    try {
      stage(root)
      const caseRecord = referenceOnlyCase()
      assert.ok(
        evaluator.validateExampleReadPolicyDeclaration(caseRecord, root)
          .some((message) => /source-link inventory (is|declares)/.test(message)),
        `${label}: an unusable projection must be reported`,
      )
      const trace = evaluator.evaluateExampleReadPolicy({
        caseRecord,
        appRoot: root,
        reads: [...entrypointReads(), { path: REFERENCE_OWNER }, { path: REFERENCE_TARGET }],
      })
      assert.match(trace.firstViolation ?? '', /source-link inventory (is|declares)/, label)
      assert.deepEqual(trace.references.followed, [], label)
      assert.ok(!evaluator.exampleReadAllowlist(caseRecord, root).includes(REFERENCE_TARGET), label)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  }
})

/** The emitted owners that render the links a shipped case declares. */
function declaredReferenceOwners(entry: { context: Record<string, unknown> }): string[] {
  const declared = (entry.context.sourceReferenceIds ?? []) as string[]
  if (!declared.length) return []
  const records = projectedInventory().records
  return [...new Set(declared.map((referenceId) => recordIn(records, referenceId).originAsset))]
}

// ---------------------------------------------------------------------------------------------
// Spec family 4 — a routed owner renders a visible link into an installed package, the case
// follows that exact packed file directly, and the trace records reference ID, package, version
// and content hash. This is NOT the reason-gated fallback of family 5: no reason code is
// involved, because the link was declared.
// ---------------------------------------------------------------------------------------------

const INSTALLED_REFERENCE_ID = 'guides/backend-ui:node_modules/@open-mercato/ui/src/backend/DataTable.tsx'
const INSTALLED_TARGET = 'node_modules/@open-mercato/ui/src/backend/DataTable.tsx'
const INSTALLED_PACKAGE_VERSION = '9.9.9-fixture'

/** Stage the packed UI file the installed reference names, with a resolvable package identity. */
function stageInstalledReferenceTarget(root: string, body: string): string {
  const packageDir = path.join(root, 'node_modules', '@open-mercato', 'ui')
  fs.mkdirSync(path.join(packageDir, 'src', 'backend'), { recursive: true })
  fs.writeFileSync(
    path.join(packageDir, 'package.json'),
    `${JSON.stringify({ name: '@open-mercato/ui', version: INSTALLED_PACKAGE_VERSION }, null, 2)}\n`,
  )
  const absolute = path.join(packageDir, 'src', 'backend', 'DataTable.tsx')
  fs.writeFileSync(absolute, body)
  return absolute
}

function installedReferenceCase(): CaseRecord {
  return {
    context: {
      required: ['AGENTS.md', REFERENCE_OWNER],
      forbidden: ['.env'],
      sourceReferenceIds: [INSTALLED_REFERENCE_ID],
      exampleRoots: [{
        root: EXAMPLE_ROOT,
        entrypoints: ENTRYPOINTS,
        allowedCapabilityIds: ['ui.datatable'],
        maxFiles: 12,
        maxBytes: 131_072,
      }],
    },
  }
}

test('family 12: the shipped inventory carries an installed-package reference the UI package really packs', () => {
  const record = recordIn(projectedInventory().records, INSTALLED_REFERENCE_ID)
  assert.equal(record.targetKind, 'installed-package')
  assert.equal(record.readStatus, 'readable')
  assert.equal(record.resolvedPath, INSTALLED_TARGET)
  assert.equal((record as unknown as { packageName: string }).packageName, '@open-mercato/ui')
  assert.equal((record as unknown as { packageRelativePath: string }).packageRelativePath, 'src/backend/DataTable.tsx')

  // The record is only honest if the workspace package genuinely publishes that exact path. The
  // canonical spec deferred this whole family claiming no gate could verify a packed artifact;
  // `npm pack --dry-run --json` is that gate, and it is what the link validator runs.
  const packed = JSON.parse(spawnSync(
    'npm',
    ['pack', '--dry-run', '--json', '--ignore-scripts'],
    { cwd: fileURLToPath(new URL('../../../ui/', import.meta.url)), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  ).stdout) as Array<{ files: Array<{ path: string }> }>
  assert.ok(
    packed[0].files.some((entry) => entry.path === 'src/backend/DataTable.tsx'),
    '@open-mercato/ui must actually pack the file the inventory links',
  )
})

test('family 12: a declared installed reference is followed directly, with no reason code, and the trace records package, version and hash', async () => {
  const evaluator = await loadEvaluator()
  const root = stageExampleApp()
  try {
    const body = 'export function DataTable() { return null }\n'
    stageInstalledReferenceTarget(root, body)
    const caseRecord = installedReferenceCase()
    assert.deepEqual(evaluator.validateExampleReadPolicyDeclaration(caseRecord, root), [])

    const trace = evaluator.evaluateExampleReadPolicy({
      caseRecord,
      appRoot: root,
      reads: [...entrypointReads(), { path: REFERENCE_OWNER }, { path: INSTALLED_TARGET }],
    })
    assert.equal(trace.firstViolation, null)
    // Decisively NOT the fallback lane: no reason code was declared or consumed.
    assert.equal(trace.fallback.reason, null)
    assert.equal(trace.fallback.files, 0)
    assert.equal((caseRecord.context as Record<string, unknown>).installedVersionFallback, undefined)

    assert.deepEqual(trace.references.followed.map((entry) => entry.referenceId), [INSTALLED_REFERENCE_ID])
    const followed = trace.references.followed[0]
    assert.equal(followed.targetKind, 'installed-package')
    assert.equal(followed.package, '@open-mercato/ui')
    assert.equal(followed.version, INSTALLED_PACKAGE_VERSION)
    assert.equal(followed.hash, createHash('sha256').update(body).digest('hex'))
    // The read is charged to the declaring root's normal budget, not to a separate allowance.
    assert.equal(trace.roots[0].files, 3)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('family 12: an installed reference grants no sibling, no directory, and nothing before the owner', async () => {
  const evaluator = await loadEvaluator()
  const root = stageExampleApp()
  try {
    stageInstalledReferenceTarget(root, 'export function DataTable() { return null }\n')
    const sibling = 'node_modules/@open-mercato/ui/src/backend/Sibling.tsx'
    fs.writeFileSync(path.join(root, sibling), 'export const sibling = true\n')
    const caseRecord = installedReferenceCase()

    const allowlist = evaluator.exampleReadAllowlist(caseRecord, root)
    assert.ok(allowlist.includes(INSTALLED_TARGET))
    assert.ok(!allowlist.includes(sibling))
    assert.ok(!allowlist.includes('node_modules/@open-mercato/ui/src/backend'))

    // A sibling in the same packed directory is refused: the case declares no fallback, and the
    // reference grants exactly one file.
    const siblingTrace = evaluator.evaluateExampleReadPolicy({
      caseRecord,
      appRoot: root,
      reads: [...entrypointReads(), { path: REFERENCE_OWNER }, { path: sibling }],
    })
    assert.match(siblingTrace.firstViolation ?? '', /installed-source fallback is not enabled/)

    // And the declared target itself is still refused before its owner is read.
    const earlyTrace = evaluator.evaluateExampleReadPolicy({
      caseRecord,
      appRoot: root,
      reads: [...entrypointReads(), { path: INSTALLED_TARGET }],
    })
    assert.match(earlyTrace.firstViolation ?? '', /followed before its origin owner was read/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('family 12: an installed reference whose packed target is missing from the app fails closed', async () => {
  const evaluator = await loadEvaluator()
  const root = stageExampleApp()
  try {
    // The app never installed the package, so the declared link is dead in THIS app.
    const caseRecord = installedReferenceCase()
    assert.ok(
      evaluator.validateExampleReadPolicyDeclaration(caseRecord, root)
        .some((message) => /target is dead or unreadable/.test(message)),
    )
    assert.ok(!evaluator.exampleReadAllowlist(caseRecord, root).includes(INSTALLED_TARGET))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('family 12: the module-shaped planning case routes the generated local example reference sheet', () => {
  const planningCase = shippedCases().find((entry) => entry.id === 'OMH-223')
  assert.ok(planningCase, 'OMH-223 must remain the module-shaped planning proof')
  const routed = [
    ...((planningCase.context.required as string[] | undefined) ?? []),
    ...((planningCase.context.allowedExtra as string[] | undefined) ?? []),
  ]
  assert.ok(routed.includes(REFERENCE_SHEET))
  assert.match(JSON.stringify(planningCase), /contribution, activation, and override-target IDs/)
})

function recordIn(records: InventoryRecord[], referenceId: string): InventoryRecord {
  const found = records.find((entry) => entry.referenceId === referenceId)
  assert.ok(found, `the shipped projection must still carry ${referenceId}`)
  return found
}

// ---------------------------------------------------------------------------------------------
// Coverage ledger — the spec enumerates TWELVE oracle families; this file labels its fixtures
// `family 1`..`family 11` in implementation order, and the two numbering schemes are NOT the
// same. The ledger states which spec family each fixture family serves, which spec families are
// covered today, and which are not. Every "uncovered" claim names a surface whose absence is
// checked here, so implementing that surface fails this test until the ledger is updated.
// ---------------------------------------------------------------------------------------------

const specPath = fileURLToPath(new URL('../../../../.ai/specs/2026-08-01-standalone-harness-example-read-policy.md', import.meta.url))

type LedgerRow = {
  specFamily: number
  status: 'covered' | 'partial' | 'uncovered'
  fixtures: string[]
  blockedBy: string[]
  note?: string
}

const FIXTURE_FAMILY_TO_SPEC_FAMILIES: Record<number, number[]> = {
  1: [1],
  2: [2],
  3: [3],
  4: [5],
  5: [6],
  6: [7],
  7: [8],
  8: [5],
  // Fixture family 9 serves the cross-cutting "output redaction" requirement in the spec's
  // Testing and Validation section and Phase 2 step 1, not one of the twelve numbered families.
  9: [],
  10: [7],
  11: [1, 9],
  // Declared source references: spec family 4 (the installed-package lane) plus the visible-link
  // half of families 6 and 8.
  12: [4, 6, 8, 10],
}

const COVERAGE_LEDGER: LedgerRow[] = [
  {
    specFamily: 1,
    status: 'covered',
    fixtures: [
      'family 1: a relevant case reads the example entrypoints and several exact CRUD, data, and UI files',
      'family 1: the read allowlist resolves the declared capabilities to exact inventory files',
      'family 11: each newest capability resolves to exactly its shipped sources for the case that declares it',
      'family 11: an undeclared, cross-case, sibling, directory, or stale newest source is refused',
    ],
    blockedBy: [],
  },
  {
    specFamily: 2,
    status: 'covered',
    fixtures: ['family 2: an unrelated capability under the allowed root fails, in the evaluator and at the tool server'],
    blockedBy: [],
  },
  {
    specFamily: 3,
    status: 'covered',
    fixtures: ['family 3: a case without a declared example root cannot reach the canonical example at all'],
    blockedBy: [],
  },
  {
    specFamily: 4,
    status: 'covered',
    fixtures: [
      'family 12: the shipped inventory carries an installed-package reference the UI package really packs',
      'family 12: a declared installed reference is followed directly, with no reason code, and the trace records package, version and hash',
      'family 12: an installed reference grants no sibling, no directory, and nothing before the owner',
      'family 12: an installed reference whose packed target is missing from the app fails closed',
    ],
    blockedBy: [],
    note: 'Closed on 2026-08-05. The canonical spec deferred this family claiming no gate in the batch could verify a packed artifact; `npm pack --dry-run --json` IS that gate, so the deferral rationale was falsifiable and is now falsified. `.ai/guides/backend-ui.md` renders a visible link to `node_modules/@open-mercato/ui/src/backend/DataTable.tsx`, the link validator resolves it against the publishing workspace package AND its packed file list, and the trace records reference id, package, version and content hash from the app`s own install rather than freezing them at derivation. Historical note, since it explains the shape of the fixtures: the blocker used to be that the field itself did not exist — `context.sourceReferenceIds` exists — schema field, evaluator resolution, allowlist widening, and a trace that records the reference id plus package/version/hash for an installed target (`installedTargetIdentity`). What this family still cannot prove is the INSTALLED half: every one of the 125 inventory records is `canonical-example` or `local-owner`, because no emitted Markdown owner renders a link into `node_modules/@open-mercato/*/src/**` yet. Rendering one requires `validate-source-links.mjs` to resolve an installed target against its workspace package and prove packed presence, which does not exist. Until then a fixture could only assert package/version/hash against a hand-written inventory the harness does not ship — exactly the vacuous shape this file exists to reject.',
  },
  {
    specFamily: 5,
    status: 'covered',
    fixtures: [
      'family 4: a named installed-version contract mismatch after local inspection is a bounded passing fallback',
      'family 7: an ordinary example surface is never a specialist-route fallback reason',
      'family 8: a live trace carries the declared reason code into the fallback accounting',
      'family 8: the live channel carries the capability id a specialist-route fallback needs',
      'family 8: one trace may not mix two declared fallback reasons',
      'family 8: the tool server refuses a read whose declared reason is outside the enum',
    ],
    blockedBy: [],
  },
  {
    specFamily: 6,
    status: 'covered',
    fixtures: [
      'family 5: fallback before local inspection, an unknown reason, and an undeclared reason all fail',
      'family 5: reading must start from a declared entrypoint before any capability file',
      'family 5: directory-wide reads and glob dumps fail even when both budgets are untouched',
      'family 5: both cumulative budgets are enforced independently',
      'family 5: symlink escapes, generated caches, and sensitive paths fail closed',
      'path normalization accepts Windows-style separators and rejects every escape spelling',
      'family 12: an orphan, prose, qa-only, wildcard, directory, or dead declared link all fail',
      'family 12: a missing or malformed projection fails closed instead of granting the reference',
    ],
    blockedBy: [],
    note: 'Closed on 2026-08-05. Fallback ordering, unknown reason, traversal, budget overflow, symlink escape, generated cache, and sensitive path were already covered; the absent/dead/directory/wildcard/orphan DECLARED LINK half now has an implementation and a fixture that stages each defect one at a time into the REAL shipped projection and pins the exact message it must produce, so no defect can pass by matching an unrelated violation.',
  },
  {
    specFamily: 7,
    status: 'covered',
    fixtures: [
      'family 6: root immutability is resolved before writable-pattern matching and the write is refused before it happens',
      'family 6: the immutable-root refusal precedes the write allowlist inside the tool server source',
      'family 6: the immutable roots travel by environment so the positional allowlist contract is unchanged',
      'family 10: an installed source read through the fallback cannot be written, even under a wildcard write grant',
      'family 10: a glob write grant that could reach an installed source is refused before the tool server starts',
      'family 10: installed-source immutability rests on the enforced dependency link and the protected-tree fingerprint, not on the write allowlist',
    ],
    blockedBy: [],
    note: 'The canonical-example half is enforced by the immutable-root list. The installed-package half is enforced by the mandated symlinked dependency root plus the protected-tree fingerprint, NOT by the write allowlist — see the last fixture.',
  },
  {
    specFamily: 8,
    status: 'partial',
    fixtures: [
      'family 7: the published schema rejects legacy roots, duplicates, missing entrypoints, bad budgets, unsafe paths, and unknown reasons',
      'family 7: the published schema rejects every malformed declaration it must reject',
      'family 7: a legacy root, a stale capability mapping, and a qa-only source fail evaluator validation',
      'family 7: an ordinary example surface is never a specialist-route fallback reason',
      'family 12: a declared reference is followed only after its origin owner is read, and the trace records it',
      'family 12: a reference whose origin owner is not routed to the case is refused',
      'family 12: a declared reference widens the read allowlist by exactly one exact file',
    ],
    blockedBy: ['a preset-narrowed or tier-narrowed inventory record'],
    note: 'Updated on 2026-08-05. Legacy root, stale mapping, qa-only status, ordinary-surface fallback, the declared-reference half — orphan ID, qa-only target, unrouted origin owner, and following a link before reading the owner that renders it — are covered. and the installed-package half — an unpublished path is rejected by the packed-file gate, and a target the app never installed fails closed — are covered. What remains is preset/tier applicability: every emitted owner ships in every preset today, so no record narrows to one, and `wrong preset` and `wrong tier` have nothing to be wrong about yet.',
  },
  {
    specFamily: 9,
    status: 'covered',
    fixtures: [
      'family 11: the operation-progress and DataTable bulk-action sources are selected by different cases and share no file',
      'family 11: each newest capability resolves to exactly its shipped sources for the case that declares it',
      'family 11: the inventory maps each newest capability to exactly its shipped files, and every one of them exists',
      'family 11: the writable bulk-review oracle connects the selected progressJobId lifecycle',
    ],
    blockedBy: [],
    note: 'Closed on 2026-08-10. OMH-220 and OMH-225 independently select the disjoint DataTable bulk-action and durable operation-progress source sets. Writable case OMH-181 reads both canonical seams, requires the connected `progressJobId` decision, and its trusted behavior oracle proves the exact job returned by execution is passed once to the progress observer and returned to the caller.',
  },
  {
    specFamily: 10,
    status: 'covered',
    fixtures: ['family 12: the module-shaped planning case routes the generated local example reference sheet'],
    blockedBy: [],
    note: 'Closed on 2026-08-10. OMH-223 routes the generated activated-reference sheet alongside the canonical source inventory, so its planning oracle can bind capability choices to generated contribution, activation and override-target identities.',
  },
  {
    specFamily: 11,
    status: 'uncovered',
    fixtures: [],
    blockedBy: ['a design-system gallery record in surface-inventory.json'],
    note: 'The PR #4301 gallery surfaces are not emitted.',
  },
  {
    specFamily: 12,
    status: 'uncovered',
    fixtures: [],
    blockedBy: [
      'a PR #4277 designFoundation record in surface-inventory.json',
      'a design-system gallery record in surface-inventory.json',
    ],
    note: 'The PR #4277 design-foundation surfaces are not emitted.',
  },
]

const MISSING_SURFACES: Record<string, () => boolean> = {
  // The declared-reference field exists now, so the remaining gap is the INSTALLED half: an
  // inventory record whose target is a packed package file rather than app-local source.
  // Every emitted owner ships in every preset today, so no inventory record narrows to one.
  'a preset-narrowed or tier-narrowed inventory record': () => projectedInventory().records
    .every((record) => (record as unknown as Record<string, unknown>).presets === undefined
      && (record as unknown as Record<string, unknown>).tiers === undefined),
  'a design-system gallery record in surface-inventory.json': () => !JSON.stringify(inventoryCapabilities()).includes('gallery'),
  'a PR #4277 designFoundation record in surface-inventory.json': () => !JSON.stringify(inventoryCapabilities()).includes('designFoundation'),
}

test('ledger: the spec still enumerates exactly twelve oracle families', () => {
  const specText = fs.readFileSync(specPath, 'utf8')
  const start = specText.indexOf('## Evaluator Oracles')
  assert.ok(start > 0, 'the spec must still carry an Evaluator Oracles section')
  const section = specText.slice(start, specText.indexOf('\n## ', start + 1))
  const numbered = [...section.matchAll(/^(\d+)\. /gm)].map((match) => Number(match[1]))
  assert.deepEqual(numbered, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 'the ledger is written against exactly twelve families')
  assert.deepEqual(COVERAGE_LEDGER.map((row) => row.specFamily), numbered, 'the ledger must cover every spec family exactly once')
})

test('ledger: the fixture family labels in this file are distinct from the spec family numbers and every mapping is honest', () => {
  const ownSource = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8')
  const labels = [...ownSource.matchAll(/\btest\('family (\d+):/g)].map((match) => Number(match[1]))
  const fixtureFamilies = [...new Set(labels)].sort((left, right) => left - right)
  assert.deepEqual(fixtureFamilies, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 'fixture families are contiguous and stop at twelve')
  assert.deepEqual(Object.keys(FIXTURE_FAMILY_TO_SPEC_FAMILIES).map(Number).sort((left, right) => left - right), fixtureFamilies)

  const claimed = new Set(Object.values(FIXTURE_FAMILY_TO_SPEC_FAMILIES).flat())
  for (const row of COVERAGE_LEDGER) {
    if (row.status === 'uncovered') {
      assert.equal(claimed.has(row.specFamily), false, `spec family ${row.specFamily} is called uncovered but a fixture family claims it`)
      assert.deepEqual(row.fixtures, [], `spec family ${row.specFamily} is called uncovered but names fixtures`)
    } else {
      assert.ok(claimed.has(row.specFamily), `spec family ${row.specFamily} is called ${row.status} but no fixture family claims it`)
      assert.ok(row.fixtures.length > 0, `spec family ${row.specFamily} is called ${row.status} but names no fixture`)
    }
  }
})

test('ledger: every fixture the ledger cites exists in this file', () => {
  const ownSource = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8')
  for (const row of COVERAGE_LEDGER) {
    for (const title of row.fixtures) {
      assert.ok(ownSource.includes(`test('${title}'`), `the ledger cites a fixture that does not exist: ${title}`)
    }
  }
})

/**
 * The anti-staleness gate below only fires for a blocker a ledger row actually cites. A probe
 * nobody cites is never evaluated, so it can silently become FALSE — which is what happened to
 * the `source-link-inventory.json` probe: CANON-C's whole-harness ledger shipped in wave 10, the
 * probe went false, and no assertion noticed because no row named it. That probe is gone; this
 * test keeps the next one from lurking.
 */
test('ledger: no blocker probe exists that the ledger never cites, so a probe cannot silently go false', () => {
  const cited = new Set(COVERAGE_LEDGER.flatMap((row) => row.blockedBy))
  const orphans = Object.keys(MISSING_SURFACES).filter((surface) => !cited.has(surface))
  assert.deepEqual(orphans, [], 'an uncited probe is never evaluated and will rot; delete it or cite it')
})

test('ledger: every gap the ledger claims is a surface that is genuinely absent today', () => {
  for (const row of COVERAGE_LEDGER) {
    if (row.status === 'covered') {
      assert.deepEqual(row.blockedBy, [], `spec family ${row.specFamily} is covered, so it may not name a blocker`)
      continue
    }
    assert.ok(row.blockedBy.length > 0, `spec family ${row.specFamily} is ${row.status} and must name what blocks it`)
    assert.ok(typeof row.note === 'string' && row.note.length > 0, `spec family ${row.specFamily} must explain its gap`)
    for (const surface of row.blockedBy) {
      const probe = MISSING_SURFACES[surface]
      assert.ok(probe, `the ledger names an unverifiable blocker: ${surface}`)
      assert.ok(probe(), `${surface} now exists, so the ledger entry for spec family ${row.specFamily} is stale`)
    }
  }
})

test('ledger: the honest coverage count is nine covered, one partial, and two uncovered of twelve', () => {
  // Moved on 2026-08-10: family 9 closed when the existing writable DataTable extension lane
  // began selecting both canonical seams and its trusted behavior oracle proved the shared
  // progressJobId is handed to the operation-progress observer.
  const tally = (status: LedgerRow['status']) => COVERAGE_LEDGER.filter((row) => row.status === status).map((row) => row.specFamily)
  assert.deepEqual(tally('covered'), [1, 2, 3, 4, 5, 6, 7, 9, 10])
  assert.deepEqual(tally('partial'), [8])
  assert.deepEqual(tally('uncovered'), [11, 12])
  assert.equal(COVERAGE_LEDGER.length, 12)
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
  const matchesType = (type: string) => (type === 'null' ? value === null
    : type === 'array' ? Array.isArray(value)
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
