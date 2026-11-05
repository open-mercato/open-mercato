import { convertOutboundForGmail } from '../convert-outbound'

describe('convertOutboundForGmail', () => {
  it('assembles a multipart/alternative RFC2822 message when html and text both present', async () => {
    const result = await convertOutboundForGmail({
      body: '<p>Hello <b>world</b></p>',
      bodyFormat: 'html',
      channelMetadata: { subject: 'Hi', to: ['bob@example.com'] },
      fromAddress: 'alice@gmail.com',
      fromName: 'Alice',
    })
    const meta = result.metadata as Record<string, unknown>
    const raw = (meta.rawMessage as Buffer).toString('utf-8')
    expect(raw).toContain('From: "Alice" <alice@gmail.com>')
    expect(raw).toContain('To: bob@example.com')
    expect(raw).toContain('Subject: Hi')
    expect(raw).toContain('MIME-Version: 1.0')
    expect(raw).toContain('multipart/alternative')
    expect(raw).toContain('Content-Type: text/plain')
    expect(raw).toContain('Content-Type: text/html')
    expect(raw).toContain('<p>Hello <b>world</b></p>')
  })

  it('preserves the inReplyTo / references headers when threading', async () => {
    const result = await convertOutboundForGmail({
      body: 'reply',
      bodyFormat: 'text',
      channelMetadata: {
        to: ['root@example.com'],
        inReplyTo: '<root@example.com>',
        references: ['<root@example.com>', '<parent@example.com>'],
      },
      fromAddress: 'alice@gmail.com',
    })
    const meta = result.metadata as Record<string, unknown>
    const raw = (meta.rawMessage as Buffer).toString('utf-8')
    expect(raw).toContain('In-Reply-To: <root@example.com>')
    expect(raw).toContain('References: <root@example.com> <parent@example.com>')
  })

  it('passes gmailThreadId through metadata.threadId', async () => {
    const result = await convertOutboundForGmail({
      body: 'hi',
      bodyFormat: 'text',
      channelMetadata: { to: 'bob@example.com', gmailThreadId: 'thread-abc' },
      fromAddress: 'alice@gmail.com',
    })
    expect((result.metadata as Record<string, unknown>).threadId).toBe('thread-abc')
  })

  it('derives the Gmail threadId from the hub gmail-thread conversation ref', async () => {
    const result = await convertOutboundForGmail({
      body: 'reply',
      bodyFormat: 'text',
      channelMetadata: { to: ['bob@example.com'], thread_id: 'gmail-thread:18cabc123' },
      fromAddress: 'alice@gmail.com',
    })
    expect((result.metadata as Record<string, unknown>).threadId).toBe('18cabc123')
  })

  it('leaves threadId unset for a new outbound thread ref so Gmail starts a fresh thread', async () => {
    const result = await convertOutboundForGmail({
      body: 'new',
      bodyFormat: 'text',
      channelMetadata: { to: ['bob@example.com'], thread_id: 'outbound:550e8400-e29b-41d4-a716-446655440000' },
      fromAddress: 'alice@gmail.com',
    })
    expect((result.metadata as Record<string, unknown>).threadId).toBeUndefined()
  })

  it('preserves the Gmail threadId across the hub convert→send double-conversion', async () => {
    const firstPass = await convertOutboundForGmail({
      body: 'reply',
      bodyFormat: 'text',
      channelMetadata: { to: ['bob@example.com'], thread_id: 'gmail-thread:18cabc123' },
      fromAddress: 'alice@gmail.com',
    })
    const secondPass = await convertOutboundForGmail({
      body: 'reply',
      bodyFormat: 'text',
      channelMetadata: firstPass.metadata as Record<string, unknown>,
      fromAddress: 'alice@gmail.com',
    })
    expect((secondPass.metadata as Record<string, unknown>).threadId).toBe('18cabc123')
  })

  it('rejects when there are no recipients', async () => {
    await expect(
      convertOutboundForGmail({
        body: 'hi',
        bodyFormat: 'text',
        channelMetadata: {},
        fromAddress: 'alice@gmail.com',
      }),
    ).rejects.toThrow(/at least one recipient/i)
  })

  it('auto-generates a Message-ID rooted in the From address when missing', async () => {
    const result = await convertOutboundForGmail({
      body: 'hi',
      bodyFormat: 'text',
      channelMetadata: { to: ['bob@example.com'] },
      fromAddress: 'alice@gmail.com',
    })
    const meta = result.metadata as Record<string, unknown>
    const generated = meta.messageId as string
    expect(generated).toMatch(/^<[^@]+@gmail\.com>$/)
  })

  it('neutralizes CRLF header injection in subject / fromName', async () => {
    const result = await convertOutboundForGmail({
      body: 'hi',
      bodyFormat: 'text',
      channelMetadata: {
        subject: 'Hello\r\nBcc: attacker@evil.com',
        to: ['bob@example.com'],
      },
      fromAddress: 'alice@gmail.com',
      fromName: 'Alice\r\nX-Injected: 1',
    })
    const meta = result.metadata as Record<string, unknown>
    const raw = (meta.rawMessage as Buffer).toString('utf-8')
    // The injected CRLF must collapse into the header value, not start a new header.
    expect(raw).not.toMatch(/^Bcc: attacker@evil\.com/m)
    expect(raw).not.toMatch(/^X-Injected:/m)
    expect(raw).toMatch(/^Subject: /m)
  })
})
