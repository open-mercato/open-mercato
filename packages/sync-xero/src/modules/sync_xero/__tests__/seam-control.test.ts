/** @jest-environment node */
import { createFakeGrantService, type FakeGrantService } from './support/fakeGrantService'
import { createFakeContainer } from './support/fakeContainer'

const mockFindWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/encryption/find'),
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))

import { belongsToSeam, resetSeam, SeamConflictError, startSeam } from '../lib/testing/seam-control'
import { seamRegistry } from '../lib/testing/seam'

const scope = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }

let grants: FakeGrantService
let credentials: Record<string, unknown> | null
let mappingCount: number
const saveCredentials = jest.fn()
const nativeDelete = jest.fn()
const deleteSchedule = jest.fn()
const getByKey = jest.fn()
const resetResumePosition = jest.fn()
const deleteExternalIdMappings = jest.fn()
const disconnectSpy = jest.fn()

function context() {
  const container = createFakeContainer({
    integrationCredentialsService: {
      getRaw: async () => credentials,
      save: async (...args: unknown[]) => {
        saveCredentials(...args)
        credentials = args[1] as Record<string, unknown>
      },
    },
    integrationOAuthGrantService: {
      ...grants.service,
      disconnect: async (...args: Parameters<typeof grants.service.disconnect>) => {
        disconnectSpy(...args)
        return grants.service.disconnect(...args)
      },
    },
    em: { count: async () => mappingCount, nativeDelete: (...args: unknown[]) => nativeDelete(...args) },
    externalIdMappingService: { deleteExternalIdMappings: (...args: unknown[]) => deleteExternalIdMappings(...args) },
    dataSyncScheduleService: { getByKey: (...args: unknown[]) => getByKey(...args), deleteSchedule: (...args: unknown[]) => deleteSchedule(...args) },
    dataSyncRunService: { resetResumePosition: (...args: unknown[]) => resetResumePosition(...args) },
  })
  return { container, scope, userId: 'user-1' }
}

async function stopAllFakes(): Promise<void> {
  for (const fakes of seamRegistry().values()) {
    await fakes.authorizationServer.close()
    await fakes.xeroApi.close()
  }
  seamRegistry().clear()
}

beforeEach(() => {
  jest.clearAllMocks()
  grants = createFakeGrantService()
  credentials = null
  mappingCount = 0
  getByKey.mockResolvedValue(null)
  resetResumePosition.mockResolvedValue(0)
  deleteExternalIdMappings.mockResolvedValue(0)
  nativeDelete.mockResolvedValue(0)
  mockFindWithDecryption.mockResolvedValue([])
})

afterEach(async () => {
  await stopAllFakes()
})

