import { sendSystemEmail } from '../system-email'
import { registerSystemEmailProviderConfigResolver } from '../system-email-provider-config'

describe('system email trust boundary', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      SYSTEM_EMAIL_PROVIDER: 'test-email',
      EMAIL_FROM: 'from@example.com',
    }
    registerSystemEmailProviderConfigResolver({
      providerKey: 'test-email',
      isConfigured: () => true,
      resolveCredentials: ({ fromAddress }) => ({ token: 'env-token', fromAddress }),
    })
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('uses instance-wide env transport when tenant channel lacks explicit systemEmail capability', async () => {
    const sendMessage = jest.fn().mockResolvedValue({ status: 'sent' })
    const adapter = {
      providerKey: 'test-email',
      channelType: 'email',
      capabilities: {},
      convertOutbound: jest.fn().mockResolvedValue({
        content: { text: 'Hello', bodyFormat: 'text' },
        metadata: { to: ['user@example.com'], subject: 'Hello', from: 'from@example.com' },
      }),
      sendMessage,
      normalizeInbound: jest.fn(),
      verifyWebhook: jest.fn(),
      getStatus: jest.fn(),
    }

    const findOne = jest.fn().mockResolvedValue({
      providerKey: 'test-email',
      channelType: 'email',
      organizationId: 'org-1',
      isActive: true,
      status: 'connected',
      capabilities: {}, // missing systemEmail capability
    })

    const container = {
      resolve(name: string) {
        if (name === 'em') return { fork: () => ({ findOne }) }
        if (name === 'channelAdapterRegistry') return { get: () => adapter }
        if (name === 'integrationCredentialsService') return { resolve: jest.fn().mockResolvedValue(null) }
        throw new Error(`unexpected ${name}`)
      },
    }

    await sendSystemEmail(container as never, {
      to: 'user@example.com',
      subject: 'Hello',
      from: 'from@example.com',
      text: 'Hello',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })

    // Should fall back to instance-wide env credentials, not tenant channel
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: { token: 'env-token', fromAddress: 'from@example.com' },
      }),
    )
  })

  it('uses tenant channel only when explicitly marked with systemEmail capability', async () => {
    const sendMessage = jest.fn().mockResolvedValue({ status: 'sent' })
    const adapter = {
      providerKey: 'test-email',
      channelType: 'email',
      capabilities: {},
      convertOutbound: jest.fn().mockResolvedValue({
        content: { text: 'Hello', bodyFormat: 'text' },
        metadata: { to: ['user@example.com'], subject: 'Hello', from: 'tenant@example.com' },
      }),
      sendMessage,
      normalizeInbound: jest.fn(),
      verifyWebhook: jest.fn(),
      getStatus: jest.fn(),
    }

    const findOne = jest.fn().mockResolvedValue({
      providerKey: 'test-email',
      channelType: 'email',
      organizationId: 'org-1',
      isActive: true,
      status: 'connected',
      capabilities: { systemEmail: true },
    })

    const container = {
      resolve(name: string) {
        if (name === 'em') return { fork: () => ({ findOne }) }
        if (name === 'channelAdapterRegistry') return { get: () => adapter }
        if (name === 'integrationCredentialsService') {
          return { resolve: jest.fn().mockResolvedValue({ apiKey: 'tenant-key', fromAddress: 'tenant@example.com' }) }
        }
        throw new Error(`unexpected ${name}`)
      },
    }

    await sendSystemEmail(container as never, {
      to: 'user@example.com',
      subject: 'Hello',
      from: 'from@example.com',
      fromIsInstanceDefault: true,
      text: 'Hello',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })

    // Should use tenant credentials because channel is explicitly marked
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: { apiKey: 'tenant-key', fromAddress: 'tenant@example.com' },
      }),
    )
  })
})
