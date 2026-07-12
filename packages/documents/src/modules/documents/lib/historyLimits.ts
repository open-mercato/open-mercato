import type { EntityManager } from '@mikro-orm/postgresql'
import { type Kysely, sql } from 'kysely'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { DocumentComment, DocumentVersion } from '../data/entities'
import {
  DOCUMENTS_MAX_COMMENTS_PER_DOCUMENT,
  DOCUMENTS_MAX_VERSION_STORAGE_BYTES,
  DOCUMENTS_MAX_VERSIONS_PER_DOCUMENT,
} from './historyPolicy'

export {
  DOCUMENTS_COMMENT_LIST_PAGE_SIZE,
  DOCUMENTS_MAX_COMMENTS_PER_DOCUMENT,
  DOCUMENTS_MAX_VERSION_STORAGE_BYTES,
  DOCUMENTS_MAX_VERSIONS_PER_DOCUMENT,
  DOCUMENTS_VERSION_LIST_PAGE_SIZE,
} from './historyPolicy'

export type DocumentHistoryScope = {
  tenantId: string
  organizationId: string
  documentId: string
}

export type StoredDocumentVersionResource = {
  id: string
  createdAt: Date | string
  storageBytes: number
}

type HistoryDatabase = {
  document_versions: {
    id: string
    tenant_id: string
    organization_id: string
    document_id: string
    created_at: Date
    yjs_snapshot: Buffer
    content_html: string | null
  }
}

export function documentVersionStorageBytes(input: {
  yjsSnapshot: Buffer | Uint8Array
  contentHtml?: string | null
}): number {
  return input.yjsSnapshot.byteLength + Buffer.byteLength(input.contentHtml ?? '', 'utf8')
}

function quotaExceeded(): never {
  throw new CrudHttpError(413, { error: 'documents.versions.quotaExceeded' })
}

export function planDocumentVersionRetention(input: {
  stored: StoredDocumentVersionResource[]
  incomingStorageBytes: number
  protectedIds?: Iterable<string>
  maxCount?: number
  maxStorageBytes?: number
}): string[] {
  const maxCount = input.maxCount ?? DOCUMENTS_MAX_VERSIONS_PER_DOCUMENT
  const maxStorageBytes = input.maxStorageBytes ?? DOCUMENTS_MAX_VERSION_STORAGE_BYTES
  if (
    !Number.isSafeInteger(input.incomingStorageBytes)
    || input.incomingStorageBytes < 0
    || input.incomingStorageBytes > maxStorageBytes
  ) {
    return quotaExceeded()
  }

  const protectedIds = new Set(
    Array.from(input.protectedIds ?? [], (id) => id.toLowerCase()),
  )
  const stored = [...input.stored].sort((left, right) => {
    const timestampDifference = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
    return timestampDifference || left.id.localeCompare(right.id)
  })
  let retainedCount = stored.length + 1
  let retainedStorageBytes = stored.reduce((total, row) => {
    if (!Number.isSafeInteger(row.storageBytes) || row.storageBytes < 0) return quotaExceeded()
    const nextTotal = total + row.storageBytes
    if (!Number.isSafeInteger(nextTotal)) return quotaExceeded()
    return nextTotal
  }, input.incomingStorageBytes)
  const pruneIds: string[] = []

  for (const row of stored) {
    if (retainedCount <= maxCount && retainedStorageBytes <= maxStorageBytes) break
    if (protectedIds.has(row.id.toLowerCase())) continue
    pruneIds.push(row.id)
    retainedCount -= 1
    retainedStorageBytes -= row.storageBytes
  }

  if (retainedCount > maxCount || retainedStorageBytes > maxStorageBytes) return quotaExceeded()
  return pruneIds
}

export async function enforceDocumentVersionRetention(
  em: EntityManager,
  scope: DocumentHistoryScope,
  incoming: { yjsSnapshot: Buffer | Uint8Array; contentHtml?: string | null },
  protectedIds: Iterable<string> = [],
): Promise<string[]> {
  const db = em.getKysely() as unknown as Kysely<HistoryDatabase>
  const rows = await db
    .selectFrom('document_versions')
    .select(['id', 'created_at'])
    .select(sql<number>`octet_length(${sql.ref('yjs_snapshot')}) + coalesce(octet_length(${sql.ref('content_html')}), 0)`.as('storage_bytes'))
    .where('tenant_id', '=', scope.tenantId)
    .where('organization_id', '=', scope.organizationId)
    .where('document_id', '=', scope.documentId)
    .orderBy('created_at', 'asc')
    .orderBy('id', 'asc')
    .execute() as Array<{ id: string; created_at: Date | string; storage_bytes: number | string }>

  const stored = rows.map((row) => ({
    id: String(row.id),
    createdAt: row.created_at,
    storageBytes: Number(row.storage_bytes),
  }))
  const pruneIds = planDocumentVersionRetention({
    stored,
    incomingStorageBytes: documentVersionStorageBytes(incoming),
    protectedIds,
  })
  if (!pruneIds.length) return []

  const deleted = await em.nativeDelete(DocumentVersion, {
    id: { $in: pruneIds },
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    documentId: scope.documentId,
  })
  if (deleted !== pruneIds.length) {
    throw new CrudHttpError(409, { error: 'Record changed by another user' })
  }
  return pruneIds
}

export async function assertDocumentCommentCapacity(
  em: EntityManager,
  scope: DocumentHistoryScope,
): Promise<void> {
  const count = await em.count(DocumentComment, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    documentId: scope.documentId,
    deletedAt: null,
  })
  if (count >= DOCUMENTS_MAX_COMMENTS_PER_DOCUMENT) {
    throw new CrudHttpError(413, { error: 'documents.comments.limitExceeded' })
  }
}
