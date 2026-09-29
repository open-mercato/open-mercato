import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const oracle = fileURLToPath(new URL('../../agentic/shared/ai/harness/writable-behavior-oracles.mjs', import.meta.url))
const seedsPath = fileURLToPath(new URL('../../agentic/shared/ai/harness/fixtures/seeds.json', import.meta.url))
const seeds = JSON.parse(fs.readFileSync(seedsPath, 'utf8')) as {
  fixtures: Record<string, Record<string, string>>
}
const typescriptRoot = path.dirname(require.resolve('typescript-standalone/package.json'))

type CaseDefinition = {
  fixture: string
  file: string
  corrected: string
}

type OracleResult = {
  passed: boolean
  failures: string[]
  checks: Array<{ id: string; passed: boolean }>
}

const cases: Record<string, CaseDefinition> = {
  'OMH-045': {
    fixture: 'integration-rest-client',
    file: 'src/modules/external_sync/lib/client.ts',
    corrected: `
export type PageState = { cursor?: string }
export type ClientEffects = {
  maxAttempts: number
  fetch(url: string): Promise<{ ok: boolean; status: number; json(): Promise<{ items: unknown[]; nextCursor?: string }> }>
}

export async function fetchPage(endpoint: string, state: PageState, effects: ClientEffects) {
  const endpointUrl = new URL(endpoint)
  if (endpointUrl.protocol !== 'https:' || endpointUrl.hostname === '127.0.0.1' || endpointUrl.hostname === 'localhost') {
    throw new Error('unsafe endpoint')
  }
  let lastStatus = 0
  for (let attempt = 0; attempt < effects.maxAttempts; attempt += 1) {
    const url = new URL(endpointUrl.toString())
    url.searchParams.set('cursor', state.cursor ?? '')
    const response = await effects.fetch(url.toString())
    lastStatus = response.status
    if (!response.ok) continue
    const page = await response.json()
    state.cursor = page.nextCursor
    return page
  }
  throw new Error(\`provider returned ${'${lastStatus}'}\`)
}
`,
  },
  'OMH-054': {
    fixture: 'workflow-call-api',
    file: 'src/modules/automation/workflows/call-api.ts',
    corrected: `
export type CallApiInput = { url: string; idempotencyKey: string }
export type CallApiEffects = {
  reserveIdempotency(key: string): Promise<string>
  transaction<T>(work: () => Promise<T>): Promise<T>
  post(url: string, options: { idempotencyKey: string }): Promise<unknown>
}

export async function callApiActivity(input: CallApiInput, effects: CallApiEffects) {
  const key = await effects.reserveIdempotency(input.idempotencyKey)
  return effects.transaction(() => effects.post(input.url, { idempotencyKey: key }))
}
`,
  },
  'OMH-057': {
    fixture: 'regression-missing-scope',
    file: 'src/modules/harness_fixture/api/scope/route.ts',
    corrected: `
export type RecordScope = { tenantId?: string; organizationId?: string }
export type RecordStore = { find(filter: { tenant_id: string; organization_id: string }): Promise<unknown> }

export async function listRecords(scope: RecordScope, store: RecordStore) {
  if (!scope.tenantId || !scope.organizationId) throw new Error('complete scope is required')
  return store.find({ tenant_id: scope.tenantId, organization_id: scope.organizationId })
}
`,
  },
  'OMH-060': {
    fixture: 'regression-partial-write',
    file: 'src/modules/harness_fixture/commands/update-record.ts',
    corrected: `
export async function updateRecord(store: any, failAfterFirst: boolean) {
  return store.transaction(async (transactionalStore: any) => {
    await transactionalStore.persist({ phase: 1 })
    if (failAfterFirst) throw new Error('injected failure')
    await transactionalStore.persist({ phase: 2 })
    await transactionalStore.flush()
  })
}
`,
  },
  'OMH-061': {
    fixture: 'regression-null-roundtrip',
    file: 'src/modules/harness_fixture/backend/edit/page.tsx',
    corrected: `
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'

export type EditFixtureRecord = { note: string | null }
export type EditFixtureValues = { note: string | null }

export function toInitialValues(record: EditFixtureRecord): EditFixtureValues {
  return { note: record.note }
}

export function toUpdatePayload(values: EditFixtureValues): EditFixtureRecord {
  return { note: values.note === '' ? null : values.note }
}

export function EditFixture({ record }: { record: EditFixtureRecord }) {
  return <CrudForm initialValues={toInitialValues(record)} fields={[]} onSubmit={async (values: EditFixtureValues) => toUpdatePayload(values)} />
}
`,
  },
  'OMH-070': {
    fixture: 'regression-cursor-advance',
    file: 'src/modules/harness_fixture/workers/sync.ts',
    corrected: `
export async function syncPage(state: { cursor?: string }, provider: any) {
  let lastError: unknown
  for (let attempt = 0; attempt < provider.maxAttempts; attempt += 1) {
    try {
      const page = await provider.fetchPage(state.cursor)
      state.cursor = page.nextCursor
      return page
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}
`,
  },
  'OMH-192': {
    fixture: 'omh-192',
    file: 'src/modules/library/commands/crm-loans.ts',
    corrected: `
export type TrustedScope = { tenantId?: string; organizationId?: string }
export type LibraryEffects = {
  createBook(record: Record<string, unknown>, scope: TrustedScope): Promise<Record<string, unknown>>
  softDeleteBook(id: string, scope: TrustedScope): Promise<Record<string, unknown>>
  restoreBook(id: string, scope: TrustedScope): Promise<Record<string, unknown>>
  resolveCustomer(id: string, scope: TrustedScope): Promise<{ id: string; displayName: string }>
  findActiveLoan(bookId: string, scope: TrustedScope): Promise<Record<string, unknown> | undefined>
  createLoan(input: Record<string, unknown>, scope: TrustedScope): Promise<Record<string, unknown>>
  claimCheckout(input: Record<string, unknown>, scope: TrustedScope): Promise<Record<string, unknown>>
  findLoan(id: string, scope: TrustedScope): Promise<Record<string, unknown> | undefined>
  updateLoan(id: string, scope: TrustedScope, patch: Record<string, unknown>): Promise<Record<string, unknown>>
}

export function requireTrustedScope(scope: TrustedScope) {
  if (!scope.tenantId || !scope.organizationId) throw new Error('trusted tenant and organization scope required')
  return { tenantId: scope.tenantId, organizationId: scope.organizationId }
}

export async function createBook(input: { id: string; title: string; tenantId?: string; organizationId?: string }, scope: TrustedScope, effects: LibraryEffects) {
  const trusted = requireTrustedScope(scope)
  return effects.createBook({ id: input.id, title: input.title }, trusted)
}

export async function undoCreateBook(id: string, scope: TrustedScope, effects: LibraryEffects) {
  return effects.softDeleteBook(id, requireTrustedScope(scope))
}

export async function deleteBook(id: string, scope: TrustedScope, effects: LibraryEffects) {
  return effects.softDeleteBook(id, requireTrustedScope(scope))
}

export async function undoDeleteBook(id: string, scope: TrustedScope, effects: LibraryEffects) {
  return effects.restoreBook(id, requireTrustedScope(scope))
}

export async function checkoutBook(input: { bookId: string; customerEntityId: string; idempotencyKey: string; tenantId?: string; organizationId?: string }, scope: TrustedScope, effects: LibraryEffects) {
  const trusted = requireTrustedScope(scope)
  const customer = await effects.resolveCustomer(input.customerEntityId, trusted)
  return effects.claimCheckout({
    bookId: input.bookId,
    customerEntityId: customer.id,
    customerNameSnapshot: customer.displayName,
    idempotencyKey: input.idempotencyKey,
  }, trusted)
}

async function mutateLoan(id: string, status: string, scope: TrustedScope, effects: LibraryEffects) {
  const trusted = requireTrustedScope(scope)
  const loan = await effects.findLoan(id, trusted)
  if (!loan) throw new Error('loan not found')
  return effects.updateLoan(id, trusted, { status })
}

export async function returnLoan(input: { id: string }, scope: TrustedScope, effects: LibraryEffects) {
  requireTrustedScope(scope)
  return mutateLoan(input.id, 'returned', scope, effects)
}

export async function renewLoan(input: { id: string }, scope: TrustedScope, effects: LibraryEffects) {
  requireTrustedScope(scope)
  return mutateLoan(input.id, 'renewed', scope, effects)
}

export async function markLoanLost(input: { id: string }, scope: TrustedScope, effects: LibraryEffects) {
  requireTrustedScope(scope)
  return mutateLoan(input.id, 'lost', scope, effects)
}
`,
  },
}

