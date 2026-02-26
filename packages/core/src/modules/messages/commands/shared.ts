import type { EntityManager } from '@mikro-orm/postgresql'
import { Message, MessageObject, MessageRecipient, type MessageActionData, type RecipientStatus } from '../data/entities'
import { MESSAGE_ATTACHMENT_ENTITY_ID } from '../lib/constants'

export type MessageCommandExecuteResult = {
  id: string
  externalEmail: string | null
  recipientUserIds: string[]
}

export type MessageScopeInput = {
  tenantId: string
  organizationId: string | null
  userId: string
}

export type MessageRecipientSnapshot = {
  id: string
  messageId: string
  recipientUserId: string
  recipientType: 'to' | 'cc' | 'bcc'
  status: RecipientStatus
  readAt: string | null
  archivedAt: string | null
  deletedAt: string | null
}

export type MessageObjectSnapshot = {
  id: string
  messageId: string
  entityModule: string
  entityType: string
  entityId: string
  actionRequired: boolean
  actionType: string | null
  actionLabel: string | null
  entitySnapshot: Record<string, unknown> | null
}

export type MessageSnapshot = {
  id: string
  type: string
  visibility: 'public' | 'internal' | null
  sourceEntityType: string | null
  sourceEntityId: string | null
  externalEmail: string | null
  externalName: string | null
  threadId: string | null
  parentMessageId: string | null
  senderUserId: string
  subject: string
  body: string
  bodyFormat: 'text' | 'markdown'
  priority: 'low' | 'normal' | 'high' | 'urgent'
  status: 'draft' | 'sent'
  isDraft: boolean
  sentAt: string | null
  actionData: MessageActionData | null
  actionResult: Record<string, unknown> | null
  actionTaken: string | null
  actionTakenByUserId: string | null
  actionTakenAt: string | null
  sendViaEmail: boolean
  tenantId: string
  organizationId: string | null
  deletedAt: string | null
}

export type MessageAggregateSnapshot = {
  message: MessageSnapshot
  recipients: MessageRecipientSnapshot[]
  objects: MessageObjectSnapshot[]
  attachmentIds: string[]
}

function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null
}

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null
  return new Date(value)
}

function hasOrganizationAccess(scopeOrganizationId: string | null, messageOrganizationId: string | null | undefined): boolean {
  if (scopeOrganizationId) {
    return messageOrganizationId === scopeOrganizationId
  }
  return messageOrganizationId == null
}

export function assertOrganizationAccess(scope: MessageScopeInput, message: Message): void {
  if (!hasOrganizationAccess(scope.organizationId, message.organizationId)) {
    throw new Error('Access denied')
  }
}

export async function getAttachmentIdsForMessage(
  em: EntityManager,
  messageId: string,
  scope: { tenantId: string; organizationId: string | null },
): Promise<string[]> {
  const { Attachment } = await import('@open-mercato/core/modules/attachments/data/entities')
  const attachments = await em.find(Attachment, {
    entityId: MESSAGE_ATTACHMENT_ENTITY_ID,
    recordId: messageId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })
  return attachments.map((item) => item.id)
}

