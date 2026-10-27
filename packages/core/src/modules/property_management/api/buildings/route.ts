import { z } from 'zod'
import { makeCrudRoute, type CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveCrudRecordId } from '@open-mercato/shared/lib/api/scoped'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { E } from '#generated/entities.ids.generated'
import { Building, Floor, Space, Unit } from '../../data/entities'
import { buildingCreateSchema, buildingUpdateSchema } from '../../data/validators'
import { canManageAllBuildings } from '../../lib/buildingAccess'
import { listBuildingManagers } from '../../lib/managers'
import { loadProductUses } from '../../lib/productUse'
import {
  asRecord,
  createPagedListResponseSchema,
  createPropertyManagementCrudOpenApi,
  crudEm,
  crudPermitted,
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
  }
}

async function decorateBuildings(payload: unknown, ctx: CrudCtx & { query: BuildingListQuery }): Promise<void> {
  const scope = crudScope(ctx)
  const items = listItems(payload)
  if (!scope) return
  const em = crudEm(ctx)
  const ids = items.map((item) => readString(item, 'id')).filter((id): id is string => Boolean(id))
  const [floors, spaces, units, managers] = ids.length
    ? await Promise.all([
        findWithDecryption(em, Floor, { ...scope, buildingId: { $in: ids }, deletedAt: null }, undefined, scope),
        findWithDecryption(em, Space, { ...scope, buildingId: { $in: ids }, deletedAt: null }, undefined, scope),
        findWithDecryption(em, Unit, { ...scope, buildingId: { $in: ids }, deletedAt: null }, undefined, scope),
        listBuildingManagers(em, scope, ids),
      ])
    : [[], [], [], new Map()]
  const uses = await loadProductUses(em, scope, units.map((unit) => unit.catalogProductId))
  const permitted = await crudPermitted(ctx)
  const archivedWhere: Record<string, unknown> = { ...scope, status: 'archived', deletedAt: null }
  if (permitted !== null) archivedWhere.id = { $in: permitted.length ? permitted : [] }
  const archivedCount = permitted !== null && !permitted.length ? 0 : await em.count(Building, archivedWhere)
  const unitFloorCounts = new Map<string, number>()
  for (const unit of units) unitFloorCounts.set(unit.floorId, (unitFloorCounts.get(unit.floorId) ?? 0) + 1)
  const spaceFloorCounts = new Map<string, number>()
  for (const space of spaces) spaceFloorCounts.set(space.floorId, (spaceFloorCounts.get(space.floorId) ?? 0) + 1)
  for (const item of items) {
    const id = readString(item, 'id')
    const buildingFloors = floors
      .filter((floor) => floor.buildingId === id)
      .sort((left, right) => left.number - right.number)
    const buildingUnits = units.filter((unit) => unit.buildingId === id)
    item.floorCount = buildingFloors.length
    item.floorsBelow = buildingFloors.filter((floor) => floor.number < 0).length
    item.floorsAbove = buildingFloors.filter((floor) => floor.number >= 0).length
    item.spaceCount = spaces.filter((space) => space.buildingId === id).length
    item.unitCount = buildingUnits.length
    item.leasableUnitCount = buildingUnits.filter((unit) => uses.get(unit.catalogProductId)?.use === 'leasable').length
    item.bookableUnitCount = buildingUnits.filter((unit) => uses.get(unit.catalogProductId)?.use === 'bookable').length
    item.managers = id ? managers.get(id) ?? [] : []
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
  record.canManageAll = await canManageAllBuildings({ container: ctx.container, auth: ctx.auth, ...scope })
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
    entityId: E.property_management.building,
    fields: ['id', 'name', 'address', 'status', 'archived_at', 'opening_hours_enabled', 'organization_id', 'tenant_id', 'created_at', 'updated_at'],
    sortFieldMap: { name: 'name', address: 'address', createdAt: 'created_at', updatedAt: 'updated_at' },
    defaultSort: { field: 'name', dir: 'asc' },
    tiebreakSortField: 'id',
    buildFilters: async (query, ctx) => {
      const filters: Record<string, unknown> = {}
      const permitted = await crudPermitted(ctx)
      restrictIds(filters, query.id, permitted)
      const status = query.status ?? (query.id ? 'all' : 'active')
      if (status !== 'all') filters.status = { $eq: status }
      const term = query.search?.trim()
      if (term) {
        const like = `%${escapeLikePattern(term)}%`
        filters.$or = [{ name: { $ilike: like } }, { address: { $ilike: like } }]
      }
      return filters
    },
    transformItem: (item: Record<string, unknown>) => toItem(asRecord(item)),
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
        return parseScopedCommandInput(buildingCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.buildingId ?? null }),
      status: 201,
    },
    update: {
      commandId: 'property_management.building.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(buildingUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'property_management.building.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations()
        return withScopedPayload({ id: resolveCrudRecordId(parsed, ctx, translate) }, ctx, translate)
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
})

export const openApi = createPropertyManagementCrudOpenApi({
  resourceName: 'Building',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(buildingListItemSchema),
  create: {
    schema: buildingCreateSchema,
    description: 'Creates a building and lays out its floors from the below/above-ground counts; every floor gets one default space covering it.',
  },
  update: {
    schema: buildingUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates a building, its manager assignments and (optionally) its floor layout in one transaction.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Deletes a building that never had a lease or booking (409 otherwise — archive it instead).',
  },
})
