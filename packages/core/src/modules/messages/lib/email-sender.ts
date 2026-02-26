import * as React from 'react'
import crypto from 'node:crypto'
import { promises as fs } from 'fs'
import type { EntityManager } from '@mikro-orm/postgresql'
import { sendEmail } from '@open-mercato/shared/lib/email/send'
import { loadDictionary } from '@open-mercato/shared/lib/i18n/server'
import { defaultLocale } from '@open-mercato/shared/lib/i18n/config'
import { createFallbackTranslator } from '@open-mercato/shared/lib/i18n/translate'
import type { Message, MessageObject } from '../data/entities'
import { MessageAccessToken } from '../data/entities'
import MessageEmail from '../emails/MessageEmail'
import { resolveAttachmentAbsolutePath } from '../../attachments/lib/storage'
import type { MessageEmailAttachment } from './attachments'

const ACCESS_TOKEN_EXPIRY_HOURS = 24 * 7
const DEBUG = process.env.MESSAGES_EMAIL_DEBUG === 'true'
const MAX_EMAIL_ATTACHMENTS = 10
const MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024

export type SenderIdentity = {
  name: string | null
  email: string | null
}

function logDebug(message: string, details?: Record<string, unknown>) {
  if (!DEBUG) return
  if (details) {
    console.log(`[messages:email-sender] ${message}`, details)
    return
  }
  console.log(`[messages:email-sender] ${message}`)
}

function resolveAppUrl(): string | null {
  const raw = process.env.APP_URL?.trim()
  if (!raw) return null
  return raw.replace(/\/$/, '')
}

function buildSenderLabel(sender: SenderIdentity): string {
  const name = sender.name?.trim()
  if (name) return name
  const email = sender.email?.trim()
  if (email) return email
  return 'System'
}

function generateAccessToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

function resolveObjectLabels(objects: MessageObject[]): string[] {
  return objects.map((item) => `${item.entityModule}.${item.entityType} (${item.entityId})`)
}

type ResendAttachment = {
  filename: string
  content: string
  contentType?: string
}

async function mapAttachmentsForEmail(
  messageId: string,
  attachments: MessageEmailAttachment[],
): Promise<ResendAttachment[]> {
  const resendAttachments: ResendAttachment[] = []
  let totalBytes = 0

  for (const attachment of attachments.slice(0, MAX_EMAIL_ATTACHMENTS)) {
    const absolutePath = resolveAttachmentAbsolutePath(
      attachment.partitionCode,
      attachment.storagePath,
      attachment.storageDriver,
    )

    let buffer: Buffer
    try {
      buffer = await fs.readFile(absolutePath)
    } catch (error) {
      logDebug('Attachment skipped: file read failed', {
        messageId,
        fileName: attachment.fileName,
        error: error instanceof Error ? error.message : String(error),
      })
      continue
    }

    if ((totalBytes + buffer.length) > MAX_TOTAL_ATTACHMENT_BYTES) {
      logDebug('Attachment skipped: total size limit exceeded', {
        messageId,
        fileName: attachment.fileName,
        nextTotalBytes: totalBytes + buffer.length,
      })
      continue
    }

    totalBytes += buffer.length
    resendAttachments.push({
      filename: attachment.fileName,
      content: buffer.toString('base64'),
      contentType: attachment.mimeType || undefined,
    })
  }

  return resendAttachments
}

async function renderMarkdownEmailBody(body: string) {
  const ReactMarkdownModule = await import('react-markdown')
  const remarkGfmModule = await import('remark-gfm')
  const ReactMarkdown =
    (ReactMarkdownModule.default ?? ReactMarkdownModule) as React.ComponentType<{
      remarkPlugins?: unknown
      children?: React.ReactNode
    }>
  const remarkGfmPlugin = remarkGfmModule.default ?? remarkGfmModule
  const { renderToStaticMarkup } = await import('react-dom/server')

  return renderToStaticMarkup(
    React.createElement(ReactMarkdown, { remarkPlugins: [remarkGfmPlugin] }, body),
  )
}

async function buildEmailBodyHtml(message: Message): Promise<string | undefined> {
  if (message.bodyFormat !== 'markdown') return undefined
  if (!message.body) return undefined
  return renderMarkdownEmailBody(message.body)
}

