import React from 'react'
import { isSystemEmailTransportConfigured, sendSystemEmail } from '../system-email'
import type { ChannelAdapter } from '../adapter'
import { registerSystemEmailProviderConfigResolver } from '../system-email-provider-config'

type ContainerOptions = {
  fork: Record<string, unknown>
  sendMessage: jest.Mock
  credentials: Record<string, unknown> | null
}

function buildContainer({ fork, sendMessage, credentials }: ContainerOptions) {
  const adapter = {
    providerKey: 'test-email',
    channelType: 'email',
    capabilities: {} as ChannelAdapter['capabilities'],
    convertOutbound: jest.fn().mockResolvedValue({
      content: { text: 'Hello', bodyFormat: 'text' },
      metadata: { to: ['user@example.com'], subject: 'Hello', from: 'from@example.com' },
    }),
    sendMessage,
    normalizeInbound: jest.fn(),
    verifyWebhook: jest.fn(),
    getStatus: jest.fn(),
  } satisfies ChannelAdapter

  return {
    resolve(name: string) {
      if (name === 'em') return { fork: () => fork }
      if (name === 'channelAdapterRegistry') return { get: () => adapter }
      if (name === 'integrationCredentialsService') {
        return { resolve: jest.fn().mockResolvedValue(credentials) }
      }
      throw new Error(`[internal] unexpected dependency ${name}`)
    },
  }
}

