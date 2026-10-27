import { z } from 'zod'
import { makeCrudRoute, type CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveCrudRecordId } from '@open-mercato/shared/lib/api/scoped'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { E } from '#generated/entities.ids.generated'
import { Space, Unit } from '../../data/entities'
import { spaceCreateSchema, spaceUpdateSchema } from '../../data/validators'
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
    buildingId: z.string().uuid().optional(),
  })
  .passthrough()

function toItem(row: Record<string, unknown>) {
  return {
    id: readString(row, 'id'),
    buildingId: readString(row, 'building_id', 'buildingId'),
    floorId: readString(row, 'floor_id', 'floorId'),
    name: readString(row, 'name'),
    purpose: readString(row, 'purpose'),
    ...rectFields(row),
    isDefault: readBoolean(row, 'is_default', 'isDefault'),
    organizationId: readString(row, 'organization_id', 'organizationId'),
    tenantId: readString(row, 'tenant_id', 'tenantId'),
    createdAt: readIso(row, 'created_at', 'createdAt'),
    updatedAt: readIso(row, 'updated_at', 'updatedAt'),
  }
}

async function attachUnitCounts(payload: unknown, ctx: CrudCtx): Promise<void> {
  const scope = crudScope(ctx)
  const items = listItems(payload)
  if (!scope || !items.length) return
  const ids = items.map((item) => readString(item, 'id')).filter((id): id is string => Boolean(id))
  const units = await findWithDecryption(crudEm(ctx), Unit, { ...scope, spaceId: { $in: ids }, deletedAt: null }, undefined, scope)
  for (const item of items) {
    const id = readString(item, 'id')
    item.unitCount = units.filter((unit) => unit.spaceId === id).length
  }
}

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: { entity: Space, idField: 'id', orgField: 'organizationId', tenantField: 'tenantId', softDeleteField: 'deletedAt' },
  indexer: { entityType: E.property_management.space },
  list: {
    schema: listSchema,
    entityId: E.property_management.space,
    fields: ['id', 'building_id', 'floor_id', 'name', 'purpose', 'x', 'y', 'width', 'depth', 'is_default', 'organization_id', 'tenant_id', 'created_at', 'updated_at'],
    sortFieldMap: { name: 'name', x: 'x', y: 'y', updatedAt: 'updated_at' },
    defaultSort: { field: 'name', dir: 'asc' },
    tiebreakSortField: 'id',
    buildFilters: async (query, ctx) => {
      const filters: Record<string, unknown> = {}
      restrictBuildingField(filters, 'building_id', await crudPermitted(ctx), query.buildingId)
      if (query.id) filters.id = { $eq: query.id }
      if (query.floorId) filters.floor_id = { $eq: query.floorId }
      const term = query.search?.trim()
      if (term) filters.name = { $ilike: `%${escapeLikePattern(term)}%` }
      return filters
    },
    transformItem: (item: Record<string, unknown>) => toItem(asRecord(item)),
  },
  hooks: { afterList: attachUnitCounts },
  actions: {
    create: {
      commandId: 'property_management.space.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(spaceCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.spaceId ?? null }),
      status: 201,
    },
    update: {
      commandId: 'property_management.space.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(spaceUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'property_management.space.delete',
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

const spaceItemSchema = z.object({
  id: z.string().uuid(),
  buildingId: z.string().uuid(),
  floorId: z.string().uuid(),
  name: z.string(),
  purpose: z.string().nullable(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  depth: z.number(),
  isDefault: z.boolean(),
  unitCount: z.number().int(),
  updatedAt: z.string().nullable(),
})

export const openApi = createPropertyManagementCrudOpenApi({
  resourceName: 'Space',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(spaceItemSchema),
  create: {
    schema: spaceCreateSchema,
    description: 'Creates a space (a rectangle on the floor). 422 when it leaves the floor or overlaps another space, naming what is in the way.',
  },
  update: {
    schema: spaceUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Moves, resizes or renames a space. Units never move with it; 422 when any of its units would stick out.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Deletes an empty space (409 while it still holds units).',
  },
})
