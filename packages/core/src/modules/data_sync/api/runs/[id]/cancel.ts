import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { ProgressService } from '../../../../progress/lib/progressService'
import type { SyncRunService } from '../../../lib/sync-run-service'

const paramsSchema = z.object({ id: z.string().uuid() })

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['data_sync.run'] },
}

export const openApi = {
  tags: ['DataSync'],
  summary: 'Cancel a running sync',
}

export async function POST(req: Request, ctx: { params?: Promise<{ id?: string }> | { id?: string } }) {
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
  if (run.status !== 'running' && run.status !== 'pending') {
    return NextResponse.json({ error: 'Only pending or running runs can be cancelled' }, { status: 409 })
  }

  const progressCtx = {
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
    userId: auth.sub,
  }

  if (run.progressJobId) {
    try {
      await progressService.markCancelled(run.progressJobId, progressCtx)
    } catch (error) {
      const job = await progressService.getJob(run.progressJobId, progressCtx)
      const cancelRequested = job && (job.status === 'running' || job.status === 'cancelled')
        ? await progressService.isCancellationRequested(run.progressJobId)
        : false

      if (job?.status !== 'cancelled' && !cancelRequested) {
        throw error
      }
    }
  }

  await syncRunService.markStatus(run.id, 'cancelled', scope)
  return NextResponse.json({ ok: true })
}
