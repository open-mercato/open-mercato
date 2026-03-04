import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { SyncCursor, SyncRun } from '../data/entities'

type SyncScope = {
  organizationId: string
  tenantId: string
}

export function createSyncRunService(em: EntityManager) {
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

      await em.persistAndFlush(row)
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

    async listRuns(query: { integrationId?: string; entityType?: string; status?: string; page: number; pageSize: number }, scope: SyncScope): Promise<{ items: SyncRun[]; total: number }> {
      const where: FilterQuery<SyncRun> = {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        deletedAt: null,
      }

      if (query.integrationId) where.integrationId = query.integrationId
      if (query.entityType) where.entityType = query.entityType
      if (query.status) where.status = query.status as SyncRun['status']

      const [items, total] = await em.findAndCount(SyncRun, where, {
        orderBy: { createdAt: 'DESC' },
        limit: query.pageSize,
        offset: (query.page - 1) * query.pageSize,
      })

      return { items, total }
    },

    async markStatus(runId: string, status: SyncRun['status'], scope: SyncScope, error?: string): Promise<SyncRun | null> {
      const row = await this.getRun(runId, scope)
      if (!row) return null
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
      run.cursor = cursor

      const cursorRow = await em.findOne(SyncCursor, {
        integrationId: run.integrationId,
        entityType: run.entityType,
        direction: run.direction,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
      })

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

      await em.flush()
    },

    async resolveCursor(integrationId: string, entityType: string, direction: 'import' | 'export', scope: SyncScope): Promise<string | null> {
      const row = await em.findOne(SyncCursor, {
        integrationId,
        entityType,
        direction,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
      })
      return row?.cursor ?? null
    },

    async findRunningOverlap(integrationId: string, entityType: string, direction: 'import' | 'export', scope: SyncScope): Promise<SyncRun | null> {
      return em.findOne(SyncRun, {
        integrationId,
        entityType,
        direction,
        status: 'running',
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        deletedAt: null,
      })
    },
  }
}

export type SyncRunService = ReturnType<typeof createSyncRunService>
