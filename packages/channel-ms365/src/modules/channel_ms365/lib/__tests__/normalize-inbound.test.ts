import { normalizeInboundMs365Message } from '../normalize-inbound'

function buildRawMime(options: { messageId?: string; inReplyTo?: string; references?: string; date?: string; body?: string }): Buffer {
  const lines = [
    options.messageId ? `Message-ID: <${options.messageId}>` : null,
    options.inReplyTo ? `In-Reply-To: <${options.inReplyTo}>` : null,
    options.references ? `References: ${options.references}` : null,
    'From: "Bob Builder" <bob@example.com>',
    'To: alice@contoso.com',
    'Subject: Hello from Outlook',
    options.date ? `Date: ${options.date}` : null,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    options.body ?? 'Body text',
  ].filter((line): line is string => line !== null)
  return Buffer.from(lines.join('\r\n'), 'utf-8')
}

describe('normalizeInboundMs365Message', () => {
  it('maps MIME headers to the hub shape and keeps Graph ids as metadata', async () => {
    const normalized = await normalizeInboundMs365Message({
      rawMessage: buildRawMime({ messageId: 'msg-1@example.com', date: 'Thu, 04 Sep 2026 10:00:00 +0000' }),
      graphMessageId: 'AAMk1',
      graphConversationId: 'AAQk1',
      internetMessageId: '<msg-1@example.com>',
      accountIdentifier: 'alice@contoso.com',
    })
    expect(normalized.externalMessageId).toBe('msg-1@example.com')
    expect(normalized.externalConversationId).toBe('msg-1@example.com')
    expect(normalized.senderIdentifier).toBe('bob@example.com')
    expect(normalized.senderDisplayName).toBe('Bob Builder')
    expect(normalized.subject).toBe('Hello from Outlook')
    expect(normalized.bodyFormat).toBe('text')
    expect(normalized.body).toContain('Body text')
    expect(normalized.timestamp.toISOString()).toBe('2026-09-04T10:00:00.000Z')
    expect(normalized.channelContentType).toBe('email/mime')
    expect(normalized.channelMetadata).toMatchObject({ graphMessageId: 'AAMk1', graphConversationId: 'AAQk1', internetMessageId: '<msg-1@example.com>' })
  })

  it('threads on the References root and In-Reply-To like the IMAP provider', async () => {
    const normalized = await normalizeInboundMs365Message({
      rawMessage: buildRawMime({ messageId: 'reply-2@example.com', inReplyTo: 'msg-1@example.com', references: '<root@example.com> <msg-1@example.com>' }),
      graphMessageId: 'AAMk2',
      accountIdentifier: 'alice@contoso.com',
    })
    expect(normalized.externalConversationId).toBe('root@example.com')
    expect(normalized.replyToExternalId).toBe('msg-1@example.com')
  })

  it('falls back to a deterministic id and the Graph timestamp when headers are missing', async () => {
    const fallbackDate = new Date('2026-09-04T12:34:56.000Z')
    const normalized = await normalizeInboundMs365Message({
      rawMessage: buildRawMime({}),
      graphMessageId: 'AAMk3',
      accountIdentifier: 'alice@contoso.com',
      fallbackDate,
    })
    expect(normalized.externalMessageId).toBe('ms365:AAMk3@alice@contoso.com')
    expect(normalized.timestamp.getTime()).toBe(fallbackDate.getTime())
  })
})
