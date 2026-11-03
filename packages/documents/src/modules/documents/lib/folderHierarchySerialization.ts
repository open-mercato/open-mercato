import type { EntityManager } from '@mikro-orm/postgresql'

const FOLDER_HIERARCHY_ADVISORY_LOCK_SQL = 'select pg_advisory_xact_lock(hashtextextended(?, 0))'

type FolderHierarchyMutationScope = {
  tenantId: string
  organizationId: string
}

function folderHierarchyMutationLockKey(scope: FolderHierarchyMutationScope): string {
  return `documents:folder-hierarchy:${scope.tenantId}:${scope.organizationId}`
}

/**
 * Serialize all folder hierarchy writes inside one tenant and organization.
 * The transaction owns the lock, so PostgreSQL releases it on commit/rollback.
 */
export async function acquireFolderHierarchyMutationLock(
  em: EntityManager,
  scope: FolderHierarchyMutationScope,
): Promise<void> {
  if (!em.isInTransaction()) {
    throw new Error('[internal] Folder hierarchy mutation lock requires an active transaction')
  }

  // SqlEntityManager.execute forwards the active transaction context. Calling the
  // bare connection here would let PostgreSQL release this xact lock immediately.
  await em.execute(
    FOLDER_HIERARCHY_ADVISORY_LOCK_SQL,
    [folderHierarchyMutationLockKey(scope)],
  )
}

export { FOLDER_HIERARCHY_ADVISORY_LOCK_SQL, folderHierarchyMutationLockKey }
