import { convertOutboundForMs365, type Ms365EmailNativeMetadata } from '../convert-outbound'

describe('convertOutboundForMs365', () => {
  it('assembles an RFC2822 message with threading headers and a generated Message-ID', async () => {
    const native = await convertOutboundForMs365({
      body: '<p>Hello <b>there</b></p>',
      bodyFormat: 'html',
      fromAddress: 'alice@contoso.com',
      fromName: 'Alice "A" Example',
      channelMetadata: {
        subject: 'Re: Quote',
        to: ['bob@example.com'],
        cc: 'carol@example.com',
        inReplyTo: 'orig@example.com',
        references: ['root@example.com', 'orig@example.com'],
      },
    })
    const meta = native.metadata as unknown as Ms365EmailNativeMetadata
    const raw = meta.rawMessage.toString('utf-8')
    expect(raw).toContain('To: bob@example.com')
    expect(raw).toContain('Cc: carol@example.com')
    expect(raw).toContain('Subject: Re: Quote')
    expect(raw).toContain('In-Reply-To: <orig@example.com>')
    expect(raw).toContain('References: <root@example.com> <orig@example.com>')
    expect(raw).toContain('From: "Alice \\"A\\" Example" <alice@contoso.com>')
    expect(raw).toContain('Content-Type: multipart/alternative')
    expect(meta.messageId).toMatch(/^<[0-9a-f-]+@contoso\.com>$/)
    expect(native.content.text).toContain('Hello')
    expect(native.content.html).toContain('<b>there</b>')
  })

  it('keeps an explicit Message-ID from the hub metadata', async () => {
    const native = await convertOutboundForMs365({
      body: 'plain',
      bodyFormat: 'text',
      fromAddress: 'alice@contoso.com',
      channelMetadata: { to: 'bob@example.com', messageId: '<fixed@contoso.com>' },
    })
    const meta = native.metadata as unknown as Ms365EmailNativeMetadata
    expect(meta.messageId).toBe('<fixed@contoso.com>')
    expect(meta.rawMessage.toString('utf-8')).toContain('Message-ID: <fixed@contoso.com>')
  })

  it('requires at least one recipient', async () => {
    await expect(
      convertOutboundForMs365({ body: 'x', bodyFormat: 'text', fromAddress: 'alice@contoso.com', channelMetadata: {} }),
    ).rejects.toThrow(/recipient/)
  })
})
