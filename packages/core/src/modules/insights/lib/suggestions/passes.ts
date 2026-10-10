import { sql } from 'kysely'
import { listPassMarkers, markPassMarker, XRAY_ROLLUP_ALL_PROCESSES, XRAY_SUGGESTION_PASS_WINDOW_KEY } from '../analytics/rollups'
import type { AnalyticsDb, AnalyticsTrx } from '../analytics/query'
import type { ProjectionScope } from '../projection/types'
import { XRAY_SUGGESTION_FORCED_MIN_INTERVAL_MS, XRAY_SUGGESTION_INTERVAL_MS } from './constants'

/** Whether an organization's suggestions are due: no pass yet, or the last one is at least 24 hours old. */
export function isSuggestionPassDue(lastPassAt: string | null | undefined, dbNow: string): boolean {
  if (!lastPassAt) return true
  return Date.parse(dbNow) - Date.parse(lastPassAt) >= XRAY_SUGGESTION_INTERVAL_MS
}

/**
 * Whether an on-demand (forced) pass may run: no pass yet, or the last one finished at least
 * 30 seconds ago, so a burst of requests coalesces into one pass instead of queueing full passes.
 */
export function isForcedSuggestionPassAllowed(lastPassAt: string | null | undefined, dbNow: string): boolean {
  if (!lastPassAt) return true
  return Date.parse(dbNow) - Date.parse(lastPassAt) >= XRAY_SUGGESTION_FORCED_MIN_INTERVAL_MS
}

/** When each organization's last mining pass finished (ISO), keyed `tenantId|organizationId`. One query per page of scopes. */
export async function listSuggestionPasses(db: AnalyticsDb | AnalyticsTrx, scopes: readonly ProjectionScope[]): Promise<Map<string, string>> {
  return listPassMarkers(db, scopes, XRAY_SUGGESTION_PASS_WINDOW_KEY)
}

/** Records a finished mining pass of an organization (database clock). */
export async function markSuggestionPass(db: AnalyticsDb | AnalyticsTrx, scope: ProjectionScope): Promise<void> {
  await markPassMarker(db, scope, XRAY_SUGGESTION_PASS_WINDOW_KEY)
}

/**
 * Forgets the organization's last mining pass (after its projection was cleared by a rebuild or a
 * contract change), so the first tick after the projection is complete again mines it at once
 * instead of waiting for the 24-hour interval.
 */
export async function clearSuggestionPass(db: AnalyticsDb | AnalyticsTrx, scope: ProjectionScope): Promise<void> {
  await sql`
    delete from insights_process_rollups
    where tenant_id = ${scope.tenantId}
      and organization_id = ${scope.organizationId}
      and process_key = ${XRAY_ROLLUP_ALL_PROCESSES}
      and window_key = ${XRAY_SUGGESTION_PASS_WINDOW_KEY}
  `.execute(db)
}
