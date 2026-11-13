import { createLogger } from '@open-mercato/shared/lib/logger'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { runAiMaintenanceTenant } from '../database'
import { isDatabaseRuntimeEnabled } from '@open-mercato/shared/lib/db/runtime'

const logger = createLogger('ai_assistant')

/** Default retention window for the ai_token_usage_events table (days). */
const DEFAULT_RETENTION_DAYS = 90
/** Batch size for delete operations to avoid long locks. */
const DELETE_BATCH_SIZE = 5_000
/** Number of trailing days to reconcile session_count against events table. */
const RECONCILE_TRAILING_DAYS = 7

export const metadata: WorkerMeta = {
  queue: 'ai-token-usage-prune',
  id: 'ai_assistant:token-usage-prune',
  concurrency: 1,
}

export interface TokenUsagePruneRunOptions {
  em: EntityManager
  tenantId?: string
  /** Override for deterministic tests. Defaults to `new Date()`. */
  now?: Date
  /** Override retention days (default from env). */
  retentionDays?: number
  /** Override batch size (default 5000). */
  batchSize?: number
}

export interface TokenUsagePruneSummary {
  eventsDeleted: number
  dailyRowsReconciled: number
}

/**
 * Reads `AI_TOKEN_USAGE_EVENTS_RETENTION_DAYS` env var (default 90).
 */
function resolveRetentionDays(): number {
  const raw = process.env.AI_TOKEN_USAGE_EVENTS_RETENTION_DAYS
  if (!raw) return DEFAULT_RETENTION_DAYS
  const parsed = parseInt(raw.trim(), 10)
  return !isNaN(parsed) && parsed > 0 ? parsed : DEFAULT_RETENTION_DAYS
}

/**
 * Deletes events older than the retention cutoff in batches of `batchSize` to
 * avoid long table locks. Returns total rows deleted.
 */
async function pruneOldEvents(
  connection: ReturnType<EntityManager['getConnection']>,
  cutoff: Date,
  batchSize: number,
  tenantId?: string,
): Promise<number> {
  let totalDeleted = 0
  for (let batch = 0; batch < 1000; batch += 1) {
    const result = await connection.execute(
      `
      delete from ai_token_usage_events
      where id in (
        select id from ai_token_usage_events
        where created_at < ?
        ${tenantId ? 'and tenant_id = ?' : ''}
        limit ?
      )
      `,
      tenantId ? [cutoff, tenantId, batchSize] : [cutoff, batchSize],
      'run',
    ) as { affectedRows?: number; rowCount?: number } | undefined
    const deleted = result?.affectedRows ?? result?.rowCount ?? 0
    totalDeleted += deleted
    if (deleted < batchSize) break
  }
  return totalDeleted
}

/**
 * Reconciles `session_count` on daily rollup rows for the trailing N days by
 * recomputing it directly from the events table. This corrects any drift caused
 * by out-of-order event delivery, retention pruning, or failed incremental
 * writes.
 */
async function reconcileSessionCounts(
  connection: ReturnType<EntityManager['getConnection']>,
  now: Date,
  trailingDays: number,
  tenantId?: string,
): Promise<number> {
  const trailingStart = new Date(now)
  trailingStart.setUTCDate(trailingStart.getUTCDate() - trailingDays)
  const from = trailingStart.toISOString().slice(0, 10)

  // Recompute session_count for each (tenant_id, day, agent_id, model_id, org)
  // combination by counting distinct session_ids from the events table.
  const rows = await connection.execute(
    `
    select
      d.id,
      count(distinct e.session_id)::bigint as computed_session_count
    from ai_token_usage_daily d
    left join ai_token_usage_events e
      on e.tenant_id = d.tenant_id
      and e.agent_id = d.agent_id
      and e.model_id = d.model_id
      and date_trunc('day', e.created_at)::date = d.day
      and (
        (d.organization_id is null and e.organization_id is null)
        or (d.organization_id is not null and e.organization_id = d.organization_id)
      )
    where d.day >= ?::date
    ${tenantId ? 'and d.tenant_id = ?' : ''}
    group by d.id
    `,
    tenantId ? [from, tenantId] : [from],
    'all',
  )

  if (!Array.isArray(rows) || rows.length === 0) return 0

  let reconciled = 0
  for (const row of rows as Array<Record<string, unknown>>) {
    const rowId = row.id as string
    const computed = typeof row.computed_session_count === 'string'
      ? parseInt(row.computed_session_count, 10)
      : (row.computed_session_count as number) ?? 0
    await connection.execute(
      `update ai_token_usage_daily set session_count = ?, updated_at = now() where id = ?${tenantId ? ' and tenant_id = ?' : ''}`,
      tenantId ? [computed, rowId, tenantId] : [computed, rowId],
      'run',
    )
    reconciled += 1
  }

  return reconciled
}

/**
 * Core logic for the token-usage prune worker. Exported for unit testing.
 *
 * 1. Resolves the retention cutoff from `AI_TOKEN_USAGE_EVENTS_RETENTION_DAYS`.
 * 2. Deletes events older than the cutoff in batches of 5_000.
 * 3. Reconciles `session_count` on the daily rollup for trailing 7 days.
 *
 * Phase 6.4 of spec `2026-04-28-ai-agents-agentic-loop-controls`.
 */
export async function runTokenUsagePrune(
  options: TokenUsagePruneRunOptions,
): Promise<TokenUsagePruneSummary> {
  const now = options.now ?? new Date()
  const retentionDays = options.retentionDays ?? resolveRetentionDays()
  const batchSize = options.batchSize ?? DELETE_BATCH_SIZE

  const cutoff = new Date(now)
  cutoff.setUTCDate(cutoff.getUTCDate() - retentionDays)

  const connection = options.em.getConnection()

  let eventsDeleted = 0
  try {
    eventsDeleted = await pruneOldEvents(connection, cutoff, batchSize, options.tenantId)
  } catch (error) {
    logger.error('Failed to prune old events', { err: error })
  }

  let dailyRowsReconciled = 0
  try {
    dailyRowsReconciled = await reconcileSessionCounts(connection, now, RECONCILE_TRAILING_DAYS, options.tenantId)
  } catch (error) {
    logger.error('Failed to reconcile session counts', { err: error })
  }

  logger.info('Token-usage prune done', { eventsDeleted, dailyRowsReconciled, retentionDays })

  return { eventsDeleted, dailyRowsReconciled }
}

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

export default async function handle(
  _job: QueuedJob,
  ctx: HandlerContext,
): Promise<void> {
  const em = ctx.resolve<EntityManager>('em')
  if (!isDatabaseRuntimeEnabled()) {
    await runTokenUsagePrune({ em })
    return
  }
  const tenants: unknown = await em.getConnection().execute('select distinct tenant_id from ai_token_usage_events union select distinct tenant_id from ai_token_usage_daily')
  if (!Array.isArray(tenants)) throw new Error('[internal] Invalid AI usage tenant discovery result')
  for (const row of tenants as Array<{ tenant_id: string }>) {
    await runAiMaintenanceTenant({ tenantId: row.tenant_id }, em, async (tenantEm) => {
      await runTokenUsagePrune({ em: tenantEm, tenantId: row.tenant_id })
    })
  }
}
