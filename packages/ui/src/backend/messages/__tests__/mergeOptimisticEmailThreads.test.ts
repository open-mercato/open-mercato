import { mergeOptimisticEmailThreads, type OptimisticEmailMessage } from '../mergeOptimisticEmailThreads'
import type { EmailThread, EmailThreadMessage } from '../EmailThreadsPanel'

function message(overrides: Partial<EmailThreadMessage> & { id: string }): EmailThreadMessage {
  return {
    messageId: overrides.id,
    rfcMessageId: null,
    references: [],
    direction: 'outbound',
    fromName: null,
    fromEmail: null,
    to: ['contact@example.com'],
    cc: [],
    subject: 'Hello',
    bodyText: 'Body',
    sentAt: '2026-06-02T10:00:00.000Z',
    providerKey: 'gmail',
    ...overrides,
  }
}

function thread(overrides: Partial<EmailThread> & { threadKey: string }): EmailThread {
  const messages = overrides.messages ?? [message({ id: `${overrides.threadKey}-m1` })]
  const last = messages[messages.length - 1]
  return {
    subject: 'Hello',
    preview: 'Body',
    participants: ['contact@example.com'],
    lastMessageAt: last.sentAt,
    messageCount: messages.length,
    providerKey: 'gmail',
    lastDirection: last.direction,
    ...overrides,
    messages,
  }
}

function optimistic(
  overrides: Partial<EmailThreadMessage> & { id: string; threadKey: string },
): OptimisticEmailMessage {
  const { threadKey, ...rest } = overrides
  return { ...message(rest), threadKey, status: 'sending' }
}

describe('mergeOptimisticEmailThreads', () => {
  it('returns the server threads unchanged when there are no optimistic messages', () => {
    const server = [thread({ threadKey: 't1' })]
    expect(mergeOptimisticEmailThreads(server, [])).toBe(server)
  })

  it('appends an optimistic message to its matching server thread, sorted by sentAt', () => {
    const server = [
      thread({
        threadKey: 't1',
        messages: [message({ id: 'srv-1', messageId: 'srv-1', sentAt: '2026-06-02T09:00:00.000Z' })],
      }),
    ]
    const opt = optimistic({
      id: 'optimistic:c1',
      messageId: 'msg-new',
      threadKey: 't1',
      sentAt: '2026-06-02T11:00:00.000Z',
    })
    const merged = mergeOptimisticEmailThreads(server, [opt])
    expect(merged).toHaveLength(1)
    expect(merged[0].messages.map((m) => m.id)).toEqual(['srv-1', 'optimistic:c1'])
    expect(merged[0].messageCount).toBe(2)
    expect(merged[0].lastMessageAt).toBe('2026-06-02T11:00:00.000Z')
    expect(merged[0].messages[1].status).toBe('sending')
  })

  it('drops the optimistic copy once the server thread contains the same messageId (no duplicate)', () => {
    const server = [
      thread({
        threadKey: 't1',
        messages: [message({ id: 'srv-row', messageId: 'msg-1' })],
      }),
    ]
    const opt = optimistic({ id: 'optimistic:c1', messageId: 'msg-1', threadKey: 't1' })
    const merged = mergeOptimisticEmailThreads(server, [opt])
    expect(merged).toBe(server) // nothing left to overlay
  })

  it('creates a new thread when the optimistic threadKey matches no server thread', () => {
    const server = [
      thread({ threadKey: 't1', messages: [message({ id: 's1', messageId: 's1', sentAt: '2026-06-02T08:00:00.000Z' })] }),
    ]
    const opt = optimistic({
      id: 'optimistic:c1',
      messageId: 'msg-new',
      threadKey: 'new-thread',
      subject: 'Fresh',
      sentAt: '2026-06-02T12:00:00.000Z',
    })
    const merged = mergeOptimisticEmailThreads(server, [opt])
    expect(merged).toHaveLength(2)
    // Newest thread (the optimistic one) sorts first.
    expect(merged[0].threadKey).toBe('new-thread')
    expect(merged[0].subject).toBe('Fresh')
    expect(merged[0].messages[0].status).toBe('sending')
  })

  it('preserves a failed status and keeps it visible until the server has the message', () => {
    const server = [thread({ threadKey: 't1', messages: [message({ id: 's1', messageId: 's1' })] })]
    const opt = optimistic({
      id: 'optimistic:c1',
      messageId: 'msg-failed',
      threadKey: 't1',
      sentAt: '2026-06-02T13:00:00.000Z',
    })
    opt.status = 'failed'
    opt.statusError = 'SMTP rejected'
    const merged = mergeOptimisticEmailThreads(server, [opt])
    const last = merged[0].messages[merged[0].messages.length - 1]
    expect(last.status).toBe('failed')
    expect(last.statusError).toBe('SMTP rejected')
  })

  it('does not mutate the input arrays', () => {
    const server = [thread({ threadKey: 't1', messages: [message({ id: 's1', messageId: 's1' })] })]
    const serverSnapshot = JSON.parse(JSON.stringify(server))
    const opt = optimistic({ id: 'optimistic:c1', messageId: 'msg-new', threadKey: 't1' })
    mergeOptimisticEmailThreads(server, [opt])
    expect(server).toEqual(serverSnapshot)
  })
})
