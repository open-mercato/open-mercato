import { raw } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { DocumentShare } from '../data/entities'

export type DocumentShareCountScope = {
  tenantId: string
  organizationId: string
}

type GroupedShareCountRow = {
  documentId?: unknown
  document_id?: unknown
  shareCount?: unknown
  share_count?: unknown
}

export async function loadDocumentShareCounts(
  em: EntityManager,
  scope: DocumentShareCountScope,
  documentIds: readonly string[],
): Promise<Map<string, number>> {
  const shareCounts = new Map<string, number>()
  if (documentIds.length === 0) return shareCounts
  const groupedShares = await em
    .createQueryBuilder(DocumentShare, 'document_share')
    .select([
      'document_share.documentId',
      raw('count(*) as "shareCount"'),
    ])
    .where({
      documentId: { $in: [...documentIds] },
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    })
    .groupBy('document_share.documentId')
    .execute<GroupedShareCountRow[]>('all', false)
  for (const row of groupedShares) {
    const documentId = row.documentId ?? row.document_id
    const count = Number(row.shareCount ?? row.share_count ?? 0)
    if (typeof documentId === 'string' && Number.isFinite(count)) shareCounts.set(documentId, count)
  }
  return shareCounts
}
