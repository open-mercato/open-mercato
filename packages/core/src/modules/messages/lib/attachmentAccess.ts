import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/core'
import type { EntityManager as PostgreSqlEntityManager } from '@mikro-orm/postgresql'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { Attachment } from '@open-mercato/core/modules/attachments/data/entities'
import { createAttachmentAccessContext } from '@open-mercato/core/modules/attachments'
import { assertAttachmentOwnersAccess } from '@open-mercato/core/modules/attachments/lib/access-query'
import { hasUploadProvenance } from '@open-mercato/core/modules/attachments/lib/uploadProvenance'
import { Message, MessageRecipient } from '../data/entities'
import { resolveMessageReadAccess } from './routeHelpers'
import { MESSAGE_ATTACHMENT_ENTITY_ID } from './constants'

export type MessageAttachmentAccess = {
  container: AwilixContainer
  auth: AuthContext | null
}

export async function denyMessageAttachmentAccess(): Promise<never> {
  const { translate } = await resolveTranslations()
  throw new CrudHttpError(403, { error: translate('messages.errors.attachmentAccessDenied') })
}

export async function assertMessageAttachmentSource(
  em: EntityManager,
  attachment: Attachment,
  organizationId: string | null,
  tenantId: string,
  access?: MessageAttachmentAccess,
  action: 'read' | 'reassign' | 'delete' = 'reassign',
): Promise<void> {
  return assertMessageAttachmentSources(em, [attachment], organizationId, tenantId, access, action)
}

export async function assertMessageAttachmentSources(
  em: EntityManager,
  attachments: readonly Attachment[],
  organizationId: string | null,
  tenantId: string,
  access?: MessageAttachmentAccess,
  action: 'read' | 'reassign' | 'delete' = 'reassign',
): Promise<void> {
  if (!attachments.length) return
  const auth = access?.auth
  if (!access || !auth?.sub || auth.tenantId !== tenantId || auth.orgId !== organizationId
    || attachments.some((attachment) => attachment.tenantId !== tenantId || attachment.organizationId !== organizationId)) {
    return denyMessageAttachmentAccess()
  }
  const context = createAttachmentAccessContext(access.container)
  const requests = attachments.flatMap((attachment) => {
    const base = { attachment, action: attachment.entityId === MESSAGE_ATTACHMENT_ENTITY_ID && action === 'reassign' ? 'read' as const : action }
    return attachment.entityId === 'attachments:library' || attachment.entityId === MESSAGE_ATTACHMENT_ENTITY_ID
      ? [base]
      : [base, { attachment: { ...attachment, storageMetadata: { assignments: [] } }, action: 'reassign' as const, requireProtected: true }]
  })
  await assertAttachmentOwnersAccess({ em: em as PostgreSqlEntityManager, auth, context, requests })

  for (const attachment of attachments) {
    if (attachment.entityId === 'attachments:library' && !hasUploadProvenance(attachment.storageMetadata, auth)) {
      return denyMessageAttachmentAccess()
    }
  }
  const messageIds = [...new Set(attachments.filter((attachment) => attachment.entityId === MESSAGE_ATTACHMENT_ENTITY_ID).map((attachment) => attachment.recordId))]
  if (messageIds.length) {
    const messages = await findWithDecryption(em as PostgreSqlEntityManager, Message, {
      id: { $in: messageIds }, tenantId, organizationId, deletedAt: null,
    }, undefined, { tenantId, organizationId })
    if (messages.length !== messageIds.length) return denyMessageAttachmentAccess()
    const recipients = await findWithDecryption(em as PostgreSqlEntityManager, MessageRecipient, {
      messageId: { $in: messages.map((message) => message.id) }, recipientUserId: auth.sub, deletedAt: null,
    }, undefined, { tenantId, organizationId })
    const recipientsByMessage = new Map(recipients.map((recipient) => [recipient.messageId, recipient]))
    for (const message of messages) {
      const scope = { tenantId, organizationId, userId: auth.sub }
      if (!(await resolveMessageReadAccess(access, scope, message, { recipient: recipientsByMessage.get(message.id) ?? null })).canRead) {
        return denyMessageAttachmentAccess()
      }
    }
  }
  if (attachments.some((attachment) => attachment.entityId !== 'attachments:library' && attachment.entityId !== MESSAGE_ATTACHMENT_ENTITY_ID)) {
    const rbac = access.container.resolve<{
      userHasAllFeatures(userId: string, features: string[], scope: { tenantId: string; organizationId: string | null }): Promise<boolean>
    }>('rbacService')
    if (!(await rbac.userHasAllFeatures(auth.sub, ['attachments.manage'], { tenantId, organizationId }))) {
      return denyMessageAttachmentAccess()
    }
  }
}
