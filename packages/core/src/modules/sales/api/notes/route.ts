import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { SalesNote } from '../../data/entities'
import { noteCreateSchema, noteUpdateSchema } from '../../data/validators'
import { withScopedPayload } from '../utils'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import {
  createPagedListResponseSchema,
  createSalesCrudOpenApi,
  defaultOkResponseSchema,
} from '../openapi'

const rawBodySchema = z.object({}).passthrough()

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    contextType: z.enum(['order', 'quote', 'invoice', 'credit_memo']).optional(),
    contextId: z.string().uuid().optional(),
    orderId: z.string().uuid().optional(),
    quoteId: z.string().uuid().optional(),
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
    entity: SalesNote,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
  },
  indexer: {
    entityType: E.sales.sales_note,
  },
  list: {
    schema: listSchema,
    entityId: E.sales.sales_note,
    fields: [
      'id',
      'context_type',
      'context_id',
      'order_id',
      'quote_id',
      'body',
      'author_user_id',
      'appearance_icon',
      'appearance_color',
      'organization_id',
      'tenant_id',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query: any) => {
      const filters: Record<string, any> = {}
      if (query.contextId) filters.context_id = { $eq: query.contextId }
      if (query.contextType) filters.context_type = { $eq: query.contextType }
      if (query.orderId) filters.order_id = { $eq: query.orderId }
      if (query.quoteId) filters.quote_id = { $eq: query.quoteId }
      return filters
    },
  },
  actions: {
    create: {
      commandId: 'sales.notes.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return noteCreateSchema.parse(withScopedPayload(raw ?? {}, ctx, translate))
      },
      response: ({ result }) => ({
        id: result?.noteId ?? result?.id ?? null,
        authorUserId: result?.authorUserId ?? null,
      }),
      status: 201,
    },
    update: {
      commandId: 'sales.notes.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return noteUpdateSchema.parse(withScopedPayload(raw ?? {}, ctx, translate))
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'sales.notes.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations()
        const id =
          parsed?.body?.id ??
          parsed?.id ??
          parsed?.query?.id ??
          (ctx.request ? new URL(ctx.request.url).searchParams.get('id') : null)
        if (!id) {
          throw new CrudHttpError(400, { error: translate('sales.documents.detail.error', 'Document not found or inaccessible.') })
        }
        return { id }
      },
      response: () => ({ ok: true }),
    },
  },
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

const noteListItemSchema = z
  .object({
    id: z.string().uuid(),
    context_type: z.enum(['order', 'quote', 'invoice', 'credit_memo']),
    context_id: z.string().uuid(),
    order_id: z.string().uuid().nullable().optional(),
    quote_id: z.string().uuid().nullable().optional(),
    body: z.string().nullable(),
    author_user_id: z.string().uuid().nullable().optional(),
    appearance_icon: z.string().nullable().optional(),
    appearance_color: z.string().nullable().optional(),
    organization_id: z.string().uuid().nullable().optional(),
    tenant_id: z.string().uuid().nullable().optional(),
    created_at: z.string().nullable(),
    updated_at: z.string().nullable().optional(),
  })
  .passthrough()

const noteCreateResponseSchema = z.object({
  id: z.string().uuid().nullable(),
  authorUserId: z.string().uuid().nullable(),
})

export const openApi = createSalesCrudOpenApi({
  resourceName: 'Sales note',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(noteListItemSchema),
  create: {
    schema: noteCreateSchema,
    responseSchema: noteCreateResponseSchema,
    description: 'Creates a note attached to a sales document.',
  },
  update: {
    schema: noteUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates a sales note.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Deletes a sales note.',
  },
})
