import { z } from 'zod'
import { makeCrudRoute, type CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveCrudRecordId } from '@open-mercato/shared/lib/api/scoped'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { E } from '#generated/entities.ids.generated'
import { Floor, Space, Unit, UnitProductPeriod } from '../../data/entities'
import { unitCreateSchema, unitUpdateSchema } from '../../data/validators'
import { loadCategoryNames, loadProductNames, loadProductUses } from '../../lib/productUse'
import { findUnitBlockers } from '../../lib/usageGuards'
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
  readIso,
  readString,
  rectFields,
  restrictBuildingField,
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
    floorId: z.string().uuid().optional(),
    spaceId: z.string().uuid().optional(),
    buildingId: z.string().uuid().optional(),
    productId: z.string().uuid().optional(),
  })
  .passthrough()

function toItem(row: Record<string, unknown>) {
  return {
    id: readString(row, 'id'),
    buildingId: readString(row, 'building_id', 'buildingId'),
    floorId: readString(row, 'floor_id', 'floorId'),
    spaceId: readString(row, 'space_id', 'spaceId'),
    name: readString(row, 'name'),
    catalogCategoryId: readString(row, 'catalog_category_id', 'catalogCategoryId'),
    catalogProductId: readString(row, 'catalog_product_id', 'catalogProductId'),
    ...rectFields(row),
    organizationId: readString(row, 'organization_id', 'organizationId'),
    tenantId: readString(row, 'tenant_id', 'tenantId'),
    createdAt: readIso(row, 'created_at', 'createdAt'),
    updatedAt: readIso(row, 'updated_at', 'updatedAt'),
  }
}

async function decorateUnits(payload: unknown, ctx: CrudCtx): Promise<void> {
  const scope = crudScope(ctx)
  const items = listItems(payload)
  if (!scope || !items.length) return
  const em = crudEm(ctx)
  const unitIds = items.map((item) => readString(item, 'id')).filter((id): id is string => Boolean(id))
  const productIds = items.map((item) => readString(item, 'catalogProductId')).filter((id): id is string => Boolean(id))
  const categoryIds = items.map((item) => readString(item, 'catalogCategoryId')).filter((id): id is string => Boolean(id))
  const spaceIds = items.map((item) => readString(item, 'spaceId')).filter((id): id is string => Boolean(id))
  const floorIds = items.map((item) => readString(item, 'floorId')).filter((id): id is string => Boolean(id))
  const [productNames, categoryNames, uses, periods, spaces, floors, blockers] = await Promise.all([
    loadProductNames(em, scope, productIds),
    loadCategoryNames(em, scope, categoryIds),
    loadProductUses(em, scope, productIds),
    findWithDecryption(em, UnitProductPeriod, { ...scope, unitId: { $in: unitIds }, validTo: null }, undefined, scope),
    findWithDecryption(em, Space, { ...scope, id: { $in: spaceIds } }, undefined, scope),
    findWithDecryption(em, Floor, { ...scope, id: { $in: floorIds } }, undefined, scope),
    findUnitBlockers(em, scope, unitIds),
  ])
  const periodByUnit = new Map(periods.map((period) => [period.unitId, period]))
  const spaceNames = new Map(spaces.map((space) => [space.id, space.name]))
  const floorById = new Map(floors.map((floor) => [floor.id, floor]))
  for (const item of items) {
    const id = readString(item, 'id') ?? ''
    const productId = readString(item, 'catalogProductId') ?? ''
    const period = periodByUnit.get(id)
    const use = uses.get(productId)
    const floor = floorById.get(readString(item, 'floorId') ?? '')
    item.productName = productNames.get(productId) ?? period?.productName ?? null
    item.productMissing = !productNames.has(productId)
    item.categoryName = categoryNames.get(readString(item, 'catalogCategoryId') ?? '') ?? null
    item.use = use?.use ?? period?.use ?? null
    item.billingUnit = use?.billingUnit ?? period?.billingUnit ?? null
    item.spaceName = spaceNames.get(readString(item, 'spaceId') ?? '') ?? null
    item.floorName = floor?.name ?? null
    item.floorNumber = floor?.number ?? null
    item.price = period ? { amount: period.priceAmount ?? null, currencyCode: period.currencyCode ?? null } : null
    item.blockers = blockers.filter((blocker) => blocker.unitId === id)
  }
}

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: { entity: Unit, idField: 'id', orgField: 'organizationId', tenantField: 'tenantId', softDeleteField: 'deletedAt' },
  indexer: { entityType: E.property_management.unit },
  list: {
    schema: listSchema,
    entityId: E.property_management.unit,
    fields: [
      'id',
      'building_id',
      'floor_id',
      'space_id',
      'name',
      'catalog_category_id',
      'catalog_product_id',
      'x',
      'y',
      'width',
      'depth',
      'organization_id',
      'tenant_id',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: { name: 'name', updatedAt: 'updated_at' },
    defaultSort: { field: 'name', dir: 'asc' },
    tiebreakSortField: 'id',
    buildFilters: async (query, ctx) => {
      const filters: Record<string, unknown> = {}
      restrictBuildingField(filters, 'building_id', await crudPermitted(ctx), query.buildingId)
      if (query.id) filters.id = { $eq: query.id }
      if (query.floorId) filters.floor_id = { $eq: query.floorId }
      if (query.spaceId) filters.space_id = { $eq: query.spaceId }
      if (query.productId) filters.catalog_product_id = { $eq: query.productId }
      const term = query.search?.trim()
      if (term) filters.name = { $ilike: `%${escapeLikePattern(term)}%` }
      return filters
    },
    transformItem: (item: Record<string, unknown>) => toItem(asRecord(item)),
  },
  hooks: { afterList: decorateUnits },
  actions: {
    create: {
      commandId: 'property_management.unit.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(unitCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.unitId ?? null }),
      status: 201,
    },
    update: {
      commandId: 'property_management.unit.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(unitUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'property_management.unit.delete',
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

const unitItemSchema = z.object({
  id: z.string().uuid(),
  buildingId: z.string().uuid(),
  floorId: z.string().uuid(),
  spaceId: z.string().uuid(),
  name: z.string(),
  catalogCategoryId: z.string().uuid(),
  catalogProductId: z.string().uuid(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  depth: z.number(),
  productName: z.string().nullable(),
  productMissing: z.boolean(),
  categoryName: z.string().nullable(),
  use: z.enum(['leasable', 'bookable']).nullable(),
  billingUnit: z.enum(['month', 'hour', 'day']).nullable(),
  spaceName: z.string().nullable(),
  floorName: z.string().nullable(),
  floorNumber: z.number().int().nullable(),
  price: z.object({ amount: z.string().nullable(), currencyCode: z.string().nullable() }).nullable(),
  updatedAt: z.string().nullable(),
})

export const openApi = createPropertyManagementCrudOpenApi({
  resourceName: 'Unit',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(unitItemSchema),
  create: {
    schema: unitCreateSchema,
    description: 'Creates a unit inside a space. The product must belong to the unit type (catalog category or a descendant) and be marked leasable or bookable. Opens the first product history period.',
  },
  update: {
    schema: unitUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Moves, resizes, renames or re-types a unit; a product change opens a new product history period (409 while an active lease locks the product).',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Deletes a unit (409 while it has a lease or bookings).',
  },
})