describe('sendSystemEmail', () => {
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
      resolveCredentials: ({ fromAddress }) => ({ token: 'test-token', fromAddress }),
    })
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('uses the communications hub adapter registry for pre-tenant system email', async () => {
    const convertOutbound = jest.fn().mockResolvedValue({
      content: { html: '<div>Hello</div>', text: 'Hello', bodyFormat: 'html' },
      metadata: {
        to: ['user@example.com'],
        subject: 'Hello',
        from: 'from@example.com',
      },
    })
    const sendMessage = jest.fn().mockResolvedValue({
      externalMessageId: 'email-1',
      status: 'sent',
    })
    const adapter = {
      providerKey: 'test-email',
      channelType: 'email',
      capabilities: {} as ChannelAdapter['capabilities'],
      convertOutbound,
      sendMessage,
      normalizeInbound: jest.fn(),
      verifyWebhook: jest.fn(),
      getStatus: jest.fn(),
    } satisfies ChannelAdapter
    const container = {
      resolve(name: string) {
        if (name === 'em') return { fork: () => ({}) }
        if (name === 'channelAdapterRegistry') return { get: () => adapter }
        throw new Error(`[internal] unexpected dependency ${name}`)
      },
    }

    await sendSystemEmail(container as never, {
      to: 'user@example.com',
      subject: 'Hello',
      from: 'from@example.com',
      react: React.createElement('div', null, 'Hello'),
    })

    expect(convertOutbound).toHaveBeenCalledWith(expect.objectContaining({
      bodyFormat: 'html',
      channelMetadata: expect.objectContaining({
        to: 'user@example.com',
        subject: 'Hello',
        from: 'from@example.com',
      }),
    }))
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      credentials: { token: 'test-token', fromAddress: 'from@example.com' },
      scope: { tenantId: 'system', organizationId: 'system' },
    }))
  })

  it('does not fall back to a channel from another organization', async () => {
    const findOne = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        providerKey: 'test-email',
        channelType: 'email',
        organizationId: 'other-org',
        isActive: true,
        status: 'connected',
      })
    const sendMessage = jest.fn().mockResolvedValue({ externalMessageId: 'email-1', status: 'sent' })
    const container = buildContainer({
      fork: { findOne },
      sendMessage,
      credentials: null,
    })

    await sendSystemEmail(container as never, {
      to: 'user@example.com',
      subject: 'Hello',
      from: 'from@example.com',
      text: 'Hello',
      tenantId: 'tenant-1',
      organizationId: null,
    })

    // Only the caller's own organization is probed — the `other-org` row on the second mocked call is
    // never reached, so it can never be borrowed.
    expect(findOne).toHaveBeenCalledTimes(1)
    expect(findOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: 'tenant-1',
        organizationId: null,
        userId: null,
      }),
      undefined,
    )
    // With no channel of its own the send uses the instance-wide environment credentials rather than
    // another organization's.
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      credentials: { token: 'test-token', fromAddress: 'from@example.com' },
    }))
  })

  describe('upgrade path (issue #5010)', () => {
    it('sends through environment credentials when an existing tenant has no channel row', async () => {
      const findOne = jest.fn().mockResolvedValue(null)
      const sendMessage = jest.fn().mockResolvedValue({ externalMessageId: 'email-1', status: 'sent' })
      const container = buildContainer({ fork: { findOne }, sendMessage, credentials: null })

      await sendSystemEmail(container as never, {
        to: 'user@example.com',
        subject: 'Hello',
        from: 'from@example.com',
        text: 'Hello',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      })

      expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
        credentials: { token: 'test-token', fromAddress: 'from@example.com' },
        scope: { tenantId: 'tenant-1', organizationId: 'org-1' },
      }))
    })

    it('fails closed when no channel exists and the environment is not configured either', async () => {
      registerSystemEmailProviderConfigResolver({
        providerKey: 'test-email',
        isConfigured: () => false,
        resolveCredentials: ({ fromAddress }) => ({ fromAddress }),
      })
      const container = buildContainer({
        fork: { findOne: jest.fn().mockResolvedValue(null) },
        sendMessage: jest.fn(),
        credentials: null,
      })

      await expect(sendSystemEmail(container as never, {
        to: 'user@example.com',
        subject: 'Hello',
        from: 'from@example.com',
        text: 'Hello',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      })).rejects.toThrow('SYSTEM_EMAIL_CHANNEL_NOT_CONFIGURED')
    })

    it('prefers tenant credentials saved through the integrations admin UI over environment ones', async () => {
      const persist = jest.fn().mockReturnValue({ flush: jest.fn() })
      const sendMessage = jest.fn().mockResolvedValue({ externalMessageId: 'email-1', status: 'sent' })
      const container = buildContainer({
        fork: { findOne: jest.fn().mockResolvedValue(null), create: jest.fn(), persist, flush: jest.fn() },
        sendMessage,
        credentials: { apiKey: 'tenant-key', fromAddress: 'tenant@example.com' },
      })

      await sendSystemEmail(container as never, {
        to: 'user@example.com',
        subject: 'Hello',
        from: 'from@example.com',
        text: 'Hello',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      })

      expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
        credentials: { apiKey: 'tenant-key', fromAddress: 'tenant@example.com' },
      }))
      // The admin UI stores credentials but has no hook to create the Hub channel, so the send
      // repairs it — otherwise the integration page stays permanently disconnected.
      expect(persist).toHaveBeenCalled()
    })

    it('still fails closed when a configured channel is missing its credentials', async () => {
      const channel = {
        providerKey: 'test-email',
        channelType: 'email',
        organizationId: 'org-1',
        isActive: true,
        status: 'connected',
      }
      const container = buildContainer({
        fork: { findOne: jest.fn().mockResolvedValue(channel) },
        sendMessage: jest.fn(),
        credentials: null,
      })

      await expect(sendSystemEmail(container as never, {
        to: 'user@example.com',
        subject: 'Hello',
        from: 'from@example.com',
        text: 'Hello',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      })).rejects.toThrow('SYSTEM_EMAIL_CREDENTIALS_NOT_CONFIGURED')
    })
  })

  it('fails closed when tenant credential resolution fails', async () => {
    const adapter = { providerKey: 'test-email' } as ChannelAdapter
    const channel = {
      providerKey: 'test-email',
      channelType: 'email',
      organizationId: 'org-1',
      isActive: true,
      status: 'connected',
    }
    const container = {
      resolve(name: string) {
        if (name === 'em') return { fork: () => ({ findOne: jest.fn().mockResolvedValue(channel) }) }
        if (name === 'channelAdapterRegistry') return { get: () => adapter }
        if (name === 'integrationCredentialsService') {
          return { resolve: jest.fn().mockRejectedValue(new Error('credential store unavailable')) }
        }
        throw new Error(`[internal] unexpected dependency ${name}`)
      },
    }

    await expect(sendSystemEmail(container as never, {
      to: 'user@example.com',
      subject: 'Hello',
      from: 'from@example.com',
      text: 'Hello',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })).rejects.toThrow('credential store unavailable')
  })

  it('rejects missing tenant credentials instead of using environment credentials', async () => {
    const adapter = { providerKey: 'test-email' } as ChannelAdapter
    const channel = {
      providerKey: 'test-email',
      channelType: 'email',
      organizationId: 'org-1',
      isActive: true,
      status: 'connected',
    }
    const container = {
      resolve(name: string) {
        if (name === 'em') return { fork: () => ({ findOne: jest.fn().mockResolvedValue(channel) }) }
        if (name === 'channelAdapterRegistry') return { get: () => adapter }
        if (name === 'integrationCredentialsService') return { resolve: jest.fn().mockResolvedValue(null) }
        throw new Error(`[internal] unexpected dependency ${name}`)
      },
    }

    await expect(sendSystemEmail(container as never, {
      to: 'user@example.com',
      subject: 'Hello',
      from: 'from@example.com',
      text: 'Hello',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })).rejects.toThrow('SYSTEM_EMAIL_CREDENTIALS_NOT_CONFIGURED')
  })

  it('reports unknown and disabled providers as unconfigured', () => {
    process.env.SYSTEM_EMAIL_PROVIDER = 'unknown-email-provider'
    expect(isSystemEmailTransportConfigured()).toBe(false)

    registerSystemEmailProviderConfigResolver({
      providerKey: 'disabled-email-provider',
      isConfigured: () => false,
      resolveCredentials: () => ({}),
    })
    process.env.SYSTEM_EMAIL_PROVIDER = 'disabled-email-provider'
    expect(isSystemEmailTransportConfigured()).toBe(false)
  })
})
