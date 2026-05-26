import { convertOutboundForMicrosoft } from '../convert-outbound'
import type { MicrosoftEmailNativeMetadata } from '../convert-outbound'

describe('convertOutboundForMicrosoft', () => {
  it('builds a Graph sendMail body with HTML content + saveToSentItems true', async () => {
    const result = await convertOutboundForMicrosoft({
      body: '<p>Hello <b>world</b></p>',
      bodyFormat: 'html',
      channelMetadata: { subject: 'Hi', to: ['bob@example.com'] },
      fromAddress: 'alice@outlook.com',
      fromName: 'Alice',
    })
    const meta = result.metadata as unknown as MicrosoftEmailNativeMetadata
    expect(meta.sendMailBody.message.subject).toBe('Hi')
    expect(meta.sendMailBody.message.body.contentType).toBe('HTML')
    expect(meta.sendMailBody.message.body.content).toContain('<b>world</b>')
    expect(meta.sendMailBody.message.toRecipients).toEqual([{ emailAddress: { address: 'bob@example.com' } }])
    expect(meta.sendMailBody.saveToSentItems).toBe(true)
  })

  it('captures conversationId for diagnostics but does NOT post it (read-only on Graph)', async () => {
    const result = await convertOutboundForMicrosoft({
      body: 'reply',
      bodyFormat: 'text',
      channelMetadata: { to: ['bob@example.com'], microsoftConversationId: 'conv-1' },
      fromAddress: 'alice@outlook.com',
    })
    const meta = result.metadata as unknown as MicrosoftEmailNativeMetadata
    // conversationId on the Graph Message resource is read-only; it must not
    // appear in the outbound sendMail body.
    expect((meta.sendMailBody.message as Record<string, unknown>).conversationId).toBeUndefined()
    // …but we still surface the value on our own metadata for diagnostics.
    expect(meta.conversationId).toBe('conv-1')
  })

  it('attaches threading hints via internetMessageHeaders (Graph proxy for In-Reply-To)', async () => {
    const result = await convertOutboundForMicrosoft({
      body: 'reply',
      bodyFormat: 'text',
      channelMetadata: {
        to: ['bob@example.com'],
        inReplyTo: 'parent@example.com',
        references: ['root@example.com', 'parent@example.com'],
      },
      fromAddress: 'alice@outlook.com',
    })
    const headers = (result.metadata as unknown as MicrosoftEmailNativeMetadata).sendMailBody.message.internetMessageHeaders ?? []
    const names = headers.map((h) => h.name)
    expect(names).toContain('x-omc-in-reply-to')
    expect(names).toContain('x-omc-references')
    expect(headers.find((h) => h.name === 'x-omc-in-reply-to')?.value).toBe('<parent@example.com>')
  })

  it('rejects when there are no recipients', async () => {
    await expect(
      convertOutboundForMicrosoft({
        body: 'hi',
        bodyFormat: 'text',
        channelMetadata: {},
        fromAddress: 'alice@outlook.com',
      }),
    ).rejects.toThrow(/at least one recipient/i)
  })

  it('auto-generates a Message-ID rooted in the From address', async () => {
    const result = await convertOutboundForMicrosoft({
      body: 'hi',
      bodyFormat: 'text',
      channelMetadata: { to: ['bob@example.com'] },
      fromAddress: 'alice@outlook.com',
    })
    const generated = (result.metadata as unknown as MicrosoftEmailNativeMetadata).messageId
    expect(generated).toMatch(/^<[^@]+@outlook\.com>$/)
  })
})
