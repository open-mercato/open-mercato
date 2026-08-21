import crypto from 'node:crypto'
import type { NormalizedInboundMessage, NormalizedAttachment } from './adapter'
import { EMAIL_MAX_ATTACHMENT_BYTES } from './email-capabilities'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('communication_channels').child({ component: 'email-mime' })

/**
 * Aggregate ceiling for all attachments on a single inbound message. Inbound
 * mail is untrusted, so without a cap a malicious/large message would be fully
 * base64-buffered in memory (~1.33x raw bytes) and persisted. Allow a small
 * multiple of the per-attachment limit for legitimate multi-file emails.
 */
const TOTAL_INBOUND_ATTACHMENTS_MAX_BYTES = EMAIL_MAX_ATTACHMENT_BYTES * 2

/**
 * Shared email MIME helpers for the email channel providers (Gmail, IMAP).
 * Outbound assembly, inbound parsing, header/address normalization,
 * and threading-id extraction all live here so every provider shares one
 * correct implementation instead of copy-pasting (which previously let Gmail's
 * `extractHeaders` drift into a Map-handling bug that IMAP had already fixed).
 *
 * Provider-specific transport (Gmail History API, IMAP UID sync)
 * stays in each package — this module only owns the format-level plumbing.
 */

// ── Outbound MIME helpers ─────────────────────────────────────

export function stringOrUndefined(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

export function toAddressList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter((v) => v.length > 0)
  if (typeof value === 'string') {
    return value
      .split(/[,;]\s*/)
      .map((v) => v.trim())
      .filter((v) => v.length > 0)
  }
  return []
}

export function referencesFromMeta(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.filter((entry): entry is string => typeof entry === 'string')
}

/**
 * Strip every `<tag>…</tag>` block (and its contents) for a single tag name.
 * Inbound HTML is untrusted, so the matcher must resist evasion: the close tag
 * allows trailing attributes/whitespace (`</script >`, `</style foo>`), the `i`
 * flag covers mixed case, and the replacement loops until the string is stable
 * so a payload split across nested or reconstructed tags cannot survive a
 * single pass (`<scr<script>ipt>` collapsing back into `<script>`).
 *
 * The opening tag is also matched when it is truncated or never closed — a bare
 * `<script` or an unterminated `<script>…` running to end-of-input is removed
 * outright — so no prefix of the element name can leak into the output.
 */
function stripTagBlocks(html: string, tag: string): string {
  const blockPattern = new RegExp(
    `<${tag}\\b[^>]*(?:>[\\s\\S]*?(?:<\\/${tag}[^>]*>|$)|$)`,
    'gi',
  )
  let previous: string
  let current = html
  do {
    previous = current
    current = current.replace(blockPattern, ' ')
  } while (current !== previous)
  return current
}

/**
 * Drop HTML comments (`<!-- … -->`), including an unterminated comment running
 * to end-of-input. Comments are stripped first because they can wrap content
 * that would otherwise survive tag removal (`<!--<script-->`), and a naive
 * filter that ignores them leaves a tag fragment behind.
 */
function stripHtmlComments(html: string): string {
  return html.replace(/<!--[\s\S]*?(?:-->|$)/g, ' ')
}

const BASIC_HTML_ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&amp;': '&',
}

/**
 * Decode the handful of HTML entities we surface in plaintext in ONE
 * left-to-right pass. A single pass cannot double-unescape: characters produced
 * by a replacement (e.g. the `&` from `&amp;`) are never re-scanned, so
 * `&amp;lt;` decodes to the literal `&lt;` rather than collapsing into `<`.
 */
function decodeBasicEntities(input: string): string {
  return input.replace(
    /&(?:nbsp|lt|gt|quot|amp);/gi,
    (match) => BASIC_HTML_ENTITIES[match.toLowerCase()] ?? match,
  )
}

/**
 * Remove every remaining `<…>` tag, looping until the string is stable so a tag
 * reconstructed by a single pass (`<<div>div>`) cannot survive — the same
 * loop-until-stable shape `stripTagBlocks` uses. A raw `<` that is not part of a
 * tag (`a < b`) has no closing `>`, never matches, and is intentionally kept.
 */
function stripRemainingTags(html: string): string {
  let previous: string
  let current = html
  do {
    previous = current
    current = current.replace(/<[^>]*>/g, '')
  } while (current !== previous)
  return current
}

