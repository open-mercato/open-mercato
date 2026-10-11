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
  to: string
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
  to: string
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

type CapturedEmail = {
  to: string
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

async function captureEmailForTests(options: SendEmailOptions): Promise<void> {
  if (!parseBooleanWithDefault(process.env.OM_TEST_MODE, false)) return

  const capturePath = resolveTestEmailCapturePath()
  const record: CapturedEmail = {
    to: options.to,
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

export async function sendEmail(options: SendEmailOptions): Promise<void> {
  await captureEmailForTests(options)
  if (isEmailDeliveryDisabled()) return

  const fromAddr = options.from || resolveDefaultEmailFromAddress()
  if (!fromAddr) {
    throw new Error('EMAIL_FROM_NOT_CONFIGURED: set NOTIFICATIONS_EMAIL_FROM, EMAIL_FROM, or ADMIN_EMAIL')
  }

  const transport = getRegisteredEmailTransport()
  if (!transport) {
    throw new Error('EMAIL_TRANSPORT_NOT_CONFIGURED: enable an outbound email provider module')
  }

  await transport.send({
    to: options.to,
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
  })
}
