import { sql } from 'kysely'
import type { ProjectionScope } from '../projection/types'
import type { AnalyticsDb, AnalyticsTrx } from './query'
import type { ResolvedWindow } from './window'
import {
  XRAY_ROLLUP_METRICS_VERSION,
  rollupMetricsSchema,
  type RollupMetrics,
} from './types'

/** A rollup older than this is not served; the rollup worker refreshes rows every 15 minutes. */
export const XRAY_ROLLUP_MAX_AGE_MS = 20 * 60_000

/** Marker row (per organization) recording the last invalidation of its rollups. */
export const XRAY_ROLLUP_INVALIDATION_WINDOW_KEY = '__invalidated__'

export const XRAY_ROLLUP_ALL_PROCESSES = '*'

const MARKER_WINDOW_START = '1970-01-01T00:00:00.000Z'

export type RollupReadInput = {
  scope: ProjectionScope
  processKey: string
  window: ResolvedWindow
  contractHash: string
  settingsFingerprint: string
  maxAgeMs?: number
}

/**
 * The stored rollup of a default window when it is fresh: the same window bounds, computed
 * within `maxAgeMs` of the database clock, after the organization's last invalidation, under
 * the current metrics version, process contract, settings fingerprint and time zone.
 * Anything else returns `null` and the caller computes live.
 */
export async function readFreshRollup(db: AnalyticsDb | AnalyticsTrx, input: RollupReadInput): Promise<RollupMetrics | null> {
  if (!input.window.windowKey) return null
  const maxAgeMs = Math.max(0, Math.trunc(input.maxAgeMs ?? XRAY_ROLLUP_MAX_AGE_MS))
  const result = await sql<{ metrics: unknown }>`
    select rollups.metrics
    from insights_process_rollups rollups
    where rollups.tenant_id = ${input.scope.tenantId}
      and rollups.organization_id = ${input.scope.organizationId}
      and rollups.process_key = ${input.processKey}
      and rollups.window_key = ${input.window.windowKey}
      and rollups.window_start = ${input.window.from}::timestamptz
      and rollups.window_end = ${input.window.to}::timestamptz
      and rollups.computed_at >= now() - (${maxAgeMs}::int * interval '1 millisecond')
      and not exists (
        select 1 from insights_process_rollups markers
        where markers.tenant_id = rollups.tenant_id
          and markers.organization_id = rollups.organization_id
          and markers.process_key = ${XRAY_ROLLUP_ALL_PROCESSES}
          and markers.window_key = ${XRAY_ROLLUP_INVALIDATION_WINDOW_KEY}
          and markers.computed_at >= rollups.computed_at
      )
  `.execute(db)
  const row = result.rows[0]
  if (!row) return null
  const parsed = rollupMetricsSchema.safeParse(row.metrics)
  if (!parsed.success) return null
  const metrics = parsed.data
  if (metrics.version !== XRAY_ROLLUP_METRICS_VERSION) return null
  if (metrics.contractHash !== input.contractHash) return null
  if (metrics.settingsFingerprint !== input.settingsFingerprint) return null
  if (metrics.timeZone !== input.window.timeZone) return null
  return metrics
}

/**
 * Writes one window's rollup at `(tenant, organization, process, window key, window start)`.
 * `computedAt` is the database time the computation's snapshot started; a computation never
 * overwrites a newer one, so repeating a pass is idempotent and late writers lose.
 */
export async function upsertRollup(
  db: AnalyticsDb,
  input: { scope: ProjectionScope; processKey: string; window: ResolvedWindow; computedAt: string; metrics: RollupMetrics },
): Promise<boolean> {
  if (!input.window.windowKey) throw new Error('[internal] Only default windows are rolled up')
  const result = await sql<{ id: string }>`
    insert into insights_process_rollups
      (tenant_id, organization_id, process_key, window_key, window_start, window_end, computed_at, metrics, created_at)
    values (
      ${input.scope.tenantId}, ${input.scope.organizationId}, ${input.processKey}, ${input.window.windowKey},
      ${input.window.from}::timestamptz, ${input.window.to}::timestamptz, ${input.computedAt}::timestamptz,
      ${JSON.stringify(input.metrics)}::jsonb, now()
    )
    on conflict (tenant_id, organization_id, process_key, window_key, window_start) do update
      set window_end = excluded.window_end, computed_at = excluded.computed_at, metrics = excluded.metrics
      where insights_process_rollups.computed_at <= excluded.computed_at
    returning id
  `.execute(db)
  return result.rows.length > 0
}

/**
 * Invalidates every rollup of an organization (after an undo voided events, or after a
 * rebuild): stamps the marker with the database clock, so rows computed from a snapshot that
 * started before it are never served, including rows written later by a computation that was
 * already running. The marker only moves forward (`greatest`), so a concurrent invalidation
 * that committed later with an earlier clock reading never reopens stale rollups.
 */
export async function markRollupsInvalidated(db: AnalyticsDb, scope: ProjectionScope): Promise<void> {
  await sql`
    insert into insights_process_rollups
      (tenant_id, organization_id, process_key, window_key, window_start, window_end, computed_at, metrics, created_at)
    values (
      ${scope.tenantId}, ${scope.organizationId}, ${XRAY_ROLLUP_ALL_PROCESSES}, ${XRAY_ROLLUP_INVALIDATION_WINDOW_KEY},
      ${MARKER_WINDOW_START}::timestamptz, clock_timestamp(), clock_timestamp(), '{}'::jsonb, now()
    )
    on conflict (tenant_id, organization_id, process_key, window_key, window_start) do update
      set window_end = greatest(insights_process_rollups.window_end, excluded.window_end),
        computed_at = greatest(insights_process_rollups.computed_at, excluded.computed_at)
  `.execute(db)
}
