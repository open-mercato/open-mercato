import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { makeCrudRoute, type CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError, notFound } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { SalesNote, type SalesDocumentKind } from '../../data/entities'
import { noteCreateSchema, noteUpdateSchema } from '../../data/validators'
import { withScopedPayload } from '../utils'
import { E } from '#generated/entities.ids.generated'
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

type NoteListQuery = z.infer<typeof listSchema>
type NoteAction = 'view' | 'manage'

const noteFeatureByContext: Record<SalesDocumentKind, Record<NoteAction, string>> = {
  order: { view: 'sales.orders.view', manage: 'sales.orders.manage' },
  quote: { view: 'sales.quotes.view', manage: 'sales.quotes.manage' },
  invoice: { view: 'sales.invoices.manage', manage: 'sales.invoices.manage' },
  credit_memo: { view: 'sales.credit_memos.manage', manage: 'sales.credit_memos.manage' },
}

const allNoteViewFeatures = Array.from(
  new Set(Object.values(noteFeatureByContext).map((features) => features.view)),
)
const allNoteManageFeatures = Array.from(
  new Set(Object.values(noteFeatureByContext).map((features) => features.manage)),
)

function resolveNoteListContextType(query: NoteListQuery): SalesDocumentKind | null {
  if (query.contextType) return query.contextType
  if (query.orderId) return 'order'
  if (query.quoteId) return 'quote'
  return null
}

function requiredNoteFeatures(action: NoteAction, contextType: SalesDocumentKind | null): string[] {
  if (contextType) return [noteFeatureByContext[contextType][action]]
  return action === 'view' ? allNoteViewFeatures : allNoteManageFeatures
}

async function ensureNotePermission(
  ctx: CrudCtx,
  action: NoteAction,
  contextType: SalesDocumentKind | null,
  translate: (key: string, fallback?: string) => string
) {
  const auth = ctx.auth
  if (!auth?.sub) {
    throw new CrudHttpError(401, { error: translate('api.errors.unauthorized', 'Unauthorized') })
  }

  const requiredFeatures = requiredNoteFeatures(action, contextType)
  const rbac = ctx.container.resolve<RbacService>('rbacService')
  const ok = await rbac.userHasAllFeatures(auth.sub, requiredFeatures, {
    tenantId: auth.tenantId ?? null,
    organizationId: ctx.selectedOrganizationId ?? auth.orgId ?? null,
  })

  if (!ok) {
    throw new CrudHttpError(403, {
      error: translate('api.errors.forbidden', 'Forbidden'),
      requiredFeatures,
    })
  }
}

async function loadNoteForPermission(
  ctx: CrudCtx,
  id: string,
  translate: (key: string, fallback?: string) => string
): Promise<SalesNote> {
  const em = ctx.container.resolve<EntityManager>('em')
  const note = await findOneWithDecryption(em, SalesNote, { id }, {}, {
    tenantId: ctx.auth?.tenantId ?? undefined,
    organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? undefined,
  })

  if (!note) {
    throw notFound(translate('sales.documents.detail.error', 'Document not found or inaccessible.'))
  }

  return note
}

async function ensureExistingNotePermission(
  ctx: CrudCtx,
  id: string,
  action: NoteAction,
  translate: (key: string, fallback?: string) => string
) {
  const note = await loadNoteForPermission(ctx, id, translate)
  await ensureNotePermission(ctx, action, note.contextType, translate)
}

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
  hooks: {
    beforeList: async (query, ctx) => {
      const { translate } = await resolveTranslations()
      await ensureNotePermission(ctx, 'view', resolveNoteListContextType(query as NoteListQuery), translate)
    },
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
        const input = noteCreateSchema.parse(withScopedPayload(raw ?? {}, ctx, translate))
        await ensureNotePermission(ctx, 'manage', input.contextType, translate)
        return input
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
        const input = noteUpdateSchema.parse(withScopedPayload(raw ?? {}, ctx, translate))
        await ensureExistingNotePermission(ctx, input.id, 'manage', translate)
        return input
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
        await ensureExistingNotePermission(ctx, id, 'manage', translate)
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
