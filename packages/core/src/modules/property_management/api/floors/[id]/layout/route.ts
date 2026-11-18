import { NextResponse } from 'next/server'
import { z } from 'zod'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { buildQueryParams } from '@open-mercato/shared/lib/crud/query-params'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { Building, CommonArea, Floor, Space, Unit, type ProductUseKind } from '../../../../data/entities'
import { floorLayoutQuerySchema } from '../../../../data/validators'
import { isBuildingPermitted } from '../../../../lib/buildingAccess'
import { loadFloorLeases, loadFloorStatus, type FloorStatus } from '../../../../lib/floorStatus'
import { resolveCrmAccess } from '../../../../lib/crmAccess'
import { loadCategoryNames, loadProductNames, loadProductUses } from '../../../../lib/productUse'
import { findUnitsWithUpcomingBookings, leaseBlockersOf } from '../../../../lib/usageGuards'
import { handleRouteError, readRouteParam, resolveStaffContext } from '../../../routeContext'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['property_management.view'] },
}

type RouteContext = { params: Promise<{ id?: string }> }

const rectSchema = { x: z.number(), y: z.number(), width: z.number(), depth: z.number() }

const leaseStatusSchema = z.enum(['proposed', 'pending_order', 'active', 'declined', 'withdrawn', 'expired', 'ended'])

const openProposalStatusSchema = z.enum(['sending', 'sent', 'declined'])

const unitStatusSchema = {
  status: z.enum(['occupied', 'available', 'unavailable', 'booked', 'free']).optional(),
  lease: z
    .object({
      id: z.string().uuid(),
      reference: z.string(),
      status: leaseStatusSchema,
      startsOn: z.string(),
      endsOn: z.string(),
      daysLeft: z.number().int(),
      customerCompanyId: z.string().uuid(),
      companyName: z.string().nullable().optional(),
      contactPersonId: z.string().uuid().nullable(),
      contactName: z.string().nullable().optional(),
      contactEmail: z.string().nullable().optional(),
      extensionRespondBy: z.string().nullable(),
      extensionStatus: openProposalStatusSchema.nullable(),
    })
    .nullable()
    .optional(),
  leaseEnding: z.boolean().optional(),
  proposed: z.boolean().optional(),
  proposal: z
    .object({
      id: z.string().uuid().nullable(),
      leaseId: z.string().uuid(),
      reference: z.string(),
      status: openProposalStatusSchema.nullable(),
      respondBy: z.string().nullable(),
      startsOn: z.string(),
      endsOn: z.string(),
      customerCompanyId: z.string().uuid(),
      companyName: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  bookings: z
    .array(
      z.object({
        id: z.string().uuid(),
        status: z.enum(['pending', 'confirmed', 'completed', 'cancelled']),
        startsAt: z.string(),
        endsAt: z.string(),
        billingUnit: z.string(),
        productName: z.string(),
        personId: z.string().uuid(),
        personName: z.string().nullable().optional(),
        companyId: z.string().uuid().nullable(),
        companyName: z.string().nullable().optional(),
      }),
    )
    .optional(),
  unavailable: z
    .object({
      source: z.enum(['building', 'floor', 'space', 'unit', 'building_archived']),
      reasonLabel: z.string().nullable(),
      reasonText: z.string().nullable(),
      from: z.string().nullable(),
      until: z.string().nullable(),
    })
    .nullable()
    .optional(),
  reservation: z
    .object({ leaseId: z.string().uuid(), reference: z.string(), until: z.string() })
    .nullable()
    .optional(),
}

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
      ...unitStatusSchema,
    }),
  ),
  commonAreas: z.array(z.object({ id: z.string().uuid(), name: z.string(), kind: z.string(), updatedAt: z.string(), ...rectSchema })),
  crmAccess: z.object({ people: z.boolean(), companies: z.boolean() }),
  date: z.string().optional(),
  leaseEndingThresholdDays: z.number().int().optional(),
  unavailableAreas: z
    .array(
      z.object({
        subjectType: z.enum(['building', 'floor', 'space']),
        subjectId: z.string().uuid(),
        reasonLabel: z.string().nullable(),
        reasonText: z.string().nullable(),
        from: z.string().nullable(),
        until: z.string().nullable(),
      }),
    )
    .optional(),
})

