import { createTillioEnvironmentHealthCheck } from '../lib/health'
import { createTillioClient } from '../lib/client'
import { TILLIO_ENVIRONMENT_IDENTITY_INTEGRATION_ID } from '../lib/environment'

jest.mock('../lib/client', () => ({
  createTillioClient: jest.fn(),
}))

const createTillioClientMock = createTillioClient as jest.MockedFunction<typeof createTillioClient>

const scope = { tenantId: 'tn', organizationId: 'org' }
const env = { apiUrl: 'https://x.example.com', apiKey: 'k' }

function mockPlugins(getPlugins = jest.fn().mockResolvedValue({ plugins: [] })) {
  createTillioClientMock.mockReturnValue({ getPlugins } as unknown as ReturnType<typeof createTillioClient>)
  return getPlugins
}

function fakeStore(initial: Record<string, Record<string, unknown> | null> = {}) {
  const store: Record<string, Record<string, unknown> | null> = { ...initial }
  return {
    store,
    service: {
      getRaw: jest.fn(async (id: string) => store[id] ?? null),
      save: jest.fn(async (id: string, credentials: Record<string, unknown>) => {
        store[id] = credentials
      }),
    },
  }
}

describe('createTillioEnvironmentHealthCheck.check', () => {
  beforeEach(() => {
    createTillioClientMock.mockReset()
  })

  it('generates and persists tenantSystemId when missing, then reports healthy', async () => {
    const probe = mockPlugins()
    const { service, store } = fakeStore()
    const health = createTillioEnvironmentHealthCheck({ credentialsService: service })

    const res = await health.check({ ...env }, scope)

    expect(service.save).toHaveBeenCalledWith(
      TILLIO_ENVIRONMENT_IDENTITY_INTEGRATION_ID,
      { tenantSystemId: expect.stringMatching(/^OM-/) },
      scope,
    )
    expect(store.tillio).toBeUndefined()
    expect(probe).toHaveBeenCalledWith('test_connection')
    expect(res.status).toBe('healthy')
  })

  it('reuses an existing tenantSystemId without re-saving', async () => {
    mockPlugins()
    const { service } = fakeStore({
      [TILLIO_ENVIRONMENT_IDENTITY_INTEGRATION_ID]: { tenantSystemId: 'OM-existing' },
    })
    const health = createTillioEnvironmentHealthCheck({ credentialsService: service })

    const res = await health.check({ ...env }, scope)

    expect(service.save).not.toHaveBeenCalled()
    expect(createTillioClientMock).toHaveBeenCalledWith(expect.objectContaining({ tenantSystemId: 'OM-existing' }))
    expect(res.status).toBe('healthy')
  })

  it('adopts an identity left in the credentials record instead of minting a new one', async () => {
    mockPlugins()
    const { service } = fakeStore()
    const health = createTillioEnvironmentHealthCheck({ credentialsService: service })

    const res = await health.check({ ...env, tenantSystemId: 'OM-legacy' }, scope)

    expect(service.save).toHaveBeenCalledWith(
      TILLIO_ENVIRONMENT_IDENTITY_INTEGRATION_ID,
      { tenantSystemId: 'OM-legacy' },
      scope,
    )
    expect(createTillioClientMock).toHaveBeenCalledWith(expect.objectContaining({ tenantSystemId: 'OM-legacy' }))
    expect(res.status).toBe('healthy')
  })

  it('keeps the identity when the credentials record is saved without it', async () => {
    mockPlugins()
    const { service } = fakeStore({
      [TILLIO_ENVIRONMENT_IDENTITY_INTEGRATION_ID]: { tenantSystemId: 'OM-kept' },
    })
    const health = createTillioEnvironmentHealthCheck({ credentialsService: service })

    // What the integration form writes back: the schema fields only.
    const res = await health.check({ apiUrl: env.apiUrl, apiKey: 'rotated' }, scope)

    expect(service.save).not.toHaveBeenCalled()
    expect(createTillioClientMock).toHaveBeenCalledWith(expect.objectContaining({ tenantSystemId: 'OM-kept' }))
    expect(res.status).toBe('healthy')
  })

  it('reports unhealthy when getPlugins fails', async () => {
    mockPlugins(jest.fn().mockRejectedValue(new Error('401 unauthorized')))
    const { service } = fakeStore({
      [TILLIO_ENVIRONMENT_IDENTITY_INTEGRATION_ID]: { tenantSystemId: 'OM-x' },
    })
    const health = createTillioEnvironmentHealthCheck({ credentialsService: service })

    const res = await health.check({ ...env }, scope)

    expect(res.status).toBe('unhealthy')
    expect(res.message).toContain('401')
  })

  it('reports unhealthy for an incomplete environment without touching Tillio', async () => {
    const { service } = fakeStore()
    const health = createTillioEnvironmentHealthCheck({ credentialsService: service })

    const res = await health.check({ apiUrl: 'https://x.example.com' }, scope)

    expect(res.status).toBe('unhealthy')
    expect(service.save).not.toHaveBeenCalled()
    expect(createTillioClientMock).not.toHaveBeenCalled()
  })
})
