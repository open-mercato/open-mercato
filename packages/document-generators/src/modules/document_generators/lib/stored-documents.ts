import type { EntityManager } from '@mikro-orm/postgresql'
import { GeneratedDocument } from '../data/entities'
import type { StoredDocumentRemover } from '../services/generated-document-retention-service'
import type { PreparedGeneratedDocument } from '../services/generation-history-service'

export const STORED_DOCUMENT_ENTITY_ID = 'document_generators:document'
export const STORED_DOCUMENT_ASSIGNMENT_TYPE = 'document_generators:generated_document'
export const STORED_DOCUMENT_PARTITION = 'privateAttachments'

type StoredDocumentOwner = { entityId: string; recordId: string }
type StoredDocumentAssignment = { type: string; id: string }

export type StoredDocumentAttachmentService = {
  createScoped(input: StoredDocumentOwner & {
    tenantId: string
    organizationId: string
    partitionCode: string
    fileName: string
    declaredMimeType?: string | null
    buffer: Buffer
    assignments?: StoredDocumentAssignment[]
    persistLink?: (tx: EntityManager, attachmentId: string) => Promise<void> | void
  }): Promise<{ id: string }>
  readScoped(input: {
    attachmentId: string
    auth: { sub: string; tenantId: string | null; orgId: string | null; [key: string]: unknown }
    expectedOwner: StoredDocumentOwner
    expectedAssignment?: StoredDocumentAssignment
    expectedPartitionCode?: string
    requirePrivatePartition?: boolean
    forceDownload?: boolean
  }): Promise<{ buffer: Buffer; contentType: string; contentDisposition: string; fileName: string; mimeType: string }>
  releaseScoped?(input: {
    attachmentId: string
    tenantId: string
    organizationId: string
    expectedOwner: StoredDocumentOwner
    expectedAssignment: StoredDocumentAssignment
    expectedPartitionCode?: string
  }): Promise<unknown>
}

type Resolver = <T = unknown>(name: string) => T

export function resolveStoredDocumentAttachmentService(resolve: Resolver): StoredDocumentAttachmentService | null {
  try {
    const service = resolve<Partial<StoredDocumentAttachmentService> | null | undefined>('attachmentService')
    if (!service || typeof service.createScoped !== 'function' || typeof service.readScoped !== 'function') return null
    return service as StoredDocumentAttachmentService
  } catch {
    return null
  }
}

export function storedDocumentOwner(resourceId: string): StoredDocumentOwner {
  return { entityId: STORED_DOCUMENT_ENTITY_ID, recordId: resourceId }
}

export function storedDocumentAssignment(historyId: string): StoredDocumentAssignment {
  return { type: STORED_DOCUMENT_ASSIGNMENT_TYPE, id: historyId }
}

export async function storeGeneratedDocument(input: {
  attachmentService: StoredDocumentAttachmentService
  prepared: PreparedGeneratedDocument
  buffer: Uint8Array
  fileName: string
  mimeType: string
}): Promise<{ historyId: string; attachmentId: string }> {
  const { attachmentService, prepared } = input
  const entity = prepared.entity
  const attachment = await attachmentService.createScoped({
    ...storedDocumentOwner(entity.resourceId),
    tenantId: entity.tenantId,
    organizationId: entity.organizationId,
    partitionCode: STORED_DOCUMENT_PARTITION,
    fileName: input.fileName,
    declaredMimeType: input.mimeType,
    buffer: Buffer.from(input.buffer),
    assignments: [storedDocumentAssignment(entity.id)],
    persistLink: async (tx, attachmentId) => {
      const linked = Object.assign(new GeneratedDocument(), entity, { attachmentId })
      await tx.persist(linked).flush()
    },
  })
  return { historyId: entity.id, attachmentId: attachment.id }
}

function isNotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const status = (error as { status?: unknown; statusCode?: unknown }).status ?? (error as { statusCode?: unknown }).statusCode
  return status === 404
}

export function createStoredDocumentRemover(attachmentService: StoredDocumentAttachmentService): StoredDocumentRemover | undefined {
  const releaseScoped = attachmentService.releaseScoped?.bind(attachmentService)
  if (!releaseScoped) return undefined
  return async ({ documents, tenantId, organizationId }) => {
    for (const document of documents) {
      try {
        await releaseScoped({
          attachmentId: document.attachmentId,
          tenantId,
          organizationId,
          expectedOwner: storedDocumentOwner(document.resourceId),
          expectedAssignment: storedDocumentAssignment(document.historyId),
          expectedPartitionCode: STORED_DOCUMENT_PARTITION,
        })
      } catch (error) {
        if (!isNotFound(error)) throw error
      }
    }
  }
}