function stageTarget(caseId: string, source?: string): string {
  const definition = cases[caseId]
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-writable-behavior-')))
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"behavior-oracle-target","private":true}\n')
  fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true })
  fs.symlinkSync(typescriptRoot, path.join(root, 'node_modules', 'typescript'), process.platform === 'win32' ? 'junction' : 'dir')
  const target = path.join(root, definition.file)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const seeded = seeds.fixtures[definition.fixture]?.[definition.file]
  assert.equal(typeof seeded, 'string', `missing seed for ${caseId}`)
  fs.writeFileSync(target, source ?? seeded)
  return root
}

function runOracle(root: string, caseId: string, phase: 'before' | 'after') {
  const result = spawnSync(process.execPath, [oracle, '--root', root, '--case', caseId, '--phase', phase, '--json'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 10_000,
  })
  let parsed: OracleResult | undefined
  try { parsed = JSON.parse(result.stdout) as OracleResult } catch { /* assertion below reports raw output */ }
  return { ...result, parsed }
}

test('current controlled seeds reproduce every fixed behavior defect', { skip: process.platform === 'win32' }, () => {
  for (const caseId of Object.keys(cases)) {
    const root = stageTarget(caseId)
    try {
      const before = runOracle(root, caseId, 'before')
      assert.equal(before.status, 1, `${caseId}\n${before.stdout}\n${before.stderr}`)
      assert.equal(before.parsed?.passed, false)
      assert.ok(before.parsed?.failures.length)
      assert.ok(before.parsed?.checks?.some((check) => !check.passed))

      const incorrectlyUsedAsAfter = runOracle(root, caseId, 'after')
      assert.equal(incorrectlyUsedAsAfter.status, 1, `${caseId}\n${incorrectlyUsedAsAfter.stdout}\n${incorrectlyUsedAsAfter.stderr}`)
      assert.equal(incorrectlyUsedAsAfter.parsed?.passed, false)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  }
})

test('corrected fixtures pass the fixed after-phase behavior probes', { skip: process.platform === 'win32' }, () => {
  for (const [caseId, definition] of Object.entries(cases)) {
    const root = stageTarget(caseId, definition.corrected)
    try {
      const after = runOracle(root, caseId, 'after')
      assert.equal(after.status, 0, `${caseId}\n${after.stdout}\n${after.stderr}`)
      assert.equal(after.parsed?.passed, true)
      assert.deepEqual(after.parsed?.failures, [])
      assert.ok(after.parsed?.checks?.length)
      assert.ok(after.parsed?.checks?.every((check) => check.passed))

      const correctedBefore = runOracle(root, caseId, 'before')
      assert.equal(correctedBefore.status, 0, `${caseId}\n${correctedBefore.stdout}\n${correctedBefore.stderr}`)
      assert.equal(correctedBefore.parsed?.passed, true)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  }
})

test('OMH-189 behavior-probes the exported endpoint guard against private networks', { skip: process.platform === 'win32' }, () => {
  const root = stageTarget('OMH-057')
  const client = path.join(root, 'src/modules/room_calendar_sync/lib/transport.ts')
  fs.mkdirSync(path.dirname(client), { recursive: true })
  try {
    fs.writeFileSync(client, `
export function assertSafeEndpoint(endpoint: string) {
  const url = new URL(endpoint)
  if (url.protocol !== 'https:') throw new Error('unsafe endpoint')
}
`)
    const insecure = runOracle(root, 'OMH-189', 'after')
    assert.equal(insecure.status, 1, `${insecure.stdout}\n${insecure.stderr}`)
    assert.equal(insecure.parsed?.checks.find((check) => check.id === 'rejects-non-https-and-private-endpoints')?.passed, false)

    fs.writeFileSync(client, `
import { lookup } from 'node:dns/promises'

export const assertSafeEndpoint = (async (endpoint: string) => {
  const url = new URL(endpoint)
  const hostname = url.hostname.toLowerCase()
  const resolved = await lookup(hostname)
  const privateIpv4 = /^(?:10\\.|127\\.|192\\.168\\.|169\\.254\\.|172\\.(?:1[6-9]|2\\d|3[01])\\.)/
  if (url.protocol !== 'https:' || hostname === 'localhost' || hostname === '[::1]' || privateIpv4.test(hostname) || privateIpv4.test(resolved.address)) {
    throw new Error('unsafe endpoint')
  }
}) satisfies (endpoint: string) => Promise<void>
`)
    fs.writeFileSync(path.join(path.dirname(client), 'index.ts'), `
// export function assertSafeEndpoint() is implemented by transport.ts
export { assertSafeEndpoint } from './transport'
`)
    const secure = runOracle(root, 'OMH-189', 'after')
    assert.equal(secure.status, 0, `${secure.stdout}\n${secure.stderr}`)
    assert.equal(secure.parsed?.passed, true)
    assert.ok(secure.parsed?.checks.every((check) => check.passed))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('OMH-045 uses inert dependency stubs for trusted imported helpers', { skip: process.platform === 'win32' }, () => {
  const caseId = 'OMH-045'
  const definition = cases[caseId]
  const source = `
import { z } from 'zod'
import { registerCommand } from '@open-mercato/shared/modules/commands'

const importedSchema = z.object({})
registerCommand({ id: 'harness.probe', schema: importedSchema })

${definition.corrected}
`
  const root = stageTarget(caseId, source)
  try {
    const result = runOracle(root, caseId, 'after')
    assert.equal(result.status, 0, `${caseId}\n${result.stdout}\n${result.stderr}`)
    assert.equal(result.parsed?.passed, true)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('the fixed worker refuses target imports instead of executing case-controlled commands', { skip: process.platform === 'win32' }, () => {
  const sentinel = path.join(os.tmpdir(), `om-writable-oracle-sentinel-${process.pid}-${Date.now()}`)
  const source = `
import { writeFileSync } from 'node:fs'
writeFileSync(${JSON.stringify(sentinel)}, 'unsafe')
export async function listRecords() { return [] }
`
  const root = stageTarget('OMH-057', source)
  try {
    const result = runOracle(root, 'OMH-057', 'after')
    assert.equal(result.status, 2, `${result.stdout}\n${result.stderr}`)
    assert.equal(result.parsed?.passed, false)
    assert.match(result.parsed?.failures.join(' ') ?? '', /must not execute imports/)
    assert.equal(fs.existsSync(sentinel), false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
    fs.rmSync(sentinel, { force: true })
  }
})

test('the CLI rejects unsupported cases and out-of-root symlink targets', { skip: process.platform === 'win32' }, () => {
  const root = stageTarget('OMH-057')
  const outside = path.join(os.tmpdir(), `om-writable-oracle-outside-${process.pid}-${Date.now()}.ts`)
  try {
    const unsupported = runOracle(root, 'OMH-999', 'after')
    assert.equal(unsupported.status, 2)
    assert.equal(unsupported.parsed?.passed, false)

    fs.writeFileSync(outside, cases['OMH-057'].corrected)
    const target = path.join(root, cases['OMH-057'].file)
    fs.rmSync(target)
    fs.symlinkSync(outside, target)
    const escaped = runOracle(root, 'OMH-057', 'after')
    assert.equal(escaped.status, 2, `${escaped.stdout}\n${escaped.stderr}`)
    assert.equal(escaped.parsed?.passed, false)
    assert.match(escaped.parsed?.failures.join(' ') ?? '', /outside the app root/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
    fs.rmSync(outside, { force: true })
  }
})
