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
})
