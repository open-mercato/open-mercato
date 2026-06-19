import { normalizeInboundImapMessage } from '../normalize-inbound'

function buildMimeMessage(parts: {
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
  if (parts.html && parts.text) {
    headers.push('Content-Type: multipart/alternative; boundary="alt-boundary"')
    const body = [
      '',
      '--alt-boundary',
      'Content-Type: text/plain; charset=utf-8',
      '',
      parts.text,
      '--alt-boundary',
      'Content-Type: text/html; charset=utf-8',
      '',
      parts.html,
      '--alt-boundary--',
      '',
    ].join('\r\n')
    return Buffer.from(headers.join('\r\n') + body, 'utf-8')
  }
  if (parts.html) {
    headers.push('Content-Type: text/html; charset=utf-8')
    return Buffer.from(headers.join('\r\n') + '\r\n\r\n' + parts.html, 'utf-8')
  }
  headers.push('Content-Type: text/plain; charset=utf-8')
  return Buffer.from(headers.join('\r\n') + '\r\n\r\n' + (parts.text ?? ''), 'utf-8')
}

describe('normalizeInboundImapMessage', () => {
  it('uses the Message-ID header as externalMessageId', async () => {
    const result = await normalizeInboundImapMessage({
      rawMessage: buildMimeMessage({
        messageId: '<root@example.com>',
        from: '"Alice" <alice@example.com>',
        to: 'bob@example.com',
        subject: 'Greetings',
        text: 'Hello world',
        date: 'Wed, 21 May 2026 10:00:00 +0000',
      }),
      uid: 42,
      accountIdentifier: 'bob@example.com',
    })
    expect(result.externalMessageId).toBe('root@example.com')
    expect(result.externalConversationId).toBe('root@example.com')
    expect(result.senderIdentifier).toBe('alice@example.com')
    expect(result.senderDisplayName).toBe('Alice')
    expect(result.subject).toBe('Greetings')
    expect(result.body).toContain('Hello world')
    expect(result.bodyFormat).toBe('text')
    expect(result.channelContentType).toBe('email/mime')
  })

  it('synthesises a deterministic fallback message id when missing', async () => {
    const result = await normalizeInboundImapMessage({
      rawMessage: buildMimeMessage({
        from: 'eve@example.com',
        to: 'bob@example.com',
        subject: 'no id',
        text: 'hi',
      }),
      uid: 7,
      accountIdentifier: 'bob@example.com',
    })
    expect(result.externalMessageId).toBe('imap:7@bob@example.com')
    expect(result.externalConversationId).toBe('imap:7@bob@example.com')
  })

  it('threads replies via In-Reply-To and root References', async () => {
    const result = await normalizeInboundImapMessage({
      rawMessage: buildMimeMessage({
        messageId: '<reply@example.com>',
        inReplyTo: '<parent@example.com>',
        references: '<root@example.com> <parent@example.com>',
        from: 'alice@example.com',
        to: 'bob@example.com',
        subject: 'Re: original',
        text: 'replying',
      }),
      uid: 100,
      accountIdentifier: 'bob@example.com',
    })
    expect(result.externalMessageId).toBe('reply@example.com')
    expect(result.replyToExternalId).toBe('parent@example.com')
    expect(result.externalConversationId).toBe('root@example.com')
    expect((result.channelMetadata as { references: string[] }).references).toEqual([
      'root@example.com',
      'parent@example.com',
    ])
  })

  it('prefers html body when both html and text are present', async () => {
    const result = await normalizeInboundImapMessage({
      rawMessage: buildMimeMessage({
        messageId: '<html@example.com>',
        from: 'alice@example.com',
        to: 'bob@example.com',
        subject: 'rich',
        text: 'plain',
        html: '<p><b>rich</b></p>',
      }),
      uid: 1,
      accountIdentifier: 'bob@example.com',
    })
    expect(result.bodyFormat).toBe('html')
    expect(result.body).toContain('<b>rich</b>')
  })
})
