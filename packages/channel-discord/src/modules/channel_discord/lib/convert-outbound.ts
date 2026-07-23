import type {
  ChannelNativeContent,
  ConvertOutboundInput,
} from '@open-mercato/core/modules/communication_channels/lib/adapter'
import { DISCORD_MAX_BODY_LENGTH } from './capabilities'

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
 */
export async function convertOutboundForDiscord(input: ConvertOutboundInput): Promise<ChannelNativeContent> {
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
      // Reply threading: the hub's outbound metadata may carry the id of the
      // Discord message we're replying to.
      messageReferenceId:
        typeof input.channelMetadata?.replyToExternalId === 'string'
          ? (input.channelMetadata.replyToExternalId as string)
          : undefined,
    },
  }
}
