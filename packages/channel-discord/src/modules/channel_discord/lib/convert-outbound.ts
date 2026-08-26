import type {
  ChannelNativeContent,
  ConvertOutboundInput,
} from '@open-mercato/core/modules/communication_channels/lib/adapter'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { DISCORD_MAX_BODY_LENGTH } from './capabilities'

const logger = createLogger('channel_discord').child({ component: 'convert-outbound' })

/**
 * Very small HTML → markdown down-converter for the common inline tags the hub's
 * `html` body format produces. Discord content is markdown-native, so we map the
 * handful of tags that have a markdown equivalent and strip the rest rather than
 * pulling in a full HTML parser dependency.
 */
function htmlToMarkdown(html: string): string {
  return html
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*\/\s*p\s*>/gi, '\n\n')
    .replace(/<\s*p[^>]*>/gi, '')
    .replace(/<\s*(strong|b)\s*>(.*?)<\s*\/\s*\1\s*>/gis, '**$2**')
    .replace(/<\s*(em|i)\s*>(.*?)<\s*\/\s*\1\s*>/gis, '*$2*')
    .replace(/<\s*code\s*>(.*?)<\s*\/\s*code\s*>/gis, '`$1`')
    .replace(/<\s*a[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\s*\/\s*a\s*>/gis, '[$2]($1)')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Convert the hub's normalized outbound body into Discord native content.
 *
 * - `markdown` / `text` pass through unchanged (Discord is markdown-native).
 * - `html` is down-converted to markdown.
 * - Content is clamped to Discord's 2000-char hard limit (a longer body is
 *   truncated with an ellipsis marker rather than rejected by the API).
 * - `allowed_mentions` defaults to `{ parse: [] }` so an AI/automated reply can
 *   never accidentally @-ping everyone; callers can widen it via `channelMetadata`.
 * - Attachments are NOT uploaded: `discord-rest` has no multipart upload, so the
 *   capability profile declares `fileSharing: false` and the hub should never
 *   route an attachment here. If one arrives anyway we log it rather than drop
 *   it silently, and report the count in `metadata.droppedAttachmentCount` so the
 *   caller can surface the gap.
 */
export async function convertOutboundForDiscord(input: ConvertOutboundInput): Promise<ChannelNativeContent> {
  const droppedAttachmentCount = input.attachments?.length ?? 0
  if (droppedAttachmentCount > 0) {
    logger.warn('discord outbound attachments are not supported — sending text only', {
      droppedAttachmentCount,
    })
  }

  const raw = input.body ?? ''
  const markdown = input.bodyFormat === 'html' ? htmlToMarkdown(raw) : raw

  const TRUNCATE_MARKER = '…'
  const content =
    markdown.length > DISCORD_MAX_BODY_LENGTH
      ? markdown.slice(0, DISCORD_MAX_BODY_LENGTH - TRUNCATE_MARKER.length) + TRUNCATE_MARKER
      : markdown

  const allowedMentions =
    (input.channelMetadata?.allowedMentions as Record<string, unknown> | undefined) ?? { parse: [] }

  return {
    content: {
      text: content,
      bodyFormat: 'markdown',
    },
    metadata: {
      allowedMentions,
      droppedAttachmentCount,
      // Reply threading: the hub writes `replyToExternalId` on the outbound path
      // (`communication_channels/lib/outbound-reply-ref.ts`) when the message
      // being delivered answers one that already reached this channel. Absent on
      // a non-reply, which sends a plain channel message.
      messageReferenceId:
        typeof input.channelMetadata?.replyToExternalId === 'string'
          ? (input.channelMetadata.replyToExternalId as string)
          : undefined,
    },
  }
}
