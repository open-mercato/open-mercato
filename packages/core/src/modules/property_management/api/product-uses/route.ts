import { z } from 'zod'
import { makeCrudRoute, type CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { isUuidListParam, splitIdListParam } from '@open-mercato/shared/lib/crud/ids'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { E } from '#generated/entities.ids.generated'
import { ProductUse } from '../../data/entities'
import { productUseSetSchema, type ProductUseSetInput } from '../../data/validators'
import {
  asRecord,
  createPagedListResponseSchema,
  createPropertyManagementCrudOpenApi,
  crudEm,
  defaultOkResponseSchema,
  parseScopedCommandInput,
  rawBodySchema,
  readIso,
  readString,
  unscopedDocSchema,
} from '../crudShared'

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['property_management.view'] },
  POST: { requireAuth: true, requireFeatures: ['property_management.manage', 'property_management.buildings.manage_all'] },
  PUT: { requireAuth: true, requireFeatures: ['property_management.manage', 'property_management.buildings.manage_all'] },
  DELETE: { requireAuth: true, requireFeatures: ['property_management.manage', 'property_management.buildings.manage_all'] },
}

export const metadata = routeMetadata

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(100),
    productIds: z
      .string()
      .optional()
      .refine(isUuidListParam, { message: 'productIds must be a comma-separated list of UUIDs' }),
    use: z.enum(['leasable', 'bookable']).optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

function toItem(row: Record<string, unknown>) {
  return {
    id: readString(row, 'id'),
    catalogProductId: readString(row, 'catalog_product_id', 'catalogProductId'),
    use: readString(row, 'use'),
    billingUnit: readString(row, 'billing_unit', 'billingUnit'),
    updatedAt: readIso(row, 'updated_at', 'updatedAt'),
  }
}

function readProductId(raw: unknown, request: Request | undefined): string | null {
  const envelope = asRecord(raw)
  const fromBody = readString(asRecord(envelope.body), 'catalogProductId') ?? readString(envelope, 'catalogProductId')
  if (fromBody) return fromBody
  const fromQuery = readString(asRecord(envelope.query), 'catalogProductId')
  if (fromQuery) return fromQuery
  if (!request) return null
  return new URL(request.url).searchParams.get('catalogProductId')
}

async function withGuardResourceId(ctx: CrudCtx, input: ProductUseSetInput): Promise<ProductUseSetInput & { id: string }> {
  const scope = { tenantId: input.tenantId, organizationId: input.organizationId }
  const record = await findOneWithDecryption(crudEm(ctx), ProductUse, { ...scope, catalogProductId: input.catalogProductId }, undefined, scope)
  return { ...input, id: record?.id ?? input.catalogProductId }
}

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: { entity: ProductUse, idField: 'id', orgField: 'organizationId', tenantField: 'tenantId', softDeleteField: null },
  indexer: { entityType: E.property_management.product_use },
  list: {
    schema: listSchema,
    entityId: E.property_management.product_use,
    fields: ['id', 'catalog_product_id', 'use', 'billing_unit', 'updated_at'],
    sortFieldMap: { updatedAt: 'updated_at' },
    defaultSort: { field: 'updatedAt', dir: 'desc' },
    tiebreakSortField: 'id',
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      const ids = splitIdListParam(query.productIds)
      if (ids.length) filters.catalog_product_id = { $in: ids }
      if (query.use) filters.use = { $eq: query.use }
      return filters
    },
    transformItem: (item: Record<string, unknown>) => toItem(asRecord(item)),
  },
  actions: {
    create: {
      commandId: 'property_management.product_use.set',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(productUseSetSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.catalogProductId ?? null }),
      status: 201,
    },
    update: {
      commandId: 'property_management.product_use.set',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return withGuardResourceId(ctx, parseScopedCommandInput(productUseSetSchema, raw ?? {}, ctx, translate))
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'property_management.product_use.set',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return withGuardResourceId(
          ctx,
          parseScopedCommandInput(
            productUseSetSchema,
            { catalogProductId: readProductId(raw, ctx.request), use: null, billingUnit: null },
            ctx,
            translate,
          ),
        )
      },
      response: () => ({ ok: true }),
    },
  },
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

const productUseItemSchema = z.object({
  id: z.string().uuid(),
  catalogProductId: z.string().uuid(),
  use: z.enum(['leasable', 'bookable']),
  billingUnit: z.enum(['month', 'hour', 'day']),
  updatedAt: z.string().nullable(),
})

export const openApi = createPropertyManagementCrudOpenApi({
  resourceName: 'Product use',
  pluralName: 'Product uses',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(productUseItemSchema),
  create: {
    schema: unscopedDocSchema(productUseSetSchema),
    description: 'Marks a catalog product leasable (billed per month) or bookable (per hour or day). Upserts by product. Requires `property_management.buildings.manage_all`, since a product use applies to units of every building.',
  },
  update: {
    schema: unscopedDocSchema(productUseSetSchema),
    responseSchema: defaultOkResponseSchema,
    description: 'Changes a product use; `use: null` clears it. Refused (409) while units use the product (clear) or the change would strand leases or upcoming bookings. Requires `property_management.buildings.manage_all`.',
  },
  del: {
    schema: z.object({ catalogProductId: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Clears the use of a product (pass `catalogProductId` in the body or query). Requires `property_management.buildings.manage_all`.',
  },
})
