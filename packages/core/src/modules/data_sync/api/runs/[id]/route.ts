import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { ProgressService } from '../../../../progress/lib/progressService'
import type { SyncRunService } from '../../../lib/sync-run-service'

const paramsSchema = z.object({ id: z.string().uuid() })

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['data_sync.view'] },
}

export const openApi = {
  tags: ['DataSync'],
  summary: 'Get sync run detail',
}

export async function GET(req: Request, ctx: { params?: Promise<{ id?: string }> | { id?: string } }) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rawParams = (ctx.params && typeof (ctx.params as Promise<unknown>).then === 'function')
    ? await (ctx.params as Promise<{ id?: string }>)
    : (ctx.params as { id?: string } | undefined)

  const parsed = paramsSchema.safeParse(rawParams)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid run id' }, { status: 400 })
  }

  const container = await createRequestContainer()
  const syncRunService = container.resolve('dataSyncRunService') as SyncRunService
  const progressService = container.resolve('progressService') as ProgressService
  const scope = { organizationId: auth.orgId as string, tenantId: auth.tenantId }

  const run = await syncRunService.getRun(parsed.data.id, scope)
  if (!run) {
    return NextResponse.json({ error: 'Run not found' }, { status: 404 })
  }

  const progressJob = run.progressJobId
    ? await progressService.getJob(run.progressJobId, {
      tenantId: auth.tenantId,
      organizationId: auth.orgId,
      userId: auth.sub,
    })
    : null

  return NextResponse.json({
    id: run.id,
    integrationId: run.integrationId,
    entityType: run.entityType,
    direction: run.direction,
    status: run.status,
    cursor: run.cursor ?? null,
    initialCursor: run.initialCursor ?? null,
    createdCount: run.createdCount,
    updatedCount: run.updatedCount,
    skippedCount: run.skippedCount,
    failedCount: run.failedCount,
    batchesCompleted: run.batchesCompleted,
    lastError: run.lastError ?? null,
    progressJobId: run.progressJobId ?? null,
    progressJob: progressJob
      ? {
        id: progressJob.id,
        status: progressJob.status,
        progressPercent: progressJob.progressPercent,
        processedCount: progressJob.processedCount,
        totalCount: progressJob.totalCount ?? null,
        etaSeconds: progressJob.etaSeconds ?? null,
      }
      : null,
    triggeredBy: run.triggeredBy ?? null,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
  })
}
