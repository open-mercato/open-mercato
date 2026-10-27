import type { DataSyncAdapter } from './adapter'
import type { SyncRunService } from './sync-run-service'

type SyncScope = {
  organizationId: string
  tenantId: string
}

export { resolveAdapterForIntegration } from './adapter-registry'

export function persistsSharedCursor(adapter: DataSyncAdapter | null | undefined, entityType: string): boolean {
  return adapter?.persistsSharedCursor?.(entityType) ?? true
}

/**
 * Start position for a non-full run. Entity types that mirror their cursor into
 * the shared `sync_cursors` row read it from there. Entity types whose adapter
 * opted out never write that row, so reading it would silently turn every
 * incremental run into a full one — they resume from their own last run
 * instead.
 */
export async function resolveStartCursor(params: {
  syncRunService: SyncRunService
  adapter?: DataSyncAdapter | null
  integrationId: string
  entityType: string
  direction: 'import' | 'export'
  scope: SyncScope
}): Promise<string | null> {
  const { syncRunService, adapter, integrationId, entityType, direction, scope } = params
  if (persistsSharedCursor(adapter, entityType)) {
    return syncRunService.resolveCursor(integrationId, entityType, direction, scope)
  }
  return syncRunService.resolveResumeCursor(integrationId, entityType, direction, scope)
}