/**
 * Convert untrusted inbound HTML to plaintext. Entities are decoded FIRST so any
 * entity-encoded markup (e.g. `&lt;script&gt;`) is normalized into real tag
 * syntax before the strippers run — otherwise decoding last would reintroduce a
 * `<script` fragment into the final output after sanitization had finished
 * (CodeQL `js/incomplete-multi-character-sanitization`). After decoding, all
 * tag removal (script/style blocks, then remaining tags) happens via
 * loop-until-stable passes, so no `<tag` prefix can leak into the plaintext.
 */
export function htmlToText(html: string): string {
  const decoded = decodeBasicEntities(html)
  const stripped = stripTagBlocks(stripTagBlocks(stripHtmlComments(decoded), 'style'), 'script')
    .replace(/<br\s*\/?>(?=\s*)/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n\n')
  return stripRemainingTags(stripped)
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function escapeQuotes(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/**
 * Collapse CR/LF/TAB in an email header value to a single space to prevent
 * RFC 5322 header injection — e.g. a Subject smuggling an extra
 * `Bcc:`/`Content-Type:` header or splitting the message into a body.
 * Collapsing (rather than folding) is safe for the short structured headers
 * we emit (Subject, addresses, Message-ID, References).
 */
export function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n\t]+/g, ' ').trim()
}

export function ensureBrackets(value: string): string {
  const trimmed = sanitizeHeaderValue(value)
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) return trimmed
  return `<${trimmed}>`
}

function isPureAscii(value: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /^[\x00-\x7F]*$/.test(value)
}

/**
 * Encode a single header value as an RFC 2047 "B" (base64) encoded-word when it
 * contains non-ASCII characters, so 8-bit text like "Café" survives strict MTAs
 * that treat header bytes as 7-bit ASCII. Pure-ASCII values are returned
 * unchanged. Apply only AFTER `sanitizeHeaderValue` so the CR/LF injection guard
 * still runs against the raw value.
 */
export function encodeHeaderWord(value: string): string {
  if (isPureAscii(value)) return value
  return `=?utf-8?B?${Buffer.from(value, 'utf-8').toString('base64')}?=`
}

/**
 * Encode the display-name part of a single address header value, leaving the
 * `<addr@domain>` untouched (per RFC 2047, encoded-words are not permitted
 * inside the addr-spec). Inputs without a bracketed address are treated as a
 * bare display name / address and encoded only when non-ASCII.
 */
export function encodeAddressHeaderWord(value: string): string {
  if (isPureAscii(value)) return value
  const match = value.match(/^(.*?)(\s*<[^>]*>)\s*$/)
  if (match) {
    const [, displayPart, addrPart] = match
    const displayName = displayPart.replace(/^"|"$/g, '').trim()
    if (!displayName) return value
    return `${encodeHeaderWord(displayName)}${addrPart}`
  }
  return encodeHeaderWord(value)
}

/**
 * Generate an RFC 5322 Message-ID rooted in the sender's domain. Used as a
 * downstream idempotency key, so entropy comes from `crypto.randomUUID()`
 * rather than `Math.random()`.
 */
export function generateMessageId(fromAddress: string, fallbackDomain = 'localhost'): string {
  const domain = fromAddress.split('@')[1] ?? fallbackDomain
  return `<${crypto.randomUUID()}@${domain}>`
}

export interface AssembleRfc2822Input {
  from: string
  to: string[]
  cc: string[]
  bcc: string[]
  subject: string | undefined
  text: string | undefined
  html: string | undefined
  inReplyTo: string | undefined
  references: string[] | undefined
  messageId: string
}

/**
 * Render one MIME body part's CTE header + body content. Non-ASCII bodies are
 * base64-encoded (CRLF-wrapped at 76 cols) and labelled
 * `Content-Transfer-Encoding: base64` so 8-bit text survives strict MTAs;
 * pure-ASCII bodies stay `7bit` and verbatim.
 */
function encodeBodyPart(content: string): { cte: string; body: string } {
  if (isPureAscii(content)) return { cte: '7bit', body: content }
  const base64 = Buffer.from(content, 'utf-8').toString('base64')
  const wrapped = base64.match(/.{1,76}/g)?.join('\r\n') ?? base64
  return { cte: 'base64', body: wrapped }
}

