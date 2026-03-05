import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getBundle, getBundleIntegrations, getIntegration } from '@open-mercato/shared/modules/integrations/types'
import type { CredentialsService } from '../../lib/credentials-service'
import type { IntegrationStateService } from '../../lib/state-service'

const idParamsSchema = z.object({ id: z.string().min(1) })

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['integrations.view'] },
}

export const openApi = {
  tags: ['Integrations'],
  summary: 'Get integration detail',
}

export async function GET(req: Request, ctx: { params?: Promise<{ id?: string }> | { id?: string } }) {
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
  const credentialsService = container.resolve('integrationCredentialsService') as CredentialsService
  const stateService = container.resolve('integrationStateService') as IntegrationStateService
  const scope = { organizationId: auth.orgId as string, tenantId: auth.tenantId }

  const [credentials, state] = await Promise.all([
    credentialsService.resolve(integration.id, scope),
    stateService.get(integration.id, scope),
  ])

  const bundle = integration.bundleId ? getBundle(integration.bundleId) : undefined
  const bundleIntegrations = integration.bundleId
    ? await Promise.all(
      getBundleIntegrations(integration.bundleId).map(async (item) => {
        const itemState = await stateService.get(item.id, scope)
        return {
          ...item,
          isEnabled: itemState?.isEnabled ?? true,
        }
      }),
    )
    : []

  return NextResponse.json({
    integration,
    bundle,
    bundleIntegrations,
    state: {
      isEnabled: state?.isEnabled ?? true,
      apiVersion: state?.apiVersion ?? null,
      reauthRequired: state?.reauthRequired ?? false,
      lastHealthStatus: state?.lastHealthStatus ?? null,
      lastHealthCheckedAt: state?.lastHealthCheckedAt?.toISOString() ?? null,
    },
    hasCredentials: Boolean(credentials),
  })
}
