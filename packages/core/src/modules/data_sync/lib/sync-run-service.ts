import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { findAndCountWithDecryption, findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { SyncCursor, SyncRun } from '../data/entities'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function buildRunSearchFilter(search: string): FilterQuery<SyncRun>[] | null {
  const trimmed = search.trim()
  if (!trimmed) return null
  const pattern = `%${escapeLikePattern(trimmed)}%`
  const conditions: FilterQuery<SyncRun>[] = [
    { integrationId: { $ilike: pattern } },
    { entityType: { $ilike: pattern } },
    { status: { $ilike: pattern } },
  ]
  if (UUID_PATTERN.test(trimmed)) {
    conditions.push({ id: trimmed })
  }
  return conditions
}

type SyncScope = {
  organizationId: string
  tenantId: string
}

/**
 * Raised when a batch commit loses the ownership compare-and-swap, meaning
 * another delivery of the same job advanced the run while this worker was
 * streaming.
 *
 * BullMQ guarantees at-least-once delivery: a job whose lock is not renewed is
 * redelivered under the SAME job id, whether the previous worker died or is only
 * blocked. No identity token can tell those apart, so ownership is enforced here
 * — on the write that matters — instead of at claim time. The loser aborts and
 * leaves the run to the worker that is still making progress.
 */
export class SyncRunOwnershipConflictError extends Error {
  constructor(
    readonly runId: string,
    readonly expectedBatchesCompleted: number,
  ) {
    super(`[internal] Sync run ${runId} advanced past batch ${expectedBatchesCompleted} under a concurrent worker`)
    this.name = 'SyncRunOwnershipConflictError'
  }
}

export function createSyncRunService(em: EntityManager) {
  async function resolveCursorRow(run: SyncRun, scope: SyncScope): Promise<SyncCursor | null> {
    return findOneWithDecryption(
      em,
      SyncCursor,
      {
        integrationId: run.integrationId,
        entityType: run.entityType,
        direction: run.direction,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
      },
      undefined,
      scope,
    )
  }

  function applyCursorMutation(run: SyncRun, cursorRow: SyncCursor | null, cursor: string, scope: SyncScope): void {
    run.cursor = cursor
    if (cursorRow) {
      cursorRow.cursor = cursor
    } else {
      em.create(SyncCursor, {
        integrationId: run.integrationId,
        entityType: run.entityType,
        direction: run.direction,
        cursor,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
      })
    }
  }

  return {
    async createRun(input: {
      integrationId: string
      entityType: string
      direction: 'import' | 'export'
      cursor?: string | null
      triggeredBy?: string | null
      progressJobId?: string | null
      jobId?: string | null
    }, scope: SyncScope): Promise<SyncRun> {
      const row = em.create(SyncRun, {
        integrationId: input.integrationId,
        entityType: input.entityType,
        direction: input.direction,
        status: 'pending',
        cursor: input.cursor,
        initialCursor: input.cursor,
        triggeredBy: input.triggeredBy,
        progressJobId: input.progressJobId,
        jobId: input.jobId,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
      })

      await em.persist(row).flush()
      return row
    },

    async getRun(runId: string, scope: SyncScope): Promise<SyncRun | null> {
      return findOneWithDecryption(
        em,
        SyncRun,
        {
          id: runId,
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          deletedAt: null,
        },
        undefined,
        scope,
      )
    },

    async listRuns(query: {
      integrationId?: string
      entityType?: string
      direction?: 'import' | 'export'
      status?: string
      search?: string
      page: number
      pageSize: number
    }, scope: SyncScope): Promise<{ items: SyncRun[]; total: number }> {
      const where: FilterQuery<SyncRun> = {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        deletedAt: null,
      }

      if (query.integrationId) where.integrationId = query.integrationId
      if (query.entityType) where.entityType = query.entityType
      if (query.direction) where.direction = query.direction
      if (query.status) where.status = query.status as SyncRun['status']
      if (query.search) {
        const searchConditions = buildRunSearchFilter(query.search)
        if (searchConditions) where.$or = searchConditions
      }

      const [items, total] = await findAndCountWithDecryption(
        em,
        SyncRun,
        where,
        {
          orderBy: { createdAt: 'DESC' },
          limit: query.pageSize,
          offset: (query.page - 1) * query.pageSize,
        },
        scope,
      )

      return { items, total }
    },

    async markStatus(runId: string, status: SyncRun['status'], scope: SyncScope, error?: string): Promise<SyncRun | null> {
      if (status === 'running') {
        const updated = await em.nativeUpdate(
          SyncRun,
          {
            id: runId,
            organizationId: scope.organizationId,
            tenantId: scope.tenantId,
            deletedAt: null,
            // A BullMQ stalled-job redelivery finds the run in `running` after
            // the previous worker was hard-killed. Treat that transition as an
            // idempotent claim while still excluding terminal states so a
            // cancelled or completed run cannot be revived.
            status: { $in: ['pending', 'running'] },
          },
          {
            status,
            ...(error !== undefined ? { lastError: error } : {}),
            updatedAt: new Date(),
          },
        )
        if (updated === 0) return null
        const row = await this.getRun(runId, scope)
        if (row && typeof em.refresh === 'function') {
          await em.refresh(row)
        }
        return row
      }

      const row = await this.getRun(runId, scope)
      if (!row) return null
      const isTerminal = row.status === 'completed' || row.status === 'failed' || row.status === 'cancelled'
      if (isTerminal && row.status !== status) {
        return row
      }
      row.status = status
      if (error !== undefined) row.lastError = error
      await em.flush()
      return row
    },

    /**
     * @deprecated Use {@link commitBatchProgress}, which writes counters and
     * cursor in one transaction behind the ownership fence. This method updates
     * counters unfenced, so two deliveries of the same job can lose each other's
     * increments. Kept for external callers only.
     */
    async updateCounts(
      runId: string,
      delta: Partial<Pick<SyncRun, 'createdCount' | 'updatedCount' | 'skippedCount' | 'failedCount' | 'batchesCompleted'>>,
      scope: SyncScope,
    ): Promise<SyncRun | null> {
      const row = await this.getRun(runId, scope)
      if (!row) return null

      row.createdCount += delta.createdCount ?? 0
      row.updatedCount += delta.updatedCount ?? 0
      row.skippedCount += delta.skippedCount ?? 0
      row.failedCount += delta.failedCount ?? 0
      row.batchesCompleted += delta.batchesCompleted ?? 0
      await em.flush()
      return row
    },

    /**
     * @deprecated Use {@link commitBatchProgress}. This method advances the
     * cursor without the ownership fence, so a stale delivery can move the
     * cursor of a run another worker owns. Kept for external callers only.
     */
    async updateCursor(runId: string, cursor: string, scope: SyncScope): Promise<void> {
      const run = await this.getRun(runId, scope)
      if (!run) return
      const cursorRow = await resolveCursorRow(run, scope)
      await withAtomicFlush(em, [
        () => applyCursorMutation(run, cursorRow, cursor, scope),
      ], { transaction: true })
    },

    /**
     * Commits one batch's counters and cursor in a single transaction.
     *
     * Passing `expectedBatchesCompleted` fences the write: the run must still be
     * `running` and still sit on that batch count, or another delivery of the
     * same BullMQ job owns the run and this commit throws
     * `SyncRunOwnershipConflictError` and rolls back. Omitting it keeps the
     * legacy unguarded write for callers outside the engine.
     *
     * The fence token is `batchesCompleted` rather than `cursor` because it
     * advances by construction on every commit. A cursor is a free-form adapter
     * string that an adapter may legitimately repeat between batches — the
     * Akeneo products adapter does, between its final page and the
     * reconciliation batch that follows it — and a repeated token fences
     * nothing.
     *
     * The guard's `UPDATE` also holds the row lock for the rest of the
     * transaction, so a competing commit blocks here and then re-reads the
     * advanced count instead of interleaving with this one. That is what lets
     * the counters below stay a plain read-modify-write against the snapshot
     * read above: a commit that wins the fence has proven that nothing else
     * landed since it read.
     */
    async commitBatchProgress(
      runId: string,
      delta: Partial<Pick<SyncRun, 'createdCount' | 'updatedCount' | 'skippedCount' | 'failedCount' | 'batchesCompleted'>>,
      cursor: string,
      scope: SyncScope,
      expectedBatchesCompleted?: number,
    ): Promise<SyncRun | null> {
      const run = await this.getRun(runId, scope)
      if (!run) return null
      const cursorRow = await resolveCursorRow(run, scope)
      const claimRunOwnership = async () => {
        if ((delta.batchesCompleted ?? 0) < 1) {
          throw new Error(`[internal] A fenced commit for sync run ${runId} must advance batchesCompleted`)
        }
        const owned = await em.nativeUpdate(
          SyncRun,
          {
            id: runId,
            organizationId: scope.organizationId,
            tenantId: scope.tenantId,
            deletedAt: null,
            status: 'running',
            batchesCompleted: expectedBatchesCompleted,
          },
          { updatedAt: new Date() },
        )
        if (owned === 0) {
          throw new SyncRunOwnershipConflictError(runId, expectedBatchesCompleted ?? 0)
        }
      }
      await withAtomicFlush(em, [
        ...(expectedBatchesCompleted === undefined ? [] : [claimRunOwnership]),
        () => {
          run.createdCount += delta.createdCount ?? 0
          run.updatedCount += delta.updatedCount ?? 0
          run.skippedCount += delta.skippedCount ?? 0
          run.failedCount += delta.failedCount ?? 0
          run.batchesCompleted += delta.batchesCompleted ?? 0
          applyCursorMutation(run, cursorRow, cursor, scope)
        },
      ], { transaction: true })
      return run
    },

    async resolveCursor(integrationId: string, entityType: string, direction: 'import' | 'export', scope: SyncScope): Promise<string | null> {
      const row = await findOneWithDecryption(
        em,
        SyncCursor,
        {
        integrationId,
        entityType,
        direction,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        },
        undefined,
        scope,
      )
      return row?.cursor ?? null
    },

    async findRunningOverlap(integrationId: string, entityType: string, direction: 'import' | 'export', scope: SyncScope): Promise<SyncRun | null> {
      const [run] = await findWithDecryption(
        em,
        SyncRun,
        {
          integrationId,
          entityType,
          direction,
          status: { $in: ['pending', 'running'] },
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          deletedAt: null,
        },
        { limit: 1 },
        scope,
      )
      return run ?? null
    },
  }
}

export type SyncRunService = ReturnType<typeof createSyncRunService>
