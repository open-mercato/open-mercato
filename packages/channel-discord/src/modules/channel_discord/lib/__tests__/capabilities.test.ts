import { discordCapabilities, DISCORD_MAX_BODY_LENGTH } from '../capabilities'
import { getDiscordRestClient } from '../discord-rest'
import { convertOutboundForDiscord } from '../convert-outbound'

/**
 * The hub routes work to the adapter based on these flags, so a capability that
 * nothing implements is not cosmetic — it makes the hub hand this provider work
 * it silently drops. Each assertion below is pinned to the code that would have
 * to land before the flag may flip.
 */
describe('discordCapabilities honesty', () => {
  it('does not advertise outbound file sharing while attachments are dropped', async () => {
    expect(discordCapabilities.fileSharing).toBe(false)
    expect(discordCapabilities.inlineImages).toBe(false)
    expect(discordCapabilities.maxFileSize).toBeUndefined()
    expect(discordCapabilities.supportedMimeTypes).toBeUndefined()

    const native = await convertOutboundForDiscord({
      body: 'hello',
      bodyFormat: 'text',
      attachments: [{ filename: 'a.png', contentType: 'image/png', size: 12, url: 'https://example/a.png' }],
    } as Parameters<typeof convertOutboundForDiscord>[0])
    expect(native.metadata?.droppedAttachmentCount).toBe(1)

    const restClient = getDiscordRestClient() as unknown as Record<string, unknown>
    expect(restClient.uploadAttachment).toBeUndefined()
  })

  it('does not advertise typing, presence or stickers — none of them are implemented', () => {
    expect(discordCapabilities.typingIndicators).toBe(false)
    expect(discordCapabilities.presence).toBe(false)
    expect(discordCapabilities.stickers).toBe(false)
  })

  it('does not advertise rich blocks or interactive components while the endpoint only defers', () => {
    expect(discordCapabilities.richBlocks).toBe(false)
    expect(discordCapabilities.interactiveComponents).toBe(false)
  })

  it('keeps the capabilities that are actually backed by adapter methods', () => {
    expect(discordCapabilities.threading).toBe(true)
    expect(discordCapabilities.richText).toBe(true)
    expect(discordCapabilities.reactions).toBe(true)
    expect(discordCapabilities.editMessage).toBe(true)
    expect(discordCapabilities.deleteMessage).toBe(true)
    expect(discordCapabilities.conversationHistory).toBe(true)
    expect(discordCapabilities.realtimePush).toBe(true)
    expect(discordCapabilities.supportedBodyFormats).toEqual(['text', 'markdown'])
    expect(discordCapabilities.maxBodyLength).toBe(DISCORD_MAX_BODY_LENGTH)
  })
})