export async function loadMessageAggregateSnapshot(
  em: EntityManager,
  messageId: string,
  scope?: { tenantId: string; organizationId: string | null },
): Promise<MessageAggregateSnapshot | null> {
  const where: Record<string, unknown> = { id: messageId }
  if (scope) {
    where.tenantId = scope.tenantId
    where.organizationId = scope.organizationId
  }
  const message = await em.findOne(Message, where)
  if (!message) return null
  const recipients = await em.find(MessageRecipient, { messageId })
  const objects = await em.find(MessageObject, { messageId })
  const attachmentIds = await getAttachmentIdsForMessage(em, messageId, {
    tenantId: message.tenantId,
    organizationId: message.organizationId ?? null,
  })

  return {
    message: {
      id: message.id,
      type: message.type,
      visibility: message.visibility ?? null,
      sourceEntityType: message.sourceEntityType ?? null,
      sourceEntityId: message.sourceEntityId ?? null,
      externalEmail: message.externalEmail ?? null,
      externalName: message.externalName ?? null,
      threadId: message.threadId ?? null,
      parentMessageId: message.parentMessageId ?? null,
      senderUserId: message.senderUserId,
      subject: message.subject,
      body: message.body,
      bodyFormat: message.bodyFormat,
      priority: message.priority,
      status: message.status,
      isDraft: message.isDraft,
      sentAt: toIso(message.sentAt),
      actionData: (message.actionData as MessageActionData | null) ?? null,
      actionResult: message.actionResult ?? null,
      actionTaken: message.actionTaken ?? null,
      actionTakenByUserId: message.actionTakenByUserId ?? null,
      actionTakenAt: toIso(message.actionTakenAt),
      sendViaEmail: message.sendViaEmail,
      tenantId: message.tenantId,
      organizationId: message.organizationId ?? null,
      deletedAt: toIso(message.deletedAt),
    },
    recipients: recipients.map((item) => ({
      id: item.id,
      messageId: item.messageId,
      recipientUserId: item.recipientUserId,
      recipientType: item.recipientType,
      status: item.status,
      readAt: toIso(item.readAt),
      archivedAt: toIso(item.archivedAt),
      deletedAt: toIso(item.deletedAt),
    })),
    objects: objects.map((item) => ({
      id: item.id,
      messageId: item.messageId,
      entityModule: item.entityModule,
      entityType: item.entityType,
      entityId: item.entityId,
      actionRequired: item.actionRequired,
      actionType: item.actionType ?? null,
      actionLabel: item.actionLabel ?? null,
      entitySnapshot: item.entitySnapshot ?? null,
    })),
    attachmentIds,
  }
}

