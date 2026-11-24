import type { EntityManager } from '@mikro-orm/postgresql'
import { sendEmail } from '@open-mercato/shared/lib/email/send'
import { resolveDefaultEmailFromAddress } from '@open-mercato/shared/lib/email/config'
import { loadDictionary } from '@open-mercato/shared/lib/i18n/server'
import { defaultLocale } from '@open-mercato/shared/lib/i18n/config'
import { createFallbackTranslator } from '@open-mercato/shared/lib/i18n/translate'
import type { Message, MessageObject } from '../data/entities'
import { MessageAccessToken } from '../data/entities'
import MessageEmail from '../emails/MessageEmail'
import type { AttachmentService } from '@open-mercato/core/modules/attachments'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { denyMessageAttachmentAccess } from './attachmentAccess'
import { MESSAGE_ATTACHMENT_ENTITY_ID } from './constants'
import { generateAuthToken, hashAuthToken } from '../../auth/lib/tokenHash'
import type { MessageEmailAttachment } from './attachments'
import { renderMarkdownEmailBody } from './markdownEmailBody'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('messages').child({ component: 'email-sender' })

const ACCESS_TOKEN_EXPIRY_HOURS = 24 * 7
const MAX_EMAIL_ATTACHMENTS = 10
const MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024

export type SenderIdentity = {
  name: string | null
  email: string | null
}

function logDebug(message: string, details?: Record<string, unknown>) {
  logger.debug(message, details)
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

function resolveObjectLabels(objects: MessageObject[]): string[] {
  return objects.map((item) => `${item.entityModule}.${item.entityType} (${item.entityId})`)
}

export type MessageEmailAttachmentAccess = {
  auth: NonNullable<AuthContext>
  service: AttachmentService
}

type EmailAttachment = {
  filename: string
  content: string
  contentType?: string
}

async function mapAttachmentsForEmail(
  message: Message,
  attachments: MessageEmailAttachment[],
  access?: MessageEmailAttachmentAccess,
): Promise<EmailAttachment[]> {
  const emailAttachments: EmailAttachment[] = []
  let totalBytes = 0

  for (const attachment of attachments.slice(0, MAX_EMAIL_ATTACHMENTS)) {
    if (!attachment.attachmentId || !access?.service || access.auth.sub !== message.senderUserId
      || access.auth.tenantId !== message.tenantId || access.auth.orgId !== message.organizationId) {
      return denyMessageAttachmentAccess()
    }
    const { buffer, fileName, mimeType } = await access.service.readScoped({
      attachmentId: attachment.attachmentId,
      auth: access.auth,
      expectedOwner: { entityId: MESSAGE_ATTACHMENT_ENTITY_ID, recordId: message.id },
    })

    if ((totalBytes + buffer.length) > MAX_TOTAL_ATTACHMENT_BYTES) {
      logDebug('Attachment skipped: total size limit exceeded', {
        messageId: message.id,
        fileName: attachment.fileName,
        nextTotalBytes: totalBytes + buffer.length,
      })
      continue
    }

    totalBytes += buffer.length
    emailAttachments.push({
      filename: fileName,
      content: buffer.toString('base64'),
      contentType: mimeType || undefined,
    })
  }

  return emailAttachments
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
  const rawToken = generateAuthToken()
  const expiresAt = new Date(Date.now() + ACCESS_TOKEN_EXPIRY_HOURS * 60 * 60 * 1000)
  const record = em.create(MessageAccessToken, {
    messageId,
    recipientUserId,
    token: hashAuthToken(rawToken),
    expiresAt,
    useCount: 0,
  })
  await em.persist(record).flush()
  logDebug('Created access token', {
    messageId,
    recipientUserId,
    expiresAt: expiresAt.toISOString(),
  })
  return rawToken
}

export async function sendMessageEmailToRecipient(params: {
  em: EntityManager
  message: Message
  recipientUserId: string
  recipientEmail: string
  sender: SenderIdentity
  objects: MessageObject[]
  attachments: MessageEmailAttachment[]
  attachmentAccess?: MessageEmailAttachmentAccess
}): Promise<void> {
  const { em, message, recipientUserId, recipientEmail, sender, objects, attachments, attachmentAccess } = params
  const token = await createMessageAccessToken(em, message.id, recipientUserId)
  const appUrl = resolveAppUrl()
  const viewUrl = appUrl ? `${appUrl}/messages/view/${token}` : null
  if (!appUrl) {
    logDebug('APP_URL missing - email link omitted', { messageId: message.id })
  }
  const copy = await buildEmailCopy(message.sentAt ?? new Date())
  const bodyHtml = await buildEmailBodyHtml(message)
  const emailAttachments = await mapAttachmentsForEmail(message, attachments, attachmentAccess)
  logDebug('Sending recipient email', {
    messageId: message.id,
    recipientUserId,
    recipientEmail,
    hasViewUrl: Boolean(viewUrl),
    attachmentsCount: emailAttachments.length,
    from: resolveDefaultEmailFromAddress() ?? null,
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
      attachmentNames: emailAttachments.map((item) => item.filename),
      objectLabels: resolveObjectLabels(objects),
    }),
    attachments: emailAttachments,
    tenantId: message.tenantId,
    organizationId: message.organizationId ?? null,
  })
}

export async function sendMessageEmailToExternal(params: {
  message: Message
  email: string
  sender: SenderIdentity
  objects: MessageObject[]
  attachments: MessageEmailAttachment[]
  attachmentAccess?: MessageEmailAttachmentAccess
}): Promise<void> {
  const { message, email, sender, objects, attachments, attachmentAccess } = params
  const copy = await buildEmailCopy(message.sentAt ?? new Date())
  const bodyHtml = await buildEmailBodyHtml(message)
  const emailAttachments = await mapAttachmentsForEmail(message, attachments, attachmentAccess)
  logDebug('Sending external email', {
    messageId: message.id,
    email,
    attachmentsCount: emailAttachments.length,
    from: resolveDefaultEmailFromAddress() ?? null,
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
      attachmentNames: emailAttachments.map((item) => item.filename),
      objectLabels: resolveObjectLabels(objects),
    }),
    attachments: emailAttachments,
    tenantId: message.tenantId,
    organizationId: message.organizationId ?? null,
  })
  logDebug('External email sent', {
    messageId: message.id,
    email,
  })
}
