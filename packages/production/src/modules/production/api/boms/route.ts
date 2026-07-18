import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { resolveCrudRecordId } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { ProductionBom } from '../../data/entities.js'
import {
  bomCreateSchema,
  bomUpdateSchema,
  bomListQuerySchema,
  bomItemInputSchema,
} from '../../data/validators.js'
import { E } from '../../../../../generated/entities.ids.generated.js'
import {
  createProductionCrudOpenApi,
  createPagedListResponseSchema,
  defaultOkResponseSchema,
} from '../openapi.js'

const rawBodySchema = z.object({}).passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['production.technology.view'] },
  POST: { requireAuth: true, requireFeatures: ['production.technology.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['production.technology.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['production.technology.manage'] },
}

export const metadata = routeMetadata

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: ProductionBom,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: E.production.production_bom },
  list: {
    entityId: E.production.production_bom,
    schema: bomListQuerySchema,
    fields: [
      'id',
      'product_id',
      'variant_id',
      'version',
      'status',
      'valid_from',
      'valid_to',
      'name',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      name: 'name',
      version: 'version',
      status: 'status',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    transformItem: (item: Record<string, unknown>) => {
      if (!item) return item
      return {
        id: item.id,
        productId: item.product_id,
        variantId: item.variant_id,
        version: item.version,
        status: item.status,
        validFrom: item.valid_from,
        validTo: item.valid_to,
        name: item.name,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
      }
    },
  },
  actions: {
    create: {
      commandId: 'production.boms.create',
      schema: rawBodySchema,
      mapInput: async ({ raw }) => bomCreateSchema.parse(raw),
      response: ({ result }) => ({ id: result?.id ?? null }),
      status: 201,
    },
    update: {
      commandId: 'production.boms.update',
      schema: rawBodySchema,
      mapInput: async ({ raw }) => bomUpdateSchema.parse(raw),
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'production.boms.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations()
        const id = resolveCrudRecordId(parsed, ctx, translate)
        if (!id) {
          throw new CrudHttpError(400, { error: translate('production.errors.id_required', 'Record id is required') })
        }
        return { id }
      },
      response: () => ({ ok: true }),
    },
  },
})

export const { GET, POST, PUT, DELETE } = crud

const bomListItemSchema = z.object({
  id: z.string().uuid(),
  productId: z.string().uuid(),
  variantId: z.string().uuid().nullable(),
  version: z.number(),
  status: z.enum(['draft', 'active', 'archived']),
  validFrom: z.string().nullable(),
  validTo: z.string().nullable(),
  name: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const openApi = createProductionCrudOpenApi({
  resourceName: 'ProductionBom',
  pluralName: 'ProductionBoms',
  querySchema: bomListQuerySchema,
  listResponseSchema: createPagedListResponseSchema(bomListItemSchema),
  create: {
    schema: bomCreateSchema.extend({ items: z.array(bomItemInputSchema) }),
    description: 'Creates a new BOM version with its component items.',
  },
  update: {
    schema: bomUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates BOM header fields and/or replaces its component items.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Soft-deletes a BOM version by ID.',
  },
})
