import React from 'react'
import { isSystemEmailTransportConfigured, sendSystemEmail } from '../system-email'
import type { ChannelAdapter } from '../adapter'
import { registerSystemEmailProviderConfigResolver } from '../system-email-provider-config'

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
    const container = {
      resolve(name: string) {
        if (name === 'em') return { fork: () => ({ findOne }) }
        if (name === 'channelAdapterRegistry') return { get: jest.fn() }
        throw new Error(`[internal] unexpected dependency ${name}`)
      },
    }

    await expect(sendSystemEmail(container as never, {
      to: 'user@example.com',
      subject: 'Hello',
      from: 'from@example.com',
      text: 'Hello',
      tenantId: 'tenant-1',
      organizationId: null,
    })).rejects.toThrow('SYSTEM_EMAIL_CHANNEL_NOT_CONFIGURED')

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
