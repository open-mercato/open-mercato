import type { NormalizedInboundMessage, NormalizedAttachment } from '@open-mercato/core/modules/communication_channels/lib/adapter'

/**
 * Convert a Gmail `messages.get?format=raw` response to the hub's canonical
 * `NormalizedInboundMessage`. Gmail returns the full RFC2822 message base64url-encoded,
 * so we re-use `mailparser` (same library the IMAP provider uses) for the parsing
 * heavy lifting and then layer in Gmail-specific metadata (`threadId`, `labelIds`,
 * Gmail message id).
 *
 * Threading uses Gmail's `threadId` first (more reliable than In-Reply-To inside
 * Gmail's mailbox), with In-Reply-To as a fallback for the conversation root id.
 */

export interface NormalizeInboundGmailOptions {
  rawMessage: Buffer
  gmailMessageId: string
  gmailThreadId: string
  gmailLabelIds?: string[]
  accountIdentifier: string
  fallbackDate?: Date
}

export async function normalizeInboundGmailMessage(
  options: NormalizeInboundGmailOptions,
): Promise<NormalizedInboundMessage> {
  const mailparser = (await import('mailparser')) as unknown as {
    simpleParser: (buf: Buffer | string) => Promise<ParsedMail>
  }
  const parsed = await mailparser.simpleParser(options.rawMessage)

  const messageId = stripBrackets(parsed.messageId) ?? `gmail:${options.gmailMessageId}@${options.accountIdentifier}`
  const inReplyTo = stripBrackets(parsed.inReplyTo)
  const references = parseReferences(parsed.references)
  // Gmail's threadId is authoritative for conversation grouping.
  const conversationId = `gmail-thread:${options.gmailThreadId}`

  const from = parsed.from?.value?.[0]
  const subject = parsed.subject?.trim() || undefined
  const bodyHtml = parsed.html && typeof parsed.html === 'string' ? parsed.html : undefined
  const bodyText = typeof parsed.text === 'string' ? parsed.text : undefined
  const body = bodyHtml ?? bodyText ?? ''
  const bodyFormat = bodyHtml ? 'html' : 'text'

  const attachments = normalizeAttachments(parsed.attachments ?? [])

  const channelMetadata: Record<string, unknown> = {
    gmailMessageId: options.gmailMessageId,
    gmailThreadId: options.gmailThreadId,
    gmailLabelIds: options.gmailLabelIds ?? [],
    messageId,
    inReplyTo: inReplyTo ?? null,
    references,
    headers: extractHeaders(parsed.headers),
  }

  return {
    externalMessageId: messageId,
    externalConversationId: conversationId,
    senderIdentifier: from?.address ?? options.accountIdentifier,
    senderDisplayName: from?.name?.trim() || undefined,
    subject,
    body,
    bodyFormat,
    attachments,
    timestamp: parsed.date ? new Date(parsed.date) : options.fallbackDate ?? new Date(),
    replyToExternalId: inReplyTo ?? undefined,
    channelPayload: {
      subject,
      from: from ? { address: from.address, name: from.name } : null,
      to: parsed.to?.value ?? [],
      cc: parsed.cc?.value ?? [],
      bcc: parsed.bcc?.value ?? [],
      html: bodyHtml ?? null,
      text: bodyText ?? null,
      messageId,
      gmailMessageId: options.gmailMessageId,
      gmailThreadId: options.gmailThreadId,
      gmailLabelIds: options.gmailLabelIds ?? [],
    },
    channelContentType: 'email/mime',
    channelMetadata,
  }
}

function stripBrackets(value: string | undefined | null): string | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) return trimmed.slice(1, -1)
  return trimmed
}

function parseReferences(value: string | string[] | undefined | null): string[] {
  if (!value) return []
  if (Array.isArray(value)) return value.map((v) => stripBrackets(v)).filter((v): v is string => Boolean(v))
  return value
    .split(/\s+/)
    .map((segment) => stripBrackets(segment))
    .filter((segment): segment is string => Boolean(segment))
}

function normalizeAttachments(attachments: ParsedAttachment[]): NormalizedAttachment[] {
  const out: NormalizedAttachment[] = []
  for (const att of attachments) {
    if (!att.content) continue
    const base64 = Buffer.isBuffer(att.content) ? att.content.toString('base64') : Buffer.from(att.content).toString('base64')
    out.push({
      url: `data:${att.contentType ?? 'application/octet-stream'};base64,${base64}`,
      mimeType: att.contentType ?? 'application/octet-stream',
      fileName: att.filename ?? 'attachment',
      fileSize: att.size,
      inline: Boolean(att.contentDisposition && /inline/i.test(att.contentDisposition)) || Boolean(att.cid),
    })
  }
  return out
}

function extractHeaders(headers: ParsedMail['headers']): Record<string, string> {
  if (!headers) return {}
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    if (typeof value === 'string') out[key] = value
    else if (Array.isArray(value)) out[key] = value.map((v) => String(v)).join(', ')
    else if (value && typeof value === 'object') out[key] = JSON.stringify(value)
  }
  return out
}

interface ParsedMail {
  messageId?: string | null
  inReplyTo?: string | null
  references?: string | string[] | null
  from?: { value?: Array<{ address?: string; name?: string }> }
  to?: { value?: Array<{ address?: string; name?: string }> }
  cc?: { value?: Array<{ address?: string; name?: string }> }
  bcc?: { value?: Array<{ address?: string; name?: string }> }
  subject?: string | null
  html?: string | false
  text?: string
  date?: string | Date | null
  attachments?: ParsedAttachment[]
  headers?: Map<string, unknown> | Record<string, unknown>
}

interface ParsedAttachment {
  content?: Buffer | Uint8Array
  contentType?: string
  filename?: string
  size?: number
  contentDisposition?: string
  cid?: string
}
