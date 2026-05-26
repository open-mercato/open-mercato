import type {
  ChannelNativeContent,
  ConvertOutboundInput,
} from '@open-mercato/core/modules/communication_channels/lib/adapter'

/**
 * Convert a hub-canonical outbound payload to a Gmail-ready native content shape.
 *
 * Unlike IMAP/SMTP (which hands the message to nodemailer), the Gmail adapter
 * builds the RFC2822 message itself and sends via `gmail.users.messages.send`.
 * The converter pre-builds the raw message so `sendMessage` is a pure
 * "base64url-encode + POST" call, with no SMTP transport involved.
 *
 * Output metadata fields:
 *   - rawMessage: Buffer  — the assembled RFC2822 message
 *   - threadId: string?   — Gmail thread id (channelMetadata.gmailThreadId)
 *   - subject / to / cc / bcc / inReplyTo / references — diagnostic copies
 */

export interface GmailEmailNativeMetadata {
  subject?: string
  to: string[]
  cc?: string[]
  bcc?: string[]
  inReplyTo?: string
  references?: string[]
  messageId?: string
  threadId?: string
  fromAddress: string
  fromName?: string
  rawMessage: Buffer
}

export interface ConvertOutboundForGmailInput extends ConvertOutboundInput {
  fromAddress: string
  fromName?: string
}

export async function convertOutboundForGmail(
  input: ConvertOutboundForGmailInput,
): Promise<ChannelNativeContent> {
  const meta = (input.channelMetadata ?? {}) as Record<string, unknown>
  const subject = stringOrUndefined(meta.subject)
  const to = toAddressList(meta.to)
  if (to.length === 0) {
    throw new Error('Gmail outbound conversion requires at least one recipient (channelMetadata.to)')
  }
  const cc = toAddressList(meta.cc)
  const bcc = toAddressList(meta.bcc)
  const inReplyTo = stringOrUndefined(meta.inReplyTo)
  const references = Array.isArray(meta.references)
    ? meta.references.filter((v): v is string => typeof v === 'string')
    : undefined
  const messageId = stringOrUndefined(meta.messageId) ?? generateMessageId(input.fromAddress)
  const threadId = stringOrUndefined(meta.gmailThreadId)

  const html = input.bodyFormat === 'html' ? input.body : undefined
  const text = input.bodyFormat === 'html' ? htmlToText(input.body) : input.body

  const rawMessage = assembleRfc2822({
    from: input.fromName ? `"${escapeQuotes(input.fromName)}" <${input.fromAddress}>` : input.fromAddress,
    to,
    cc,
    bcc,
    subject,
    text,
    html,
    inReplyTo,
    references,
    messageId,
  })

  const metadata: GmailEmailNativeMetadata = {
    subject,
    to,
    cc: cc.length ? cc : undefined,
    bcc: bcc.length ? bcc : undefined,
    inReplyTo,
    references,
    messageId,
    threadId,
    fromAddress: input.fromAddress,
    fromName: input.fromName,
    rawMessage,
  }

  return {
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
        threadId,
      },
    },
    metadata: metadata as unknown as Record<string, unknown>,
  }
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

function escapeQuotes(value: string): string {
  return value.replace(/"/g, '\\"')
}

function generateMessageId(fromAddress: string): string {
  const domain = fromAddress.split('@')[1] ?? 'gmail.com'
  const random = Math.random().toString(36).slice(2) + Date.now().toString(36)
  return `<${random}@${domain}>`
}

interface AssembleRfc2822Input {
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

function assembleRfc2822(input: AssembleRfc2822Input): Buffer {
  const boundary = `omc_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`
  const headers: string[] = []
  headers.push(`From: ${input.from}`)
  headers.push(`To: ${input.to.join(', ')}`)
  if (input.cc.length) headers.push(`Cc: ${input.cc.join(', ')}`)
  if (input.bcc.length) headers.push(`Bcc: ${input.bcc.join(', ')}`)
  if (input.subject) headers.push(`Subject: ${input.subject}`)
  headers.push(`Message-ID: ${input.messageId.startsWith('<') ? input.messageId : `<${input.messageId}>`}`)
  if (input.inReplyTo) headers.push(`In-Reply-To: ${ensureBrackets(input.inReplyTo)}`)
  if (input.references && input.references.length) {
    headers.push(`References: ${input.references.map(ensureBrackets).join(' ')}`)
  }
  headers.push('MIME-Version: 1.0')
  headers.push(`Date: ${new Date().toUTCString()}`)

  if (input.html && input.text) {
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`)
    const body = [
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: 7bit',
      '',
      input.text,
      `--${boundary}`,
      'Content-Type: text/html; charset=utf-8',
      'Content-Transfer-Encoding: 7bit',
      '',
      input.html,
      `--${boundary}--`,
      '',
    ].join('\r\n')
    return Buffer.from(headers.join('\r\n') + body, 'utf-8')
  }

  if (input.html) {
    headers.push('Content-Type: text/html; charset=utf-8')
    headers.push('Content-Transfer-Encoding: 7bit')
    return Buffer.from(headers.join('\r\n') + '\r\n\r\n' + input.html, 'utf-8')
  }

  headers.push('Content-Type: text/plain; charset=utf-8')
  headers.push('Content-Transfer-Encoding: 7bit')
  return Buffer.from(headers.join('\r\n') + '\r\n\r\n' + (input.text ?? ''), 'utf-8')
}

function ensureBrackets(value: string): string {
  const trimmed = value.trim()
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) return trimmed
  return `<${trimmed}>`
}
