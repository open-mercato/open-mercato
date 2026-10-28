import { NextResponse } from 'next/server'
import { z } from 'zod'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { Building, Floor, Space, Unit, UnitProductPeriod } from '../../../data/entities'
import { buildingIdFilter } from '../../../lib/buildingAccess'
import { findOverlaps, loadReservedRanges } from '../../../lib/leaseOccupancy'
import { isIsoDate, leaseEndsOn } from '../../../lib/leaseTerm'
import { handleRouteError, resolveStaffContext } from '../../routeContext'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['property_management.view'] },
}

const querySchema = z.object({
  startsOn: z.string().refine(isIsoDate).optional(),
  termMonths: z.coerce.number().int().min(1).max(600).optional(),
  buildingId: z.string().uuid().optional(),
  search: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(100),
})

export async function GET(req: Request) {
  try {
    const context = await resolveStaffContext(req)
    const query = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams))
    const scope = { tenantId: context.tenantId, organizationId: context.organizationId }
    const buildingWhere: Record<string, unknown> = { ...scope, status: 'active', deletedAt: null }
    const permittedFilter = buildingIdFilter(context.permitted)
    if (permittedFilter) buildingWhere.id = permittedFilter
    if (query.buildingId) buildingWhere.id = permittedFilter ? { $in: permittedFilter.$in.filter((id) => id === query.buildingId) } : query.buildingId
    const buildings = await findWithDecryption(context.em, Building, buildingWhere, undefined, scope)
    if (!buildings.length) return NextResponse.json({ items: [] })
    const unitWhere: Record<string, unknown> = { ...scope, buildingId: { $in: buildings.map((building) => building.id) }, deletedAt: null }
    const term = query.search?.trim()
    if (term) unitWhere.name = { $ilike: `%${escapeLikePattern(term)}%` }
    const units = await findWithDecryption(context.em, Unit, unitWhere, { orderBy: { name: 'asc' } }, scope)
    const periods = units.length
      ? await findWithDecryption(context.em, UnitProductPeriod, { ...scope, unitId: { $in: units.map((unit) => unit.id) }, validTo: null, use: 'leasable' }, undefined, scope)
      : []
    const periodByUnit = new Map(periods.map((period) => [period.unitId, period]))
    const leasable = units.filter((unit) => periodByUnit.has(unit.id))
    const window = query.startsOn && query.termMonths ? { startsOn: query.startsOn, endsOn: leaseEndsOn(query.startsOn, query.termMonths) } : null
    const ranges = window ? await loadReservedRanges(context.em, scope, leasable.map((unit) => unit.id)) : []
    const free = window ? leasable.filter((unit) => !findOverlaps(ranges, unit.id, window).length) : leasable
    const selected = free.slice(0, query.limit)
    const [floors, spaces] = await Promise.all([
      findWithDecryption(context.em, Floor, { ...scope, id: { $in: Array.from(new Set(selected.map((unit) => unit.floorId))) } }, undefined, scope),
      findWithDecryption(context.em, Space, { ...scope, id: { $in: Array.from(new Set(selected.map((unit) => unit.spaceId))) } }, undefined, scope),
    ])
    const buildingById = new Map(buildings.map((building) => [building.id, building]))
    const floorById = new Map(floors.map((floor) => [floor.id, floor]))
    const spaceById = new Map(spaces.map((space) => [space.id, space]))
    return NextResponse.json({
      endsOn: window?.endsOn ?? null,
      items: selected.map((unit) => {
        const period = periodByUnit.get(unit.id)
        return {
          id: unit.id,
          name: unit.name,
          buildingId: unit.buildingId,
          buildingName: buildingById.get(unit.buildingId)?.name ?? null,
          floorName: floorById.get(unit.floorId)?.name ?? null,
          spaceName: spaceById.get(unit.spaceId)?.name ?? null,
          productName: period?.productName ?? null,
          priceAmount: period?.priceAmount ?? null,
          currencyCode: period?.currencyCode ?? null,
          width: Number(unit.width),
          depth: Number(unit.depth),
        }
      }),
    })
  } catch (err) {
    return handleRouteError(err, 'property_management.lease_available_units_failed')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Property Management',
  summary: 'Units free for a lease term',
  methods: {
    GET: {
      summary: 'Leasable units in the caller’s buildings that no lease or open proposal holds during the term',
      query: querySchema,
      responses: [
        {
          status: 200,
          description: 'Units',
          schema: z.object({
            endsOn: z.string().nullable(),
            items: z.array(
              z.object({
                id: z.string().uuid(),
                name: z.string(),
                buildingId: z.string().uuid(),
                buildingName: z.string().nullable(),
                floorName: z.string().nullable(),
                spaceName: z.string().nullable(),
                productName: z.string().nullable(),
                priceAmount: z.string().nullable(),
                currencyCode: z.string().nullable(),
                width: z.number(),
                depth: z.number(),
              }),
            ),
          }),
        },
      ],
    },
  },
}
