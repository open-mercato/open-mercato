import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { GeneratedDocument } from '../../data/entities'

export type GeneratedDocumentResourceScope = {
  tenantId: string
  organizationId: string
  resourceKind: string
  resourceId: string
}

export type StoredDocumentReference = {
  attachmentId: string
  historyId: string
  resourceId: string
}

export type StoredDocumentRemover = (input: {
  documents: StoredDocumentReference[]
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

    const documents: StoredDocumentReference[] = records.flatMap((record) => (
      typeof record.attachmentId === 'string' && record.attachmentId.length > 0
        ? [{ attachmentId: record.attachmentId, historyId: record.id, resourceId: record.resourceId }]
        : []
    ))
    if (documents.length > 0) {
      if (!this.removeStoredDocuments) {
        throw new Error('[internal] stored document removal is unavailable; refusing to orphan generated files')
      }
      await this.removeStoredDocuments({
        documents,
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
      removedAttachmentIds: documents.map((document) => document.attachmentId),
    }
  }
}
