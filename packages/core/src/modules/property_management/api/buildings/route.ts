import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { makeCrudRoute, type CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveCrudRecordId } from '@open-mercato/shared/lib/api/scoped'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { extractAllCustomFieldEntries } from '@open-mercato/shared/lib/crud/custom-fields'
import { E } from '#generated/entities.ids.generated'
import { Building, Floor } from '../../data/entities'
import { buildingCreateSchema, buildingUpdateSchema, liftCustomFields } from '../../data/validators'
import { listBuildingManagers } from '../../lib/managers'
import { loadProductUses, type Scope } from '../../lib/productUse'
import { loadOpeningHours, serializeWeeklyHours } from '../../lib/openingHours'
import {
  asRecord,
  assertCrudBuildingAccess,
  createPagedListResponseSchema,
  createPropertyManagementCrudOpenApi,
  crudEm,
  crudPermitted,
  crudScopeFilters,
  sealListScope,
  crudScope,
  defaultOkResponseSchema,
  listItems,
  listQueryBase,
  parseScopedCommandInput,
  rawBodySchema,
  readBoolean,
  readIso,
  readString,
  restrictIds,
  withScopedPayload,
  unscopedDocSchema,
} from '../crudShared'

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['property_management.view'] },
  POST: { requireAuth: true, requireFeatures: ['property_management.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['property_management.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['property_management.manage'] },
}

export const metadata = routeMetadata

const listSchema = z
  .object({
    ...listQueryBase,
    status: z.enum(['active', 'archived', 'all']).optional(),
  })
  .passthrough()

type BuildingListQuery = z.infer<typeof listSchema>

function toItem(row: Record<string, unknown>) {
  return {
    id: readString(row, 'id'),
    name: readString(row, 'name'),
    address: readString(row, 'address'),
    status: readString(row, 'status') ?? 'active',
    archivedAt: readIso(row, 'archived_at', 'archivedAt'),
    openingHoursEnabled: readBoolean(row, 'opening_hours_enabled', 'openingHoursEnabled'),
    organizationId: readString(row, 'organization_id', 'organizationId'),
    tenantId: readString(row, 'tenant_id', 'tenantId'),
    createdAt: readIso(row, 'created_at', 'createdAt'),
    updatedAt: readIso(row, 'updated_at', 'updatedAt'),
    ...extractAllCustomFieldEntries(row),
  }
}

type PlacementCountRow = {
  building_id: string
  floor_id: string
  tenant_id: string
  organization_id: string
  deleted_at: Date | null
}

type BuildingCountDatabase = {
  property_management_spaces: PlacementCountRow
  property_management_units: PlacementCountRow & { catalog_product_id: string }
}

type PlacementCount = { buildingId: string; floorId: string; productId: string | null; count: number }

function toCount(value: unknown): number {
  const count = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(count) ? count : 0
}

async function countBuildingPlacements(
  em: EntityManager,
  scope: Scope,
  buildingIds: readonly string[],
): Promise<{ spaces: PlacementCount[]; units: PlacementCount[] }> {
  if (!buildingIds.length) return { spaces: [], units: [] }
  const db = em.getKysely<BuildingCountDatabase>()
  const ids = Array.from(new Set(buildingIds))
  const [spaceRows, unitRows] = await Promise.all([
    db
      .selectFrom('property_management_spaces')
      .select(['building_id', 'floor_id'])
      .select((eb) => eb.fn.countAll().as('count'))
      .where('tenant_id', '=', scope.tenantId)
      .where('organization_id', '=', scope.organizationId)
      .where('deleted_at', 'is', null)
      .where('building_id', 'in', ids)
      .groupBy(['building_id', 'floor_id'])
      .execute(),
    db
      .selectFrom('property_management_units')
      .select(['building_id', 'floor_id', 'catalog_product_id'])
      .select((eb) => eb.fn.countAll().as('count'))
      .where('tenant_id', '=', scope.tenantId)
      .where('organization_id', '=', scope.organizationId)
      .where('deleted_at', 'is', null)
      .where('building_id', 'in', ids)
      .groupBy(['building_id', 'floor_id', 'catalog_product_id'])
      .execute(),
  ])
  return {
    spaces: spaceRows.map((row) => ({ buildingId: row.building_id, floorId: row.floor_id, productId: null, count: toCount(row.count) })),
    units: unitRows.map((row) => ({ buildingId: row.building_id, floorId: row.floor_id, productId: row.catalog_product_id, count: toCount(row.count) })),
  }
}

