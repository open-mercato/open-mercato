/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { MaterialUnit } from '../../data/entities'
import {
  createMaterialUnitSchema,
  updateMaterialUnitSchema,
  materialUnitUsageSchema,
} from '../../data/validators'
import { withScopedPayload } from '../utils'
import {
  createMaterialsCrudOpenApi,
  createPagedListResponseSchema,
  defaultOkResponseSchema,
} from '../openapi'
import '../../commands'

const MATERIAL_UNIT_ENTITY_ID = 'materials:material_unit'

const rawBodySchema = z.object({}).passthrough()

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    materialId: z.string().uuid().optional(),
    usage: materialUnitUsageSchema.optional(),
    isBase: z.coerce.boolean().optional(),
    isDefaultForUsage: z.coerce.boolean().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['materials.units.view'] },
  POST: { requireAuth: true, requireFeatures: ['materials.units.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['materials.units.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['materials.units.manage'] },
}

export const metadata = routeMetadata

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: MaterialUnit,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
  },
  list: {
    schema: listSchema,
    entityId: MATERIAL_UNIT_ENTITY_ID,
    fields: [
      'id',
      'material_id',
      'code',
      'label',
      'usage',
      'factor',
      'is_base',
      'is_default_for_usage',
      'is_active',
      'organization_id',
      'tenant_id',
      'created_at',
      'updated_at',
    ],
    buildFilters: async (query: any) => {
      const filters: Record<string, any> = { deletedAt: null }
      if (query.materialId) filters.materialId = query.materialId
      if (query.usage) filters.usage = query.usage
      if (query.isBase !== undefined) filters.isBase = query.isBase
      if (query.isDefaultForUsage !== undefined) filters.isDefaultForUsage = query.isDefaultForUsage
      return filters
    },
  },
  actions: {
    create: {
      commandId: 'materials.unit.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return createMaterialUnitSchema.parse(withScopedPayload(raw ?? {}, ctx, translate))
      },
      response: ({ result }) => ({ id: result?.unitId ?? result?.id ?? null }),
      status: 201,
    },
    update: {
      commandId: 'materials.unit.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return updateMaterialUnitSchema.parse(withScopedPayload(raw ?? {}, ctx, translate))
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'materials.unit.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations()
        const id =
          parsed?.body?.id ??
          parsed?.id ??
          parsed?.query?.id ??
          (ctx.request ? new URL(ctx.request.url).searchParams.get('id') : null)
        if (!id) {
          throw new CrudHttpError(400, {
            error: translate('materials.unit.errors.id_required', 'Unit id is required'),
          })
        }
        return { id }
      },
      response: () => ({ ok: true }),
    },
  },
})

const { POST, PUT, DELETE } = crud

export { POST, PUT, DELETE }
export const GET = crud.GET

const unitListItemSchema = z.object({
  id: z.string().uuid(),
  material_id: z.string().uuid(),
  code: z.string(),
  label: z.string(),
  usage: materialUnitUsageSchema,
  factor: z.string(),
  is_base: z.boolean(),
  is_default_for_usage: z.boolean(),
  is_active: z.boolean(),
  organization_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  created_at: z.string(),
  updated_at: z.string(),
})

export const openApi = createMaterialsCrudOpenApi({
  resourceName: 'MaterialUnit',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(unitListItemSchema),
  create: {
    schema: createMaterialUnitSchema,
    description:
      'Creates a measurement unit for a material. `is_base` is mutually exclusive across the material — promoting one demotes the previous base. `is_default_for_usage` is mutually exclusive per (material, usage) bucket. Base units always carry `factor=1`.',
  },
  update: {
    schema: updateMaterialUnitSchema,
    responseSchema: defaultOkResponseSchema,
    description:
      'Updates a unit. Setting `isBase=true` clears the previous base for the same material; setting `isDefaultForUsage=true` clears the previous default for the same (material, usage).',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description:
      'Soft-deletes a unit. Refuses to delete the base unit while other units exist for the same material — promote another unit to base first.',
  },
})
