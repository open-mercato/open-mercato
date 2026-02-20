import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { ProgressJob } from '../../data/entities'

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
  const em = container.resolve('em') as EntityManager

  const jobs = await em.find(ProgressJob, {
    tenantId: auth.tenantId,
    ...(auth.orgId ? { organizationId: auth.orgId } : {}),
    status: { $in: ['pending', 'running'] },
    parentJobId: null,
  }, {
    orderBy: { createdAt: 'DESC' },
    limit: 50,
  })

  const recentCutoff = new Date(Date.now() - 30_000)
  const recentlyCompleted = await em.find(ProgressJob, {
    tenantId: auth.tenantId,
    ...(auth.orgId ? { organizationId: auth.orgId } : {}),
    status: { $in: ['completed', 'failed'] },
    finishedAt: { $gte: recentCutoff },
    parentJobId: null,
  }, {
    orderBy: { finishedAt: 'DESC' },
    limit: 10,
  })

  return NextResponse.json({
    active: jobs.map(formatJob),
    recentlyCompleted: recentlyCompleted.map(formatJob),
  })
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
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
    errorMessage: job.errorMessage,
  }
}

export const openApi = {
  GET: {
    summary: 'Get active progress jobs',
    description: 'Returns currently running jobs and recently completed jobs for the progress top bar.',
    tags: ['Progress'],
    responses: {
      200: { description: 'Active and recently completed jobs' },
    },
  },
}
