import type { EntityManager } from '@mikro-orm/postgresql'
import { ProgressJob } from '@open-mercato/core/modules/progress/data/entities'
import type { ProgressService } from '@open-mercato/core/modules/progress/lib/progressService'

export type ReindexProgressType = 'fulltext' | 'vector'

const REINDEX_JOB_CONFIG: Record<ReindexProgressType, { jobType: string; name: string }> = {
  fulltext: {
    jobType: 'search.reindex.fulltext',
    name: 'Search fulltext reindex',
  },
  vector: {
    jobType: 'search.reindex.vector',
    name: 'Search vector reindex',
  },
}

function buildScopeFilter(
  type: ReindexProgressType,
  tenantId: string,
  organizationId?: string | null,
) {
  const config = REINDEX_JOB_CONFIG[type]
  return {
    jobType: config.jobType,
    tenantId,
    organizationId: organizationId ?? null,
  }
}

async function findActiveJob(
  em: EntityManager,
  type: ReindexProgressType,
  tenantId: string,
  organizationId?: string | null,
): Promise<ProgressJob | null> {
  return em.findOne(
    ProgressJob,
    {
      ...buildScopeFilter(type, tenantId, organizationId),
      status: { $in: ['pending', 'running'] },
    },
    {
      orderBy: { createdAt: 'DESC' },
    },
  )
}

export async function ensureReindexProgressJob(params: {
  em: EntityManager
  progressService: ProgressService
  type: ReindexProgressType
  tenantId: string
  organizationId?: string | null
  userId?: string | null
  totalCount?: number | null
  description?: string | null
}): Promise<string | null> {
  const current = await findActiveJob(params.em, params.type, params.tenantId, params.organizationId)
  if (current) {
    if (typeof params.totalCount === 'number') {
      await params.progressService.updateProgress(
        current.id,
        { totalCount: params.totalCount },
        {
          tenantId: params.tenantId,
          organizationId: params.organizationId ?? null,
          userId: params.userId ?? null,
        },
      )
    }
    return current.id
  }

  const config = REINDEX_JOB_CONFIG[params.type]
  const created = await params.progressService.createJob(
    {
      jobType: config.jobType,
      name: config.name,
      description: params.description ?? undefined,
      totalCount: params.totalCount ?? undefined,
      cancellable: true,
      meta: {
        source: 'search',
        type: params.type,
      },
    },
    {
      tenantId: params.tenantId,
      organizationId: params.organizationId ?? null,
      userId: params.userId ?? null,
    },
  )
  await params.progressService.startJob(created.id, {
    tenantId: params.tenantId,
    organizationId: params.organizationId ?? null,
    userId: params.userId ?? null,
  })
  return created.id
}

export async function incrementReindexProgress(params: {
  em: EntityManager
  progressService: ProgressService
  type: ReindexProgressType
  tenantId: string
  organizationId?: string | null
  delta: number
}): Promise<boolean> {
  if (!Number.isFinite(params.delta) || params.delta <= 0) return false
  const current = await findActiveJob(params.em, params.type, params.tenantId, params.organizationId)
  if (!current) return false
  const updated = await params.progressService.incrementProgress(
    current.id,
    params.delta,
    {
      tenantId: params.tenantId,
      organizationId: params.organizationId ?? null,
      userId: null,
    },
  )
  if (updated.totalCount && updated.processedCount >= updated.totalCount) {
    await params.progressService.completeJob(
      updated.id,
      {
        resultSummary: {
          processedCount: updated.processedCount,
          totalCount: updated.totalCount,
        },
      },
      {
        tenantId: params.tenantId,
        organizationId: params.organizationId ?? null,
        userId: null,
      },
    )
    return true
  }
  return false
}

export async function completeReindexProgress(params: {
  em: EntityManager
  progressService: ProgressService
  type: ReindexProgressType
  tenantId: string
  organizationId?: string | null
  resultSummary?: Record<string, unknown>
}): Promise<void> {
  const current = await findActiveJob(params.em, params.type, params.tenantId, params.organizationId)
  if (!current) return
  await params.progressService.completeJob(
    current.id,
    { resultSummary: params.resultSummary ?? {} },
    {
      tenantId: params.tenantId,
      organizationId: params.organizationId ?? null,
      userId: null,
    },
  )
}

export async function failReindexProgress(params: {
  em: EntityManager
  progressService: ProgressService
  type: ReindexProgressType
  tenantId: string
  organizationId?: string | null
  errorMessage: string
}): Promise<void> {
  const current = await findActiveJob(params.em, params.type, params.tenantId, params.organizationId)
  if (!current) return
  await params.progressService.failJob(
    current.id,
    { errorMessage: params.errorMessage },
    {
      tenantId: params.tenantId,
      organizationId: params.organizationId ?? null,
      userId: null,
    },
  )
}

export async function cancelReindexProgress(params: {
  em: EntityManager
  progressService: ProgressService
  type: ReindexProgressType
  tenantId: string
  organizationId?: string | null
  userId?: string | null
}): Promise<void> {
  const current = await findActiveJob(params.em, params.type, params.tenantId, params.organizationId)
  if (!current) return
  await params.progressService.cancelJob(
    current.id,
    {
      tenantId: params.tenantId,
      organizationId: params.organizationId ?? null,
      userId: params.userId ?? null,
    },
  )
}
