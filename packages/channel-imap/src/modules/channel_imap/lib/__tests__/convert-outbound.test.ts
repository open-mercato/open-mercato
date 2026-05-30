import { convertOutboundForEmail } from '../convert-outbound'

describe('convertOutboundForEmail', () => {
  it('produces text + html from html input', async () => {
    const native = await convertOutboundForEmail({
      body: '<p>Hello <strong>world</strong></p>',
      bodyFormat: 'html',
      channelMetadata: {
        subject: 'Hi',
        to: ['bob@example.com'],
      },
    })
    expect(native.content.html).toContain('<strong>world</strong>')
    expect(native.content.text).toContain('Hello world')
    expect(native.metadata).toMatchObject({ subject: 'Hi', to: ['bob@example.com'] })
  })

  it('keeps plain text untouched', async () => {
    const native = await convertOutboundForEmail({
      body: 'Hello\n\nworld',
      bodyFormat: 'text',
      channelMetadata: { to: 'bob@example.com', subject: 'Re: hi' },
    })
    expect(native.content.text).toBe('Hello\n\nworld')
    expect(native.content.html).toBeUndefined()
    expect(native.metadata?.to).toEqual(['bob@example.com'])
  })

  it('splits comma-separated address strings into arrays', async () => {
    const native = await convertOutboundForEmail({
      body: 'hi',
      bodyFormat: 'text',
      channelMetadata: { to: 'a@x.com, b@y.com', cc: 'c@z.com;d@z.com' },
    })
    expect(native.metadata?.to).toEqual(['a@x.com', 'b@y.com'])
    expect(native.metadata?.cc).toEqual(['c@z.com', 'd@z.com'])
  })

  it('preserves threading headers from channelMetadata', async () => {
    const native = await convertOutboundForEmail({
      body: 'reply',
      bodyFormat: 'text',
      channelMetadata: {
        to: ['root@example.com'],
        inReplyTo: '<root@example.com>',
        references: ['<root@example.com>', '<parent@example.com>'],
      },
    })
    expect(native.metadata?.inReplyTo).toBe('<root@example.com>')
    expect(native.metadata?.references).toEqual(['<root@example.com>', '<parent@example.com>'])
  })

  it('rejects payloads without recipients', async () => {
    await expect(
      convertOutboundForEmail({ body: 'hi', bodyFormat: 'text', channelMetadata: {} }),
    ).rejects.toThrow(/at least one recipient/i)
  })

  it('strips CRLF from header-shaped fields (defense-in-depth)', async () => {
    const native = await convertOutboundForEmail({
      body: 'hi',
      bodyFormat: 'text',
      channelMetadata: {
        subject: 'Hello\r\nBcc: attacker@evil.com',
        to: ['bob@example.com'],
        inReplyTo: '<root@example.com>\r\nX-Injected: 1',
      },
    })
    expect(native.metadata?.subject).toBe('Hello Bcc: attacker@evil.com')
    expect(native.metadata?.subject).not.toMatch(/[\r\n]/)
    expect(native.metadata?.inReplyTo).not.toMatch(/[\r\n]/)
  })
})
