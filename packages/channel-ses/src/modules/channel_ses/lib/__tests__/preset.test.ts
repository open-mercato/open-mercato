import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { applySesEnvPreset, readSesEnvPreset } from '../preset'

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

describe('channel_ses env preset', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      SYSTEM_EMAIL_PROVIDER: 'ses',
      AWS_SES_REGION: 'eu-west-2',
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

    await applySesEnvPreset({
      em: em as never,
      container,
      tenantId: 'tenant-1',
      organizationId: 'organization-1',
    })

    expect(save).toHaveBeenCalledWith(
      'channel_ses',
      { region: 'eu-west-2', fromAddress: 'from@example.com' },
      { tenantId: 'tenant-1', organizationId: 'organization-1', userId: null },
    )
    expect(em.create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      tenantId: 'tenant-1',
      organizationId: 'organization-1',
      userId: null,
      providerKey: 'ses',
    }))
    expect(persist).toHaveBeenCalledWith(channel)
  })

  it('enables the integration state so Integrations does not read Disabled while email is live', async () => {
    mockedFindOneWithDecryption.mockResolvedValue(null)
    const flush = jest.fn().mockResolvedValue(undefined)
    const em = { create: jest.fn().mockReturnValue({ id: 'channel-1' }), persist: jest.fn().mockReturnValue({ flush }) }
    const { container, upsert } = createContainer()

    await applySesEnvPreset({
      em: em as never,
      container,
      tenantId: 'tenant-1',
      organizationId: 'organization-1',
    })

    expect(upsert).toHaveBeenCalledWith(
      'channel_ses',
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

    await expect(applySesEnvPreset({
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

    await applySesEnvPreset({
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

    await expect(applySesEnvPreset({
      em: { flush: jest.fn() } as never,
      container,
      tenantId: 'tenant-1',
      organizationId: 'organization-1',
    })).resolves.toBeUndefined()

    expect(save).toHaveBeenCalledTimes(1)
  })

  it('requires an explicit region and sender address', () => {
    delete process.env.AWS_SES_REGION
    delete process.env.AWS_REGION
    expect(readSesEnvPreset()).toBeNull()
  })

  it('seeds nothing when another provider is selected, even with AWS_REGION set', async () => {
    // `AWS_REGION` is set by every AWS runtime and ships uncommented in `.env.example` for vector
    // search, so without the provider gate a Resend instance would get an Enabled SES integration
    // and a connected SES channel it never configured.
    process.env.SYSTEM_EMAIL_PROVIDER = 'resend'
    delete process.env.AWS_SES_REGION
    process.env.AWS_REGION = 'eu-central-1'
    const em = { create: jest.fn(), persist: jest.fn(), flush: jest.fn() }
    const { container, save, upsert } = createContainer()

    await applySesEnvPreset({
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

  it('seeds nothing when no provider is selected, because the default is Resend', async () => {
    delete process.env.SYSTEM_EMAIL_PROVIDER
    const em = { create: jest.fn(), persist: jest.fn(), flush: jest.fn() }
    const { container, save } = createContainer()

    await applySesEnvPreset({
      em: em as never,
      container,
      tenantId: 'tenant-1',
      organizationId: 'organization-1',
    })

    expect(save).not.toHaveBeenCalled()
  })
})
