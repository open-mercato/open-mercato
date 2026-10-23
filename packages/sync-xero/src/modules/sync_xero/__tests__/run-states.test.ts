/** @jest-environment node */
import type { ImportBatch, StreamImportInput } from '@open-mercato/core/modules/data_sync/lib/adapter'
import { startFakeXeroApi, toXeroDotNetDate, type FakeXeroApi, type FakeXeroContact } from '../lib/testing/fakeXeroApi'
import { XeroTestFakesUnavailableError } from '../lib/endpoints'
import { createFakeGrantService, type FakeGrantService } from './support/fakeGrantService'
import { createFakeContainer } from './support/fakeContainer'

const mockCreateRequestContainer = jest.fn()
const mockResolveEndpoints = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => mockCreateRequestContainer(...args),
}))

const mockEnsureFieldDefinitions = jest.fn(async (..._args: unknown[]) => ({ created: 0, updated: 0, unchanged: 3 }))
const mockPreparePage = jest.fn(async (..._args: unknown[]) => undefined)
const mockReportOrphans = jest.fn(async (..._args: unknown[]) => undefined)

jest.mock('../lib/field-definitions', () => ({
  ...jest.requireActual('../lib/field-definitions'),
  ensureXeroFieldDefinitions: (...args: unknown[]) => mockEnsureFieldDefinitions(...args),
}))

jest.mock('../lib/contacts/preload', () => ({
  ...jest.requireActual('../lib/contacts/preload'),
  loadXeroRunIndex: async () => ({ lookup: () => null, isMapped: () => false, add: () => undefined }),
}))

/** This suite covers the walk, the cursor and the grant states; company-writer.test.ts covers the writes. */
jest.mock('../lib/contacts/company-writer', () => ({
  ...jest.requireActual('../lib/contacts/company-writer'),
  createXeroContactWriter: (deps: { xeroOrganisationId: string }) => ({
    preparePage: (...args: unknown[]) => mockPreparePage(...args),
    reportOrphans: (...args: unknown[]) => mockReportOrphans(...args),
    write: async (record: { ContactID: string }) => {
      const externalId = `${deps.xeroOrganisationId}:${record.ContactID}`
      return { externalId, action: 'skip', data: { sourceIdentifier: externalId } }
    },
  }),
}))

jest.mock('../lib/endpoints', () => ({
  ...jest.requireActual('../lib/endpoints'),
  resolveXeroEndpoints: (...args: unknown[]) => mockResolveEndpoints(...args),
}))

jest.mock('../lib/api-client', () => {
  const actual = jest.requireActual('../lib/api-client')
  return {
    ...actual,
    createXeroApiClient: (options: Record<string, unknown>) => actual.createXeroApiClient({ ...options, sleep: async () => undefined }),
  }
})

import { xeroContactsAdapter } from '../lib/contacts/adapter'

const ORG = '996096ec-5362-40dd-be90-3e6a2be09dce'
const PROVIDER_DATA = { xeroOrganisationId: ORG, xeroConnectionId: 'a0a0a0a0-0000-4000-8000-00000000000a', xeroOrganisationName: 'Demo' }
const scope = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }
const PERSONAL = ['Jane Doe', 'jane@example.com', '+44 20 7946 0000', 'GB123456789']

let api: FakeXeroApi
let grants: FakeGrantService
const logWrites: Array<Record<string, unknown>> = []
let failLogWrites = false

function contact(id: string, iso: string): FakeXeroContact {
  return {
    ContactID: id,
    Name: 'Jane Doe',
    EmailAddress: 'jane@example.com',
    TaxNumber: 'GB123456789',
    Phones: [{ PhoneType: 'DEFAULT', PhoneNumber: '+44 20 7946 0000' }],
    ContactStatus: 'ACTIVE',
    UpdatedDateUTC: toXeroDotNetDate(new Date(iso)),
  }
}

