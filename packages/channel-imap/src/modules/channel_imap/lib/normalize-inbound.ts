import type { NormalizedInboundMessage, NormalizedAttachment } from '@open-mercato/core/modules/communication_channels/lib/adapter'

/**
 * Convert a raw RFC2822 MIME buffer (delivered by IMAP fetch) to the hub's
 * canonical `NormalizedInboundMessage`. Wraps `mailparser` so the adapter can
 * stay agnostic of the parsing library.
 *
 * Threading:
 *   - `externalMessageId`     := MIME `Message-ID` header (RFC2822). Required by
 *     IMAP/SMTP; if missing we fall back to `imap:<uid>@<account>` so downstream
 *     idempotency still has a deterministic key.
 *   - `replyToExternalId`     := `In-Reply-To` header (single value).
 *   - `externalConversationId` := the root of the References chain when present,
 *     otherwise the message id itself (single-message thread).
 *
 * The hub uses these three fields to build `ChannelThreadMapping` and place the
 * message under the correct `MessageThread` via `In-Reply-To` lookup.
 */

export interface NormalizeInboundOptions {
  rawMessage: Buffer
  /** UID from the IMAP fetch — embedded into `channelMetadata.uid` for diagnostics. */
  uid?: number
  /** External identifier of the receiving channel (typically the account's email). */
  accountIdentifier: string
  /** Fallback timestamp if the parsed message has no Date header. */
  fallbackDate?: Date
}

export async function normalizeInboundImapMessage(
  options: NormalizeInboundOptions,
): Promise<NormalizedInboundMessage> {
  const mailparser = (await import('mailparser')) as unknown as {
    simpleParser: (buf: Buffer | string) => Promise<ParsedMail>
  }
  const parsed = await mailparser.simpleParser(options.rawMessage)

  const messageId = stripBrackets(parsed.messageId) ?? `imap:${options.uid ?? 'unknown'}@${options.accountIdentifier}`
  const inReplyTo = stripBrackets(parsed.inReplyTo)
  const references = parseReferences(parsed.references)
  const conversationId = references[0] ?? messageId

  const from = parsed.from?.value?.[0]
  const subject = parsed.subject?.trim() || undefined
  const bodyHtml = parsed.html && typeof parsed.html === 'string' ? parsed.html : undefined
  const bodyText = typeof parsed.text === 'string' ? parsed.text : undefined
  const body = bodyHtml ?? bodyText ?? ''
  const bodyFormat = bodyHtml ? 'html' : 'text'

  const attachments = normalizeAttachments(parsed.attachments ?? [])

  const channelMetadata: Record<string, unknown> = {
    uid: options.uid,
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
  // mailparser returns `headers` as a `Map<string, unknown>`. Using
  // `Object.entries` on a Map returns an empty array (Maps don't have enumerable
  // own properties), so all inbound channelMetadata.headers ended up `{}`.
  // Iterate the Map entries directly, with a Record fallback for test fakes.
  if (headers instanceof Map) {
    for (const [key, value] of headers.entries()) {
      const stringified = stringifyHeaderValue(value)
      if (stringified !== undefined) out[String(key)] = stringified
    }
    return out
  }
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    const stringified = stringifyHeaderValue(value)
    if (stringified !== undefined) out[key] = stringified
  }
  return out
}

function stringifyHeaderValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map((v) => String(v)).join(', ')
  if (value instanceof Date) return value.toISOString()
  if (value && typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return undefined
    }
  }
  if (value === undefined || value === null) return undefined
  return String(value)
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
