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

    async updateCursor(runId: string, cursor: string, scope: SyncScope): Promise<void> {
      const run = await this.getRun(runId, scope)
      if (!run) return
      const cursorRow = await resolveCursorRow(run, scope)
      await withAtomicFlush(em, [
        () => applyCursorMutation(run, cursorRow, cursor, scope),
      ], { transaction: true })
    },

    async commitBatchProgress(
      runId: string,
      delta: Partial<Pick<SyncRun, 'createdCount' | 'updatedCount' | 'skippedCount' | 'failedCount' | 'batchesCompleted'>>,
      cursor: string,
      scope: SyncScope,
    ): Promise<SyncRun | null> {
      const run = await this.getRun(runId, scope)
      if (!run) return null
      const cursorRow = await resolveCursorRow(run, scope)
      await withAtomicFlush(em, [
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
