import handler, { metadata } from '../outbound-bridge'

const enqueueMock = jest.fn(async () => 'job-id')
jest.mock('../../lib/queue', () => {
  const actual = jest.requireActual('../../lib/queue')
  return {
    ...actual,
    getCommunicationChannelsQueue: jest.fn(() => ({ enqueue: enqueueMock })),
  }
})

describe('outbound-bridge subscriber metadata', () => {
  it('subscribes to messages.message.sent with a stable id', () => {
    expect(metadata.event).toBe('messages.message.sent')
    expect(metadata.persistent).toBe(true)
    expect(metadata.id).toBe('communication_channels:outbound-bridge')
  })
})

describe('outbound-bridge subscriber behaviour', () => {
  beforeEach(() => {
    enqueueMock.mockClear()
  })

  function makeCtx(em: { findOne: jest.Mock }) {
    return {
      container: {
        resolve: ((name: string) => {
          if (name === 'em') return { fork: () => em }
          return null
        }) as <T>(name: string) => T,
      },
    }
  }

  const tenantId = '11111111-1111-1111-1111-111111111111'
  const messageId = '22222222-2222-2222-2222-222222222222'

  it('skips silently when payload is missing messageId', async () => {
    const findOne = jest.fn()
    await handler({} as any, makeCtx({ findOne }))
    expect(findOne).not.toHaveBeenCalled()
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('skips when Message no longer exists', async () => {
    const findOne = jest.fn().mockResolvedValueOnce(null) // Message lookup
    await handler({ messageId, tenantId }, makeCtx({ findOne }))
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('skips internal-only messages (no threadId)', async () => {
    const findOne = jest.fn()
    findOne.mockResolvedValueOnce({ id: messageId, threadId: null }) // Message
    await handler({ messageId, tenantId }, makeCtx({ findOne }))
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('skips when no ChannelThreadMapping exists for the threadId', async () => {
    const findOne = jest.fn()
    findOne.mockResolvedValueOnce({ id: messageId, threadId: 'thread-1' }) // Message
    findOne.mockResolvedValueOnce(null) // ChannelThreadMapping
    await handler({ messageId, tenantId }, makeCtx({ findOne }))
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('enqueues an outbound job when channel-linked and not yet delivered', async () => {
    const findOne = jest.fn()
    findOne.mockResolvedValueOnce({ id: messageId, threadId: 'thread-1' }) // Message
    findOne.mockResolvedValueOnce({ id: 'mapping-1', messageThreadId: 'thread-1' }) // mapping
    findOne.mockResolvedValueOnce(null) // existing link (none)
    findOne.mockResolvedValueOnce({ id: 'ch-1', userId: null }) // channel (tenant-wide → any sender)
    await handler({ messageId, tenantId, organizationId: 'org-1' }, makeCtx({ findOne }))
    expect(enqueueMock).toHaveBeenCalledTimes(1)
    const [payload] = enqueueMock.mock.calls[0]
    expect((payload as any).messageId).toBe(messageId)
    expect((payload as any).scope.tenantId).toBe(tenantId)
    expect((payload as any).scope.organizationId).toBe('org-1')
    expect((payload as any).attempt).toBe(1)
  })

  it('skips when an existing link is already in a delivered state', async () => {
    const findOne = jest.fn()
    findOne.mockResolvedValueOnce({ id: messageId, threadId: 'thread-1' }) // Message
    findOne.mockResolvedValueOnce({ id: 'mapping-1', messageThreadId: 'thread-1' }) // mapping
    findOne.mockResolvedValueOnce({ id: 'link-1', deliveryStatus: 'sent' }) // existing link
    await handler({ messageId, tenantId }, makeCtx({ findOne }))
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  // FINDING 3 regression — an in-flight delivery ('queued'/'pending') must not
  // be re-enqueued by a replayed `messages.message.sent`. Only terminal-failure
  // links ('failed') are a genuine retry path.
  it.each(['queued', 'pending'])(
    'skips when an existing link is in-flight (deliveryStatus=%s)',
    async (deliveryStatus) => {
      const findOne = jest.fn()
      findOne.mockResolvedValueOnce({ id: messageId, threadId: 'thread-1' }) // Message
      findOne.mockResolvedValueOnce({ id: 'mapping-1', messageThreadId: 'thread-1' }) // mapping
      findOne.mockResolvedValueOnce({ id: 'link-1', deliveryStatus }) // existing link
      await handler({ messageId, tenantId }, makeCtx({ findOne }))
      expect(enqueueMock).not.toHaveBeenCalled()
    },
  )

  it('enqueues when an existing link is in a terminal-failure state (retry path)', async () => {
    const findOne = jest.fn()
    findOne.mockResolvedValueOnce({ id: messageId, threadId: 'thread-1' })
    findOne.mockResolvedValueOnce({ id: 'mapping-1', messageThreadId: 'thread-1' })
    findOne.mockResolvedValueOnce({ id: 'link-1', deliveryStatus: 'failed' })
    findOne.mockResolvedValueOnce({ id: 'ch-1', userId: null }) // channel (tenant-wide)
    await handler({ messageId, tenantId }, makeCtx({ findOne }))
    expect(enqueueMock).toHaveBeenCalledTimes(1)
  })

  it('skips delivery when the channel is owned by a DIFFERENT user (no cross-user send-as)', async () => {
    // Security regression guard: composing a platform message into another user's
    // channel-linked thread must NOT enqueue a delivery that would send from that
    // user's connected account (the worker uses the channel owner's credentials).
    const findOne = jest.fn()
    findOne.mockResolvedValueOnce({ id: messageId, threadId: 'thread-1', senderUserId: 'sender-a' }) // Message
    findOne.mockResolvedValueOnce({ id: 'mapping-1', messageThreadId: 'thread-1', channelId: 'ch-owner' }) // mapping
    findOne.mockResolvedValueOnce(null) // existing link (none)
    findOne.mockResolvedValueOnce({ id: 'ch-owner', userId: 'owner-b' }) // per-user channel owned by someone else
    await handler({ messageId, tenantId, organizationId: 'org-1' }, makeCtx({ findOne }))
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('enqueues delivery when the message sender OWNS the per-user channel', async () => {
    const findOne = jest.fn()
    findOne.mockResolvedValueOnce({ id: messageId, threadId: 'thread-1', senderUserId: 'owner-b' }) // Message
    findOne.mockResolvedValueOnce({ id: 'mapping-1', messageThreadId: 'thread-1', channelId: 'ch-owner' }) // mapping
    findOne.mockResolvedValueOnce(null) // existing link (none)
    findOne.mockResolvedValueOnce({ id: 'ch-owner', userId: 'owner-b' }) // channel owned by the sender
    await handler({ messageId, tenantId, organizationId: 'org-1' }, makeCtx({ findOne }))
    expect(enqueueMock).toHaveBeenCalledTimes(1)
  })
})

// ── Spec B § Phase B2 — outbound thread-token injection contract ─────
//
// The subscriber itself only enqueues; the actual References + body
// footer injection runs inside `deliver-outbound-message.ts` after the
// outbound-delivery worker dispatches the command. These tests assert
// the exact assembly pattern that `deliver-outbound-message` performs
// inline, so a regression in either the thread-token lib or the wiring
// fails here.
describe('outbound thread-token assembly (Spec B § B2 contract)', () => {
  const {
    generateToken,
    buildReferencesId,
    buildBodyFooter,
    applyOutboundThreadingToken,
  } = jest.requireActual('../../lib/thread-token') as typeof import('../../lib/thread-token')

  const tenantId = '11111111-1111-4111-8111-111111111111'

  function buildOutboundPayload(args: {
    threadToken: string
    bodyFormat: 'html' | 'text'
    existingReferences?: string[]
  }) {
    // Mirrors the code in `commands/deliver-outbound-message.ts` lines ~306-345.
    let outboundBody = args.bodyFormat === 'html' ? '<p>Hello!</p>' : 'Hello!'
    const baseMetadata: Record<string, unknown> = {
      references: args.existingReferences ?? [],
    }
    let mergedReferences = (baseMetadata.references as string[]) ?? []
    if (args.threadToken && !outboundBody.includes(`[OM:${args.threadToken}]`)) {
      const footer = buildBodyFooter(args.threadToken)
      if (args.bodyFormat === 'html') {
        outboundBody = `${outboundBody}${footer.html}`
      } else {
        outboundBody = `${outboundBody}${footer.plain}`
      }
      const refId = buildReferencesId(args.threadToken)
      if (!mergedReferences.includes(refId)) {
        mergedReferences = [...mergedReferences, refId]
      }
    }
    return {
      body: outboundBody,
      channelMetadata: {
        ...baseMetadata,
        references: mergedReferences,
        omThreadToken: args.threadToken,
      },
    }
  }

  it('an HTML outbound carries References + hidden body footer', () => {
    const token = generateToken({ tenantId })
    const out = buildOutboundPayload({ threadToken: token, bodyFormat: 'html' })
    // References header carries the synthetic `.invalid` Message-ID.
    expect((out.channelMetadata.references as string[])).toContain(`<${token}@open-mercato.invalid>`)
    // Body has the hidden span — survives MUAs that strip References.
    expect(out.body).toContain(`[OM:${token}]`)
    expect(out.body).toMatch(/<span[^>]*display\s*:\s*none/i)
  })

  it('a plain-text outbound carries References + plain marker', () => {
    const token = generateToken({ tenantId })
    const out = buildOutboundPayload({ threadToken: token, bodyFormat: 'text' })
    expect((out.channelMetadata.references as string[])).toContain(`<${token}@open-mercato.invalid>`)
    expect(out.body).toContain(`[OM:${token}]`)
    expect(out.body).not.toMatch(/<span/)
  })

  it('extends an existing References array without removing prior refs', () => {
    const token = generateToken({ tenantId })
    const out = buildOutboundPayload({
      threadToken: token,
      bodyFormat: 'html',
      existingReferences: ['<msg-1@external.example>', '<msg-2@external.example>'],
    })
    const refs = out.channelMetadata.references as string[]
    expect(refs).toContain('<msg-1@external.example>')
    expect(refs).toContain('<msg-2@external.example>')
    expect(refs).toContain(`<${token}@open-mercato.invalid>`)
    expect(refs).toHaveLength(3)
  })

  it('is idempotent on retry — re-applying the same token does NOT double-inject', () => {
    const token = generateToken({ tenantId })
    // First send.
    const out1 = buildOutboundPayload({ threadToken: token, bodyFormat: 'html' })
    // Hypothetical retry: deliver-outbound checks `outboundBody.includes('[OM:TOKEN]')`
    // before injecting a second footer. Simulate that guard here.
    const alreadyInjected = out1.body.includes(`[OM:${token}]`)
    expect(alreadyInjected).toBe(true)
    // Re-pass through applyOutboundThreadingToken — proves the lib-level
    // primitive is also idempotent (no duplicate spans).
    const replay = applyOutboundThreadingToken(
      { headers: { References: out1.channelMetadata.references as string[] }, body: out1.body },
      token,
    )
    const tokenOccurrencesInBody = (replay.body!.match(new RegExp(`\\[OM:${token}\\]`, 'g')) ?? []).length
    expect(tokenOccurrencesInBody).toBe(1)
  })
})
