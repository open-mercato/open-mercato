import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { Floor } from '../../../../../data/entities'
import { floorLayoutSchema, floorLayoutReplaceSchema, type FloorLayoutReplaceInput } from '../../../../../data/validators'
import { assertBuildingPermitted } from '../../../../../lib/buildingAccess'
import { BUILDING_RESOURCE_KIND } from '../../../../../commands/building'
import { handleRouteError, readRouteParam, resolveStaffContext, runStaffGuard } from '../../../../routeContext'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['property_management.manage'] },
}

type RouteContext = { params: Promise<{ id?: string }> }

const floorResponseSchema = z.object({
  id: z.string().uuid(),
  number: z.number().int(),
  name: z.string(),
  sizeX: z.number(),
  sizeY: z.number(),
  updatedAt: z.string(),
})

export async function POST(req: Request, routeCtx: RouteContext) {
  try {
    const context = await resolveStaffContext(req)
    const buildingId = await readRouteParam(routeCtx.params, 'id')
    if (!buildingId) {
      return NextResponse.json({ error: context.translate('property_management.errors.buildingNotFound', 'Building not found.') }, { status: 404 })
    }
    await assertBuildingPermitted(context.permitted, buildingId)
    const body = await readJsonSafe<Record<string, unknown>>(req, {})
    const layout = floorLayoutSchema.parse(body ?? {})
    const input: FloorLayoutReplaceInput = floorLayoutReplaceSchema.parse({
      tenantId: context.tenantId,
      organizationId: context.organizationId,
      buildingId,
      layout,
    })
    const guarded = await runStaffGuard(req, context, {
      resourceKind: BUILDING_RESOURCE_KIND,
      resourceId: buildingId,
      operation: 'update',
      payload: { ...input },
    })
    if (!guarded.ok) return guarded.response
    const commandInput = guarded.modifiedPayload ? floorLayoutReplaceSchema.parse(guarded.modifiedPayload) : input
    const commandBus = context.ctx.container.resolve('commandBus') as CommandBus
    await commandBus.execute('property_management.floor.layout_replace', { input: commandInput, ctx: context.ctx })
    await guarded.runAfterSuccess()
    const scope = { tenantId: context.tenantId, organizationId: context.organizationId }
    const floors = await findWithDecryption(
      context.em,
      Floor,
      { ...scope, buildingId, deletedAt: null },
      { orderBy: { number: 'asc' } },
      scope,
    )
    return NextResponse.json({
      floors: floors.map((floor) => ({
        id: floor.id,
        number: floor.number,
        name: floor.name,
        sizeX: Number(floor.sizeX),
        sizeY: Number(floor.sizeY),
        updatedAt: floor.updatedAt.toISOString(),
      })),
    })
  } catch (err) {
    const rejection = getCommandInterceptorHttpRejection(err)
    if (rejection) return NextResponse.json(rejection.body, { status: rejection.status })
    return handleRouteError(err, 'property_management.floor_layout_failed')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Property Management',
  summary: 'Replace a building floor layout',
  methods: {
    POST: {
      summary: 'Lay out the floors of a building from below/above-ground counts',
      description:
        'Adds floors at the top or bottom, removes empty ones and renames/resizes kept floors. 422 with `minimumAbove`, `minimumBelow` and `blockingFloor` when a removed floor still holds units. Honours the optimistic-lock header against the building.',
      requestBody: { contentType: 'application/json', schema: floorLayoutSchema },
      responses: [{ status: 200, description: 'Floors after the change', schema: z.object({ floors: z.array(floorResponseSchema) }) }],
      errors: [
        { status: 404, description: 'Building not found or not assigned to the caller' },
        { status: 409, description: 'Optimistic-lock conflict or archived building' },
        { status: 422, description: 'A removed floor still holds units, or a resize would strand a space, unit or common area' },
      ],
    },
  },
}
