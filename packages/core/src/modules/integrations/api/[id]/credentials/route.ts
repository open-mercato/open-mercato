import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getIntegration } from '@open-mercato/shared/modules/integrations/types'
import { emitIntegrationsEvent } from '../../../events'
import { saveCredentialsSchema } from '../../../data/validators'
import type { CredentialsService } from '../../../lib/credentials-service'

const idParamsSchema = z.object({ id: z.string().min(1) })

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['integrations.view'] },
  PUT: { requireAuth: true, requireFeatures: ['integrations.credentials.manage'] },
}

export const openApi = {
  tags: ['Integrations'],
  summary: 'Get or save integration credentials',
}

function resolveParams(ctx: { params?: Promise<{ id?: string }> | { id?: string } }): Promise<{ id?: string } | undefined> | { id?: string } | undefined {
  if (!ctx.params) return undefined
  if (typeof (ctx.params as Promise<unknown>).then === 'function') {
    return ctx.params as Promise<{ id?: string }>
  }
  return ctx.params as { id?: string }
}

export async function GET(req: Request, ctx: { params?: Promise<{ id?: string }> | { id?: string } }) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rawParams = await resolveParams(ctx)
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
  const scope = { organizationId: auth.orgId as string, tenantId: auth.tenantId }

  const values = await credentialsService.resolve(integration.id, scope)

  return NextResponse.json({
    integrationId: integration.id,
    schema: credentialsService.getSchema(integration.id),
    credentials: values ?? {},
  })
}

export async function PUT(req: Request, ctx: { params?: Promise<{ id?: string }> | { id?: string } }) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rawParams = await resolveParams(ctx)
  const parsedParams = idParamsSchema.safeParse(rawParams)
  if (!parsedParams.success) {
    return NextResponse.json({ error: 'Invalid integration id' }, { status: 400 })
  }

  const integration = getIntegration(parsedParams.data.id)
  if (!integration) {
    return NextResponse.json({ error: 'Integration not found' }, { status: 404 })
  }

  const parsedBody = saveCredentialsSchema.safeParse(await req.json())
  if (!parsedBody.success) {
    return NextResponse.json({ error: 'Invalid credentials payload', details: parsedBody.error.flatten() }, { status: 422 })
  }

  const container = await createRequestContainer()
  const credentialsService = container.resolve('integrationCredentialsService') as CredentialsService
  const scope = { organizationId: auth.orgId as string, tenantId: auth.tenantId }

  await credentialsService.save(integration.id, parsedBody.data.credentials, scope)

  await emitIntegrationsEvent('integrations.credentials.updated', {
    integrationId: integration.id,
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
    userId: auth.sub,
  })

  return NextResponse.json({ ok: true })
}
