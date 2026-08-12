import type { EntityManager } from '@mikro-orm/postgresql'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Attachment, AttachmentPartition } from '../data/entities'
import { checkAttachmentAccess } from './access'
import { readAttachmentMetadata } from './metadata'

export type AttachmentRecordTarget = {
  entityId: string
  recordId: string
}

export type AttachmentTargetAccessInput = {
  attachmentId: string
  tenantId: string
  organizationId: string
  auth: Exclude<AuthContext, null>
  targets: AttachmentRecordTarget[]
}

export class AttachmentTargetAccessService {
  constructor(private readonly em: EntityManager) {}

  async canAccessLinkedTarget(input: AttachmentTargetAccessInput): Promise<boolean> {
    if (!input.targets.length) return false
    const attachment = await findOneWithDecryption(
      this.em,
      Attachment,
      {
        id: input.attachmentId,
        tenantId: input.tenantId,
        organizationId: input.organizationId,
      },
      {},
      { tenantId: input.tenantId, organizationId: input.organizationId },
    )
    if (!attachment) return false

    const partition = await this.em.findOne(AttachmentPartition, { code: attachment.partitionCode })
    if (!partition) return false
    if (!checkAttachmentAccess(input.auth, attachment, partition, { requireAuthForPublic: true }).ok) return false

    const metadata = readAttachmentMetadata(attachment.storageMetadata)
    return input.targets.some((target) => (
      (attachment.entityId === target.entityId && attachment.recordId === target.recordId)
      || metadata.assignments?.some((assignment) => (
        assignment.type === target.entityId && assignment.id === target.recordId
      )) === true
    ))
  }
}
