import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { Building, CommonArea, Floor, Space, Unit } from '../../../../data/entities'
import { buildingIdSchema } from '../../../../data/validators'
import { assertBuildingPermitted } from '../../../../lib/buildingAccess'
import { findUnitBlockers, findUnitsEverUsed } from '../../../../lib/usageGuards'
import { BUILDING_RESOURCE_KIND } from '../../../../commands/building'
import { handleRouteError, readRouteParam, resolveStaffContext, runStaffGuard } from '../../../routeContext'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['property_management.view'] },
  POST: { requireAuth: true, requireFeatures: ['property_management.manage'] },
}

type RouteContext = { params: Promise<{ id?: string }> }

const blockerSchema = z.object({
  kind: z.enum(['lease', 'booking']),
  id: z.string(),
  label: z.string(),
  unitId: z.string(),
  until: z.string().nullable(),
})

const usageSchema = z.object({
  floorCount: z.number().int(),
  spaceCount: z.number().int(),
  unitCount: z.number().int(),
  commonAreaCount: z.number().int(),
  everUsed: z.boolean(),
  canDelete: z.boolean(),
  canArchive: z.boolean(),
  blockers: z.array(blockerSchema),
})

export async function GET(req: Request, routeCtx: RouteContext) {
  try {
    const context = await resolveStaffContext(req)
    const buildingId = await readRouteParam(routeCtx.params, 'id')
    if (!buildingId) {
      return NextResponse.json({ error: context.translate('property_management.errors.buildingNotFound', 'Building not found.') }, { status: 404 })
    }
    await assertBuildingPermitted(context.permitted, buildingId)
    const scope = { tenantId: context.tenantId, organizationId: context.organizationId }
    const building = await findOneWithDecryption(context.em, Building, { id: buildingId, ...scope, deletedAt: null }, undefined, scope)
    if (!building) {
      return NextResponse.json({ error: context.translate('property_management.errors.buildingNotFound', 'Building not found.') }, { status: 404 })
    }
    const where = { ...scope, buildingId, deletedAt: null }
    const [floors, spaces, units, commonAreas] = await Promise.all([
      findWithDecryption(context.em, Floor, where, undefined, scope),
      findWithDecryption(context.em, Space, where, undefined, scope),
      findWithDecryption(context.em, Unit, where, undefined, scope),
      findWithDecryption(context.em, CommonArea, where, undefined, scope),
    ])
    const unitIds = units.map((unit) => unit.id)
    const [blockers, used] = await Promise.all([
      findUnitBlockers(context.em, scope, unitIds),
      findUnitsEverUsed(context.em, scope, unitIds),
    ])
    return NextResponse.json({
      floorCount: floors.length,
      spaceCount: spaces.length,
      unitCount: units.length,
      commonAreaCount: commonAreas.length,
      everUsed: used.length > 0,
      canDelete: used.length === 0,
      canArchive: blockers.length === 0 && building.status !== 'archived',
      blockers,
    })
  } catch (err) {
    const rejection = getCommandInterceptorHttpRejection(err)
    if (rejection) return NextResponse.json(rejection.body, { status: rejection.status })
    return handleRouteError(err, 'property_management.building_usage_failed')
  }
}

export async function POST(req: Request, routeCtx: RouteContext) {
  try {
    const context = await resolveStaffContext(req)
    const buildingId = await readRouteParam(routeCtx.params, 'id')
    if (!buildingId) {
      return NextResponse.json({ error: context.translate('property_management.errors.buildingNotFound', 'Building not found.') }, { status: 404 })
    }
    await assertBuildingPermitted(context.permitted, buildingId)
    const input = buildingIdSchema.parse({ id: buildingId, tenantId: context.tenantId, organizationId: context.organizationId })
    const guarded = await runStaffGuard(req, context, {
      resourceKind: BUILDING_RESOURCE_KIND,
      resourceId: buildingId,
      operation: 'custom',
      payload: { ...input },
    })
    if (!guarded.ok) return guarded.response
    const commandBus = context.ctx.container.resolve('commandBus') as CommandBus
    await commandBus.execute('property_management.building.archive', { input, ctx: context.ctx })
    await guarded.runAfterSuccess()
    return NextResponse.json({ ok: true })
  } catch (err) {
    const rejection = getCommandInterceptorHttpRejection(err)
    if (rejection) return NextResponse.json(rejection.body, { status: rejection.status })
    return handleRouteError(err, 'property_management.building_archive_failed')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Property Management',
  summary: 'Archive a building',
  methods: {
    GET: {
      summary: 'What deleting or archiving the building would take with it',
      responses: [{ status: 200, description: 'Counts, usage and blockers', schema: usageSchema }],
      errors: [{ status: 404, description: 'Building not found or not assigned to the caller' }],
    },
    POST: {
      summary: 'Archive the building for good',
      description: 'Final: the building leaves every list and switcher. Refused (409 `building_archive_blocked`, with `blockers`) while active leases or upcoming bookings exist.',
      responses: [{ status: 200, description: 'Archived', schema: z.object({ ok: z.literal(true) }) }],
      errors: [
        { status: 404, description: 'Building not found or not assigned to the caller' },
        { status: 409, description: 'Active leases or upcoming bookings, already archived, or optimistic-lock conflict' },
      ],
    },
  },
}
