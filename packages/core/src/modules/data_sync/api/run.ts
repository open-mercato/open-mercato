import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { ProgressService } from '../../progress/lib/progressService'
import type { SyncRunService } from '../lib/sync-run-service'
import { runSyncSchema } from '../data/validators'
import { getSyncQueue } from '../lib/queue'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['data_sync.run'] },
}

export const openApi = {
  tags: ['DataSync'],
  summary: 'Start a data sync run',
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = runSyncSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', details: parsed.error.flatten() }, { status: 422 })
  }

  const container = await createRequestContainer()
  const syncRunService = container.resolve('dataSyncRunService') as SyncRunService
  const progressService = container.resolve('progressService') as ProgressService

  const scope = {
    organizationId: auth.orgId as string,
    tenantId: auth.tenantId,
  }

  const cursor = parsed.data.fullSync
    ? null
    : await syncRunService.resolveCursor(parsed.data.integrationId, parsed.data.entityType, parsed.data.direction, scope)

  const progressJob = await progressService.createJob(
    {
      jobType: `data_sync:${parsed.data.direction}`,
      name: `Data sync ${parsed.data.integrationId}`,
      description: `${parsed.data.entityType} ${parsed.data.direction}`,
      cancellable: true,
      meta: {
        integrationId: parsed.data.integrationId,
        entityType: parsed.data.entityType,
        direction: parsed.data.direction,
      },
    },
    {
      tenantId: auth.tenantId,
      organizationId: auth.orgId,
      userId: auth.sub,
    },
  )

  const run = await syncRunService.createRun(
    {
      integrationId: parsed.data.integrationId,
      entityType: parsed.data.entityType,
      direction: parsed.data.direction,
      cursor,
      triggeredBy: parsed.data.triggeredBy ?? auth.sub,
      progressJobId: progressJob.id,
    },
    scope,
  )

  const queueName = parsed.data.direction === 'import' ? 'data-sync-import' : 'data-sync-export'
  const queue = getSyncQueue(queueName)
  await queue.enqueue({
    runId: run.id,
    batchSize: parsed.data.batchSize,
    scope: {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      userId: auth.sub,
    },
  })

  return NextResponse.json({ id: run.id, progressJobId: progressJob.id }, { status: 201 })
}
