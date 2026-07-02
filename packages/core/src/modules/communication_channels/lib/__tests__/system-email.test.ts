import React from 'react'
import { sendSystemEmail } from '../system-email'
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
})
