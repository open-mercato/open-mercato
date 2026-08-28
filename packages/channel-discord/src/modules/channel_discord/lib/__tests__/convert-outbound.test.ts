import { convertOutboundForDiscord } from '../convert-outbound'

describe('convertOutboundForDiscord', () => {
  it('passes markdown through unchanged', async () => {
    const result = await convertOutboundForDiscord({ body: '**bold** and _em_', bodyFormat: 'markdown' })
    expect(result.content.text).toBe('**bold** and _em_')
    expect(result.content.bodyFormat).toBe('markdown')
  })

  it('down-converts basic HTML to markdown', async () => {
    const result = await convertOutboundForDiscord({
      body: '<p>Hello <strong>world</strong> <a href="https://x.test">link</a></p>',
      bodyFormat: 'html',
    })
    expect(result.content.text).toContain('**world**')
    expect(result.content.text).toContain('[link](https://x.test)')
    expect(result.content.text).not.toContain('<')
  })

  it('clamps content to the 2000-char limit', async () => {
    const result = await convertOutboundForDiscord({ body: 'x'.repeat(5000), bodyFormat: 'text' })
    expect((result.content.text ?? '').length).toBe(2000)
    expect(result.content.text?.endsWith('…')).toBe(true)
  })

  it('defaults allowed_mentions to none to prevent accidental @-everyone', async () => {
    const result = await convertOutboundForDiscord({ body: '@everyone hi', bodyFormat: 'text' })
    expect(result.metadata?.allowedMentions).toEqual({ parse: [] })
  })

  it('carries reply-to id into metadata for threaded replies', async () => {
    const result = await convertOutboundForDiscord({
      body: 'reply',
      bodyFormat: 'text',
      channelMetadata: { replyToExternalId: 'msg-42' },
    })
    expect(result.metadata?.messageReferenceId).toBe('msg-42')
  })

  it('keeps the reply reference through the hub convert→send double-conversion', async () => {
    // `deliver-outbound-message.ts` converts once, then hands `converted.metadata`
    // to `sendMessage`, which converts again. The second pass never sees the hub's
    // `replyToExternalId` — only our own renamed `messageReferenceId` — so a
    // one-way rename silently drops the reference before it reaches Discord
    // (#5541). Feed the first pass's output back in and the id must survive.
    const first = await convertOutboundForDiscord({
      body: 'reply',
      bodyFormat: 'text',
      channelMetadata: { replyToExternalId: 'msg-42' },
    })
    const second = await convertOutboundForDiscord({
      body: first.content.text ?? '',
      bodyFormat: 'markdown',
      channelMetadata: first.metadata,
    })
    expect(second.metadata?.messageReferenceId).toBe('msg-42')
  })

  it('lets the hub-resolved reference outrank a stale already-converted one', async () => {
    // Only reachable if a caller round-trips metadata from an earlier message,
    // but the precedence has to be the safe one: `replyToExternalId` is resolved
    // by the hub against the message actually being delivered.
    const result = await convertOutboundForDiscord({
      body: 'reply',
      bodyFormat: 'text',
      channelMetadata: { replyToExternalId: 'msg-42', messageReferenceId: 'stale-7' },
    })
    expect(result.metadata?.messageReferenceId).toBe('msg-42')
  })

  it('leaves a non-reply without a reference', async () => {
    const result = await convertOutboundForDiscord({
      body: 'plain',
      bodyFormat: 'text',
      channelMetadata: { inReplyTo: 'header-threaded', references: ['header-threaded'] },
    })
    expect(result.metadata?.messageReferenceId).toBeUndefined()
  })
})
