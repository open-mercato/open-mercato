import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { applyResendEnvPreset, readResendEnvPreset } from '../preset'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))

const mockedFindOneWithDecryption = findOneWithDecryption as jest.MockedFunction<typeof findOneWithDecryption>

function createContainer(overrides: { save?: jest.Mock; upsert?: jest.Mock } = {}) {
  const save = overrides.save ?? jest.fn().mockResolvedValue(undefined)
  const upsert = overrides.upsert ?? jest.fn().mockResolvedValue(undefined)
  const container = {
    resolve: (key: string) => (key === 'integrationStateService' ? { upsert } : { save }),
  } as never
  return { container, save, upsert }
}

describe('channel_resend env preset', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      RESEND_API_KEY: 're_test',
      EMAIL_FROM: 'from@example.com',
    }
    mockedFindOneWithDecryption.mockReset()
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('creates a tenant-scoped credential row and system channel', async () => {
    mockedFindOneWithDecryption.mockResolvedValue(null)
    const channel = { id: 'channel-1' }
    const flush = jest.fn().mockResolvedValue(undefined)
    const persist = jest.fn().mockReturnValue({ flush })
    const em = { create: jest.fn().mockReturnValue(channel), persist }
    const { container, save } = createContainer()

    await applyResendEnvPreset({
      em: em as never,
      container,
      tenantId: 'tenant-1',
      organizationId: 'organization-1',
    })

    expect(save).toHaveBeenCalledWith(
      'channel_resend',
      { apiKey: 're_test', fromAddress: 'from@example.com' },
      { tenantId: 'tenant-1', organizationId: 'organization-1', userId: null },
    )
    expect(em.create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      tenantId: 'tenant-1',
      organizationId: 'organization-1',
      userId: null,
      providerKey: 'resend',
    }))
    expect(persist).toHaveBeenCalledWith(channel)
  })

  it('enables the integration state so Integrations does not read Disabled while email is live', async () => {
    mockedFindOneWithDecryption.mockResolvedValue(null)
    const flush = jest.fn().mockResolvedValue(undefined)
    const em = { create: jest.fn().mockReturnValue({ id: 'channel-1' }), persist: jest.fn().mockReturnValue({ flush }) }
    const { container, upsert } = createContainer()

    await applyResendEnvPreset({
      em: em as never,
      container,
      tenantId: 'tenant-1',
      organizationId: 'organization-1',
    })

    expect(upsert).toHaveBeenCalledWith(
      'channel_resend',
      { isEnabled: true },
      { tenantId: 'tenant-1', organizationId: 'organization-1' },
    )
  })

  it('still seeds the system channel when the integration state cannot be written', async () => {
    mockedFindOneWithDecryption.mockResolvedValue(null)
    const channel = { id: 'channel-1' }
    const flush = jest.fn().mockResolvedValue(undefined)
    const persist = jest.fn().mockReturnValue({ flush })
    const em = { create: jest.fn().mockReturnValue(channel), persist }
    const { container } = createContainer({ upsert: jest.fn().mockRejectedValue(new Error('connection terminated')) })

    await expect(applyResendEnvPreset({
      em: em as never,
      container,
      tenantId: 'tenant-1',
      organizationId: 'organization-1',
    })).resolves.toBeUndefined()

    expect(persist).toHaveBeenCalledWith(channel)
  })

  it('reactivates the exactly scoped existing system channel', async () => {
    const existing = { isActive: false, status: 'error', lastError: 'failed' }
    mockedFindOneWithDecryption.mockResolvedValue(existing as never)
    const flush = jest.fn().mockResolvedValue(undefined)
    const em = { flush }

    await applyResendEnvPreset({
      em: em as never,
      container: createContainer().container,
      tenantId: 'tenant-1',
      organizationId: 'organization-1',
    })

    expect(mockedFindOneWithDecryption).toHaveBeenCalledWith(
      em,
      expect.anything(),
      expect.objectContaining({ tenantId: 'tenant-1', organizationId: 'organization-1', userId: null }),
      undefined,
      { tenantId: 'tenant-1', organizationId: 'organization-1' },
    )
    expect(existing).toEqual(expect.objectContaining({ isActive: true, status: 'connected', lastError: null }))
    expect(flush).toHaveBeenCalledTimes(1)
  })

  it('still completes tenant seeding when the channel row cannot be written', async () => {
    mockedFindOneWithDecryption.mockRejectedValue(new Error('connection terminated'))
    const { container, save } = createContainer()

    await expect(applyResendEnvPreset({
      em: { flush: jest.fn() } as never,
      container,
      tenantId: 'tenant-1',
      organizationId: 'organization-1',
    })).resolves.toBeUndefined()

    expect(save).toHaveBeenCalledTimes(1)
  })

  it('requires both an API key and sender address', () => {
    delete process.env.RESEND_API_KEY
    expect(readResendEnvPreset()).toBeNull()
  })
})
