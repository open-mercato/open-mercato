import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { listSyncRunsQuerySchema } from '../data/validators'
import type { SyncRunService } from '../lib/sync-run-service'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['data_sync.view'] },
}

export const openApi = {
  tags: ['DataSync'],
  summary: 'List sync runs',
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const parsed = listSyncRunsQuerySchema.safeParse({
    integrationId: url.searchParams.get('integrationId') ?? undefined,
    entityType: url.searchParams.get('entityType') ?? undefined,
    direction: url.searchParams.get('direction') ?? undefined,
    status: url.searchParams.get('status') ?? undefined,
    page: url.searchParams.get('page') ?? undefined,
    pageSize: url.searchParams.get('pageSize') ?? undefined,
  })

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid query', details: parsed.error.flatten() }, { status: 400 })
  }

  const container = await createRequestContainer()
  const syncRunService = container.resolve('dataSyncRunService') as SyncRunService

  const { items, total } = await syncRunService.listRuns(parsed.data, {
    organizationId: auth.orgId as string,
    tenantId: auth.tenantId,
  })

  return NextResponse.json({
    items: items.map((item) => ({
      id: item.id,
      integrationId: item.integrationId,
      entityType: item.entityType,
      direction: item.direction,
      status: item.status,
      cursor: item.cursor ?? null,
      initialCursor: item.initialCursor ?? null,
      createdCount: item.createdCount,
      updatedCount: item.updatedCount,
      skippedCount: item.skippedCount,
      failedCount: item.failedCount,
      batchesCompleted: item.batchesCompleted,
      lastError: item.lastError ?? null,
      progressJobId: item.progressJobId ?? null,
      triggeredBy: item.triggeredBy ?? null,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    })),
    total,
    page: parsed.data.page,
    pageSize: parsed.data.pageSize,
    totalPages: Math.max(1, Math.ceil(total / parsed.data.pageSize)),
  })
}
