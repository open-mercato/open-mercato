import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { listIntegrationLogsQuerySchema } from '@open-mercato/core/modules/integrations/data/validators'
import type { IntegrationLogService } from '@open-mercato/core/modules/integrations/lib/log-service'
import {
  finalizeIntegrationsReadResponse,
  integrationApiRoutePaths,
  runIntegrationsReadBeforeInterceptors,
} from '../umes-read'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['integrations.manage'] },
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

  const container = await createRequestContainer()
  const beforeInterceptors = await runIntegrationsReadBeforeInterceptors({
    routePath: integrationApiRoutePaths.logs,
    request: req,
    auth,
    container,
  })
  if (!beforeInterceptors.ok) {
    return NextResponse.json(beforeInterceptors.body, { status: beforeInterceptors.statusCode })
  }

  const query = beforeInterceptors.request.query ?? {}
  const parsed = listIntegrationLogsQuerySchema.safeParse({
    integrationId: typeof query.integrationId === 'string' ? query.integrationId : undefined,
    level: typeof query.level === 'string' ? query.level : undefined,
    runId: typeof query.runId === 'string' ? query.runId : undefined,
    entityType: typeof query.entityType === 'string' ? query.entityType : undefined,
    entityId: typeof query.entityId === 'string' ? query.entityId : undefined,
    page: typeof query.page === 'string' ? query.page : undefined,
    pageSize: typeof query.pageSize === 'string' ? query.pageSize : undefined,
  })

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid query', details: parsed.error.flatten() }, { status: 400 })
  }
  const logService = container.resolve('integrationLogService') as IntegrationLogService

  const { items, total } = await logService.query(parsed.data, {
    organizationId: auth.orgId as string,
    tenantId: auth.tenantId,
  })

  return finalizeIntegrationsReadResponse({
    routePath: integrationApiRoutePaths.logs,
    request: req,
    auth,
    container,
    interceptorRequest: beforeInterceptors.request,
    beforeMetadata: beforeInterceptors.metadataByInterceptor,
    enrich: {
      targetEntity: 'integrations.log',
      listKeys: ['items'],
    },
    body: {
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
    },
  })
}
