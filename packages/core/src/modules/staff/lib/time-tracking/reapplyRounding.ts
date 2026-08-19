/**
 * Retroactive rounding, the long-running half (T7.3 / screen 16 note 3).
 *
 * "Apply the new rounding rule to entries that already exist" is a tenant-wide
 * rewrite of a billing-relevant column, so it is a `ProgressJob` driven by a queue
 * worker rather than a request that has to finish before a response — and, just as
 * importantly, an action somebody deliberately takes rather than a passive toggle
 * that rewrites history when the settings form is saved.
 *
 * What this file owns:
 *
 *  * **Candidate selection.** Only entries that are not deleted and not locked into
 *    a closed report are ever selected. The command re-asserts the same condition in
 *    its own WHERE clause, so a locked entry is excluded twice, independently.
 *  * **Batching and progress.** Ids are paged with a stable `id > cursor` cursor and
 *    handed to the command in batches, grouped by organization because a command
 *    call is scoped to exactly one. Progress is reported per batch, and a cancel
 *    request is honoured between batches.
 *  * **Side-effect suppression.** Batches run with `bulkImport.skipEvents` /
 *    `skipNotifications`: the query index still refreshes per entry, but a
 *    thousand-entry restatement does not emit a thousand `time_entry.updated`
 *    events (which would, among other things, re-evaluate every project budget
 *    threshold a thousand times).
 */

import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { createModuleQueue, type Queue } from '@open-mercato/queue'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { buildSqlInClause } from './sqlInClause'
import type { ProgressService, ProgressServiceContext } from '../../../progress/lib/progressService'
import {
  staffTimeEntryCommandIds,
  type StaffTimeEntryReapplyRoundingResult,
} from '../../commands/timesheets-entries'

const logger = createLogger('staff').child({ component: 'time-tracking/reapply-rounding' })

export const STAFF_TIME_REAPPLY_ROUNDING_QUEUE = 'staff-time-reapply-rounding'
export const STAFF_TIME_REAPPLY_ROUNDING_JOB_TYPE = 'staff.timesheets.reapply_rounding'

/** One command call per batch; the command itself caps the id list at 500. */
export const REAPPLY_ROUNDING_BATCH_SIZE = 200

export type ReapplyRoundingScope = {
  tenantId: string
  /** Organizations the caller may act in; `null` means every organization of the tenant. */
  organizationIds: string[] | null
  userId?: string | null
}

export type ReapplyRoundingJobPayload = {
  progressJobId: string
  scope: ReapplyRoundingScope
}

export type ReapplyRoundingSummary = {
  totalCount: number
  processedCount: number
  updatedCount: number
  unchangedCount: number
  skippedCount: number
  cancelled: boolean
}

const queues = new Map<string, Queue<Record<string, unknown>>>()

export function getStaffQueue(queueName: string): Queue<Record<string, unknown>> {
  const existing = queues.get(queueName)
  if (existing) return existing
  const concurrency = Math.max(1, Number.parseInt(process.env.STAFF_QUEUE_CONCURRENCY ?? '1', 10) || 1)
  const created = createModuleQueue<Record<string, unknown>>(queueName, { concurrency })
  queues.set(queueName, created)
  return created
}

type CandidateRow = {
  id: string
  organization_id: string
}

type CountRow = {
  candidate_count: string | number | null
}

function buildCommandContext(
  container: AwilixContainer,
  tenantId: string,
  organizationId: string,
): CommandRuntimeContext {
  return {
    container,
    auth: null,
    // The job runs without an end user; the enqueuing route is the authorization
    // gate (`staff.timesheets.settings.manage`), so the worker declares itself a
    // system actor and passes the scope explicitly rather than inheriting one.
    systemActor: true,
    bulkImport: { skipEvents: true, skipNotifications: true },
    organizationScope: {
      selectedId: organizationId,
      filterIds: [organizationId],
      allowedIds: [organizationId],
      tenantId,
    },
    selectedOrganizationId: organizationId,
    organizationIds: [organizationId],
  }
}

function organizationClause(organizationIds: string[] | null): { sql: string; params: unknown[] } {
  if (!organizationIds) return { sql: '', params: [] }
  const clause = buildSqlInClause('organization_id', organizationIds)
  return { sql: ` AND ${clause.sql}`, params: clause.params }
}

