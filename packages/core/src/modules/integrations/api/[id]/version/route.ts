import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getIntegration } from '@open-mercato/shared/modules/integrations/types'
import { emitIntegrationsEvent } from '../../../events'
import { updateVersionSchema } from '../../../data/validators'
import type { IntegrationStateService } from '../../../lib/state-service'
import { resolveDefaultApiVersion } from '../../../lib/registry-service'
import {
  resolveUserFeatures,
  runIntegrationMutationGuardAfterSuccess,
  runIntegrationMutationGuards,
} from '../../guards'

const idParamsSchema = z.object({ id: z.string().min(1) })

export const metadata = {
  PUT: { requireAuth: true, requireFeatures: ['integrations.manage'] },
}

export const openApi = {
  tags: ['Integrations'],
  summary: 'Change integration API version',
}

export async function PUT(req: Request, ctx: { params?: Promise<{ id?: string }> | { id?: string } }) {
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

  const payload = await req.json().catch(() => null)
  const parsedBody = updateVersionSchema.safeParse(payload)
  if (!parsedBody.success) {
    return NextResponse.json({ error: 'Invalid payload', details: parsedBody.error.flatten() }, { status: 422 })
  }

  const requestedVersion = parsedBody.data.apiVersion
  const availableVersions = integration.apiVersions ?? []
  if (availableVersions.length === 0) {
    return NextResponse.json({ error: 'This integration is not versioned' }, { status: 422 })
  }

  const exists = availableVersions.some((version) => version.id === requestedVersion)
  if (!exists) {
    return NextResponse.json({ error: 'Unknown integration version' }, { status: 422 })
  }

  const defaultVersion = resolveDefaultApiVersion(availableVersions)
  if (!defaultVersion) {
    return NextResponse.json({ error: 'Integration version configuration is invalid' }, { status: 422 })
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
      mutationPayload: parsedBody.data as Record<string, unknown>,
    },
    resolveUserFeatures(auth),
  )
  if (!guardResult.ok) {
    return NextResponse.json(guardResult.errorBody ?? { error: 'Operation blocked by guard' }, { status: guardResult.errorStatus ?? 422 })
  }

  let payloadData = parsedBody.data
  if (guardResult.modifiedPayload) {
    const mergedPayload = { ...parsedBody.data, ...guardResult.modifiedPayload }
    const reparsed = updateVersionSchema.safeParse(mergedPayload)
    if (!reparsed.success) {
      return NextResponse.json({ error: 'Invalid payload after guard transform', details: reparsed.error.flatten() }, { status: 422 })
    }
    payloadData = reparsed.data
  }
  if (!availableVersions.some((version) => version.id === payloadData.apiVersion)) {
    return NextResponse.json({ error: 'Unknown integration version' }, { status: 422 })
  }

  const stateService = container.resolve('integrationStateService') as IntegrationStateService
  const scope = { organizationId: auth.orgId as string, tenantId: auth.tenantId }

  const before = await stateService.resolveApiVersion(integration.id, scope)
  await stateService.upsert(integration.id, { apiVersion: payloadData.apiVersion }, scope)

  await emitIntegrationsEvent('integrations.version.changed', {
    integrationId: integration.id,
    previousVersion: before ?? defaultVersion,
    apiVersion: payloadData.apiVersion,
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
    userId: auth.sub,
  })

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
    apiVersion: payloadData.apiVersion,
    previousVersion: before ?? defaultVersion,
  })
}