/**
 * Assemble a raw RFC2822 message (used by transports that send the encoded
 * message directly, e.g. Gmail `users.messages.send`). Emits a
 * `multipart/alternative` body when both html and text are present, otherwise a
 * single-part text or html body.
 */
export function assembleRfc2822(input: AssembleRfc2822Input): Buffer {
  const boundary = `omc_${crypto.randomUUID()}`
  const headers: string[] = []
  headers.push(`From: ${encodeAddressHeaderWord(sanitizeHeaderValue(input.from))}`)
  headers.push(`To: ${input.to.map((value) => encodeAddressHeaderWord(sanitizeHeaderValue(value))).join(', ')}`)
  if (input.cc.length) headers.push(`Cc: ${input.cc.map((value) => encodeAddressHeaderWord(sanitizeHeaderValue(value))).join(', ')}`)
  if (input.bcc.length) headers.push(`Bcc: ${input.bcc.map((value) => encodeAddressHeaderWord(sanitizeHeaderValue(value))).join(', ')}`)
  if (input.subject) headers.push(`Subject: ${encodeHeaderWord(sanitizeHeaderValue(input.subject))}`)
  headers.push(`Message-ID: ${ensureBrackets(input.messageId)}`)
  if (input.inReplyTo) headers.push(`In-Reply-To: ${ensureBrackets(input.inReplyTo)}`)
  if (input.references && input.references.length) {
    headers.push(`References: ${input.references.map(ensureBrackets).join(' ')}`)
  }
  headers.push('MIME-Version: 1.0')
  headers.push(`Date: ${new Date().toUTCString()}`)

  if (input.html && input.text) {
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`)
    const textPart = encodeBodyPart(input.text)
    const htmlPart = encodeBodyPart(input.html)
    const body = [
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset=utf-8',
      `Content-Transfer-Encoding: ${textPart.cte}`,
      '',
      textPart.body,
      `--${boundary}`,
      'Content-Type: text/html; charset=utf-8',
      `Content-Transfer-Encoding: ${htmlPart.cte}`,
      '',
      htmlPart.body,
      `--${boundary}--`,
      '',
    ].join('\r\n')
    return Buffer.from(headers.join('\r\n') + body, 'utf-8')
  }

  if (input.html) {
    const htmlPart = encodeBodyPart(input.html)
    headers.push('Content-Type: text/html; charset=utf-8')
    headers.push(`Content-Transfer-Encoding: ${htmlPart.cte}`)
    return Buffer.from(headers.join('\r\n') + '\r\n\r\n' + htmlPart.body, 'utf-8')
  }

  const textPart = encodeBodyPart(input.text ?? '')
  headers.push('Content-Type: text/plain; charset=utf-8')
  headers.push(`Content-Transfer-Encoding: ${textPart.cte}`)
  return Buffer.from(headers.join('\r\n') + '\r\n\r\n' + textPart.body, 'utf-8')
}

// ── Inbound MIME parsing ──────────────────────────────────────

export interface ParsedMail {
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

export interface ParsedAttachment {
  content?: Buffer | Uint8Array
  contentType?: string
  filename?: string
  size?: number
  contentDisposition?: string
  cid?: string
}

export function stripBrackets(value: string | undefined | null): string | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) return trimmed.slice(1, -1)
  return trimmed
}

export function parseReferences(value: string | string[] | undefined | null): string[] {
  if (!value) return []
  if (Array.isArray(value)) return value.map((v) => stripBrackets(v)).filter((v): v is string => Boolean(v))
  return value
    .split(/\s+/)
    .map((segment) => stripBrackets(segment))
    .filter((segment): segment is string => Boolean(segment))
}

export function normalizeAttachments(attachments: ParsedAttachment[]): NormalizedAttachment[] {
  const out: NormalizedAttachment[] = []
  let totalBytes = 0
  for (const att of attachments) {
    if (!att.content) continue
    const byteLength = att.content.byteLength
    if (byteLength > EMAIL_MAX_ATTACHMENT_BYTES) {
      logger.warn('dropping oversized inbound attachment', { fileName: att.filename ?? 'attachment', bytes: byteLength, maxBytes: EMAIL_MAX_ATTACHMENT_BYTES })
      continue
    }
    if (totalBytes + byteLength > TOTAL_INBOUND_ATTACHMENTS_MAX_BYTES) {
      logger.warn('aggregate inbound attachment size exceeded; dropping remaining attachments', { maxBytes: TOTAL_INBOUND_ATTACHMENTS_MAX_BYTES })
      break
    }
    totalBytes += byteLength
    const base64 = Buffer.isBuffer(att.content)
      ? att.content.toString('base64')
      : Buffer.from(att.content).toString('base64')
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

/**
 * Flatten parsed MIME headers to a `Record<string, string>`.
 *
 * mailparser returns `headers` as a `Map<string, unknown>`. `Object.entries` on
 * a Map yields an empty array (Maps have no enumerable own properties), so we
 * iterate Map entries directly, with a Record fallback for test fakes.
 */
export function extractHeaders(headers: ParsedMail['headers']): Record<string, string> {
  if (!headers) return {}
  const out: Record<string, string> = {}
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

export interface NormalizeMimeInboundOptions {
  /**
   * The parsed MIME message. Providers parse with their own `mailparser`
   * dependency (Gmail/IMAP) and pass the result here, so the hub stays free of a
   * MIME-parser dependency while still owning the normalization logic.
   */
  parsed: ParsedMail
  /** External identifier of the receiving channel (typically the account's email). */
  accountIdentifier: string
  /** Deterministic id used when the MIME message carries no `Message-ID` header. */
  fallbackMessageId: string
  /** Compute the conversation grouping id from the resolved message id + references. */
  resolveConversationId: (context: { messageId: string; references: string[] }) => string
  /** Fallback timestamp when the parsed message has no Date header. */
  fallbackDate?: Date
  /** Provider-specific fields merged into `channelMetadata`. */
  channelMetadata?: (parsed: ParsedMail) => Record<string, unknown>
  /** Provider-specific fields merged into `channelPayload`. */
  channelPayload?: (parsed: ParsedMail) => Record<string, unknown>
}

/**
 * Build the hub's canonical `NormalizedInboundMessage` from a parsed MIME
 * message. Providers supply the bits that genuinely differ (message-id
 * fallback, conversation grouping, extra metadata) and inherit the shared
 * threading / attachment / header logic.
 */
export function normalizeMimeInbound(options: NormalizeMimeInboundOptions): NormalizedInboundMessage {
  const { parsed } = options

  const messageId = stripBrackets(parsed.messageId) ?? options.fallbackMessageId
  const inReplyTo = stripBrackets(parsed.inReplyTo)
  const references = parseReferences(parsed.references)
  const conversationId = options.resolveConversationId({ messageId, references })

  const from = parsed.from?.value?.[0]
  const subject = parsed.subject?.trim() || undefined
  const bodyHtml = parsed.html && typeof parsed.html === 'string' ? parsed.html : undefined
  const bodyText = typeof parsed.text === 'string' ? parsed.text : undefined
  const body = bodyHtml ?? bodyText ?? ''
  const bodyFormat: 'text' | 'html' = bodyHtml ? 'html' : 'text'

  const attachments = normalizeAttachments(parsed.attachments ?? [])

  const channelMetadata: Record<string, unknown> = {
    ...(options.channelMetadata?.(parsed) ?? {}),
    messageId,
    inReplyTo: inReplyTo ?? null,
    references,
    headers: extractHeaders(parsed.headers),
  }

  const channelPayload: Record<string, unknown> = {
    subject,
    from: from ? { address: from.address, name: from.name } : null,
    to: parsed.to?.value ?? [],
    cc: parsed.cc?.value ?? [],
    bcc: parsed.bcc?.value ?? [],
    html: bodyHtml ?? null,
    text: bodyText ?? null,
    messageId,
    ...(options.channelPayload?.(parsed) ?? {}),
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
    channelPayload,
    channelContentType: 'email/mime',
    channelMetadata,
  }
}

// ── Provider sync cursor helpers ──────────────────────────────

/** Encode a provider channel-state object into an opaque base64 sync cursor. */
export function encodeCursor(state: unknown): string {
  return Buffer.from(JSON.stringify(state)).toString('base64')
}

/** Decode a base64 sync cursor back into its object form, or `null` if malformed. */
export function decodeCursor(value: string | null | undefined): unknown {
  if (!value) return null
  try {
    return JSON.parse(Buffer.from(value, 'base64').toString('utf-8'))
  } catch {
    return null
  }
}
