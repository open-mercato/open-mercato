import { sql, type Kysely, type Transaction } from 'kysely'
import type { ProjectionCursor } from './store'
import type { ProjectionScope, XrayDatabase } from './types'

export type XrayCursorState = Pick<ProjectionCursor, 'status' | 'scanId' | 'pendingRebuildKeys' | 'lastCreatedAt' | 'contractHashes'>

function readKeys(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

function readHashes(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const hashes: Record<string, string> = {}
  for (const [key, hash] of Object.entries(value as Record<string, unknown>)) {
    if (typeof hash === 'string') hashes[key] = hash
  }
  return hashes
}

/**
 * The completeness-relevant state of an organization's cursor, read with `FOR SHARE` inside the
 * caller's transaction: a rebuild or contract change that wants to update the cursor waits until
 * the caller commits, and one that already committed is seen. `null` without a cursor.
 */
export async function lockXrayCursorState(trx: Transaction<XrayDatabase> | Kysely<XrayDatabase>, scope: ProjectionScope): Promise<XrayCursorState | null> {
  const result = await sql<{ status: string; scan_id: string | null; pending_rebuild_keys: unknown; last_created_at: Date | string | null; contract_hashes: unknown }>`
    select status, scan_id::text as scan_id, pending_rebuild_keys, last_created_at, contract_hashes
    from insights_process_cursors
    where tenant_id = ${scope.tenantId} and organization_id = ${scope.organizationId}
    for share
  `.execute(trx)
  const row = result.rows[0]
  if (!row) return null
  return {
    status: row.status === 'idle' ? 'idle' : 'backfilling',
    scanId: row.scan_id,
    pendingRebuildKeys: readKeys(row.pending_rebuild_keys),
    lastCreatedAt: row.last_created_at === null ? null : new Date(row.last_created_at).toISOString(),
    contractHashes: readHashes(row.contract_hashes),
  }
}

/** Order-independent comparison of two contract hash maps (`null` = not adopted yet). */
export function sameContractHashes(left: Record<string, string> | null, right: Record<string, string> | null): boolean {
  if (left === null || right === null) return left === right
  const leftKeys = Object.keys(left)
  return leftKeys.length === Object.keys(right).length && leftKeys.every((key) => right[key] === left[key])
}

/**
 * Whether an organization's projection is complete enough to precompute from (rollups,
 * suggestion mining): it has a positioned cursor, is `idle`, runs no range scan (backfill or
 * reconciliation) and has no process cleared and waiting for its rebuild (the conditions of
 * `readProjectionState`, plus the pending rebuilds). Work enqueued for an incomplete organization
 * would only be skipped and re-enqueued by every tick until the scan finishes.
 */
export function isXrayCursorComplete(
  cursor: Pick<ProjectionCursor, 'status' | 'scanId' | 'pendingRebuildKeys' | 'lastCreatedAt'> | null,
): boolean {
  if (!cursor) return false
  return cursor.status === 'idle'
    && !cursor.scanId
    && cursor.pendingRebuildKeys.length === 0
    && cursor.lastCreatedAt !== null
}
