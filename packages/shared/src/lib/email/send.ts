import { Resend } from 'resend'
import React from 'react'
import { appendFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { parseBooleanWithDefault } from '../boolean'
import { resolveDefaultEmailFromAddress } from './config'

export type SendEmailOptions = {
  to: string
  subject: string
  react: React.ReactElement
  from?: string
  replyTo?: string
  attachments?: Array<{
    filename: string
    content: string
    contentType?: string
  }>
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

export async function sendEmail({ to, subject, react, from, replyTo, attachments }: SendEmailOptions) {
  const emailDisabled =
    parseBooleanWithDefault(process.env.OM_DISABLE_EMAIL_DELIVERY, false) ||
    parseBooleanWithDefault(process.env.OM_TEST_MODE, false)

  await captureEmailForTests({ to, subject, react, from, replyTo, attachments })

  if (emailDisabled) return

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) throw new Error('RESEND_API_KEY is not set')
  const resend = new Resend(apiKey)
  const fromAddr = from || resolveDefaultEmailFromAddress()
  if (!fromAddr) {
    throw new Error('EMAIL_FROM_NOT_CONFIGURED: set NOTIFICATIONS_EMAIL_FROM, EMAIL_FROM, or ADMIN_EMAIL')
  }
  const payload = {
    to,
    subject,
    from: fromAddr,
    react,
    ...(replyTo ? { reply_to: replyTo } : {}),
    ...(attachments?.length ? { attachments } : {}),
  }
  const result = await resend.emails.send(payload)
  const errorMessage =
    typeof (result as any)?.error === 'string'
      ? (result as any).error
      : typeof (result as any)?.error?.message === 'string'
        ? (result as any).error.message
        : null
  if (errorMessage) {
    throw new Error(`RESEND_SEND_FAILED: ${errorMessage}`)
  }
}
