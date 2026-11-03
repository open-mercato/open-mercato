import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { DocumentWatcher } from '../data/entities'
import { loadScopedDocument, resolveLoadedDocumentUserAccess } from './permissions'
import type { DocumentsServiceContainer } from './platformServices'

const logger = createLogger('documents').child({ component: 'watchers' })

export const DOCUMENTS_MAX_ACTIVE_WATCHERS = 100
const WATCHER_ACCESS_RESOLUTION_CONCURRENCY = 4

export type DocumentWatcherScope = {
  tenantId: string
  organizationId: string
}

export async function resolveWatcherRecipients(input: {
  em: EntityManager
  container: DocumentsServiceContainer
  scope: DocumentWatcherScope
  documentId: string
  actorUserId: string
  excludeUserIds?: readonly string[]
}): Promise<string[]> {
  let watchers: DocumentWatcher[]
  try {
    watchers = await findWithDecryption(
      input.em,
      DocumentWatcher,
      {
        documentId: input.documentId,
        tenantId: input.scope.tenantId,
        organizationId: input.scope.organizationId,
        deletedAt: null,
      },
      {
        fields: ['userId'],
        orderBy: { createdAt: 'ASC', id: 'ASC' },
        limit: DOCUMENTS_MAX_ACTIVE_WATCHERS,
      },
      input.scope,
    )
  } catch (error) {
    logger.error('Watcher recipient lookup failed', {
      documentId: input.documentId,
      err: error,
    })
    return []
  }

  const excludedUserIds = new Set([
    input.actorUserId.toLowerCase(),
    ...(input.excludeUserIds ?? []).map((userId) => userId.toLowerCase()),
  ])
  const candidates = watchers.filter(
    (watcher) => !excludedUserIds.has(watcher.userId.toLowerCase()),
  )
  if (candidates.length === 0) return []

  // The document is identical for every candidate, so it is read once instead
  // of once per watcher. The remaining per-watcher role and share lookups run
  // through a bounded worker pool that preserves watcher order and keeps a
  // failed resolution fail-closed for that recipient alone.
  const scopedDocument = await loadScopedDocument(
    input.em,
    input.documentId,
    input.scope,
  ).catch((error: unknown) => {
    logger.error('Watcher document lookup failed', {
      documentId: input.documentId,
      err: error,
    })
    return null
  })
  if (!scopedDocument) return []

  const permitted: Array<string | null> = new Array(candidates.length).fill(null)
  let nextIndex = 0
  const workers = Array.from(
    { length: Math.min(WATCHER_ACCESS_RESOLUTION_CONCURRENCY, candidates.length) },
    async () => {
      while (nextIndex < candidates.length) {
        const index = nextIndex
        nextIndex += 1
        const watcher = candidates[index]!
        try {
          const tier = await resolveLoadedDocumentUserAccess(
            input.em,
            scopedDocument,
            input.scope,
            watcher.userId,
            input.container,
          )
          if (tier) permitted[index] = watcher.userId
        } catch (error) {
          logger.error('Watcher access resolution failed', {
            documentId: input.documentId,
            recipientUserId: watcher.userId,
            err: error,
          })
        }
      }
    },
  )
  await Promise.all(workers)
  return permitted.filter((userId): userId is string => userId !== null)
}

export async function isDocumentWatched(
  em: EntityManager,
  scope: DocumentWatcherScope & { userId: string },
  documentId: string,
): Promise<boolean> {
  const watcher = await findOneWithDecryption(
    em,
    DocumentWatcher,
    {
      documentId,
      userId: scope.userId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    },
    { fields: ['id'] },
    scope,
  )
  return watcher !== null
}
