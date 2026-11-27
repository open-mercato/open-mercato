import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { ProgressJob } from '../../data/entities'
import { createProgressJobMutationPolicy, resolveProgressCancellationScope } from '../jobPermissions'
import {
  hasReadableProgressScope,
  hasWritableProgressScope,
  resolveProgressRequestScope,
} from '../requestScope'

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['progress.view'] },
}

export const metadata = routeMetadata

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.tenantId) {
    return NextResponse.json({ active: [], recentlyCompleted: [] }, { status: 401 })
  }

  const container = await createRequestContainer()
  const progressService = container.resolve('progressService') as import('../../lib/progressService').ProgressService
  const scope = await resolveProgressRequestScope(container, auth, req)
  if (!hasReadableProgressScope(scope)) {
    return NextResponse.json({ active: [], recentlyCompleted: [] })
  }

  const ctx = {
    tenantId: scope.tenantId,
    organizationId: scope.selectedId,
    organizationIds: scope.filterIds,
  }

  await progressService.markStaleJobsFailed(scope.tenantId, undefined, scope.selectedId, scope.filterIds)

  const [jobs, recentlyCompleted] = await Promise.all([
    progressService.getActiveJobs(ctx),
    progressService.getRecentlyCompletedJobs(ctx),
  ])

  const cancelScope = jobs.some((job) => job.cancellable) && hasWritableProgressScope(scope)
    ? await resolveProgressCancellationScope(container, auth, req)
    : null
  const canMutateJob = createProgressJobMutationPolicy(container, auth)
  const active = await Promise.all(jobs.map(async (job) => ({
    ...formatJob(job),
    canCancel: job.cancellable
      && cancelScope !== null
      && (cancelScope.filterIds === null
        || (job.organizationId != null && cancelScope.filterIds.includes(job.organizationId)))
      && await canMutateJob(job),
  })))

  return NextResponse.json({
    active,
    recentlyCompleted: recentlyCompleted.map(formatJob),
  }, { headers: { 'Cache-Control': 'private, no-store' } })
}

function formatJob(job: ProgressJob) {
  return {
    id: job.id,
    jobType: job.jobType,
    name: job.name,
    description: job.description,
    status: job.status,
    progressPercent: job.progressPercent,
    processedCount: job.processedCount,
    totalCount: job.totalCount,
    etaSeconds: job.etaSeconds,
    cancellable: job.cancellable,
    meta: job.meta ?? null,
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
    errorMessage: job.errorMessage,
  }
}

export const openApi = {
  GET: {
    summary: 'Get active progress jobs',
    description: 'Returns active and recently completed jobs for the progress top bar. Each active job includes canCancel for the authenticated caller.',
    tags: ['Progress'],
    responses: {
      200: { description: 'Active and recently completed jobs' },
    },
  },
}
