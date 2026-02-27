import { createHash } from 'node:crypto'
import type { InboxEmail, ThreadMessage } from '../data/entities'
import { htmlToPlainText } from './htmlToPlainText'

export interface ParsedEmail {
  messageId?: string | null
  from: { name?: string; email: string }
  to: { name?: string; email: string }[]
  subject: string
  replyTo?: string | null
  inReplyTo?: string | null
  references?: string[] | null
  rawText?: string | null
  rawHtml?: string | null
  cleanedText: string
  threadMessages: ThreadMessage[]
  detectedLanguage?: string | null
  contentHash: string
}

const SIGNATURE_PATTERNS = [
  /^--\s*$/m,
  /^Sent from my (iPhone|iPad|Android|Galaxy|Samsung|Pixel)/m,
  /^Get Outlook for/m,
  /^_{10,}/m,
  /^Regards,?\s*$/m,
  /^Best,?\s*$/m,
  /^Thanks,?\s*$/m,
  /^Cheers,?\s*$/m,
  /^Kind regards,?\s*$/m,
  /^Best regards,?\s*$/m,
]

const QUOTE_PATTERNS = [
  /^On .+ wrote:\s*$/m,
  /^>+\s/m,
  /^From:\s/m,
  /^-{3,}\s*Original Message\s*-{3,}/m,
  /^-{3,}\s*Forwarded message\s*-{3,}/m,
  /^Begin forwarded message:/m,
]

const DATE_HEADER_PATTERN = /^Date:\s*(.+)$/m

function stripSignature(text: string): string {
  const lines = text.split('\n')
  let cutIndex = lines.length
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    if (SIGNATURE_PATTERNS.some((p) => p.test(line))) {
      cutIndex = i
      break
    }
  }
  return lines.slice(0, cutIndex).join('\n').trimEnd()
}

function stripQuotedReplies(text: string): string {
  const lines = text.split('\n')
  const cleanLines: string[] = []
  let inQuote = false

  for (const line of lines) {
    if (QUOTE_PATTERNS.some((p) => p.test(line))) {
      inQuote = true
      continue
    }
    if (inQuote && line.startsWith('>')) {
      continue
    }
    if (inQuote && line.trim() === '') {
      continue
    }
    if (inQuote && !line.startsWith('>') && line.trim().length > 0) {
      inQuote = false
    }
    if (!inQuote) {
      cleanLines.push(line)
    }
  }

  return cleanLines.join('\n').trimEnd()
}

function stripHtml(html: string): string {
  return htmlToPlainText(html)
}