describe('startSeam', () => {
  it('starts both fakes and saves a marked Client Configuration, keeping other credential values', async () => {
    credentials = { weeklyFullResync: true }
    const result = await startSeam(context())
    expect(result.clientId).toMatch(/^om_test_seam_[0-9a-f]{16}$/)
    expect(result).not.toHaveProperty('clientSecret')
    expect(seamRegistry().has(scope.organizationId)).toBe(true)
    expect(saveCredentials).toHaveBeenCalledWith(
      'sync_xero',
      { weeklyFullResync: true, clientId: result.clientId, clientSecret: expect.any(String) },
      scope,
    )
    expect(result.authorizationEndpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//)
  })

  it.each([
    ['a real Client ID', () => { credentials = { clientId: 'A1B2C3D4E5F60718', clientSecret: 'x' } }],
    ['a live grant', () => { grants.connect() }],
    ['Xero mappings or cursors', () => { mappingCount = 2 }],
  ])('refuses an organization outside the seam that holds %s', async (_label, arrange) => {
    arrange()
    await expect(startSeam(context())).rejects.toEqual(new SeamConflictError('real_xero_state'))
    expect(seamRegistry().size).toBe(0)
    expect(saveCredentials).not.toHaveBeenCalled()
  })

  it('accepts a seam organization whose fakes are gone, even with a grant', async () => {
    credentials = { clientId: 'om_test_seam_0011223344556677', clientSecret: 'x' }
    grants.connect()
    await expect(startSeam(context())).resolves.toMatchObject({ started: true })
  })

  it('reuses running fakes and clears their data', async () => {
    const first = await startSeam(context())
    const fakes = seamRegistry().get(scope.organizationId)
    fakes?.xeroApi.seed({ organisations: [{ tenantId: 't', connectionId: 'c', name: 'n' }] })
    const second = await startSeam(context())
    expect(second.clientId).toBe(first.clientId)
    expect(seamRegistry().get(scope.organizationId)).toBe(fakes)
  })
})

describe('resetSeam', () => {
  it('refuses an organization outside the seam and erases nothing', async () => {
    credentials = { clientId: 'A1B2C3D4E5F60718', clientSecret: 'x' }
    grants.connect()
    await expect(resetSeam(context())).rejects.toEqual(new SeamConflictError('not_seam_organization'))
    expect(disconnectSpy).not.toHaveBeenCalled()
    expect(grants.state.status).toBe('active')
    expect(saveCredentials).not.toHaveBeenCalled()
  })

  it('erases the seam rows with the fakes gone, through a descriptor without a revocation endpoint', async () => {
    credentials = { clientId: 'om_test_seam_0011223344556677', clientSecret: 'x', weeklyFullResync: false }
    grants.connect({ xeroOrganisationId: 'a', xeroConnectionId: 'b', xeroOrganisationName: 'c' })
    getByKey.mockResolvedValue({ id: 'schedule-1' })
    mockFindWithDecryption.mockResolvedValue([
      { internalEntityType: 'customers.company', internalEntityId: 'company-1' },
      { internalEntityType: 'customers.address', internalEntityId: 'address-1' },
    ])
    deleteExternalIdMappings.mockResolvedValue(1)

    await expect(resetSeam(context())).resolves.toEqual({ reset: true, mappings: 2 })

    const [descriptor, owner, options] = disconnectSpy.mock.calls[0]
    expect(descriptor).not.toHaveProperty('revocationEndpoint')
    expect(descriptor.authorizationEndpoint).toBe('http://127.0.0.1:9/authorize')
    expect(owner).toMatchObject({ integrationId: 'sync_xero', ...scope })
    expect(options).toEqual({ force: true, expectedRevisedAt: null, actorUserId: 'user-1' })
    expect(grants.state.status).toBe('none')
    expect(deleteSchedule).toHaveBeenCalledWith('schedule-1', scope)
    expect(resetResumePosition).toHaveBeenCalledWith('sync_xero', 'xero.contacts', 'import', scope)
    expect(nativeDelete).toHaveBeenCalledWith(expect.anything(), { integrationId: 'sync_xero', ...scope })
    expect(deleteExternalIdMappings).toHaveBeenCalledWith('sync_xero', 'customers.company', ['company-1'], scope)
    expect(deleteExternalIdMappings).toHaveBeenCalledWith('sync_xero', 'customers.address', ['address-1'], scope)
    expect(saveCredentials).toHaveBeenLastCalledWith('sync_xero', { clientId: '', clientSecret: '', weeklyFullResync: false }, scope)
    expect(await belongsToSeam(context().container, scope)).toBe(false)
  })

  it('stops running fakes after the erase, and never revokes at the fake authorization server', async () => {
    await startSeam(context())
    const fakes = seamRegistry().get(scope.organizationId)
    grants.connect()
    await resetSeam(context())
    expect(disconnectSpy.mock.calls[0][0]).not.toHaveProperty('revocationEndpoint')
    expect(disconnectSpy.mock.calls[0][0].tokenEndpoint).toBe(fakes?.authorizationServer.tokenEndpoint)
    expect(seamRegistry().has(scope.organizationId)).toBe(false)
  })
})