async function setup(count = 3) {
  grants = createFakeGrantService({ connected: true, providerData: PROVIDER_DATA })
  api = await startFakeXeroApi({ isTokenValid: (token) => grants.isTokenValid(token) })
  api.seed({
    organisations: [{ tenantId: ORG, connectionId: 'conn', name: 'Demo' }],
    contacts: {
      [ORG]: Array.from({ length: count }, (_, index) => contact(`c${index + 1}`, new Date(Date.parse('2026-10-01T10:00:10.000Z') + index * 1000).toISOString())),
    },
  })
  logWrites.length = 0
  failLogWrites = false
  mockResolveEndpoints.mockResolvedValue({ authorize: 'https://a', token: 'https://t', ...api.endpoints })
  mockCreateRequestContainer.mockResolvedValue(
    createFakeContainer({
      em: { fork() { return this } },
      commandBus: {},
      integrationCredentialsService: { resolve: async () => ({ clientId: 'c', clientSecret: 's' }) },
      integrationOAuthGrantService: grants.service,
      integrationLogService: {
        write: async (entry: Record<string, unknown>) => {
          if (failLogWrites) throw new Error('[internal] log store unavailable')
          logWrites.push(entry)
        },
      },
      dataSyncRunService: {
        getRun: async (runId: string) => (runId === 'manual-run' ? { triggeredBy: 'user-1' } : runId === 'scheduled-run' ? { triggeredBy: 'scheduler' } : null),
      },
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
    runId: 'manual-run',
    ...overrides,
  }
}

async function run(overrides: Partial<StreamImportInput> = {}): Promise<ImportBatch[]> {
  const batches: ImportBatch[] = []
  for await (const batch of xeroContactsAdapter.streamImport!(input(overrides))) batches.push(batch)
  return batches
}

async function failure(overrides: Partial<StreamImportInput> = {}): Promise<Error> {
  const error = await run(overrides).then(
    () => {
      throw new Error('[internal] the run did not fail')
    },
    (reason: unknown) => reason as Error,
  )
  for (const value of [...PERSONAL, grants.state.accessToken ?? 'no-token']) expect(error.message).not.toContain(value)
  return error
}

function expectQuietEnd(code: string): void {
  expect(logWrites).toHaveLength(1)
  expect(logWrites[0]).toMatchObject({ integrationId: 'sync_xero', level: 'warn', code })
  const serialized = JSON.stringify(logWrites)
  for (const value of [...PERSONAL, grants.state.accessToken ?? 'no-token']) expect(serialized).not.toContain(value)
}

afterEach(async () => {
  await api?.close()
  jest.restoreAllMocks()
})

describe('xero.contacts grant-state handling', () => {
  it('ends quietly when no grant exists, as after a Disconnect, with one warning and no failure', async () => {
    await setup()
    grants.setStatus('none')
    await expect(run({ runId: 'scheduled-run' })).resolves.toEqual([])
    expectQuietEnd('xero.run_stopped_not_connected')
  })

  it('still ends quietly when the warning cannot be written', async () => {
    await setup()
    grants.setStatus('none')
    failLogWrites = true
    await expect(run({ runId: 'scheduled-run' })).resolves.toEqual([])
  })

  it('ends quietly on an invalidated grant', async () => {
    await setup()
    grants.setStatus('invalidated')
    await expect(run()).resolves.toEqual([])
    expectQuietEnd('xero.run_stopped_invalidated')
  })

  it.each([
    ['transient', /^xero\.transient: /],
    ['platform_unavailable', /^xero\.platform_unavailable: /],
    ['client_misconfigured', /^xero\.client_misconfigured: .*Client ID and Secret/],
  ] as const)('fails the run on the token failure %s', async (code, message) => {
    await setup()
    grants.failNext('getAccessToken', code)
    expect((await failure()).message).toMatch(message)
    expect(logWrites).toEqual([])
  })

  it('ends quietly when the grant disappears at a later token call', async () => {
    await setup(1002)
    const walk = xeroContactsAdapter.streamImport!(input({ batchSize: 1000 }))[Symbol.asyncIterator]()
    const first = await walk.next()
    expect(first.done).toBe(false)
    grants.failNext('getAccessToken', 'not_connected')
    const next = await walk.next()
    expect(next.done).toBe(true)
    expectQuietEnd('xero.run_stopped_not_connected')
  })

  it('fails the run when the Organisation changes mid-run', async () => {
    await setup(1002)
    const walk = xeroContactsAdapter.streamImport!(input({ batchSize: 1000 }))[Symbol.asyncIterator]()
    await walk.next()
    grants.state.providerData = { ...PROVIDER_DATA, xeroOrganisationId: '1b2c3d4e-5f60-4718-a9b0-c1d2e3f4a5b6' }
    await expect(walk.next()).rejects.toThrow(/^xero\.organisation_changed: /)
  })

  it.each([
    ['a 5xx after the retries', { status: 503, times: 4 }, /^xero\.transient: /],
    ['two 401s', { status: 401, times: 2 }, /^xero\.unauthorized: .*[Rr]econnect/],
    ['insufficient scope', { status: 401, wwwAuthenticate: 'insufficent_scope' }, /^xero\.scope_insufficient: .*[Rr]econnect/],
    ['another 4xx', { status: 400 }, /^xero\.request_rejected: .*\(HTTP 400\)$/],
  ] as const)('fails the run on %s', async (_label, injection, message) => {
    await setup()
    api.inject({ path: 'contacts', ...injection })
    expect((await failure()).message).toMatch(message)
  })

  it('tells a removed Organisation from a forbidden one on a 403', async () => {
    await setup()
    api.inject({ path: 'contacts', status: 403 })
    expect((await failure()).message).toMatch(/^xero\.forbidden: /)

    api.seed({ organisations: [] })
    api.inject({ path: 'contacts', status: 403 })
    expect((await failure()).message).toMatch(/^xero\.organisation_not_authorised: .*[Rr]econnect/)
  })

  it("ends quietly on Xero's daily limit, keeping the batches already yielded", async () => {
    await setup(1002)
    const batches: ImportBatch[] = []
    const walk = xeroContactsAdapter.streamImport!(input({ batchSize: 1000 }))[Symbol.asyncIterator]()
    const first = await walk.next()
    if (!first.done) batches.push(first.value)
    api.inject({ path: 'contacts', status: 429, rateLimitProblem: 'day', retryAfter: 40_000 })
    for (let next = await walk.next(); !next.done; next = await walk.next()) batches.push(next.value)
    expect(batches).toHaveLength(1)
    expectQuietEnd('xero.daily_limit_reached')
  })

  it('fails the run when the seam fakes of the organization are gone', async () => {
    await setup()
    mockResolveEndpoints.mockRejectedValueOnce(new XeroTestFakesUnavailableError())
    expect((await failure()).message).toMatch(/^xero\.test_fakes_unavailable: /)
  })

  it('stops within about a second of a Disconnect, without yielding the partial batch', async () => {
    await setup(3)
    let now = Date.parse('2026-10-13T10:00:00.000Z')
    jest.spyOn(Date, 'now').mockImplementation(() => now)
    const walk = xeroContactsAdapter.streamImport!(input({ batchSize: 1, runId: 'scheduled-run' }))[Symbol.asyncIterator]()
    const first = await walk.next()
    expect(first.done).toBe(false)
    grants.setStatus('none')
    const statusReads = () => grants.calls.filter((call) => call.method === 'readGrantStatus').length
    const readsBefore = statusReads()
    now += 400
    const second = await walk.next()
    expect(second.done).toBe(false)
    expect(statusReads()).toBe(readsBefore)
    now += 1_000
    const third = await walk.next()
    expect(third.done).toBe(true)
    expectQuietEnd('xero.run_stopped_not_connected')
  })
})
