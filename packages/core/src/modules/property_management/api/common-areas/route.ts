import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveCrudRecordId } from '@open-mercato/shared/lib/api/scoped'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { E } from '#generated/entities.ids.generated'
import { CommonArea } from '../../data/entities'
import { COMMON_AREA_KINDS, commonAreaCreateSchema, commonAreaUpdateSchema } from '../../data/validators'
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
    kind: readString(row, 'kind'),
    ...rectFields(row),
    organizationId: readString(row, 'organization_id', 'organizationId'),
    tenantId: readString(row, 'tenant_id', 'tenantId'),
    createdAt: readIso(row, 'created_at', 'createdAt'),
    updatedAt: readIso(row, 'updated_at', 'updatedAt'),
  }
}

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: { entity: CommonArea, idField: 'id', orgField: 'organizationId', tenantField: 'tenantId', softDeleteField: 'deletedAt' },
  indexer: { entityType: E.property_management.common_area },
  list: {
    schema: listSchema,
    entityId: E.property_management.common_area,
    fields: ['id', 'building_id', 'floor_id', 'name', 'kind', 'x', 'y', 'width', 'depth', 'organization_id', 'tenant_id', 'created_at', 'updated_at'],
    sortFieldMap: { name: 'name', kind: 'kind', updatedAt: 'updated_at' },
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
  actions: {
    create: {
      commandId: 'property_management.common_area.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(commonAreaCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.commonAreaId ?? null }),
      status: 201,
    },
    update: {
      commandId: 'property_management.common_area.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(commonAreaUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'property_management.common_area.delete',
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

const commonAreaItemSchema = z.object({
  id: z.string().uuid(),
  buildingId: z.string().uuid(),
  floorId: z.string().uuid(),
  name: z.string(),
  kind: z.enum(COMMON_AREA_KINDS),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  depth: z.number(),
  updatedAt: z.string().nullable(),
})

export const openApi = createPropertyManagementCrudOpenApi({
  resourceName: 'Common area',
  pluralName: 'Common areas',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(commonAreaItemSchema),
  create: {
    schema: commonAreaCreateSchema,
    description: 'Creates a common area (corridor, kitchen, toilets…) on a floor. 422 when it leaves the floor or overlaps a unit or another common area.',
  },
  update: {
    schema: commonAreaUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Moves, resizes or renames a common area with the same checks as create.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Deletes a common area.',
  },
})