function normalizeText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/ {2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function generateContentHash(subject: string, from: string, text: string): string {
  const input = `${subject}|${from}|${text.slice(0, 500)}`
  const normalized = input.toLowerCase().replace(/\s+/g, ' ').trim()
  return createHash('sha256').update(normalized).digest('hex')
}

function parseAddressField(value: string | undefined | null): { name?: string; email: string } {
  if (!value) return { email: '' }
  const match = value.match(/^(.+?)\s*<([^>]+)>$/)
  if (match) {
    return { name: match[1].trim().replace(/^["']|["']$/g, ''), email: match[2].trim().toLowerCase() }
  }
  return { email: value.trim().toLowerCase() }
}

function parseAddressListField(value: string | string[] | undefined | null): { name?: string; email: string }[] {
  if (!value) return []
  const list = Array.isArray(value) ? value : value.split(',')
  return list.map((v) => parseAddressField(v.trim())).filter((a) => a.email)
}

function parseDateFromBlock(block: string): string {
  const match = block.match(DATE_HEADER_PATTERN)
  if (match) {
    const parsed = new Date(match[1].trim())
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString()
    }
  }
  return new Date().toISOString()
}

function parseInlineHeaders(block: string): {
  from: { name?: string; email: string }
  to: { name?: string; email: string }[]
  subject?: string
  bodyStart: number
} {
  const lines = block.split('\n')
  let from: { name?: string; email: string } = { email: '' }
  let to: { name?: string; email: string }[] = []
  let subject: string | undefined
  let lastHeaderLine = -1

  for (let i = 0; i < lines.length && i < 10; i++) {
    const line = lines[i]
    const fromMatch = line.match(/^From:\s*(.+)$/i)
    if (fromMatch) {
      from = parseAddressField(fromMatch[1].trim())
      lastHeaderLine = i
      continue
    }
    const toMatch = line.match(/^To:\s*(.+)$/i)
    if (toMatch) {
      to = parseAddressListField(toMatch[1].trim())
      lastHeaderLine = i
      continue
    }
    const subjectMatch = line.match(/^Subject:\s*(.+)$/i)
    if (subjectMatch) {
      subject = subjectMatch[1].trim()
      lastHeaderLine = i
      continue
    }
    if (line.match(/^Date:\s/i) || line.match(/^CC:\s/i)) {
      lastHeaderLine = i
      continue
    }
    if (lastHeaderLine >= 0 && line.trim() === '') {
      lastHeaderLine = i
      break
    }
    if (lastHeaderLine >= 0) break
  }

  return { from, to, subject, bodyStart: lastHeaderLine + 1 }
}

function splitThread(text: string): ThreadMessage[] {
  const separator = /(?:^|\n)(?:-{3,}\s*(?:Original Message|Forwarded message)\s*-{3,}|(?:On .+ wrote:))\s*\n/gm
  const parts = text.split(separator).filter((p) => p.trim())

  if (parts.length <= 1) {
    return [{
      from: { email: '' },
      to: [],
      date: new Date().toISOString(),
      body: normalizeText(text),
      contentType: 'text',
      isForwarded: false,
    }]
  }

  return parts.map((part, index) => {
    if (index === 0) {
      return {
        from: { email: '' } as { name?: string; email: string },
        to: [] as { name?: string; email: string }[],
        date: parseDateFromBlock(part),
        body: normalizeText(part),
        contentType: 'text' as const,
        isForwarded: false,
      }
    }

    const headers = parseInlineHeaders(part)
    const bodyLines = part.split('\n').slice(headers.bodyStart)
    return {
      from: headers.from,
      to: headers.to,
      subject: headers.subject,
      date: parseDateFromBlock(part),
      body: normalizeText(bodyLines.join('\n')),
      contentType: 'text' as const,
      isForwarded: true,
    }
  })
}

export function parseInboundEmail(payload: {
  from?: string
  to?: string | string[]
  subject?: string
  text?: string
  html?: string
  messageId?: string
  replyTo?: string
  inReplyTo?: string
  references?: string | string[]
}): ParsedEmail {
  const fromParsed = parseAddressField(payload.from)
  const toParsed = parseAddressListField(payload.to)
  const subject = payload.subject?.trim() || '(no subject)'

  const rawText = payload.text || null
  const rawHtml = payload.html || null

  let textContent = rawText || ''
  if (!textContent && rawHtml) {
    textContent = stripHtml(rawHtml)
  }

  const normalized = normalizeText(textContent)
  const withoutSignature = stripSignature(normalized)
  const cleanedText = stripQuotedReplies(withoutSignature)

  const threadMessages = splitThread(normalized)
  if (threadMessages.length > 0 && fromParsed.email) {
    threadMessages[0].from = fromParsed
    threadMessages[0].to = toParsed
    threadMessages[0].subject = subject
  }

  const contentHash = generateContentHash(
    subject,
    fromParsed.email,
    textContent,
  )

  const references = payload.references
    ? (Array.isArray(payload.references) ? payload.references : payload.references.split(/\s+/))
    : null

  return {
    messageId: payload.messageId || null,
    from: fromParsed,
    to: toParsed,
    subject,
    replyTo: payload.replyTo || null,
    inReplyTo: payload.inReplyTo || null,
    references,
    rawText,
    rawHtml,
    cleanedText,
    threadMessages,
    // TODO: Phase 2 — detect language via LLM or `franc` library
    detectedLanguage: null,
    contentHash,
  }
}

export function extractParticipantsFromThread(
  email: InboxEmail,
): { name: string; email: string; role: string }[] {
  const seen = new Set<string>()
  const participants: { name: string; email: string; role: string }[] = []

  // Pre-seed with the inbox's own address so it's excluded from participants
  const inboxAddress = (email.toAddress || '').toLowerCase()
  if (inboxAddress) seen.add(inboxAddress)

  const addParticipant = (name: string, addr: string, role: string) => {
    const key = addr.toLowerCase()
    if (!key || seen.has(key)) return
    seen.add(key)
    participants.push({ name, email: key, role })
  }

  if (email.threadMessages) {
    for (const msg of email.threadMessages) {
      if (msg.from?.email) {
        addParticipant(msg.from.name || '', msg.from.email, 'other')
      }
      if (msg.to) {
        for (const to of msg.to) {
          addParticipant(to.name || '', to.email, 'other')
        }
      }
      if (msg.cc) {
        for (const cc of msg.cc) {
          addParticipant(cc.name || '', cc.email, 'other')
        }
      }
    }
  }

  if (email.forwardedByAddress) {
    addParticipant(email.forwardedByName || '', email.forwardedByAddress, 'seller')
  }

  return participants
}
