import type {
  ChannelNativeContent,
  ConvertOutboundInput,
} from '@open-mercato/core/modules/communication_channels/lib/adapter'

/**
 * Convert a hub-canonical outbound payload to an email-shaped `ChannelNativeContent`.
 *
 * Subject and threading headers come from `channelMetadata` populated by the hub:
 *   - `subject` (string)
 *   - `to` / `cc` / `bcc` (string | string[])
 *   - `inReplyTo` (string)
 *   - `references` (string[])
 *
 * Body format:
 *   - `'html'` keeps the HTML body as-is, derives plain-text via a naive strip.
 *   - `'text'` produces text-only.
 *   - `'markdown'` is not supported by email; we treat it as text (the hub limits
 *     `supportedBodyFormats` to ['text','html'] so this should not occur in practice).
 */

export interface EmailNativeMetadata {
  subject?: string
  to: string[]
  cc?: string[]
  bcc?: string[]
  inReplyTo?: string
  references?: string[]
  messageId?: string
}

export async function convertOutboundForEmail(
  input: ConvertOutboundInput,
): Promise<ChannelNativeContent> {
  const meta = (input.channelMetadata ?? {}) as Record<string, unknown>
  const subject = stringOrUndefined(meta.subject)
  const to = toAddressList(meta.to)
  if (to.length === 0) {
    throw new Error('Email outbound conversion requires at least one recipient (channelMetadata.to)')
  }
  const cc = toAddressList(meta.cc)
  const bcc = toAddressList(meta.bcc)
  const inReplyTo = stringOrUndefined(meta.inReplyTo)
  const references = Array.isArray(meta.references)
    ? meta.references.filter((v): v is string => typeof v === 'string')
    : undefined
  const messageId = stringOrUndefined(meta.messageId)

  const html = input.bodyFormat === 'html' ? input.body : undefined
  const text = input.bodyFormat === 'html' ? htmlToText(input.body) : input.body

  const native: ChannelNativeContent = {
    content: {
      text,
      html,
      bodyFormat: input.bodyFormat,
      attachments: input.attachments,
      raw: {
        subject,
        to,
        cc,
        bcc,
        inReplyTo,
        references,
        messageId,
      },
    },
    metadata: {
      subject,
      to,
      cc,
      bcc,
      inReplyTo,
      references,
      messageId,
    },
  }
  return native
}

function stringOrUndefined(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function toAddressList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter((v) => v.length > 0)
  if (typeof value === 'string') {
    return value
      .split(/[,;]\s*/)
      .map((v) => v.trim())
      .filter((v) => v.length > 0)
  }
  return []
}

function htmlToText(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>(?=\s*)/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
