import handler, { metadata, type InboundProcessorPayload } from '../inbound-processor'
import type { QueuedJob } from '@open-mercato/queue'

describe('inbound-processor worker metadata', () => {
  it('targets the canonical inbound queue with concurrency 10', () => {
    expect(metadata.queue).toBe('communication-channels-inbound')
    expect(metadata.id).toBe('communication_channels:inbound-processor')
    expect(metadata.concurrency).toBe(10)
  })
})

describe('inbound-processor worker behaviour', () => {
  function makeJob(payload: Partial<InboundProcessorPayload> = {}): QueuedJob<InboundProcessorPayload> {
    return {
      id: 'job-1',
      createdAt: new Date().toISOString(),
      payload: {
        providerKey: 'test',
        channelId: '11111111-1111-1111-1111-111111111111',
        channelType: 'chat',
        raw: { raw: { foo: 'bar' } },
        scope: {
          tenantId: '22222222-2222-2222-2222-222222222222',
          organizationId: '33333333-3333-3333-3333-333333333333',
        },
        ...payload,
      },
    }
  }

  function makeCtx(resolveFn: (name: string) => unknown) {
    return {
      jobId: 'job-1',
      attemptNumber: 1,
      queueName: 'communication-channels-inbound',
      resolve: resolveFn as <T>(name: string) => T,
    }
  }

  it('throws a descriptive error when no adapter is registered for the providerKey', async () => {
    const ctx = makeCtx((name) => {
      if (name === 'channelAdapterRegistry') return { get: () => undefined }
      throw new Error(`Unexpected resolve: ${name}`)
    })
    await expect(handler(makeJob({ providerKey: 'nonexistent' }), ctx)).rejects.toThrow(
      /No ChannelAdapter registered for providerKey 'nonexistent'/,
    )
  })

  it('throws when normalized message is missing externalMessageId', async () => {
    const stubAdapter = {
      providerKey: 'test',
      normalizeInbound: async () => ({
        // Missing externalMessageId & externalConversationId
        body: 'hi',
        bodyFormat: 'text',
      }),
    }
    const ctx = makeCtx((name) => {
      if (name === 'channelAdapterRegistry') return { get: () => stubAdapter }
      if (name === 'commandBus') return { execute: jest.fn() }
      throw new Error(`Unexpected resolve: ${name}`)
    })
    await expect(handler(makeJob(), ctx)).rejects.toThrow(
      /returned a normalized message missing required fields/,
    )
  })

  it('calls commandBus.execute with the canonical command id when payload normalizes correctly', async () => {
    const normalized = {
      externalMessageId: 'ext-1',
      externalConversationId: 'conv-1',
      senderIdentifier: 'jane@example.com',
      body: 'hi',
      bodyFormat: 'text' as const,
      timestamp: new Date(),
      channelPayload: {},
      channelContentType: 'email/mime',
      channelMetadata: {},
    }
    const stubAdapter = {
      providerKey: 'test',
      normalizeInbound: async () => normalized,
    }
    const execute = jest.fn(async () => ({ result: { status: 'created' as const }, logEntry: null }))
    const ctx = makeCtx((name) => {
      if (name === 'channelAdapterRegistry') return { get: () => stubAdapter }
      if (name === 'commandBus') return { execute }
      throw new Error(`Unexpected resolve: ${name}`)
    })

    await handler(makeJob(), ctx)
    expect(execute).toHaveBeenCalledTimes(1)
    const callArgs = execute.mock.calls[0]
    expect(callArgs[0]).toBe('communication_channels.message.ingest_inbound')
    const passedInput = (callArgs[1] as any).input
    expect(passedInput.providerKey).toBe('test')
    expect(passedInput.message.externalMessageId).toBe('ext-1')
  })

  it('returns silently when the command reports a duplicate', async () => {
    const stubAdapter = {
      providerKey: 'test',
      normalizeInbound: async () => ({
        externalMessageId: 'ext-1',
        externalConversationId: 'conv-1',
        senderIdentifier: 'jane@example.com',
        body: 'hi',
        bodyFormat: 'text' as const,
        timestamp: new Date(),
        channelPayload: {},
        channelContentType: 'email/mime',
        channelMetadata: {},
      }),
    }
    const execute = jest.fn(async () => ({
      result: { status: 'duplicate' as const },
      logEntry: null,
    }))
    const ctx = makeCtx((name) => {
      if (name === 'channelAdapterRegistry') return { get: () => stubAdapter }
      if (name === 'commandBus') return { execute }
      throw new Error(`Unexpected resolve: ${name}`)
    })
    await expect(handler(makeJob(), ctx)).resolves.toBeUndefined()
  })
})