export async function countReapplyRoundingCandidates(
  em: EntityManager,
  scope: ReapplyRoundingScope,
): Promise<number> {
  const org = organizationClause(scope.organizationIds)
  const rows = (await em.getConnection().execute(
    `
      SELECT COUNT(*)::bigint AS candidate_count
      FROM staff_time_entries
      WHERE tenant_id = ?
        AND deleted_at IS NULL
        AND locked_report_id IS NULL${org.sql}
    `,
    [scope.tenantId, ...org.params],
  )) as CountRow[]
  const parsed = Number(rows?.[0]?.candidate_count ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

async function loadCandidatePage(
  em: EntityManager,
  scope: ReapplyRoundingScope,
  cursor: string | null,
  limit: number,
): Promise<CandidateRow[]> {
  const org = organizationClause(scope.organizationIds)
  const cursorClause = cursor ? ' AND id > ?' : ''
  const cursorParams = cursor ? [cursor] : []
  return (await em.getConnection().execute(
    `
      SELECT id, organization_id
      FROM staff_time_entries
      WHERE tenant_id = ?
        AND deleted_at IS NULL
        AND locked_report_id IS NULL${org.sql}${cursorClause}
      ORDER BY id ASC
      LIMIT ?
    `,
    [scope.tenantId, ...org.params, ...cursorParams, limit],
  )) as CandidateRow[]
}

function groupByOrganization(rows: readonly CandidateRow[]): Map<string, string[]> {
  const grouped = new Map<string, string[]>()
  for (const row of rows) {
    const bucket = grouped.get(row.organization_id) ?? []
    bucket.push(row.id)
    grouped.set(row.organization_id, bucket)
  }
  return grouped
}

export async function reapplyRoundingWithProgress(params: {
  container: AwilixContainer
  progressJobId: string
  scope: ReapplyRoundingScope
}): Promise<ReapplyRoundingSummary> {
  const { container, progressJobId, scope } = params
  const em = (container.resolve('em') as EntityManager).fork()
  const commandBus = container.resolve('commandBus') as CommandBus
  const progressService = container.resolve('progressService') as ProgressService
  const progressContext: ProgressServiceContext = {
    tenantId: scope.tenantId,
    organizationId: scope.organizationIds?.length === 1 ? scope.organizationIds[0] : null,
    userId: scope.userId ?? null,
  }

  await progressService.startJob(progressJobId, progressContext)

  const totalCount = await countReapplyRoundingCandidates(em, scope)
  const summary: ReapplyRoundingSummary = {
    totalCount,
    processedCount: 0,
    updatedCount: 0,
    unchangedCount: 0,
    skippedCount: 0,
    cancelled: false,
  }

  if (totalCount === 0) {
    await progressService.completeJob(progressJobId, { resultSummary: { ...summary } }, progressContext)
    return summary
  }

  await progressService.updateProgress(progressJobId, { totalCount, processedCount: 0 }, progressContext)

  let cursor: string | null = null
  for (;;) {
    const page: CandidateRow[] = await loadCandidatePage(em, scope, cursor, REAPPLY_ROUNDING_BATCH_SIZE)
    if (page.length === 0) break
    cursor = page[page.length - 1].id

    for (const [organizationId, entryIds] of groupByOrganization(page)) {
      const executed = await commandBus.execute<
        { tenantId: string; organizationId: string; entryIds: string[] },
        StaffTimeEntryReapplyRoundingResult
      >(staffTimeEntryCommandIds.reapplyRounding, {
        input: { tenantId: scope.tenantId, organizationId, entryIds },
        ctx: buildCommandContext(container, scope.tenantId, organizationId),
      })
      const result = executed?.result
      summary.updatedCount += result?.updatedCount ?? 0
      summary.unchangedCount += result?.unchangedCount ?? 0
      summary.skippedCount += result?.skippedCount ?? 0
      summary.processedCount += entryIds.length
    }

    await progressService.updateProgress(
      progressJobId,
      { totalCount, processedCount: Math.min(summary.processedCount, totalCount) },
      progressContext,
    )

    if (await progressService.isCancellationRequested(progressJobId, scope.tenantId, progressContext.organizationId)) {
      summary.cancelled = true
      logger.info('staff.timesheets reapply-rounding cancelled', { progressJobId, ...summary })
      await progressService.markCancelled(progressJobId, progressContext)
      return summary
    }
  }

  await progressService.completeJob(progressJobId, { resultSummary: { ...summary } }, progressContext)
  logger.info('staff.timesheets reapply-rounding finished', { progressJobId, ...summary })
  return summary
}
