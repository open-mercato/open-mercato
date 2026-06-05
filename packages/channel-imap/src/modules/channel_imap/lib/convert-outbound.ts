import type {
  ChannelNativeContent,
  ConvertOutboundInput,
} from '@open-mercato/core/modules/communication_channels/lib/adapter'
import {
  htmlToText,
  referencesFromMeta,
  sanitizeHeaderValue,
  stringOrUndefined,
  toAddressList,
} from '@open-mercato/core/modules/communication_channels/lib/email-mime'

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

export async function convertOutboundForEmail(
  input: ConvertOutboundInput,
): Promise<ChannelNativeContent> {
  const meta = (input.channelMetadata ?? {}) as Record<string, unknown>
  // Defense-in-depth: strip CR/LF/tab from every header-shaped field so a crafted
  // subject or recipient cannot smuggle an extra header (e.g. a hidden Bcc),
  // instead of relying solely on the downstream SMTP composer to neutralize it.
  const sanitizeOptionalHeader = (value: string | undefined): string | undefined =>
    value === undefined ? undefined : sanitizeHeaderValue(value)
  const subject = sanitizeOptionalHeader(stringOrUndefined(meta.subject))
  const to = toAddressList(meta.to).map(sanitizeHeaderValue)
  if (to.length === 0) {
    throw new Error('Email outbound conversion requires at least one recipient (channelMetadata.to)')
  }
  const cc = toAddressList(meta.cc).map(sanitizeHeaderValue)
  const bcc = toAddressList(meta.bcc).map(sanitizeHeaderValue)
  const inReplyTo = sanitizeOptionalHeader(stringOrUndefined(meta.inReplyTo))
  const references = referencesFromMeta(meta.references)?.map(sanitizeHeaderValue)
  const messageId = sanitizeOptionalHeader(stringOrUndefined(meta.messageId))

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