function sumBy(rows: readonly PlacementCount[], key: (row: PlacementCount) => string | null): Map<string, number> {
  const totals = new Map<string, number>()
  for (const row of rows) {
    const id = key(row)
    if (id) totals.set(id, (totals.get(id) ?? 0) + row.count)
  }
  return totals
}

async function decorateBuildings(payload: unknown, ctx: CrudCtx & { query: BuildingListQuery }): Promise<void> {
  const scope = crudScope(ctx)
  const items = listItems(payload)
  if (!scope) return
  const em = crudEm(ctx)
  const ids = items.map((item) => readString(item, 'id')).filter((id): id is string => Boolean(id))
  const [floors, placements, managers, openingHours] = ids.length
    ? await Promise.all([
        findWithDecryption(em, Floor, { ...scope, buildingId: { $in: ids }, deletedAt: null }, undefined, scope),
        countBuildingPlacements(em, scope, ids),
        listBuildingManagers(em, scope, ids),
        loadOpeningHours(em, scope, ids),
      ])
    : [[], { spaces: [], units: [] }, new Map(), new Map()]
  const uses = await loadProductUses(em, scope, placements.units.map((row) => row.productId ?? ''))
  const permitted = await crudPermitted(ctx)
  const archivedWhere: Record<string, unknown> = { ...scope, status: 'archived', deletedAt: null }
  if (permitted !== null) archivedWhere.id = { $in: permitted.length ? permitted : [] }
  const archivedCount = permitted !== null && !permitted.length ? 0 : await em.count(Building, archivedWhere)
  const useOf = (row: PlacementCount) => (row.productId ? uses.get(row.productId)?.use ?? null : null)
  const unitFloorCounts = sumBy(placements.units, (row) => row.floorId)
  const spaceFloorCounts = sumBy(placements.spaces, (row) => row.floorId)
  const unitBuildingCounts = sumBy(placements.units, (row) => row.buildingId)
  const spaceBuildingCounts = sumBy(placements.spaces, (row) => row.buildingId)
  const leasableCounts = sumBy(placements.units.filter((row) => useOf(row) === 'leasable'), (row) => row.buildingId)
  const bookableCounts = sumBy(placements.units.filter((row) => useOf(row) === 'bookable'), (row) => row.buildingId)
  for (const item of items) {
    const id = readString(item, 'id')
    const buildingFloors = floors
      .filter((floor) => floor.buildingId === id)
      .sort((left, right) => left.number - right.number)
    item.floorCount = buildingFloors.length
    item.floorsBelow = buildingFloors.filter((floor) => floor.number < 0).length
    item.floorsAbove = buildingFloors.filter((floor) => floor.number >= 0).length
    item.spaceCount = id ? spaceBuildingCounts.get(id) ?? 0 : 0
    item.unitCount = id ? unitBuildingCounts.get(id) ?? 0 : 0
    item.leasableUnitCount = id ? leasableCounts.get(id) ?? 0 : 0
    item.bookableUnitCount = id ? bookableCounts.get(id) ?? 0 : 0
    item.managers = id ? managers.get(id) ?? [] : []
    item.openingHours = serializeWeeklyHours((id ? openingHours.get(id) : null) ?? new Map())
    item.floors = buildingFloors.map((floor) => ({
      id: floor.id,
      number: floor.number,
      name: floor.name,
      sizeX: Number(floor.sizeX),
      sizeY: Number(floor.sizeY),
      spaceCount: spaceFloorCounts.get(floor.id) ?? 0,
      unitCount: unitFloorCounts.get(floor.id) ?? 0,
      updatedAt: floor.updatedAt.toISOString(),
    }))
  }
  const record = asRecord(payload)
  record.archivedCount = archivedCount
  record.canManageAll = permitted === null
}

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: Building,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: E.property_management.building },
  list: {
    schema: listSchema,
    disableListCache: true,
    entityId: E.property_management.building,
    fields: ['id', 'name', 'address', 'status', 'archived_at', 'opening_hours_enabled', 'organization_id', 'tenant_id', 'created_at', 'updated_at'],
    sortFieldMap: { name: 'name', address: 'address', createdAt: 'created_at', updatedAt: 'updated_at' },
    defaultSort: { field: 'name', dir: 'asc' },
    tiebreakSortField: 'id',
    omitAutomaticTenantOrgScope: true,
    buildFilters: async (query, ctx) => {
      const scope = crudScopeFilters(ctx)
      restrictIds(scope, query.id, await crudPermitted(ctx))
      const filters: Record<string, unknown> = {}
      const status = query.status ?? (query.id ? 'all' : 'active')
      if (status !== 'all') filters.status = { $eq: status }
      const term = query.search?.trim()
      if (term) {
        const like = `%${escapeLikePattern(term)}%`
        filters.$or = [{ name: { $ilike: like } }, { address: { $ilike: like } }]
      }
      return sealListScope(scope, filters)
    },
    transformItem: (item: Record<string, unknown>) => toItem(asRecord(item)),
    decorateCustomFields: { entityIds: E.property_management.building, stripPrefixedKeys: true },
  },
  hooks: {
    afterList: decorateBuildings,
  },
  actions: {
    create: {
      commandId: 'property_management.building.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(buildingCreateSchema, liftCustomFields(raw ?? {}), ctx, translate)
      },
      response: ({ result }) => ({ id: result?.buildingId ?? null }),
      status: 201,
    },
    update: {
      commandId: 'property_management.building.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const input = parseScopedCommandInput(buildingUpdateSchema, liftCustomFields(raw ?? {}), ctx, translate)
        await assertCrudBuildingAccess(ctx, input.id)
        return input
      },
      response: ({ result }) => ({
        ok: true,
        bookingsOutsideHours: result?.bookingsOutsideHours ?? [],
        bookingsOutsideHoursTotal: result?.bookingsOutsideHoursTotal ?? 0,
      }),
    },
    delete: {
      commandId: 'property_management.building.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations()
        const input = withScopedPayload({ id: resolveCrudRecordId(parsed, ctx, translate) }, ctx, translate)
        await assertCrudBuildingAccess(ctx, input.id)
        return input
      },
      response: () => ({ ok: true }),
    },
  },
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

