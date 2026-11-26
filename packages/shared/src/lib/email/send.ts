import React from 'react'
import { appendFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { parseBooleanWithDefault } from '../boolean'
import {
  isEmailDeliveryDisabled,
  resolveDefaultEmailFromAddress,
} from './config'
import { getRegisteredEmailTransport } from './transport'

export type EmailAttachment = {
  filename: string
  content: string
  contentType?: string
}

export type SendEmailOptions = {
  to: string | string[]
  /** Deliver one transport call per address so recipients do not see each other. */
  sendSeparately?: boolean
  subject: string
  react?: React.ReactElement
  html?: string
  text?: string
  from?: string
  replyTo?: string
  attachments?: EmailAttachment[]
  tenantId?: string
  organizationId?: string | null
}

export type ResolvedEmailPayload = {
  /** First recipient; the only one for transports without `supportsMultipleRecipients`. */
  to: string
  /** All recipients of a joint send; set only for transports declaring `supportsMultipleRecipients`. */
  recipients?: string[]
  subject: string
  react?: React.ReactElement
  html?: string
  text?: string
  from: string
  /**
   * True when `from` was filled in from the instance-wide environment defaults rather than chosen by
   * the caller. Transports use this to decide whether a tenant's own configured sender may take
   * precedence: `from` is never empty by the time it reaches a transport, so without this flag a
   * per-tenant sender is unreachable. Absent means "caller chose it" for older transports.
   */
  fromIsInstanceDefault?: boolean
  replyTo?: string
  attachments?: EmailAttachment[]
  tenantId?: string
  organizationId?: string | null
}

export type EmailRejection = {
  address: string
  error: string
  /** True when the provider may accept the address on a later attempt (rate limit, outage, SMTP 4xx). */
  transient?: boolean
  retryAt?: Date
}

export type EmailSendResult = {
  accepted: string[]
  rejected: EmailRejection[]
  retryAt?: Date
}

export type EmailDeliveryErrorHints = {
  transient?: boolean
  retryAt?: Date
  rejected?: EmailRejection[]
}

/** A failed send that tells the caller whether retrying can help; transports may throw it. */
export class EmailSendError extends Error {
  readonly transient?: boolean
  readonly retryAt?: Date
  readonly rejected?: EmailRejection[]
  constructor(message: string, hints: EmailDeliveryErrorHints = {}) {
    super(message)
    this.name = 'EmailSendError'
    this.transient = hints.transient
    this.retryAt = hints.retryAt
    this.rejected = hints.rejected
  }
}

/** Reads retry hints from any thrown value, so errors from other bundles or transports work too. */
export function readEmailDeliveryErrorHints(error: unknown): EmailDeliveryErrorHints {
  if (!error || typeof error !== 'object') return {}
  const candidate = error as { transient?: unknown; retryAt?: unknown; rejected?: unknown }
  const retryAt = candidate.retryAt instanceof Date && Number.isFinite(candidate.retryAt.getTime()) ? candidate.retryAt : undefined
  return {
    ...(typeof candidate.transient === 'boolean' ? { transient: candidate.transient } : {}),
    ...(retryAt ? { retryAt } : {}),
    ...(Array.isArray(candidate.rejected) ? { rejected: candidate.rejected as EmailRejection[] } : {}),
  }
}

function latestRetryAt(current: Date | undefined, next: Date | undefined): Date | undefined {
  if (!next) return current
  return !current || next > current ? next : current
}

type CapturedEmail = {
  to: string
  recipients: string[]
  subject: string
  from: string | null
  replyTo: string | null
  links: string[]
  text: string
  capturedAt: string
}

type ReactElementProps = {
  href?: unknown
  children?: unknown
}

const DEFAULT_TEST_EMAIL_CAPTURE_PATH = join(tmpdir(), 'open-mercato-email-capture.jsonl')

function resolveTestEmailCapturePath(): string {
  return process.env.OM_TEST_EMAIL_CAPTURE_PATH?.trim() || DEFAULT_TEST_EMAIL_CAPTURE_PATH
}

function readElementProps(node: React.ReactElement): ReactElementProps {
  return node.props as ReactElementProps
}

function collectEmailLinks(node: unknown, links: string[] = []): string[] {
  if (node == null || typeof node === 'boolean') return links
  if (Array.isArray(node)) {
    for (const child of node) collectEmailLinks(child, links)
    return links
  }
  if (React.isValidElement(node)) {
    const props = readElementProps(node)
    if (typeof props.href === 'string' && props.href.length > 0) links.push(props.href)
    collectEmailLinks(props.children, links)
  }
  return links
}

function collectEmailText(node: unknown, parts: string[] = []): string[] {
  if (node == null || typeof node === 'boolean') return parts
  if (typeof node === 'string' || typeof node === 'number') {
    parts.push(String(node))
    return parts
  }
  if (Array.isArray(node)) {
    for (const child of node) collectEmailText(child, parts)
    return parts
  }
  if (React.isValidElement(node)) {
    collectEmailText(readElementProps(node).children, parts)
  }
  return parts
}

async function captureEmailForTests(options: SendEmailOptions, recipients: string[]): Promise<void> {
  if (!parseBooleanWithDefault(process.env.OM_TEST_MODE, false)) return

  const capturePath = resolveTestEmailCapturePath()
  const record: CapturedEmail = {
    to: recipients[0],
    recipients,
    subject: options.subject,
    from: options.from ?? resolveDefaultEmailFromAddress() ?? null,
    replyTo: options.replyTo ?? null,
    links: collectEmailLinks(options.react),
    text: collectEmailText(options.react).join(' ').replace(/\s+/g, ' ').trim(),
    capturedAt: new Date().toISOString(),
  }

  await mkdir(dirname(capturePath), { recursive: true })
  await appendFile(capturePath, `${JSON.stringify(record)}\n`, 'utf8')
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function sendEmail(options: SendEmailOptions): Promise<void> {
  await sendEmailWithResult(options)
}

/**
 * `sendEmail` that also reports which addresses the provider accepted or
 * rejected (and when to retry a rate-limited send). Throws when none was accepted.
 */
export async function sendEmailWithResult(options: SendEmailOptions): Promise<EmailSendResult> {
  const addresses = Array.isArray(options.to) ? options.to : [options.to]
  if (addresses.length === 0) {
    throw new Error('[internal] EMAIL_RECIPIENT_REQUIRED: provide at least one recipient')
  }
  const batches = options.sendSeparately ? addresses.map((address) => [address]) : [addresses]
  for (const batch of batches) await captureEmailForTests(options, batch)
  if (isEmailDeliveryDisabled()) return { accepted: [...addresses], rejected: [] }

  const fromAddr = options.from || resolveDefaultEmailFromAddress()
  if (!fromAddr) {
    throw new Error('EMAIL_FROM_NOT_CONFIGURED: set NOTIFICATIONS_EMAIL_FROM, EMAIL_FROM, or ADMIN_EMAIL')
  }

  const transport = getRegisteredEmailTransport()
  if (!transport) {
    throw new Error('EMAIL_TRANSPORT_NOT_CONFIGURED: enable an outbound email provider module')
  }
  if (addresses.length > 1 && !options.sendSeparately && !transport.supportsMultipleRecipients) {
    throw new Error(
      `[internal] EMAIL_TRANSPORT_MULTI_RECIPIENT_UNSUPPORTED: transport '${transport.id}' accepts one recipient per call; use sendSeparately`,
    )
  }

  const result: EmailSendResult = { accepted: [], rejected: [] }
  for (const batch of batches) {
    const payload: ResolvedEmailPayload = {
      to: batch[0],
      ...(batch.length > 1 ? { recipients: batch } : {}),
      subject: options.subject,
      react: options.react,
      html: options.html,
      text: options.text,
      from: fromAddr,
      fromIsInstanceDefault: !options.from,
      replyTo: options.replyTo,
      attachments: options.attachments,
      tenantId: options.tenantId,
      organizationId: options.organizationId,
    }
    let outcome: EmailSendResult | null = null
    try {
      if (transport.sendWithResult) outcome = await transport.sendWithResult(payload)
      else await transport.send(payload)
    } catch (error) {
      // A separate send must not lose the addresses already accepted, or a retry would duplicate them.
      if (!options.sendSeparately) throw error
      const { transient, retryAt } = readEmailDeliveryErrorHints(error)
      result.rejected.push({
        address: batch[0],
        error: errorMessage(error),
        ...(transient !== undefined ? { transient } : {}),
        ...(retryAt ? { retryAt } : {}),
      })
      result.retryAt = latestRetryAt(result.retryAt, retryAt)
      continue
    }
    if (!outcome) {
      result.accepted.push(...batch)
      continue
    }
    result.accepted.push(...outcome.accepted)
    result.rejected.push(...outcome.rejected)
    result.retryAt = latestRetryAt(result.retryAt, outcome.retryAt)
  }

  if (result.accepted.length === 0) {
    const details = result.rejected.map((entry) => `${entry.address}: ${entry.error}`).join('; ')
    throw new EmailSendError(`EMAIL_SEND_REJECTED: ${details || 'no recipient accepted'}`, {
      transient: result.rejected.length > 0 && result.rejected.every((entry) => entry.transient === true),
      retryAt: result.retryAt,
      rejected: result.rejected,
    })
  }
  return result
}
