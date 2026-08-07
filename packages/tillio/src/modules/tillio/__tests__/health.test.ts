import { createTillioEnvironmentHealthCheck } from '../lib/health'
import { createTillioClient } from '../lib/client'

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

describe('createTillioEnvironmentHealthCheck.check', () => {
  beforeEach(() => {
    createTillioClientMock.mockReset()
  })

  it('generates and persists tenantSystemId when missing, then reports healthy', async () => {
    const probe = mockPlugins()
    const save = jest.fn().mockResolvedValue(undefined)
    const health = createTillioEnvironmentHealthCheck({ credentialsService: { save } })

    const res = await health.check({ ...env }, scope)

    expect(save).toHaveBeenCalledWith(
      'tillio',
      expect.objectContaining({ apiUrl: env.apiUrl, apiKey: env.apiKey, tenantSystemId: expect.stringMatching(/^OM-/) }),
      scope,
    )
    expect(probe).toHaveBeenCalledWith('test_connection')
    expect(res.status).toBe('healthy')
  })

  it('reuses an existing tenantSystemId without re-saving', async () => {
    mockPlugins()
    const save = jest.fn()
    const health = createTillioEnvironmentHealthCheck({ credentialsService: { save } })

    const res = await health.check({ ...env, tenantSystemId: 'OM-existing' }, scope)

    expect(save).not.toHaveBeenCalled()
    expect(res.status).toBe('healthy')
  })

  it('reports unhealthy when getPlugins fails', async () => {
    mockPlugins(jest.fn().mockRejectedValue(new Error('401 unauthorized')))
    const save = jest.fn().mockResolvedValue(undefined)
    const health = createTillioEnvironmentHealthCheck({ credentialsService: { save } })

    const res = await health.check({ ...env, tenantSystemId: 'OM-x' }, scope)

    expect(res.status).toBe('unhealthy')
    expect(res.message).toContain('401')
  })

  it('reports unhealthy for an incomplete environment without touching Tillio', async () => {
    const save = jest.fn()
    const health = createTillioEnvironmentHealthCheck({ credentialsService: { save } })

    const res = await health.check({ apiUrl: 'https://x.example.com' }, scope)

    expect(res.status).toBe('unhealthy')
    expect(save).not.toHaveBeenCalled()
    expect(createTillioClientMock).not.toHaveBeenCalled()
  })
})
