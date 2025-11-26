import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createSalesCrudOpenApi, createPagedListResponseSchema, defaultOkResponseSchema } from '../openapi'
import { withScopedPayload } from '../utils'
import { SalesDocumentAddress } from '../../data/entities'
import {
  documentAddressCreateSchema,
  documentAddressDeleteSchema,
  documentAddressUpdateSchema,
} from '../../data/validators'
import { E } from '@open-mercato/core/generated/entities.ids.generated'

const rawBodySchema = z.object({}).passthrough()

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    documentId: z.string().uuid().optional(),
    documentKind: z.enum(['order', 'quote']).optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const routeMetadata = {
  GET: { requireAuth: true },
  POST: { requireAuth: true },
  PUT: { requireAuth: true },
  DELETE: { requireAuth: true },
}

export const metadata = routeMetadata

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: SalesDocumentAddress,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  list: {
    schema: listSchema,
    entityId: E.sales.sales_document_address,
    fields: [
      'id',
      'organization_id',
      'tenant_id',
      'document_id',
      'document_kind',
      'customer_address_id',
      'name',
      'purpose',
      'company_name',
      'address_line1',
      'address_line2',
      'building_number',
      'flat_number',
      'city',
      'region',
      'postal_code',
      'country',
      'latitude',
      'longitude',
      'order_id',
      'quote_id',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query: any) => {
      const filters: Record<string, any> = {}
      if (query.documentId) filters.document_id = { $eq: query.documentId }
      if (query.documentKind) filters.document_kind = { $eq: query.documentKind }
      return filters
    },
  },
  actions: {
    create: {
      commandId: 'sales.document-addresses.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return documentAddressCreateSchema.parse(withScopedPayload(raw ?? {}, ctx, translate))
      },
      response: ({ result }) => ({ id: result?.id ?? null }),
      status: 201,
    },
    update: {
      commandId: 'sales.document-addresses.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return documentAddressUpdateSchema.parse(withScopedPayload(raw ?? {}, ctx, translate))
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'sales.document-addresses.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations()
        const id =
          parsed?.body?.id ??
          parsed?.id ??
          parsed?.query?.id ??
          (ctx.request ? new URL(ctx.request.url).searchParams.get('id') : null)
        const documentId =
          parsed?.body?.documentId ??
          parsed?.query?.documentId ??
          (ctx.request ? new URL(ctx.request.url).searchParams.get('documentId') : null)
        const documentKind =
          parsed?.body?.documentKind ??
          parsed?.query?.documentKind ??
          (ctx.request ? new URL(ctx.request.url).searchParams.get('documentKind') : null)
        if (!id || !documentId || !documentKind) {
          throw new CrudHttpError(400, {
            error: translate('sales.documents.detail.error', 'Document not found or inaccessible.'),
          })
        }
        return documentAddressDeleteSchema.parse(withScopedPayload({ id, documentId, documentKind }, ctx, translate))
      },
      response: () => ({ ok: true }),
    },
  },
})

const { GET, POST, PUT, DELETE } = crud

export { GET, POST, PUT, DELETE }

const documentAddressSchema = z.object({
  id: z.string().uuid(),
  document_id: z.string().uuid(),
  document_kind: z.enum(['order', 'quote']),
  customer_address_id: z.string().uuid().nullable().optional(),
  name: z.string().nullable().optional(),
  purpose: z.string().nullable().optional(),
  company_name: z.string().nullable().optional(),
  address_line1: z.string(),
  address_line2: z.string().nullable().optional(),
  building_number: z.string().nullable().optional(),
  flat_number: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  region: z.string().nullable().optional(),
  postal_code: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
})

export const openApi = createSalesCrudOpenApi({
  resourceName: 'Document address',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(documentAddressSchema),
  create: {
    schema: documentAddressCreateSchema,
    responseSchema: z.object({ id: z.string().uuid().nullable() }),
    description: 'Creates a sales document address linked to an order or quote.',
  },
  update: {
    schema: documentAddressUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates a sales document address.',
  },
  del: {
    schema: documentAddressDeleteSchema.pick({ id: true, documentId: true, documentKind: true }),
    responseSchema: defaultOkResponseSchema,
    description: 'Deletes a sales document address.',
  },
})