export async function restoreMessageAggregateSnapshot(
  em: EntityManager,
  snapshot: MessageAggregateSnapshot,
): Promise<void> {
  const existingMessage = await em.findOne(Message, { id: snapshot.message.id })
  if (!existingMessage) {
    const created = em.create(Message, {
      id: snapshot.message.id,
      type: snapshot.message.type,
      visibility: snapshot.message.visibility,
      sourceEntityType: snapshot.message.sourceEntityType,
      sourceEntityId: snapshot.message.sourceEntityId,
      externalEmail: snapshot.message.externalEmail,
      externalName: snapshot.message.externalName,
      threadId: snapshot.message.threadId,
      parentMessageId: snapshot.message.parentMessageId,
      senderUserId: snapshot.message.senderUserId,
      subject: snapshot.message.subject,
      body: snapshot.message.body,
      bodyFormat: snapshot.message.bodyFormat,
      priority: snapshot.message.priority,
      status: snapshot.message.status,
      isDraft: snapshot.message.isDraft,
      sentAt: toDate(snapshot.message.sentAt),
      actionData: snapshot.message.actionData as MessageActionData,
      actionResult: snapshot.message.actionResult,
      actionTaken: snapshot.message.actionTaken,
      actionTakenByUserId: snapshot.message.actionTakenByUserId,
      actionTakenAt: toDate(snapshot.message.actionTakenAt),
      sendViaEmail: snapshot.message.sendViaEmail,
      tenantId: snapshot.message.tenantId,
      organizationId: snapshot.message.organizationId,
      deletedAt: toDate(snapshot.message.deletedAt),
    })
    em.persist(created)
  } else {
    existingMessage.type = snapshot.message.type
    existingMessage.visibility = snapshot.message.visibility
    existingMessage.sourceEntityType = snapshot.message.sourceEntityType
    existingMessage.sourceEntityId = snapshot.message.sourceEntityId
    existingMessage.externalEmail = snapshot.message.externalEmail
    existingMessage.externalName = snapshot.message.externalName
    existingMessage.threadId = snapshot.message.threadId
    existingMessage.parentMessageId = snapshot.message.parentMessageId
    existingMessage.senderUserId = snapshot.message.senderUserId
    existingMessage.subject = snapshot.message.subject
    existingMessage.body = snapshot.message.body
    existingMessage.bodyFormat = snapshot.message.bodyFormat
    existingMessage.priority = snapshot.message.priority
    existingMessage.status = snapshot.message.status
    existingMessage.isDraft = snapshot.message.isDraft
    existingMessage.sentAt = toDate(snapshot.message.sentAt)
    existingMessage.actionData = snapshot.message.actionData as MessageActionData
    existingMessage.actionResult = snapshot.message.actionResult
    existingMessage.actionTaken = snapshot.message.actionTaken
    existingMessage.actionTakenByUserId = snapshot.message.actionTakenByUserId
    existingMessage.actionTakenAt = toDate(snapshot.message.actionTakenAt)
    existingMessage.sendViaEmail = snapshot.message.sendViaEmail
    existingMessage.tenantId = snapshot.message.tenantId
    existingMessage.organizationId = snapshot.message.organizationId
    existingMessage.deletedAt = toDate(snapshot.message.deletedAt)
  }

  const existingRecipients = await em.find(MessageRecipient, { messageId: snapshot.message.id })
  const recipientById = new Map(existingRecipients.map((item) => [item.id, item]))
  const snapshotRecipientIds = new Set(snapshot.recipients.map((item) => item.id))
  for (const current of existingRecipients) {
    if (!snapshotRecipientIds.has(current.id)) {
      em.remove(current)
    }
  }
  for (const recipient of snapshot.recipients) {
    const existing = recipientById.get(recipient.id)
    if (!existing) {
      em.persist(em.create(MessageRecipient, {
        id: recipient.id,
        messageId: recipient.messageId,
        recipientUserId: recipient.recipientUserId,
        recipientType: recipient.recipientType,
        status: recipient.status,
        readAt: toDate(recipient.readAt),
        archivedAt: toDate(recipient.archivedAt),
        deletedAt: toDate(recipient.deletedAt),
      }))
      continue
    }
    existing.messageId = recipient.messageId
    existing.recipientUserId = recipient.recipientUserId
    existing.recipientType = recipient.recipientType
    existing.status = recipient.status
    existing.readAt = toDate(recipient.readAt)
    existing.archivedAt = toDate(recipient.archivedAt)
    existing.deletedAt = toDate(recipient.deletedAt)
  }

  const existingObjects = await em.find(MessageObject, { messageId: snapshot.message.id })
  const objectById = new Map(existingObjects.map((item) => [item.id, item]))
  const snapshotObjectIds = new Set(snapshot.objects.map((item) => item.id))
  for (const current of existingObjects) {
    if (!snapshotObjectIds.has(current.id)) {
      em.remove(current)
    }
  }
  for (const object of snapshot.objects) {
    const existing = objectById.get(object.id)
    if (!existing) {
      em.persist(em.create(MessageObject, {
        id: object.id,
        messageId: object.messageId,
        entityModule: object.entityModule,
        entityType: object.entityType,
        entityId: object.entityId,
        actionRequired: object.actionRequired,
        actionType: object.actionType,
        actionLabel: object.actionLabel,
        entitySnapshot: object.entitySnapshot,
      }))
      continue
    }
    existing.messageId = object.messageId
    existing.entityModule = object.entityModule
    existing.entityType = object.entityType
    existing.entityId = object.entityId
    existing.actionRequired = object.actionRequired
    existing.actionType = object.actionType
    existing.actionLabel = object.actionLabel
    existing.entitySnapshot = object.entitySnapshot
  }

  const { Attachment } = await import('@open-mercato/core/modules/attachments/data/entities')
  await em.nativeDelete(Attachment, {
    entityId: MESSAGE_ATTACHMENT_ENTITY_ID,
    recordId: snapshot.message.id,
    tenantId: snapshot.message.tenantId,
    organizationId: snapshot.message.organizationId,
    id: { $nin: snapshot.attachmentIds.length > 0 ? snapshot.attachmentIds : ['00000000-0000-0000-0000-000000000000'] },
  })
  if (snapshot.attachmentIds.length > 0) {
    const attachments = await em.find(Attachment, {
      id: { $in: snapshot.attachmentIds },
      tenantId: snapshot.message.tenantId,
      organizationId: snapshot.message.organizationId,
    })
    for (const attachment of attachments) {
      attachment.entityId = MESSAGE_ATTACHMENT_ENTITY_ID
      attachment.recordId = snapshot.message.id
    }
  }

  await em.flush()
}

export function buildCommandLogBase(
  actionLabel: string,
  resourceId: string,
  snapshot: { tenantId: string; organizationId: string | null },
) {
  return {
    actionLabel,
    resourceKind: 'messages.message',
    resourceId,
    tenantId: snapshot.tenantId,
    organizationId: snapshot.organizationId,
  }
}
