/** @jest-environment node */
import type { ImportBatch, StreamImportInput } from '@open-mercato/core/modules/data_sync/lib/adapter'
import { serializeXeroCursor, emptyXeroCursor, parseXeroCursor } from '../lib/cursor'
import { startFakeXeroApi, toXeroDotNetDate, type FakeXeroApi, type FakeXeroContact } from '../lib/testing/fakeXeroApi'
import { createFakeGrantService, type FakeGrantService } from './support/fakeGrantService'
import { createFakeContainer } from './support/fakeContainer'

const mockCreateRequestContainer = jest.fn()
const mockResolveEndpoints = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => mockCreateRequestContainer(...args),
}))

jest.mock('../lib/endpoints', () => ({
  ...jest.requireActual('../lib/endpoints'),
  resolveXeroEndpoints: (...args: unknown[]) => mockResolveEndpoints(...args),
}))

import { xeroContactsAdapter } from '../lib/contacts/adapter'

const ORG = '996096ec-5362-40dd-be90-3e6a2be09dce'
const OTHER_ORG = '1b2c3d4e-5f60-4718-a9b0-c1d2e3f4a5b6'
const PROVIDER_DATA = { xeroOrganisationId: ORG, xeroConnectionId: 'a0a0a0a0-0000-4000-8000-00000000000a', xeroOrganisationName: 'Demo' }
const XERO_NOW = new Date('2026-10-13T12:00:00.000Z')
const scope = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }

let api: FakeXeroApi
let grants: FakeGrantService
let rejectedTokens: Set<string>
const logWrites: Array<Record<string, unknown>> = []
const runs = new Map<string, { triggeredBy: string | null }>([
  ['manual-run', { triggeredBy: 'user-1' }],
  ['scheduled-run', { triggeredBy: 'scheduler' }],
])

function contact(id: string, iso: string): FakeXeroContact {
  return { ContactID: id, Name: `Contact ${id}`, EmailAddress: `${id}@example.com`, ContactStatus: 'ACTIVE', UpdatedDateUTC: toXeroDotNetDate(new Date(iso)) }
}

function contacts(count: number): FakeXeroContact[] {
  return Array.from({ length: count }, (_, index) => contact(`c${index + 1}`, `2026-10-01T10:00:${String(index + 10).padStart(2, '0')}.000Z`))
}

async function setup(seeded: FakeXeroContact[]) {
  grants = createFakeGrantService({ connected: true, providerData: PROVIDER_DATA })
  rejectedTokens = new Set()
  api = await startFakeXeroApi({ isTokenValid: (token) => grants.isTokenValid(token) && !rejectedTokens.has(token), now: () => XERO_NOW })
  api.seed({ organisations: [{ tenantId: ORG, connectionId: 'conn', name: 'Demo' }], contacts: { [ORG]: seeded } })
  mockResolveEndpoints.mockResolvedValue({ authorize: 'https://a', token: 'https://t', ...api.endpoints })
  logWrites.length = 0
  mockCreateRequestContainer.mockResolvedValue(
    createFakeContainer({
      integrationCredentialsService: { resolve: async () => ({ clientId: 'c', clientSecret: 's' }) },
      integrationOAuthGrantService: grants.service,
      integrationLogService: { write: async (entry: Record<string, unknown>) => { logWrites.push(entry) } },
      dataSyncRunService: { getRun: async (runId: string) => runs.get(runId) ?? null },
    }),
  )
}

function input(overrides: Partial<StreamImportInput> = {}): StreamImportInput {
  return {
    entityType: 'xero.contacts',
    batchSize: 100,
    credentials: {},
    mapping: { entityType: 'xero.contacts', fields: [], matchStrategy: 'externalId' },
    scope,
    ...overrides,
  }
}

async function run(overrides: Partial<StreamImportInput> = {}): Promise<ImportBatch[]> {
  const batches: ImportBatch[] = []
  for await (const batch of xeroContactsAdapter.streamImport!(input(overrides))) batches.push(batch)
  return batches
}

function cursorOf(batch: ImportBatch | undefined) {
  return parseXeroCursor(batch?.cursor ?? null, ORG)
}

afterEach(async () => {
  await api?.close()
})

