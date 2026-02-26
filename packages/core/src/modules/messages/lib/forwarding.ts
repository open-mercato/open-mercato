import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { User } from '../../auth/data/entities'
import { Message, MessageRecipient } from '../data/entities'

const FORWARD_MARKER = '---------- Forwarded message ----------'
const MAX_FORWARD_BODY_LENGTH = 50_000

type MessageScope = {
  tenantId: string
  organizationId: string | null
  userId?: string | null
}

type ForwardMessageBlock = {
  id: string
  senderUserId: string
  subject: string
  body: string
  sentAt: Date | null | undefined
  createdAt: Date
}

function formatForwardSubject(subject: string): string {
  if (/^fwd:\s*/i.test(subject)) return subject
  return `Fwd: ${subject}`
}

function formatDateLabel(date: Date | null | undefined): string {
  if (!date) return '-'
  return date.toISOString()
}

function normalizeSubject(subject: string | null | undefined): string {
  if (typeof subject !== 'string') return '(no subject)'
  const trimmed = subject.trim()
  return trimmed.length > 0 ? trimmed : '(no subject)'
}

function formatUserLabel(user: { name?: string | null; email?: string | null } | undefined, fallbackUserId: string): string {
  const name = user?.name?.trim()
  const email = user?.email?.trim()
  if (name && email) return `${name} <${email}>`
  if (name) return name
  if (email) return email
  return fallbackUserId
}

function ensureMaxForwardBodyLength(body: string): void {
  if (body.length > MAX_FORWARD_BODY_LENGTH) {
    throw new Error('Forward body exceeds maximum length')
  }
}

export async function buildForwardThreadSlice(
  em: EntityManager,
  scope: MessageScope,
  selectedMessage: Message,
): Promise<ForwardMessageBlock[]> {
  const threadMessages = await em.find(
    Message,
    {
      threadId: selectedMessage.threadId ?? selectedMessage.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
      isDraft: false,
    },
    {
      orderBy: {
        sentAt: 'ASC',
        createdAt: 'ASC',
        id: 'ASC',
      },
    },
  )

  const messagesById = new Map(threadMessages.map((item) => [item.id, item]))
  messagesById.set(selectedMessage.id, selectedMessage)

  const threadRootId = selectedMessage.threadId ?? null
  if (threadRootId && !messagesById.has(threadRootId)) {
    const threadRoot = await em.findOne(Message, {
      id: threadRootId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
      isDraft: false,
    })
    if (threadRoot) {
      messagesById.set(threadRoot.id, threadRoot)
    }
  }

  let parentMessageId = selectedMessage.parentMessageId ?? null
  while (parentMessageId) {
    const parentMessage = await em.findOne(Message, {
      id: parentMessageId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
      isDraft: false,
    })
    if (!parentMessage) break
    messagesById.set(parentMessage.id, parentMessage)
    parentMessageId = parentMessage.parentMessageId ?? null
  }

  const orderedThreadMessages = Array.from(messagesById.values()).sort((a, b) => {
    const aTime = a.sentAt?.getTime() ?? 0
    const bTime = b.sentAt?.getTime() ?? 0
    if (aTime !== bTime) return aTime - bTime

    const aCreatedAt = a.createdAt.getTime()
    const bCreatedAt = b.createdAt.getTime()
    if (aCreatedAt !== bCreatedAt) return aCreatedAt - bCreatedAt

    return a.id.localeCompare(b.id)
  })

  const selectedIndex = orderedThreadMessages.findIndex((item) => item.id === selectedMessage.id)
  const threadSlice = selectedIndex >= 0 ? orderedThreadMessages.slice(0, selectedIndex + 1) : [selectedMessage]

  if (scope.userId) {
    const sliceIds = threadSlice.map((item) => item.id)
    const recipientRows = sliceIds.length > 0
      ? await em.find(MessageRecipient, {
        messageId: { $in: sliceIds },
        recipientUserId: scope.userId,
        deletedAt: null,
      })
      : []
    const recipientMessageIds = new Set(recipientRows.map((row) => row.messageId))
    const visibleSlice = threadSlice.filter(
      (item) => item.senderUserId === scope.userId || recipientMessageIds.has(item.id),
    )
    return visibleSlice.map((item) => ({
      id: item.id,
      senderUserId: item.senderUserId,
      subject: item.subject,
      body: item.body,
      sentAt: item.sentAt,
      createdAt: item.createdAt,
    }))
  }

  return threadSlice.map((item) => ({
    id: item.id,
    senderUserId: item.senderUserId,
    subject: item.subject,
    body: item.body,
    sentAt: item.sentAt,
    createdAt: item.createdAt,
  }))
}

export async function buildForwardPreviewFromThreadSlice(
  em: EntityManager,
  scope: MessageScope,
  selectedMessage: Message,
  threadSlice: ForwardMessageBlock[],
): Promise<{ subject: string; body: string }> {
  const allMessageIds = threadSlice.map((item) => item.id)
  const allSenderIds = Array.from(new Set(threadSlice.map((item) => item.senderUserId)))

  const recipients = allMessageIds.length > 0
    ? await em.find(MessageRecipient, {
      messageId: { $in: allMessageIds },
      deletedAt: null,
    })
    : []

  const allRecipientUserIds = Array.from(new Set(recipients.map((item) => item.recipientUserId)))
  const allUserIds = Array.from(new Set([...allSenderIds, ...allRecipientUserIds]))
  const users = allUserIds.length > 0
    ? await findWithDecryption(
      em,
      User,
      { id: { $in: allUserIds } },
      undefined,
      { tenantId: scope.tenantId, organizationId: scope.organizationId },
    )
    : []

  const userById = new Map(users.map((user) => [user.id, user]))
  const recipientsByMessageId = new Map<string, MessageRecipient[]>()
  for (const recipient of recipients) {
    const currentRecipients = recipientsByMessageId.get(recipient.messageId) ?? []
    currentRecipients.push(recipient)
    recipientsByMessageId.set(recipient.messageId, currentRecipients)
  }

  const body = threadSlice.map((item) => {
    const sender = userById.get(item.senderUserId)
    const toRecipients = recipientsByMessageId.get(item.id) ?? []
    const toLabel = toRecipients.length > 0
      ? toRecipients
        .map((recipient) => formatUserLabel(userById.get(recipient.recipientUserId), recipient.recipientUserId))
        .join(', ')
      : '-'

    return [
      FORWARD_MARKER,
      `From: ${formatUserLabel(sender, item.senderUserId)}`,
      `Date: ${formatDateLabel(item.sentAt ?? item.createdAt)}`,
      `Subject: ${normalizeSubject(item.subject)}`,
      `To: ${toLabel}`,
      '',
      item.body ?? '',
    ].join('\n')
  }).join('\n\n')

  ensureMaxForwardBodyLength(body)

  return {
    subject: formatForwardSubject(selectedMessage.subject),
    body,
  }
}

export async function buildForwardPreview(
  em: EntityManager,
  scope: MessageScope,
  selectedMessage: Message,
): Promise<{ subject: string; body: string }> {
  const threadSlice = await buildForwardThreadSlice(em, scope, selectedMessage)
  return buildForwardPreviewFromThreadSlice(em, scope, selectedMessage, threadSlice)
}

export function buildForwardBodyFromLegacyInput(
  generatedBody: string,
  additionalBody?: string,
): string {
  const legacyPrefix = additionalBody?.trim()
  const finalBody = legacyPrefix
    ? `${legacyPrefix}\n\n${generatedBody}`
    : generatedBody
  ensureMaxForwardBodyLength(finalBody)
  return finalBody
}
