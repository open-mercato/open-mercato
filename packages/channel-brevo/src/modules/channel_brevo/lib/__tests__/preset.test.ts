import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { applyBrevoEnvPreset, readBrevoEnvPreset } from '../preset'

const mockWarn = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/logger', () => ({
  createLogger: () => ({ warn: (...args: unknown[]) => mockWarn(...args) }),
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

describe('channel_brevo env preset', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      SYSTEM_EMAIL_PROVIDER: 'brevo',
      OM_INTEGRATION_BREVO_API_KEY: 'brevo_test',
      EMAIL_FROM: 'from@example.com',
    }
    mockedFindOneWithDecryption.mockReset()
    mockWarn.mockClear()
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

    await applyBrevoEnvPreset({
      em: em as never,
      container,
      tenantId: 'tenant-1',
      organizationId: 'organization-1',
    })

    expect(save).toHaveBeenCalledWith(
      'channel_brevo',
      { apiKey: 'brevo_test', fromAddress: 'from@example.com' },
      { tenantId: 'tenant-1', organizationId: 'organization-1', userId: null },
    )
    expect(em.create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      tenantId: 'tenant-1',
      organizationId: 'organization-1',
      userId: null,
      providerKey: 'brevo',
    }))
    expect(persist).toHaveBeenCalledWith(channel)
  })

  it('enables the integration state so Integrations does not read Disabled while email is live', async () => {
    mockedFindOneWithDecryption.mockResolvedValue(null)
    const flush = jest.fn().mockResolvedValue(undefined)
    const em = { create: jest.fn().mockReturnValue({ id: 'channel-1' }), persist: jest.fn().mockReturnValue({ flush }) }
    const { container, upsert } = createContainer()

    await applyBrevoEnvPreset({
      em: em as never,
      container,
      tenantId: 'tenant-1',
      organizationId: 'organization-1',
    })

    expect(upsert).toHaveBeenCalledWith(
      'channel_brevo',
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

    await expect(applyBrevoEnvPreset({
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

    await applyBrevoEnvPreset({
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

    await expect(applyBrevoEnvPreset({
      em: { flush: jest.fn() } as never,
      container,
      tenantId: 'tenant-1',
      organizationId: 'organization-1',
    })).resolves.toBeUndefined()

    expect(save).toHaveBeenCalledTimes(1)
  })

  it('requires both an API key and sender address', () => {
    delete process.env.OM_INTEGRATION_BREVO_API_KEY
    expect(readBrevoEnvPreset()).toBeNull()
    expect(mockWarn).toHaveBeenCalledWith(
      'Brevo env preset is incomplete; skipping provider configuration',
      { missing: ['OM_INTEGRATION_BREVO_API_KEY'] },
    )
    expect(JSON.stringify(mockWarn.mock.calls)).not.toContain('brevo_test')
  })

  it('uses the provider-specific sender override', () => {
    process.env.OM_INTEGRATION_BREVO_FROM_ADDRESS = 'brevo@example.com'

    expect(readBrevoEnvPreset()).toEqual({
      apiKey: 'brevo_test',
      fromAddress: 'brevo@example.com',
    })
  })

  it('seeds nothing when no provider is selected because Resend remains the default', async () => {
    delete process.env.SYSTEM_EMAIL_PROVIDER
    const em = { create: jest.fn(), persist: jest.fn(), flush: jest.fn() }
    const { container, save, upsert } = createContainer()

    await applyBrevoEnvPreset({
      em: em as never,
      container,
      tenantId: 'tenant-1',
      organizationId: 'organization-1',
    })

    expect(save).not.toHaveBeenCalled()
    expect(upsert).not.toHaveBeenCalled()
    expect(em.create).not.toHaveBeenCalled()
  })

  it('seeds nothing when SES is selected even with leftover Brevo credentials', async () => {
    process.env.SYSTEM_EMAIL_PROVIDER = 'ses'
    const em = { create: jest.fn(), persist: jest.fn(), flush: jest.fn() }
    const { container, save, upsert } = createContainer()

    await applyBrevoEnvPreset({
      em: em as never,
      container,
      tenantId: 'tenant-1',
      organizationId: 'organization-1',
    })

    expect(save).not.toHaveBeenCalled()
    expect(upsert).not.toHaveBeenCalled()
    expect(em.create).not.toHaveBeenCalled()
    expect(mockedFindOneWithDecryption).not.toHaveBeenCalled()
  })
})
