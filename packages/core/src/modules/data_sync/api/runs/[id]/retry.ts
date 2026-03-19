import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { ProgressService } from '../../../../progress/lib/progressService'
import type { SyncRunService } from '../../../lib/sync-run-service'
import { retrySyncSchema } from '../../../data/validators'
import { startDataSyncRun } from '../../../lib/start-run'

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

  const payload = await readJsonSafe(req)
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

  const { run, progressJob } = await startDataSyncRun({
    syncRunService,
    progressService,
    scope: {
      ...scope,
      userId: auth.sub,
    },
    input: {
      integrationId: previous.integrationId,
      entityType: previous.entityType,
      direction: previous.direction,
      cursor,
      triggeredBy: auth.sub,
      batchSize: 100,
      progressJob: {
        name: `Retry data sync ${previous.integrationId} — ${previous.entityType}`,
      },
    },
  })

  return NextResponse.json({ id: run.id, progressJobId: progressJob?.id ?? null }, { status: 201 })
}
