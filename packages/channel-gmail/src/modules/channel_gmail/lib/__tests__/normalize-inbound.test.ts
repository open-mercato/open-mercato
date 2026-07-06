import { normalizeInboundGmailMessage } from '../normalize-inbound'

function buildMime(parts: {
  messageId?: string
  inReplyTo?: string
  references?: string
  subject?: string
  from?: string
  to?: string
  date?: string
  text?: string
  html?: string
}): Buffer {
  const headers: string[] = []
  if (parts.messageId) headers.push(`Message-ID: ${parts.messageId}`)
  if (parts.inReplyTo) headers.push(`In-Reply-To: ${parts.inReplyTo}`)
  if (parts.references) headers.push(`References: ${parts.references}`)
  if (parts.subject) headers.push(`Subject: ${parts.subject}`)
  if (parts.from) headers.push(`From: ${parts.from}`)
  if (parts.to) headers.push(`To: ${parts.to}`)
  if (parts.date) headers.push(`Date: ${parts.date}`)
  headers.push('MIME-Version: 1.0')
  if (parts.html) {
    headers.push('Content-Type: text/html; charset=utf-8')
    return Buffer.from(headers.join('\r\n') + '\r\n\r\n' + parts.html, 'utf-8')
  }
  headers.push('Content-Type: text/plain; charset=utf-8')
  return Buffer.from(headers.join('\r\n') + '\r\n\r\n' + (parts.text ?? ''), 'utf-8')
}

describe('normalizeInboundGmailMessage', () => {
  it('uses Gmail threadId for externalConversationId, not the RFC2822 root', async () => {
    const result = await normalizeInboundGmailMessage({
      rawMessage: buildMime({
        messageId: '<reply@example.com>',
        inReplyTo: '<parent@example.com>',
        references: '<root@example.com> <parent@example.com>',
        from: '"Alice" <alice@gmail.com>',
        to: 'bob@example.com',
        subject: 'Re: original',
        text: 'replying',
      }),
      gmailMessageId: 'gm-msg-100',
      gmailThreadId: 'gm-thread-1',
      gmailLabelIds: ['INBOX', 'IMPORTANT'],
      accountIdentifier: 'bob@example.com',
    })
    expect(result.externalMessageId).toBe('reply@example.com')
    expect(result.externalConversationId).toBe('gmail-thread:gm-thread-1')
    expect(result.replyToExternalId).toBe('parent@example.com')
    expect((result.channelMetadata as { gmailLabelIds: string[] }).gmailLabelIds).toEqual(['INBOX', 'IMPORTANT'])
  })

  it('synthesises a deterministic fallback message id when missing', async () => {
    const result = await normalizeInboundGmailMessage({
      rawMessage: buildMime({
        from: 'eve@example.com',
        to: 'bob@example.com',
        subject: 'no id',
        text: 'hi',
      }),
      gmailMessageId: 'gm-msg-7',
      gmailThreadId: 'gm-thread-2',
      accountIdentifier: 'bob@example.com',
    })
    expect(result.externalMessageId).toBe('gmail:gm-msg-7@bob@example.com')
    expect(result.externalConversationId).toBe('gmail-thread:gm-thread-2')
  })

  it('prefers html body when html is present', async () => {
    const result = await normalizeInboundGmailMessage({
      rawMessage: buildMime({
        messageId: '<html@example.com>',
        from: 'alice@example.com',
        to: 'bob@example.com',
        subject: 'rich',
        html: '<p><b>rich</b></p>',
      }),
      gmailMessageId: 'gm-msg-1',
      gmailThreadId: 'gm-thread-1',
      accountIdentifier: 'bob@example.com',
    })
    expect(result.bodyFormat).toBe('html')
    expect(result.body).toContain('<b>rich</b>')
  })

  it('exposes Gmail ids via channelPayload for downstream widgets', async () => {
    const result = await normalizeInboundGmailMessage({
      rawMessage: buildMime({
        messageId: '<msg@example.com>',
        from: 'alice@example.com',
        to: 'bob@example.com',
        subject: 'subj',
        text: 'hi',
      }),
      gmailMessageId: 'gm-msg-9',
      gmailThreadId: 'gm-thread-9',
      gmailLabelIds: ['INBOX'],
      accountIdentifier: 'bob@example.com',
    })
    const payload = result.channelPayload as Record<string, unknown>
    expect(payload.gmailMessageId).toBe('gm-msg-9')
    expect(payload.gmailThreadId).toBe('gm-thread-9')
    expect(payload.gmailLabelIds).toEqual(['INBOX'])
  })
})
