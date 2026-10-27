import { NextResponse } from 'next/server'
import { z } from 'zod'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { Building, CommonArea, Floor, Space, Unit } from '../../../../data/entities'
import { isBuildingPermitted } from '../../../../lib/buildingAccess'
import { loadCategoryNames, loadProductNames, loadProductUses } from '../../../../lib/productUse'
import { findUnitBlockers } from '../../../../lib/usageGuards'
import { handleRouteError, readRouteParam, resolveStaffContext } from '../../../routeContext'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['property_management.view'] },
}

type RouteContext = { params: Promise<{ id?: string }> }

const rectSchema = { x: z.number(), y: z.number(), width: z.number(), depth: z.number() }

const layoutResponseSchema = z.object({
  building: z.object({ id: z.string().uuid(), name: z.string(), address: z.string(), status: z.string(), updatedAt: z.string() }),
  floor: z.object({ id: z.string().uuid(), number: z.number().int(), name: z.string(), sizeX: z.number(), sizeY: z.number(), updatedAt: z.string() }),
  floors: z.array(z.object({ id: z.string().uuid(), number: z.number().int(), name: z.string(), sizeX: z.number(), sizeY: z.number() })),
  spaces: z.array(z.object({ id: z.string().uuid(), name: z.string(), purpose: z.string().nullable(), isDefault: z.boolean(), unitCount: z.number().int(), updatedAt: z.string(), ...rectSchema })),
  units: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string(),
      spaceId: z.string().uuid(),
      catalogCategoryId: z.string().uuid(),
      catalogProductId: z.string().uuid(),
      categoryName: z.string().nullable(),
      productName: z.string().nullable(),
      use: z.enum(['leasable', 'bookable']).nullable(),
      hasBlockers: z.boolean(),
      updatedAt: z.string(),
      ...rectSchema,
    }),
  ),
  commonAreas: z.array(z.object({ id: z.string().uuid(), name: z.string(), kind: z.string(), updatedAt: z.string(), ...rectSchema })),
})

function rect(record: { x: string; y: string; width: string; depth: string }) {
  return { x: Number(record.x), y: Number(record.y), width: Number(record.width), depth: Number(record.depth) }
}

export async function GET(req: Request, routeCtx: RouteContext) {
  try {
    const context = await resolveStaffContext(req)
    const floorId = await readRouteParam(routeCtx.params, 'id')
    const notFound = () =>
      NextResponse.json({ error: context.translate('property_management.errors.floorNotFound', 'Floor not found.') }, { status: 404 })
    if (!floorId) return notFound()
    const scope = { tenantId: context.tenantId, organizationId: context.organizationId }
    const floor = await findOneWithDecryption(context.em, Floor, { id: floorId, ...scope, deletedAt: null }, undefined, scope)
    if (!floor || !isBuildingPermitted(context.permitted, floor.buildingId)) return notFound()
    const building = await findOneWithDecryption(context.em, Building, { id: floor.buildingId, ...scope, deletedAt: null }, undefined, scope)
    if (!building) return notFound()
    const [floors, spaces, units, commonAreas] = await Promise.all([
      findWithDecryption(context.em, Floor, { ...scope, buildingId: building.id, deletedAt: null }, { orderBy: { number: 'asc' } }, scope),
      findWithDecryption(context.em, Space, { ...scope, floorId: floor.id, deletedAt: null }, { orderBy: { x: 'asc', y: 'asc' } }, scope),
      findWithDecryption(context.em, Unit, { ...scope, floorId: floor.id, deletedAt: null }, { orderBy: { name: 'asc' } }, scope),
      findWithDecryption(context.em, CommonArea, { ...scope, floorId: floor.id, deletedAt: null }, { orderBy: { name: 'asc' } }, scope),
    ])
    const productIds = units.map((unit) => unit.catalogProductId)
    const [productNames, categoryNames, uses, blockers] = await Promise.all([
      loadProductNames(context.em, scope, productIds),
      loadCategoryNames(context.em, scope, units.map((unit) => unit.catalogCategoryId)),
      loadProductUses(context.em, scope, productIds),
      findUnitBlockers(context.em, scope, units.map((unit) => unit.id)),
    ])
    const blockedUnits = new Set(blockers.map((blocker) => blocker.unitId))
    return NextResponse.json({
      building: {
        id: building.id,
        name: building.name,
        address: building.address,
        status: building.status,
        updatedAt: building.updatedAt.toISOString(),
      },
      floor: {
        id: floor.id,
        number: floor.number,
        name: floor.name,
        sizeX: Number(floor.sizeX),
        sizeY: Number(floor.sizeY),
        updatedAt: floor.updatedAt.toISOString(),
      },
      floors: floors.map((item) => ({ id: item.id, number: item.number, name: item.name, sizeX: Number(item.sizeX), sizeY: Number(item.sizeY) })),
      spaces: spaces.map((space) => ({
        id: space.id,
        name: space.name,
        purpose: space.purpose ?? null,
        isDefault: space.isDefault,
        unitCount: units.filter((unit) => unit.spaceId === space.id).length,
        updatedAt: space.updatedAt.toISOString(),
        ...rect(space),
      })),
      units: units.map((unit) => ({
        id: unit.id,
        name: unit.name,
        spaceId: unit.spaceId,
        catalogCategoryId: unit.catalogCategoryId,
        catalogProductId: unit.catalogProductId,
        categoryName: categoryNames.get(unit.catalogCategoryId) ?? null,
        productName: productNames.get(unit.catalogProductId) ?? null,
        use: uses.get(unit.catalogProductId)?.use ?? null,
        hasBlockers: blockedUnits.has(unit.id),
        updatedAt: unit.updatedAt.toISOString(),
        ...rect(unit),
      })),
      commonAreas: commonAreas.map((area) => ({
        id: area.id,
        name: area.name,
        kind: area.kind,
        updatedAt: area.updatedAt.toISOString(),
        ...rect(area),
      })),
    })
  } catch (err) {
    return handleRouteError(err, 'property_management.floor_layout_read_failed')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Property Management',
  summary: 'Floor layout',
  methods: {
    GET: {
      summary: 'Floor, its spaces, units and common areas in one call',
      description: 'Used by the floor setup page and the placement editor. The per-unit status projection (`?date=`) arrives with the floor plan.',
      responses: [{ status: 200, description: 'Floor layout', schema: layoutResponseSchema }],
      errors: [{ status: 404, description: 'Floor not found or its building is not assigned to the caller' }],
    },
  },
}