const floorSummarySchema = z.object({
  id: z.string().uuid(),
  number: z.number().int(),
  name: z.string(),
  sizeX: z.number(),
  sizeY: z.number(),
  spaceCount: z.number().int(),
  unitCount: z.number().int(),
  updatedAt: z.string(),
})

const openingHoursItemSchema = z.object({ weekday: z.number().int().min(0).max(6), opensAt: z.string(), closesAt: z.string() })

const blockerSchema = z.object({ kind: z.enum(['lease', 'booking']), id: z.string().uuid(), label: z.string(), unitId: z.string().uuid(), until: z.string().nullable(), startsAt: z.string().optional(), endsAt: z.string().optional(), startsOn: z.string().optional(), endsOn: z.string().optional() })

const bookingOutsideHoursSchema = blockerSchema.extend({ productName: z.string(), startsAt: z.string(), endsAt: z.string() })

const managerSchema = z.object({ userId: z.string().uuid(), name: z.string().nullable(), email: z.string().nullable() })

const buildingListItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  address: z.string(),
  status: z.enum(['active', 'archived']),
  archivedAt: z.string().nullable(),
  openingHoursEnabled: z.boolean(),
  organizationId: z.string().uuid().nullable(),
  tenantId: z.string().uuid().nullable(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
  floorCount: z.number().int(),
  floorsBelow: z.number().int(),
  floorsAbove: z.number().int(),
  spaceCount: z.number().int(),
  unitCount: z.number().int(),
  leasableUnitCount: z.number().int(),
  bookableUnitCount: z.number().int(),
  managers: z.array(managerSchema),
  floors: z.array(floorSummarySchema),
  openingHours: z.array(openingHoursItemSchema),
  customValues: z.record(z.string(), z.unknown()).nullable().optional(),
  customFields: z.array(z.object({ key: z.string(), label: z.string(), value: z.unknown(), kind: z.string().nullable(), multi: z.boolean() })).optional(),
})

export const openApi = createPropertyManagementCrudOpenApi({
  resourceName: 'Building',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(buildingListItemSchema),
  create: {
    schema: unscopedDocSchema(buildingCreateSchema),
    description: 'Creates a building and lays out its floors from the below/above-ground counts; every floor gets one default space covering it.',
  },
  update: {
    schema: unscopedDocSchema(buildingUpdateSchema),
    responseSchema: z.object({ ok: z.boolean(), bookingsOutsideHours: z.array(bookingOutsideHoursSchema), bookingsOutsideHoursTotal: z.number().int() }),
    description:
      'Updates a building, its manager assignments, its opening hours (replaced as a set; weekday 0 = Monday, a missing weekday is closed) and (optionally) its floor layout in one transaction. Existing bookings are kept when the hours narrow; `bookingsOutsideHours` lists the upcoming ones that now fall outside them (only when the hours or the switch actually changed, at most 100), with wall-clock `startsAt` / `endsAt`; `bookingsOutsideHoursTotal` counts all of them.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Deletes a building that never had a lease or booking (409 otherwise — archive it instead).',
  },
})
