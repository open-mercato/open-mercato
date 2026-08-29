import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { DocumentFavorite } from '../data/entities'

export type DocumentFavoriteScope = {
  tenantId: string
  organizationId: string
  userId: string
}

export async function loadDocumentFavoriteIds(
  em: EntityManager,
  scope: DocumentFavoriteScope,
  documentIds: readonly string[],
): Promise<Set<string>> {
  const uniqueDocumentIds = Array.from(new Set(documentIds))
  if (uniqueDocumentIds.length === 0) return new Set()

  const favorites = await findWithDecryption(em, DocumentFavorite, {
    documentId: { $in: uniqueDocumentIds },
    userId: scope.userId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  }, { fields: ['documentId'] }, { tenantId: scope.tenantId, organizationId: scope.organizationId })
  return new Set(favorites.map((favorite) => favorite.documentId))
}

export async function isDocumentFavorite(
  em: EntityManager,
  scope: DocumentFavoriteScope,
  documentId: string,
): Promise<boolean> {
  return (await loadDocumentFavoriteIds(em, scope, [documentId])).has(documentId)
}
