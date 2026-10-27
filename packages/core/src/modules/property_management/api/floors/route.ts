import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { E } from '#generated/entities.ids.generated'
import { Floor } from '../../data/entities'
import { floorUpdateSchema } from '../../data/validators'
import {
  asRecord,
  createPagedListResponseSchema,
  createPropertyManagementCrudOpenApi,
  crudPermitted,
  defaultOkResponseSchema,
  listQueryBase,
  parseScopedCommandInput,
  rawBodySchema,
  readIso,
  readNumber,
  readString,
  restrictBuildingField,
} from '../crudShared'

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['property_management.view'] },
  PUT: { requireAuth: true, requireFeatures: ['property_management.manage'] },
}

export const metadata = routeMetadata

const listSchema = z
  .object({
    ...listQueryBase,
    buildingId: z.string().uuid().optional(),
  })
  .passthrough()

function toItem(row: Record<string, unknown>) {
  return {
    id: readString(row, 'id'),
    buildingId: readString(row, 'building_id', 'buildingId'),
    number: readNumber(row, 'number') ?? 0,
    name: readString(row, 'name'),
    sizeX: readNumber(row, 'size_x', 'sizeX') ?? 0,
    sizeY: readNumber(row, 'size_y', 'sizeY') ?? 0,
    organizationId: readString(row, 'organization_id', 'organizationId'),
    tenantId: readString(row, 'tenant_id', 'tenantId'),
    createdAt: readIso(row, 'created_at', 'createdAt'),
    updatedAt: readIso(row, 'updated_at', 'updatedAt'),
  }
}

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: Floor,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: E.property_management.floor },
  list: {
    schema: listSchema,
    entityId: E.property_management.floor,
    fields: ['id', 'building_id', 'number', 'name', 'size_x', 'size_y', 'organization_id', 'tenant_id', 'created_at', 'updated_at'],
    sortFieldMap: { number: 'number', name: 'name', updatedAt: 'updated_at' },
    defaultSort: { field: 'number', dir: 'asc' },
    tiebreakSortField: 'id',
    buildFilters: async (query, ctx) => {
      const filters: Record<string, unknown> = {}
      restrictBuildingField(filters, 'building_id', await crudPermitted(ctx), query.buildingId)
      if (query.id) filters.id = { $eq: query.id }
      const term = query.search?.trim()
      if (term) filters.name = { $ilike: `%${escapeLikePattern(term)}%` }
      return filters
    },
    transformItem: (item: Record<string, unknown>) => toItem(asRecord(item)),
  },
  actions: {
    update: {
      commandId: 'property_management.floor.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(floorUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
  },
})

export const GET = crud.GET
export const PUT = crud.PUT

const floorItemSchema = z.object({
  id: z.string().uuid(),
  buildingId: z.string().uuid(),
  number: z.number().int(),
  name: z.string(),
  sizeX: z.number(),
  sizeY: z.number(),
  organizationId: z.string().uuid().nullable(),
  tenantId: z.string().uuid().nullable(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
})

export const openApi = createPropertyManagementCrudOpenApi({
  resourceName: 'Floor',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(floorItemSchema),
  update: {
    schema: floorUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Renames or resizes a floor. Refused (422) when the new size would leave a space, unit or common area outside the floor. Floors are added and removed through the building layout endpoint.',
  },
})
