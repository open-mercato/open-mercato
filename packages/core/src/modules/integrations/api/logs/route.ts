import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { listIntegrationLogsQuerySchema } from '../../data/validators'
import type { IntegrationLogService } from '../../lib/log-service'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['integrations.view'] },
}

export const openApi = {
  tags: ['Integrations'],
  summary: 'List integration logs',
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const parsed = listIntegrationLogsQuerySchema.safeParse({
    integrationId: url.searchParams.get('integrationId') ?? undefined,
    level: url.searchParams.get('level') ?? undefined,
    runId: url.searchParams.get('runId') ?? undefined,
    entityType: url.searchParams.get('entityType') ?? undefined,
    entityId: url.searchParams.get('entityId') ?? undefined,
    page: url.searchParams.get('page') ?? undefined,
    pageSize: url.searchParams.get('pageSize') ?? undefined,
  })

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid query', details: parsed.error.flatten() }, { status: 400 })
  }

  const container = await createRequestContainer()
  const logService = container.resolve('integrationLogService') as IntegrationLogService

  const { items, total } = await logService.query(parsed.data, {
    organizationId: auth.orgId as string,
    tenantId: auth.tenantId,
  })

  return NextResponse.json({
    items: items.map((item) => ({
      id: item.id,
      integrationId: item.integrationId,
      runId: item.runId ?? null,
      scopeEntityType: item.scopeEntityType ?? null,
      scopeEntityId: item.scopeEntityId ?? null,
      level: item.level,
      message: item.message,
      code: item.code ?? null,
      payload: item.payload ?? null,
      createdAt: item.createdAt.toISOString(),
    })),
    total,
    page: parsed.data.page,
    pageSize: parsed.data.pageSize,
    totalPages: Math.max(1, Math.ceil(total / parsed.data.pageSize)),
  })
}
