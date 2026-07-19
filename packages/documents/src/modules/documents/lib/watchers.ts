import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { DocumentWatcher } from '../data/entities'
import { resolveUserAccess } from './permissions'
import type { DocumentsServiceContainer } from './platformServices'

const logger = createLogger('documents').child({ component: 'watchers' })

export const DOCUMENTS_MAX_ACTIVE_WATCHERS = 100

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
  const recipients: string[] = []
  for (const watcher of watchers) {
    const userId = watcher.userId.toLowerCase()
    if (excludedUserIds.has(userId)) continue
    try {
      const tier = await resolveUserAccess(
        input.em,
        input.documentId,
        input.scope,
        watcher.userId,
        input.container,
      )
      if (tier) recipients.push(watcher.userId)
    } catch (error) {
      logger.error('Watcher access resolution failed', {
        documentId: input.documentId,
        recipientUserId: watcher.userId,
        err: error,
      })
    }
  }
  return recipients
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
