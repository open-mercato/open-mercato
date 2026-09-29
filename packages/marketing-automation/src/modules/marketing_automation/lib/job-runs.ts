import type { EntityManager } from '@mikro-orm/postgresql'
import { MarketingJobRun } from '../data/entities.js'

/**
 * A log of background job executions, for the morning-after question.
 *
 * Runs tell you what happened to a customer; this tells you whether the machinery ran at all. A sweep that
 * silently stopped firing looks identical to a sweep with nothing to do — until one of these rows shows the
 * last execution was four days ago.
 */

export type JobRunScope = { tenantId: string; organizationId: string }

/** The jobs this module runs. A string, not an enum, so adding one needs no migration. */
export type JobKind = 'sweep' | 'due_runs' | 'dispatch' | 'lead_digest'

export type JobRunResult = { counters?: Record<string, number> }

/**
 * Records one execution around the work it describes.
 *
 * The row is written BEFORE the work starts, so a job that crashes hard — or is killed mid-flight — still
 * leaves a `running` row with a start time rather than no trace at all. That is the state worth being able
 * to see, and a log written only on success can never show it.
 *
 * A failure is recorded and then RE-THROWN: the queue's retry and dead-lettering are what they are, and
 * swallowing the error here to keep the log tidy would turn a failed job into a successful one.
 */
export async function recordJobRun<T extends JobRunResult>(
  em: EntityManager,
  scope: JobRunScope,
  input: { kind: JobKind; campaignId?: string | null },
  work: () => Promise<T>,
): Promise<T> {
  let row: MarketingJobRun | null = null
  try {
    row = em.create(MarketingJobRun, {
      ...scope,
      kind: input.kind,
      campaignId: input.campaignId ?? null,
      status: 'running',
    })
    em.persist(row)
    await em.flush()
  } catch {
    // Bookkeeping must never stop the job it describes.
    row = null
  }

  try {
    const result = await work()
    if (row) {
      try {
        row.status = 'ok'
        row.finishedAt = new Date()
        row.counters = result.counters ?? null
        await em.flush()
      } catch {
        // As above: the work is done and committed; the log entry is not worth failing it for.
      }
    }
    return result
  } catch (error) {
    if (row) {
      try {
        row.status = 'failed'
        row.finishedAt = new Date()
        row.error = error instanceof Error ? error.message : String(error)
        await em.flush()
      } catch {
        // Nothing more to do — the throw below is what matters.
      }
    }
    throw error
  }
}

export type JobRunSummary = {
  id: string
  kind: string
  campaignId: string | null
  startedAt: string
  finishedAt: string | null
  status: string
  counters: Record<string, number> | null
  error: string | null
}

export async function listJobRuns(
  em: EntityManager,
  scope: JobRunScope,
  options: { kind?: string; limit?: number } = {},
): Promise<JobRunSummary[]> {
  const rows = await em.find(
    MarketingJobRun,
    { ...scope, ...(options.kind ? { kind: options.kind } : {}) },
    { orderBy: { startedAt: 'DESC' }, limit: Math.min(Math.max(options.limit ?? 50, 1), 200) },
  )
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    campaignId: row.campaignId ?? null,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    status: row.status,
    counters: row.counters ?? null,
    error: row.error ?? null,
  }))
}

/**
 * Removes job-run rows older than the retention window.
 *
 * Called by the same jobs that write them, for the reason the revision cap is enforced on write: a cleanup
 * job that is not scheduled is a table that grows until somebody notices.
 */
export const JOB_RUN_RETENTION_DAYS = 30

export async function pruneJobRuns(
  em: EntityManager,
  scope: JobRunScope,
  now: Date,
  retentionDays = JOB_RUN_RETENTION_DAYS,
): Promise<number> {
  const cutoff = new Date(now.getTime() - retentionDays * 86_400_000)
  return em.nativeDelete(MarketingJobRun, {
    ...scope,
    startedAt: { $lt: cutoff },
  })
}