function rect(record: { x: string; y: string; width: string; depth: string }) {
  return { x: Number(record.x), y: Number(record.y), width: Number(record.width), depth: Number(record.depth) }
}

export async function GET(req: Request, routeCtx: RouteContext) {
  try {
    const context = await resolveStaffContext(req)
    const floorId = await readRouteParam(routeCtx.params, 'id')
    const { date = null } = floorLayoutQuerySchema.parse(buildQueryParams(new URL(req.url).searchParams))
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
    const unitIds = units.map((unit) => unit.id)
    const [productNames, categoryNames, uses, leases, bookedUnits, crmAccess] = await Promise.all([
      loadProductNames(context.em, scope, productIds),
      loadCategoryNames(context.em, scope, units.map((unit) => unit.catalogCategoryId)),
      loadProductUses(context.em, scope, productIds),
      loadFloorLeases(context.em, scope, unitIds, date),
      findUnitsWithUpcomingBookings(context.em, scope, unitIds),
      resolveCrmAccess(context.ctx.container, context.ctx.auth ?? null, scope),
    ])
    const blockedUnits = new Set([...leaseBlockersOf(leases).map((blocker) => blocker.unitId), ...bookedUnits])
    const useByProduct = new Map<string, ProductUseKind>(Array.from(uses.entries()).map(([productId, info]) => [productId, info.use]))
    const status: FloorStatus | null = date
      ? await loadFloorStatus(
          context.em,
          scope,
          {
            building: { id: building.id, archived: building.status === 'archived' },
            floorId: floor.id,
            spaceIds: spaces.map((space) => space.id),
            units,
            uses: useByProduct,
            leases,
            crmAccess,
          },
          date,
        )
      : null
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
        ...(status?.units.get(unit.id) ?? {}),
      })),
      commonAreas: commonAreas.map((area) => ({
        id: area.id,
        name: area.name,
        kind: area.kind,
        updatedAt: area.updatedAt.toISOString(),
        ...rect(area),
      })),
      crmAccess,
      ...(status
        ? { date: status.date, leaseEndingThresholdDays: status.leaseEndingThresholdDays, unavailableAreas: status.unavailableAreas }
        : {}),
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
      description:
        'Used by the floor setup page, the placement editor and the floor plan. With `?date=YYYY-MM-DD` every unit also carries its status on that date: `unavailable` when the unit, its space, floor or building is unavailable at any time of the day or the building is archived (wins over every other status; the lease and bookings are still returned), otherwise `booked` / `free` for bookable units (a pending, confirmed or completed booking overlapping the day) and `occupied` / `available` for leasable units (a lease activating, active or ended whose term covers the date). `lease` carries the reference, company, contact, end date and `daysLeft` counted from the date; `leaseEnding` is true when `daysLeft` is at most the organization\'s `leaseEndingThresholdDays`; `proposed` marks a unit held by an open new-lease proposal whose term has not ended; `proposal.status` and `lease.extensionStatus` tell a `declined` proposal (still approvable until `respondBy`) from one waiting for an answer. `reservation` is set when no lease is in force on the date but a lease with a pending end or reschedule still reserves it under its previous term (`until` is the last reserved day), so the unit cannot be leased yet. `bookings` lists the day\'s bookings in start order with the booking person and company. CRM data is gated on the customers features: `lease.contactName`, `lease.contactEmail` and `bookings[].personName` are present only with `customers.people.view`, and `lease.companyName`, `proposal.companyName` and `bookings[].companyName` only with `customers.companies.view`; otherwise those keys are omitted (the ids stay). `crmAccess` tells the caller which of the two it has. `unavailableAreas` lists the building, floor and spaces of this floor that are unavailable during the day (for hatching). The status part takes six queries whatever the number of units (seven when a closure names a dictionary reason).',
      query: floorLayoutQuerySchema,
      responses: [{ status: 200, description: 'Floor layout', schema: layoutResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid `date`' },
        { status: 404, description: 'Floor not found or its building is not assigned to the caller' },
      ],
    },
  },
}
