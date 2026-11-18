import { NextResponse } from 'next/server'
import { z } from 'zod'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { Building, Floor, ProductUse, Space, Unit, UnitProductPeriod } from '../../../data/entities'
import { buildingIdFilter } from '../../../lib/buildingAccess'
import { findOverlaps, loadReservedRanges } from '../../../lib/leaseOccupancy'
import { findUnitsWithBookingsInTerm } from '../../../lib/leaseTermBookings'
import { addDays, isIsoDate, leaseEndsOn } from '../../../lib/leaseTerm'
import { resolveUnitsAvailability } from '../../../lib/availabilityResolver'
import { periodPricesOf, type Scope } from '../../../lib/productUse'
import { loadSettings } from '../../../lib/settings'
import { handleRouteError, resolveStaffContext } from '../../routeContext'
import { buildQueryParams } from '@open-mercato/shared/lib/crud/query-params'
import type { EntityManager } from '@mikro-orm/postgresql'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['property_management.view'] },
}

const MAX_SEARCH_LENGTH = 200
const MAX_UNIT_PAGES = 20

const querySchema = z.object({
  startsOn: z.string().refine(isIsoDate).optional(),
  termMonths: z.coerce.number().int().min(1).max(600).optional(),
  buildingId: z.string().uuid().optional(),
  search: z.string().trim().max(MAX_SEARCH_LENGTH).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(100),
})

const MIN_UNIT_PAGE_SIZE = 25

async function freeLeasableUnits(
  em: EntityManager,
  scope: Scope,
  units: readonly Unit[],
  window: { startsOn: string; endsOn: string } | null,
  periodByUnit: Map<string, UnitProductPeriod>,
): Promise<Unit[]> {
  const periods = await findWithDecryption(em, UnitProductPeriod, { ...scope, unitId: { $in: units.map((unit) => unit.id) }, validTo: null, use: 'leasable' }, undefined, scope)
  for (const period of periods) periodByUnit.set(period.unitId, period)
  const leasable = units.filter((unit) => periodByUnit.has(unit.id))
  if (!window || !leasable.length) return leasable
  const leasableIds = leasable.map((unit) => unit.id)
  const [ranges, availability, booked] = await Promise.all([
    loadReservedRanges(em, scope, leasableIds),
    resolveUnitsAvailability(em, scope, leasable, { start: `${window.startsOn}T00:00`, end: `${addDays(window.endsOn, 1)}T00:00` }),
    findUnitsWithBookingsInTerm(em, scope, leasableIds, window),
  ])
  return leasable.filter(
    (unit) => !booked.has(unit.id) && !findOverlaps(ranges, unit.id, window).length && !(availability.get(unit.id)?.length ?? 0),
  )
}

export async function GET(req: Request) {
  try {
    const context = await resolveStaffContext(req)
    const query = querySchema.parse(buildQueryParams(new URL(req.url).searchParams))
    const scope = { tenantId: context.tenantId, organizationId: context.organizationId }
    const buildingWhere: Record<string, unknown> = { ...scope, status: 'active', deletedAt: null }
    const permittedFilter = buildingIdFilter(context.permitted)
    if (permittedFilter) buildingWhere.id = permittedFilter
    if (query.buildingId) buildingWhere.id = permittedFilter ? { $in: permittedFilter.$in.filter((id) => id === query.buildingId) } : query.buildingId
    const buildings = await findWithDecryption(context.em, Building, buildingWhere, undefined, scope)
    if (!buildings.length) return NextResponse.json({ items: [] })
    const leasableProducts = await findWithDecryption(context.em, ProductUse, { ...scope, use: 'leasable' }, undefined, scope)
    if (!leasableProducts.length) return NextResponse.json({ items: [] })
    const unitWhere: Record<string, unknown> = {
      ...scope,
      buildingId: { $in: buildings.map((building) => building.id) },
      catalogProductId: { $in: leasableProducts.map((product) => product.catalogProductId) },
      deletedAt: null,
    }
    const term = query.search?.trim()
    if (term) unitWhere.name = { $ilike: `%${escapeLikePattern(term)}%` }
    const window = query.startsOn && query.termMonths ? { startsOn: query.startsOn, endsOn: leaseEndsOn(query.startsOn, query.termMonths) } : null
    const pageSize = Math.max(query.limit, MIN_UNIT_PAGE_SIZE)
    const selected: Unit[] = []
    const periodByUnit = new Map<string, UnitProductPeriod>()
    let cursor: { name: string; id: string } | null = null
    for (let pageIndex = 0; pageIndex < MAX_UNIT_PAGES && selected.length < query.limit; pageIndex += 1) {
      const pageWhere: Record<string, unknown> = cursor
        ? { ...unitWhere, $or: [{ name: { $gt: cursor.name } }, { name: cursor.name, id: { $gt: cursor.id } }] }
        : unitWhere
      const page = await findWithDecryption(context.em, Unit, pageWhere, { orderBy: { name: 'asc', id: 'asc' }, limit: pageSize }, scope)
      if (!page.length) break
      const free = await freeLeasableUnits(context.em, scope, page, window, periodByUnit)
      selected.push(...free.slice(0, query.limit - selected.length))
      if (page.length < pageSize) break
      const last = page[page.length - 1]
      cursor = { name: last.name, id: last.id }
    }
    const [floors, spaces] = await Promise.all([
      findWithDecryption(context.em, Floor, { ...scope, id: { $in: Array.from(new Set(selected.map((unit) => unit.floorId))) } }, undefined, scope),
      findWithDecryption(context.em, Space, { ...scope, id: { $in: Array.from(new Set(selected.map((unit) => unit.spaceId))) } }, undefined, scope),
    ])
    const selectedPeriods = selected.flatMap((unit) => {
      const period = periodByUnit.get(unit.id)
      return period ? [period] : []
    })
    const settings = await loadSettings(context.em, scope)
    const prices = await periodPricesOf(context.em, context.ctx.container, scope, selectedPeriods, { channelId: settings.billingChannelId })
    const buildingById = new Map(buildings.map((building) => [building.id, building]))
    const floorById = new Map(floors.map((floor) => [floor.id, floor]))
    const spaceById = new Map(spaces.map((space) => [space.id, space]))
    return NextResponse.json({
      endsOn: window?.endsOn ?? null,
      items: selected.map((unit) => {
        const period = periodByUnit.get(unit.id)
        const price = period ? prices.get(period.id) : undefined
        return {
          id: unit.id,
          name: unit.name,
          buildingId: unit.buildingId,
          buildingName: buildingById.get(unit.buildingId)?.name ?? null,
          floorName: floorById.get(unit.floorId)?.name ?? null,
          spaceName: spaceById.get(unit.spaceId)?.name ?? null,
          productName: period?.productName ?? null,
          priceAmount: price?.priceAmount ?? null,
          currencyCode: price?.currencyCode ?? null,
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
      summary: 'Leasable units in the caller’s buildings that no lease, open proposal or pending/confirmed booking holds, and that are not unavailable, during the term',
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
