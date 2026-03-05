import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { ProgressService } from '../../../../progress/lib/progressService'
import type { SyncRunService } from '../../../lib/sync-run-service'
import { retrySyncSchema } from '../../../data/validators'
import { getSyncQueue } from '../../../lib/queue'

const paramsSchema = z.object({ id: z.string().uuid() })

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['data_sync.run'] },
}

export const openApi = {
  tags: ['DataSync'],
  summary: 'Retry a failed sync run',
}

export async function POST(req: Request, ctx: { params?: Promise<{ id?: string }> | { id?: string } }) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rawParams = (ctx.params && typeof (ctx.params as Promise<unknown>).then === 'function')
    ? await (ctx.params as Promise<{ id?: string }>)
    : (ctx.params as { id?: string } | undefined)

  const parsedParams = paramsSchema.safeParse(rawParams)
  if (!parsedParams.success) {
    return NextResponse.json({ error: 'Invalid run id' }, { status: 400 })
  }

  const payload = await req.json().catch(() => null)
  const parsedBody = retrySyncSchema.safeParse(payload ?? {})
  if (!parsedBody.success) {
    return NextResponse.json({ error: 'Invalid payload', details: parsedBody.error.flatten() }, { status: 422 })
  }

  const container = await createRequestContainer()
  const syncRunService = container.resolve('dataSyncRunService') as SyncRunService
  const progressService = container.resolve('progressService') as ProgressService
  const scope = { organizationId: auth.orgId as string, tenantId: auth.tenantId }

  const previous = await syncRunService.getRun(parsedParams.data.id, scope)
  if (!previous) {
    return NextResponse.json({ error: 'Run not found' }, { status: 404 })
  }
  if (previous.status !== 'failed' && previous.status !== 'cancelled') {
    return NextResponse.json({ error: 'Only failed or cancelled runs can be retried' }, { status: 409 })
  }

  const overlap = await syncRunService.findRunningOverlap(
    previous.integrationId,
    previous.entityType,
    previous.direction,
    scope,
  )
  if (overlap) {
    return NextResponse.json({ error: 'A sync run is already in progress for this integration and entity direction' }, { status: 409 })
  }

  const cursor = parsedBody.data.fromBeginning
    ? null
    : previous.cursor ?? await syncRunService.resolveCursor(previous.integrationId, previous.entityType, previous.direction, scope)

  const progressJob = await progressService.createJob(
    {
      jobType: `data_sync:${previous.direction}`,
      name: `Retry data sync ${previous.integrationId}`,
      description: `${previous.entityType} ${previous.direction}`,
      cancellable: true,
    },
    {
      tenantId: auth.tenantId,
      organizationId: auth.orgId,
      userId: auth.sub,
    },
  )

  const run = await syncRunService.createRun(
    {
      integrationId: previous.integrationId,
      entityType: previous.entityType,
      direction: previous.direction,
      cursor,
      triggeredBy: auth.sub,
      progressJobId: progressJob.id,
    },
    scope,
  )

  const queueName = run.direction === 'import' ? 'data-sync-import' : 'data-sync-export'
  const queue = getSyncQueue(queueName)
  await queue.enqueue({
    runId: run.id,
    batchSize: 100,
    scope: {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      userId: auth.sub,
    },
  })

  return NextResponse.json({ id: run.id, progressJobId: progressJob.id }, { status: 201 })
}
