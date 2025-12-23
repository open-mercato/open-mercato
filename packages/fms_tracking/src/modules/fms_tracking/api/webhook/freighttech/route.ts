import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { decodeWebhookToken } from '../../../lib/webhookToken'
import { ScopedWebhookInput, webhookSchema } from '../../../data/validators'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { createRequestContainer } from '@/lib/di/container'
import { EntityManager } from '@mikro-orm/postgresql'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { withScopedPayload } from '@/lib/api/scoped'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['fms_tracking.freighttech.webhook'] },
}

type RouteContext = {
  ctx: CommandRuntimeContext
  em: EntityManager
  translate: (key: string, fallback?: string) => string
}

async function resolveWebhookContext(req: Request): Promise<RouteContext> {
  const container = await createRequestContainer()
  const url = new URL(req.url)
  const token = url.searchParams.get('token')

  if (!token) {
    console.debug('[fms_tracking.freighttech.webhook] Missing request token')
    throw new CrudHttpError(401, { error: 'Missing token' })
  }

  const decoded = decodeWebhookToken(token)
  if (!decoded) {
    console.debug('[fms_tracking.freighttech.webhook] Invalid request token')
    throw new CrudHttpError(401, { error: 'Invalid token' })
  }

  const { organizationId, tenantId } = decoded
  const auth = await getAuthFromRequest(req)
  if (!auth || !organizationId || !tenantId) {
    throw new CrudHttpError(401, { error: 'Unauthorized' })
  }
  auth.orgId = organizationId
  auth.tenantId = tenantId

  const { translate } = await resolveTranslations()
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const ctx: CommandRuntimeContext = {
    container,
    auth,
    organizationScope: scope,
    selectedOrganizationId: organizationId,
    organizationIds: scope?.filterIds ?? (auth.orgId ? [auth.orgId] : null),
    request: req,
  }
  const em = container.resolve('em') as EntityManager

  return {
    ctx,
    em,
    translate,
  }
}

// Webhook callback_url endpoint
export async function POST(req: Request) {
  try {
    const { ctx, translate } = await resolveWebhookContext(req)

    const payload = await req.json().catch(() => ({}))
    const data = webhookSchema.parse(payload)
    const input = withScopedPayload({ data }, ctx, translate) as ScopedWebhookInput

    const commandBus = ctx.container.resolve('commandBus') as CommandBus
    await commandBus.execute('fms_tracking.freighttech.webhook', { input, ctx })

    return NextResponse.json({})
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }

    console.error('[fms_tracking.freighttech.webhook] failed', err) 
    return NextResponse.json(
      { error: "INTERNAL_SERVER_ERROR" },
      { status: 500 }
    )
  }
}

const successSchema = z.object({})

const errorSchema = z.object({
  error: z.string(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Freighttech',
  summary: 'Freighttech Container Tracking webhook',
  methods: {
    POST: {
      summary: 'Push container data',
      requestBody: {
        contentType: 'application/json',
        schema: webhookSchema,
      },
      responses: [
        { status: 200, description: 'Received data', schema: successSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 400, description: 'Invalid payload', schema: errorSchema },
        { status: 500, description: 'Server error', schema: errorSchema },
      ],
    },
  },
}
