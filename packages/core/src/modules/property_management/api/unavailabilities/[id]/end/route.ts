import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { Unavailability } from '../../../../data/entities'
import { unavailabilityEndSchema } from '../../../../data/validators'
import { isBuildingPermitted } from '../../../../lib/buildingAccess'
import { UNAVAILABILITY_RESOURCE_KIND, type UnavailabilityEndResult } from '../../../../commands/availability'
import { guardedCommandInput, handleRouteError, readRouteParam, resolveStaffContext, runStaffGuard } from '../../../routeContext'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['property_management.availability.manage'] },
}

type RouteContext = { params: Promise<{ id?: string }> }

export async function POST(req: Request, routeCtx: RouteContext) {
  try {
    const context = await resolveStaffContext(req)
    const id = await readRouteParam(routeCtx.params, 'id')
    if (!id) {
      return NextResponse.json({ error: context.translate('property_management.errors.unavailabilityNotFound', 'Unavailability not found.') }, { status: 404 })
    }
    const scope = { tenantId: context.tenantId, organizationId: context.organizationId }
    const input = unavailabilityEndSchema.parse({ id, ...scope })
    const current = await findOneWithDecryption(context.em, Unavailability, { id, ...scope, deletedAt: null }, undefined, scope)
    if (!current || !isBuildingPermitted(context.permitted, current.buildingId)) {
      return NextResponse.json({ error: context.translate('property_management.errors.unavailabilityNotFound', 'Unavailability not found.') }, { status: 404 })
    }
    const guarded = await runStaffGuard(req, context, { resourceKind: UNAVAILABILITY_RESOURCE_KIND, resourceId: id, operation: 'update', payload: { ...input } })
    if (!guarded.ok) return guarded.response
    const commandInput = guardedCommandInput(unavailabilityEndSchema, guarded, input, { id, ...scope })
    const commandBus = context.ctx.container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<typeof commandInput, UnavailabilityEndResult>('property_management.unavailability.end', {
      input: commandInput,
      ctx: context.ctx,
    })
    await guarded.runAfterSuccess()
    return NextResponse.json({ ok: true, id: result.unavailabilityId, endedAt: result.endedAt })
  } catch (err) {
    const rejection = getCommandInterceptorHttpRejection(err)
    if (rejection) return NextResponse.json(rejection.body, { status: rejection.status })
    return handleRouteError(err, 'property_management.unavailability_end_failed')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Property Management',
  summary: 'End an unavailability',
  methods: {
    POST: {
      summary: 'Make the subject available again now',
      description: 'Sets `endedAt` to the current building-local time; a period that has not started yet no longer takes effect. Bookings it cancelled are not restored. Optimistic lock on the unavailability.',
      responses: [{ status: 200, description: 'Ended', schema: z.object({ ok: z.boolean(), id: z.string().uuid(), endedAt: z.string() }) }],
      errors: [
        { status: 404, description: 'Unavailability not found or its building is not assigned to the caller' },
        { status: 409, description: 'unavailability_already_ended, or the record changed since it was loaded' },
      ],
    },
  },
}
