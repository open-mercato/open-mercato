import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/core'
import type { EntityManager as PostgreSqlEntityManager } from '@mikro-orm/postgresql'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { Attachment } from '@open-mercato/core/modules/attachments/data/entities'
import { createAttachmentAccessContext } from '@open-mercato/core/modules/attachments'
import { assertAttachmentOwnerAccess } from '@open-mercato/core/modules/attachments/lib/access-query'
import { hasUploadProvenance } from '@open-mercato/core/modules/attachments/lib/uploadProvenance'
import { Message } from '../data/entities'
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
  const auth = access?.auth
  if (!auth?.sub || auth.tenantId !== tenantId || auth.orgId !== organizationId
    || attachment.tenantId !== tenantId || attachment.organizationId !== organizationId) {
    return denyMessageAttachmentAccess()
  }
  await assertAttachmentOwnerAccess({
    em: em as PostgreSqlEntityManager,
    auth, attachment,
    action: attachment.entityId === MESSAGE_ATTACHMENT_ENTITY_ID && action === 'reassign' ? 'read' : action,
    context: createAttachmentAccessContext(access!.container),
  })

  if (attachment.entityId === 'attachments:library') {
    if (!hasUploadProvenance(attachment.storageMetadata, auth)) return denyMessageAttachmentAccess()
    return
  }
  if (attachment.entityId === MESSAGE_ATTACHMENT_ENTITY_ID) {
    const message = await findOneWithDecryption(em as PostgreSqlEntityManager, Message, {
      id: attachment.recordId, tenantId, organizationId, deletedAt: null,
    }, undefined, { tenantId, organizationId })
    if (!message) return denyMessageAttachmentAccess()
    const scope = { tenantId, organizationId, userId: auth.sub }
    if (!(await resolveMessageReadAccess(access!, scope, message)).canRead) return denyMessageAttachmentAccess()
    return
  }
  await assertAttachmentOwnerAccess({
    em: em as PostgreSqlEntityManager,
    auth, attachment: { ...attachment, storageMetadata: { assignments: [] } },
    action: 'reassign', requireProtected: true,
    context: createAttachmentAccessContext(access!.container),
  })
  const rbac = access!.container.resolve<{
    userHasAllFeatures(userId: string, features: string[], scope: { tenantId: string; organizationId: string | null }): Promise<boolean>
  }>('rbacService')
  if (!(await rbac.userHasAllFeatures(auth.sub, ['attachments.manage'], { tenantId, organizationId }))) {
    return denyMessageAttachmentAccess()
  }
}
