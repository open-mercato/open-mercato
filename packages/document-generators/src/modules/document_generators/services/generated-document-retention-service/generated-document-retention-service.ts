import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { GeneratedDocument } from '../../data/entities'

export type GeneratedDocumentResourceScope = {
  tenantId: string
  organizationId: string
  resourceKind: string
  resourceId: string
}

export type StoredDocumentRemover = (input: {
  attachmentIds: string[]
  tenantId: string
  organizationId: string
}) => Promise<void>

export type ResourceErasureResult = {
  anonymizedCount: number
  removedAttachmentIds: string[]
}

export class GeneratedDocumentRetentionService {
  constructor(
    private readonly em: EntityManager,
    private readonly removeStoredDocuments?: StoredDocumentRemover,
  ) {}

  async eraseForResource(scope: GeneratedDocumentResourceScope): Promise<ResourceErasureResult> {
    const writeEm = this.em.fork()
    const records = await findWithDecryption(
      writeEm,
      GeneratedDocument,
      {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        resourceKind: scope.resourceKind,
        resourceId: scope.resourceId,
      },
      {},
      { tenantId: scope.tenantId, organizationId: scope.organizationId },
    )
    if (records.length === 0) return { anonymizedCount: 0, removedAttachmentIds: [] }

    const attachmentIds = [...new Set(records
      .map((record) => record.attachmentId)
      .filter((attachmentId): attachmentId is string => typeof attachmentId === 'string' && attachmentId.length > 0))]
    if (attachmentIds.length > 0 && this.removeStoredDocuments) {
      await this.removeStoredDocuments({
        attachmentIds,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      })
    }

    for (const record of records) {
      record.resourceLabel = record.resourceId
      record.attachmentId = null
    }
    await writeEm.flush()
    return {
      anonymizedCount: records.length,
      removedAttachmentIds: this.removeStoredDocuments ? attachmentIds : [],
    }
  }
}
