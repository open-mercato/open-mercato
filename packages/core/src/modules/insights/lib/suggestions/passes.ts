import { sql } from 'kysely'
import { listPassMarkers, markPassMarker, XRAY_ROLLUP_ALL_PROCESSES, XRAY_SUGGESTION_PASS_WINDOW_KEY } from '../analytics/rollups'
import type { AnalyticsDb, AnalyticsTrx } from '../analytics/query'
import type { ProjectionScope } from '../projection/types'
import { XRAY_SUGGESTION_FORCED_MIN_INTERVAL_MS, XRAY_SUGGESTION_INTERVAL_MS, XRAY_SUGGESTION_REQUEST_TTL_MS } from './constants'

/**
 * Marker row (per organization) of a pending on-demand mining request, kept with the pass markers
 * in `insights_process_rollups` (`process_key = '*'`): written when the request enqueues its forced
 * job, cleared by that job. Never a pass: the pass marker alone tells when the last pass finished.
 */
export const XRAY_SUGGESTION_REQUEST_WINDOW_KEY = '__suggestion_request__'

const REQUEST_MARKER_WINDOW_START = '1970-01-01T00:00:00.000Z'

/** Whether an organization's suggestions are due: no pass yet, or the last one is at least 24 hours old. */
export function isSuggestionPassDue(lastPassAt: string | null | undefined, dbNow: string): boolean {
  if (!lastPassAt) return true
  return Date.parse(dbNow) - Date.parse(lastPassAt) >= XRAY_SUGGESTION_INTERVAL_MS
}

/**
 * Whether an on-demand (forced) pass may run: no pass yet, or the last one finished at least
 * 15 minutes ago, so requests coalesce into at most one full pass per organization and interval.
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

/**
 * Claims an organization's on-demand mining request in one statement (database clock): recorded
 * when no request is pending or the pending one is older than `XRAY_SUGGESTION_REQUEST_TTL_MS`
 * (its job was lost or failed). Concurrent claims serialize on the marker row, so exactly one of
 * them wins. Returns the recorded time (ISO, microseconds), or `null` when a pending request already
 * covers this one (its forced job is still waiting or running, so no second job is enqueued).
 */
export async function claimSuggestionRequest(db: AnalyticsDb | AnalyticsTrx, scope: ProjectionScope): Promise<string | null> {
  const result = await sql<{ requested_at: string }>`
    insert into insights_process_rollups
      (tenant_id, organization_id, process_key, window_key, window_start, window_end, computed_at, metrics, created_at)
    values (
      ${scope.tenantId}, ${scope.organizationId}, ${XRAY_ROLLUP_ALL_PROCESSES}, ${XRAY_SUGGESTION_REQUEST_WINDOW_KEY},
      ${REQUEST_MARKER_WINDOW_START}::timestamptz, now(), now(), '{}'::jsonb, now()
    )
    on conflict (tenant_id, organization_id, process_key, window_key, window_start) do update
      set window_end = excluded.window_end, computed_at = excluded.computed_at
      where insights_process_rollups.computed_at <= excluded.computed_at - (${XRAY_SUGGESTION_REQUEST_TTL_MS}::int * interval '1 millisecond')
    returning to_char(computed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as requested_at
  `.execute(db)
  return result.rows[0]?.requested_at ?? null
}

/**
 * Clears an organization's on-demand mining request when it was recorded at or before `through`
 * (ISO): the forced job passes its start time (database clock), so a request recorded after the job
 * started stays pending for its own job; a failed enqueue passes the time of its own claim.
 */
export async function clearSuggestionRequest(db: AnalyticsDb | AnalyticsTrx, scope: ProjectionScope, through: string): Promise<void> {
  await sql`
    delete from insights_process_rollups
    where tenant_id = ${scope.tenantId}
      and organization_id = ${scope.organizationId}
      and process_key = ${XRAY_ROLLUP_ALL_PROCESSES}
      and window_key = ${XRAY_SUGGESTION_REQUEST_WINDOW_KEY}
      and computed_at <= ${through}::timestamptz
  `.execute(db)
}