async function buildEmailCopy(sentAt: Date) {
  const dict = await loadDictionary(defaultLocale)
  const t = createFallbackTranslator(dict)
  return {
    preview: t('messages.email.preview', 'You received a message in Open Mercato'),
    heading: t('messages.email.heading', 'New message'),
    from: t('messages.email.from', 'From'),
    sentAt: t('messages.email.sentAt', 'Sent'),
    sentAtLabel: sentAt.toISOString(),
    viewCta: t('messages.email.viewCta', 'View message'),
    attachmentsLabel: t('messages.email.attachments', 'Attachments'),
    objectsLabel: t('messages.email.objects', 'Related records'),
    footer: t('messages.email.footer', 'Open Mercato messages'),
  }
}

export async function createMessageAccessToken(
  em: EntityManager,
  messageId: string,
  recipientUserId: string,
): Promise<string> {
  const token = generateAccessToken()
  const expiresAt = new Date(Date.now() + ACCESS_TOKEN_EXPIRY_HOURS * 60 * 60 * 1000)
  const record = em.create(MessageAccessToken, {
    messageId,
    recipientUserId,
    token,
    expiresAt,
    useCount: 0,
  })
  await em.persistAndFlush(record)
  logDebug('Created access token', {
    messageId,
    recipientUserId,
    expiresAt: expiresAt.toISOString(),
  })
  return token
}

export async function sendMessageEmailToRecipient(params: {
  em: EntityManager
  message: Message
  recipientUserId: string
  recipientEmail: string
  sender: SenderIdentity
  objects: MessageObject[]
  attachments: MessageEmailAttachment[]
}): Promise<void> {
  const { em, message, recipientUserId, recipientEmail, sender, objects, attachments } = params
  const token = await createMessageAccessToken(em, message.id, recipientUserId)
  const appUrl = resolveAppUrl()
  const viewUrl = appUrl ? `${appUrl}/messages/view/${token}` : null
  if (!appUrl) {
    logDebug('APP_URL missing - email link omitted', { messageId: message.id })
  }
  const copy = await buildEmailCopy(message.sentAt ?? new Date())
  const bodyHtml = await buildEmailBodyHtml(message)
  const resendAttachments = await mapAttachmentsForEmail(message.id, attachments)
  logDebug('Sending recipient email via Resend', {
    messageId: message.id,
    recipientUserId,
    recipientEmail,
    hasViewUrl: Boolean(viewUrl),
    attachmentsCount: resendAttachments.length,
    hasApiKey: Boolean(process.env.RESEND_API_KEY),
    from: process.env.EMAIL_FROM ?? null,
  })

  await sendEmail({
    to: recipientEmail,
    subject: message.subject,
    react: MessageEmail({
      subject: message.subject,
      body: message.body,
      bodyHtml,
      senderName: buildSenderLabel(sender),
      sentAtLabel: copy.sentAtLabel,
      viewUrl,
      copy,
      attachmentNames: attachments.map((item) => item.fileName),
      objectLabels: resolveObjectLabels(objects),
    }),
    attachments: resendAttachments,
  })
}

export async function sendMessageEmailToExternal(params: {
  message: Message
  email: string
  sender: SenderIdentity
  objects: MessageObject[]
  attachments: MessageEmailAttachment[]
}): Promise<void> {
  const { message, email, sender, objects, attachments } = params
  const copy = await buildEmailCopy(message.sentAt ?? new Date())
  const bodyHtml = await buildEmailBodyHtml(message)
  const resendAttachments = await mapAttachmentsForEmail(message.id, attachments)
  logDebug('Sending external email via Resend', {
    messageId: message.id,
    email,
    attachmentsCount: resendAttachments.length,
    hasApiKey: Boolean(process.env.RESEND_API_KEY),
    from: process.env.EMAIL_FROM ?? null,
  })

  await sendEmail({
    to: email,
    subject: message.subject,
    react: MessageEmail({
      subject: message.subject,
      body: message.body,
      bodyHtml,
      senderName: buildSenderLabel(sender),
      sentAtLabel: copy.sentAtLabel,
      viewUrl: null,
      copy,
      attachmentNames: attachments.map((item) => item.fileName),
      objectLabels: resolveObjectLabels(objects),
    }),
    attachments: resendAttachments,
  })
  logDebug('External email sent via Resend', {
    messageId: message.id,
    email,
  })
}