describe('xeroContactsAdapter', () => {
  it('declares a read import of xero.contacts with no operational telemetry and a code mapping', async () => {
    expect(xeroContactsAdapter).toMatchObject({
      providerKey: 'xero',
      direction: 'import',
      supportedEntities: ['xero.contacts'],
      operationalTelemetry: false,
    })
    expect(xeroContactsAdapter.runMode).toBeUndefined()
    await expect(xeroContactsAdapter.getMapping({ entityType: 'xero.contacts', scope })).resolves.toEqual({
      entityType: 'xero.contacts',
      fields: [],
      matchStrategy: 'externalId',
    })
    expect(xeroContactsAdapter.describeProgressJob?.({ entityType: 'xero.contacts', direction: 'import' })).toEqual({ name: 'Xero contacts' })
  })

  it('runs a full pass without a cursor and commits lastFullAt from the Date header', async () => {
    await setup(contacts(3))
    const batches = await run()
    expect(batches).toHaveLength(1)
    expect(batches[0].items).toEqual([
      { externalId: `${ORG}:c1`, action: 'skip', data: { sourceIdentifier: `${ORG}:c1` } },
      { externalId: `${ORG}:c2`, action: 'skip', data: { sourceIdentifier: `${ORG}:c2` } },
      { externalId: `${ORG}:c3`, action: 'skip', data: { sourceIdentifier: `${ORG}:c3` } },
    ])
    expect(batches[0].hasMore).toBe(false)
    expect(cursorOf(batches[0])).toEqual({
      ...emptyXeroCursor(ORG),
      modifiedSince: XERO_NOW.toISOString(),
      lastFullAt: XERO_NOW.toISOString(),
      fullPassChunk: null,
      lastFullCalls: 1,
    })
    expect(api.requests()[0].ifModifiedSince).toBeNull()
  })

  it('keeps every item free of personal data', async () => {
    await setup(contacts(2))
    const [batch] = await run()
    expect(JSON.stringify(batch)).not.toContain('@example.com')
    expect(JSON.stringify(batch)).not.toContain('Contact c1')
  })

  it('yields one batch per batchSize Contacts, each with the keyset of its last Contact', async () => {
    await setup(contacts(5))
    const batches = await run({ batchSize: 2 })
    expect(batches.map((batch) => batch.items.length)).toEqual([2, 2, 1])
    expect(batches.map((batch) => batch.hasMore)).toEqual([true, true, false])
    expect(cursorOf(batches[0])).toMatchObject({ fullPassStartedAt: XERO_NOW.toISOString(), fullPassModifiedSince: '2026-10-01T10:00:11.000Z' })
    expect(cursorOf(batches[1])).toMatchObject({ fullPassModifiedSince: '2026-10-01T10:00:13.000Z' })
    expect(cursorOf(batches[2])).toMatchObject({ lastFullAt: XERO_NOW.toISOString(), fullPassStartedAt: null })
    expect(batches.map((batch) => batch.batchIndex)).toEqual([0, 1, 2])
  })

  it('walks incrementally from the cursor keyset and moves it to the last Contact', async () => {
    await setup(contacts(5))
    const cursor = serializeXeroCursor({ ...emptyXeroCursor(ORG), modifiedSince: '2026-10-01T10:00:12.000Z', lastFullAt: '2026-10-01T00:00:00.000Z' })
    const batches = await run({ cursor })
    expect(api.requests()[0].ifModifiedSince).toBe('2026-10-01T10:00:11Z')
    expect(batches.flatMap((batch) => batch.items.map((item) => item.externalId))).toEqual([`${ORG}:c2`, `${ORG}:c3`, `${ORG}:c4`, `${ORG}:c5`])
    expect(cursorOf(batches.at(-1))).toMatchObject({ modifiedSince: '2026-10-01T10:00:14.000Z', lastFullAt: '2026-10-01T00:00:00.000Z' })
  })

  it('ends an incremental run with nothing new in one drained batch that keeps the cursor', async () => {
    await setup(contacts(2))
    const cursor = serializeXeroCursor({ ...emptyXeroCursor(ORG), modifiedSince: '2026-10-05T00:00:00.000Z' })
    const batches = await run({ cursor })
    expect(batches).toEqual([expect.objectContaining({ items: [], hasMore: false })])
    expect(cursorOf(batches[0])).toMatchObject({ modifiedSince: '2026-10-05T00:00:00.000Z' })
  })

  it('resumes a pass in progress from its keyset and keeps its start', async () => {
    await setup(contacts(4))
    const cursor = serializeXeroCursor({
      ...emptyXeroCursor(ORG),
      modifiedSince: '2026-09-01T00:00:00.000Z',
      fullPassStartedAt: '2026-10-12T08:00:00.000Z',
      fullPassModifiedSince: '2026-10-01T10:00:11.000Z',
    })
    const batches = await run({ cursor })
    expect(api.requests()[0].ifModifiedSince).toBe('2026-10-01T10:00:10Z')
    expect(cursorOf(batches.at(-1))).toMatchObject({
      lastFullAt: '2026-10-12T08:00:00.000Z',
      modifiedSince: '2026-10-12T08:00:00.000Z',
      fullPassStartedAt: null,
    })
  })

  it('starts a full pass when the cursor belongs to another Organisation', async () => {
    await setup(contacts(1))
    const cursor = serializeXeroCursor({ ...emptyXeroCursor(OTHER_ORG), modifiedSince: '2026-10-05T00:00:00.000Z' })
    const batches = await run({ cursor })
    expect(api.requests()[0].ifModifiedSince).toBeNull()
    expect(cursorOf(batches[0])).toMatchObject({ xeroOrganisationId: ORG, lastFullAt: XERO_NOW.toISOString() })
  })

  it('stops above the yield once the run is cancelled', async () => {
    await setup(contacts(6))
    const controller = new AbortController()
    const batches: ImportBatch[] = []
    for await (const batch of xeroContactsAdapter.streamImport!(input({ batchSize: 2, signal: controller.signal }))) {
      batches.push(batch)
      controller.abort(new Error('cancelled'))
    }
    expect(batches).toHaveLength(1)
    expect(batches[0].hasMore).toBe(true)
  })

  it('makes the first token call before any Xero request', async () => {
    await setup(contacts(1))
    grants.failNext('getAccessToken', 'transient')
    await expect(run()).rejects.toThrow(/^xero\.transient: /)
    expect(api.requests()).toHaveLength(0)
  })

  it('outlives its access token: asks for a token before every request and retries once a rejected one', async () => {
    const start = Date.parse('2026-10-01T00:00:00.000Z')
    await setup(Array.from({ length: 1002 }, (_, index) => contact(`c${index + 1}`, new Date(start + index * 1000).toISOString())))
    const walk = xeroContactsAdapter.streamImport!(input({ batchSize: 1000 }))
    const iterator = walk[Symbol.asyncIterator]()
    await iterator.next()
    const first = grants.state.accessToken as string
    grants.rotate()
    const rotated = grants.state.accessToken as string
    rejectedTokens.add(rotated)
    const rest: ImportBatch[] = []
    for (let next = await iterator.next(); !next.done; next = await iterator.next()) rest.push(next.value)

    expect(rest.flatMap((batch) => batch.items.map((item) => item.externalId))).toEqual([`${ORG}:c1001`, `${ORG}:c1002`])
    const tokenCalls = grants.calls.filter((call) => call.method === 'getAccessToken')
    expect(tokenCalls.some((call) => (call.options as { rejectedAccessToken?: string } | undefined)?.rejectedAccessToken === rotated)).toBe(true)
    expect(grants.state.accessToken).not.toBe(first)
    expect(grants.state.accessToken).not.toBe(rotated)
  })

  it('fails a manual run while the Organisation is not chosen, and ends a scheduled one quietly', async () => {
    await setup(contacts(1))
    grants.state.providerData = null
    await expect(run({ runId: 'manual-run' })).rejects.toThrow(/^xero\.account_pending: /)
    await expect(run({ runId: 'scheduled-run' })).resolves.toEqual([])
    expect(logWrites).toEqual([expect.objectContaining({ level: 'warn', code: 'xero.account_pending', runId: 'scheduled-run' })])
    expect(api.requests()).toHaveLength(0)
  })
})
