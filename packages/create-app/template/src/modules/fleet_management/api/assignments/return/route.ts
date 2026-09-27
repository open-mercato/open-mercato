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
import { createLogger } from '@open-mercato/shared/lib/logger'
import { returnVehicleAssignmentSchema } from '../../../data/validators'
import { FLEET_ASSIGNMENT_ENTITY_ID } from '../../../commands/fleet'
import '../../../commands/assignments'

const logger = createLogger('fleet_management')

type ActionContext = {
  ctx: CommandRuntimeContext
  tenantId: string
  organizationId: string
  translate: (key: string, fallback?: string) => string
}

export const metadata = {
  path: '/fleet_management/assignments/return',
  POST: { requireAuth: true, requireFeatures: ['fleet.assign'] },
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
      container, auth, organizationScope, selectedOrganizationId: organizationId,
      organizationIds: organizationScope?.filterIds ?? (auth.orgId ? [auth.orgId] : null), request: req,
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
    const input = returnVehicleAssignmentSchema.parse(scoped)
    const userId = context.ctx.auth?.sub
    if (!userId) throw new CrudHttpError(401, { error: context.translate('errors.unauthorized', 'Unauthorized') })
    const guarded = await runRouteMutationGuards({
      container: context.ctx.container,
      req,
      auth: { userId, tenantId: context.tenantId, organizationId: context.organizationId },
      input: {
        resourceKind: FLEET_ASSIGNMENT_ENTITY_ID,
        resourceId: input.id,
        operation: 'update',
        mutationPayload: input,
      },
    })
    if (!guarded.ok) return guarded.response
    const commandInput = guarded.modifiedPayload ? returnVehicleAssignmentSchema.parse(guarded.modifiedPayload) : input
    const commandBus = context.ctx.container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<typeof commandInput, { assignmentId: string; vehicleId: string; returnedAt: Date; returnOdometer: number }>(
      'fleet_management.assignments.return', { input: commandInput, ctx: context.ctx },
    )
    await guarded.runAfterSuccess()
    return NextResponse.json({ ok: true, assignmentId: result.assignmentId, vehicleId: result.vehicleId, returnedAt: result.returnedAt.toISOString(), returnOdometer: result.returnOdometer })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    const interceptorRejection = getCommandInterceptorHttpRejection(err)
    if (interceptorRejection) return NextResponse.json(interceptorRejection.body, { status: interceptorRejection.status })
    const { translate } = await resolveTranslations()
    if (err instanceof z.ZodError) return NextResponse.json({ error: translate('errors.invalid_input', 'Invalid input') }, { status: 400 })
    logger.error('fleet_management.return_vehicle.failed', { err })
    return NextResponse.json({ error: translate('fleet_management.errors.return_failed', 'Unable to return the vehicle') }, { status: 400 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Fleet Management',
  summary: 'Return vehicle custody',
  methods: {
    POST: {
      summary: 'Close a custody assignment, release the vehicle and log the return odometer',
      requestBody: { contentType: 'application/json', schema: returnVehicleAssignmentSchema },
      responses: [{ status: 200, description: 'Custody returned', schema: z.object({ ok: z.boolean(), assignmentId: z.string().uuid(), vehicleId: z.string().uuid(), returnedAt: z.string(), returnOdometer: z.number() }) }],
    },
  },
}