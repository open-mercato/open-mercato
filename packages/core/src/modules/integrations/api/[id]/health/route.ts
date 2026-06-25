import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getIntegration } from '@open-mercato/shared/modules/integrations/types'
import type { IntegrationHealthService } from '../../../lib/health-service'
import {
  resolveUserFeatures,
  runIntegrationMutationGuardAfterSuccess,
  runIntegrationMutationGuards,
} from '../../guards'

const idParamsSchema = z.object({ id: z.string().min(1) })

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['integrations.manage'] },
}

export const openApi = {
  tags: ['Integrations'],
  summary: 'Run health check for an integration',
}

export async function POST(req: Request, ctx: { params?: Promise<{ id?: string }> | { id?: string } }) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rawParams = (ctx.params && typeof (ctx.params as Promise<unknown>).then === 'function')
    ? await (ctx.params as Promise<{ id?: string }>)
    : (ctx.params as { id?: string } | undefined)

  const parsedParams = idParamsSchema.safeParse(rawParams)
  if (!parsedParams.success) {
    return NextResponse.json({ error: 'Invalid integration id' }, { status: 400 })
  }

  const integration = getIntegration(parsedParams.data.id)
  if (!integration) {
    return NextResponse.json({ error: 'Integration not found' }, { status: 404 })
  }

  const container = await createRequestContainer()
  const guardResult = await runIntegrationMutationGuards(
    container,
    {
      tenantId: auth.tenantId,
      organizationId: auth.orgId,
      userId: auth.sub ?? '',
      resourceKind: 'integrations.integration',
      resourceId: integration.id,
      operation: 'update',
      requestMethod: req.method,
      requestHeaders: req.headers,
      mutationPayload: { integrationId: integration.id },
    },
    resolveUserFeatures(auth),
  )
  if (!guardResult.ok) {
    return NextResponse.json(guardResult.errorBody ?? { error: 'Operation blocked by guard' }, { status: guardResult.errorStatus ?? 422 })
  }

  const healthService = container.resolve('integrationHealthService') as IntegrationHealthService

  const result = await healthService.runHealthCheck(
    integration.id,
    { organizationId: auth.orgId as string, tenantId: auth.tenantId },
  )

  await runIntegrationMutationGuardAfterSuccess(guardResult.afterSuccessCallbacks, {
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
    userId: auth.sub ?? '',
    resourceKind: 'integrations.integration',
    resourceId: integration.id,
    operation: 'update',
    requestMethod: req.method,
    requestHeaders: req.headers,
  })

  return NextResponse.json({
    status: result.status,
    message: result.message ?? null,
    details: result.details ?? null,
    latencyMs: result.latencyMs,
    checkedAt: result.checkedAt,
  })
}
