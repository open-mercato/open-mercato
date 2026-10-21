import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { withScopedPayload } from '@open-mercato/shared/lib/api/scoped'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { cancelTripSchema, type CancelTripInput } from '../../../commands/cancel'
import { TRANSPORT_TRIP_ENTITY_ID } from '../../../commands/transport'
import '../../../commands/transport'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('transport_operations')

type ActionContext = {
  ctx: CommandRuntimeContext
  tenantId: string
  organizationId: string
  translate: (key: string, fallback?: string) => string
}

export const metadata = {
  path: '/transport_operations/trips/cancel',
  POST: { requireAuth: true, requireFeatures: ['transport.write'] },
}

async function resolveActionContext(req: Request): Promise<ActionContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()
  if (!auth?.tenantId) throw new CrudHttpError(401, { error: translate('errors.unauthorized', 'Unauthorized') })
  const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationId = organizationScope?.selectedId ?? auth.orgId ?? null
  if (!organizationId) throw new CrudHttpError(400, { error: translate('errors.organization_required', 'Organization context is required') })
  return {
    ctx: {
      container,
      auth,
      organizationScope,
      selectedOrganizationId: organizationId,
      organizationIds: organizationScope?.filterIds ?? (auth.orgId ? [auth.orgId] : null),
      request: req,
    },
    tenantId: auth.tenantId,
    organizationId,
    translate,
  }
}

export async function POST(req: Request) {
  try {
    const context = await resolveActionContext(req)
    const raw = await readJsonSafe(req, {})
    const scoped = withScopedPayload(raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}, context.ctx, context.translate)
    const input = cancelTripSchema.parse(scoped)
    const userId = context.ctx.auth?.sub
    if (!userId) throw new CrudHttpError(401, { error: context.translate('errors.unauthorized', 'Unauthorized') })
    const guarded = await runRouteMutationGuards({
      container: context.ctx.container,
      req,
      auth: { userId, tenantId: context.tenantId, organizationId: context.organizationId },
      input: {
        resourceKind: TRANSPORT_TRIP_ENTITY_ID,
        resourceId: input.id,
        operation: 'update',
        mutationPayload: input,
      },
    })
    if (!guarded.ok) return guarded.response
    const commandInput = guarded.modifiedPayload ? cancelTripSchema.parse(guarded.modifiedPayload) : input
    const commandBus = context.ctx.container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<CancelTripInput, { tripId: string; cancelledAt: Date }>(
      'transport_operations.trips.cancel',
      { input: commandInput, ctx: context.ctx },
    )
    await guarded.runAfterSuccess()
    return NextResponse.json({ ok: true, tripId: result.tripId, cancelledAt: result.cancelledAt.toISOString() })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    const interceptorRejection = getCommandInterceptorHttpRejection(err)
    if (interceptorRejection) return NextResponse.json(interceptorRejection.body, { status: interceptorRejection.status })
    const { translate } = await resolveTranslations()
    if (err instanceof z.ZodError) return NextResponse.json({ error: translate('errors.invalid_input', 'Invalid input') }, { status: 400 })
    logger.error('transport_operations.cancel_trip.failed', { err })
    return NextResponse.json({ error: translate('transport_operations.errors.cancel_failed', 'Unable to cancel trip') }, { status: 400 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Transport Operations',
  summary: 'Cancel trip',
  methods: {
    POST: {
      summary: 'Cancel a scheduled or in-progress trip and release its driver',
      requestBody: { contentType: 'application/json', schema: cancelTripSchema },
      responses: [{
        status: 200,
        description: 'Trip cancelled',
        schema: z.object({ ok: z.boolean(), tripId: z.string().uuid(), cancelledAt: z.string() }),
      }],
      errors: [
        { status: 409, description: 'Trip is no longer cancellable' },
        { status: 404, description: 'Trip not found' },
      ],
    },
  },
}
