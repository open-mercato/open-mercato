import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getIntegration } from '@open-mercato/shared/modules/integrations/types'
import { emitIntegrationsEvent } from '../../../events'
import { updateStateSchema } from '../../../data/validators'
import type { IntegrationStateService } from '../../../lib/state-service'

const idParamsSchema = z.object({ id: z.string().min(1) })

export const metadata = {
  PUT: { requireAuth: true, requireFeatures: ['integrations.manage'] },
}

export const openApi = {
  tags: ['Integrations'],
  summary: 'Update integration state',
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

  const parsedBody = updateStateSchema.safeParse(await req.json())
  if (!parsedBody.success) {
    return NextResponse.json({ error: 'Invalid state payload', details: parsedBody.error.flatten() }, { status: 422 })
  }

  const container = await createRequestContainer()
  const stateService = container.resolve('integrationStateService') as IntegrationStateService

  const state = await stateService.upsert(
    integration.id,
    {
      isEnabled: parsedBody.data.isEnabled,
      reauthRequired: parsedBody.data.reauthRequired,
    },
    {
      organizationId: auth.orgId as string,
      tenantId: auth.tenantId,
    },
  )

  await emitIntegrationsEvent('integrations.state.updated', {
    integrationId: integration.id,
    isEnabled: state.isEnabled,
    reauthRequired: state.reauthRequired,
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
    userId: auth.sub,
  })

  return NextResponse.json({
    isEnabled: state.isEnabled,
    reauthRequired: state.reauthRequired,
    apiVersion: state.apiVersion ?? null,
  })
}
