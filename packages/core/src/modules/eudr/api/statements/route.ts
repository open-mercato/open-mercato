import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { splitCustomFieldPayload } from '@open-mercato/shared/lib/crud/custom-fields'
import { buildIlikeTerm } from '@open-mercato/shared/lib/db/buildIlikeTerm'
import { withScopedPayload } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { E } from '#generated/entities.ids.generated'
import { EudrDueDiligenceStatement } from '../../data/entities'
import {
  EUDR_COMMODITIES,
  EUDR_STATEMENT_STATUSES,
  statementCreateSchema,
  statementUpdateSchema,
} from '../../data/validators'
import {
  createEudrCrudOpenApi,
  createPagedListResponseSchema,
  defaultOkResponseSchema,
} from '../openapi'

type TranslateFn = (key: string, fallback?: string) => string

const rawBodySchema = z.object({}).passthrough()

const listSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  search: z.string().optional(),
  commodity: z.enum(EUDR_COMMODITIES).optional(),
  status: z.enum(EUDR_STATEMENT_STATUSES).optional(),
  id: z.string().uuid().optional(),
  ids: z.string().optional(),
  sortField: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
})

type StatementListQuery = z.infer<typeof listSchema>

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['eudr.statements.view'] },
  POST: { requireAuth: true, requireFeatures: ['eudr.statements.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['eudr.statements.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['eudr.statements.manage'] },
}

export const metadata = routeMetadata

function toIsoString(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString()
  if (typeof value !== 'string' || value.length === 0) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toISOString()
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function resolveDeleteInput(parsed: unknown, ctx: { request?: Request }, translate: TranslateFn) {
  const record = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
  const body = record.body && typeof record.body === 'object' ? record.body as Record<string, unknown> : null
  const query = record.query && typeof record.query === 'object' ? record.query as Record<string, unknown> : null
  const requestId = ctx.request ? new URL(ctx.request.url).searchParams.get('id') : null
  const id = asStringOrNull(body?.id) ?? asStringOrNull(record.id) ?? asStringOrNull(query?.id) ?? requestId
  if (!id) throw new CrudHttpError(400, { error: translate('eudr.errors.statement_required', 'Due diligence statement id is required') })
  return { id }
}

function buildFilters(query: StatementListQuery): Record<string, unknown> {
  const filters: Record<string, unknown> = {}
  if (query.id) filters.id = { $eq: query.id }
  if (query.commodity) filters.commodity = { $eq: query.commodity }
  if (query.status) filters.status = { $eq: query.status }
  const search = typeof query.search === 'string' ? query.search.trim() : ''
  if (search) {
    filters.$or = [
      { title: { $ilike: buildIlikeTerm(search) } },
    ]
  }
  return filters
}

function transformStatementItem(item: unknown) {
  if (!item || typeof item !== 'object') return item
  const record = item as Record<string, unknown>
  return {
    id: record.id,
    title: record.title ?? null,
    commodity: record.commodity ?? null,
    referenceNumber: record.reference_number ?? null,
    verificationNumber: record.verification_number ?? null,
    status: record.status ?? null,
    quantityKg: record.quantity_kg ?? null,
    orderId: record.order_id ?? null,
    notes: record.notes ?? null,
    createdAt: toIsoString(record.created_at),
    updatedAt: toIsoString(record.updated_at),
  }
}

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: EudrDueDiligenceStatement,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: E.eudr.eudr_due_diligence_statement },
  list: {
    schema: listSchema,
    entityId: E.eudr.eudr_due_diligence_statement,
    fields: [
      'id',
      'title',
      'commodity',
      'reference_number',
      'verification_number',
      'status',
      'quantity_kg',
      'order_id',
      'notes',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      created_at: 'created_at',
      createdAt: 'created_at',
      updated_at: 'updated_at',
      updatedAt: 'updated_at',
      commodity: 'commodity',
      title: 'title',
      status: 'status',
      referenceNumber: 'reference_number',
      quantityKg: 'quantity_kg',
    },
    buildFilters,
    transformItem: transformStatementItem,
  },
  actions: {
    create: {
      commandId: 'eudr.statements.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        const { base, custom } = splitCustomFieldPayload(scoped)
        const parsed = statementCreateSchema.parse(base)
        const input = { ...parsed, tenantId: scoped.tenantId, organizationId: scoped.organizationId }
        return Object.keys(custom).length ? { ...input, customFields: custom } : input
      },
      response: ({ result }) => ({ id: result?.entityId ?? result?.id ?? null }),
      status: 201,
    },
    update: {
      commandId: 'eudr.statements.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        const { base, custom } = splitCustomFieldPayload(scoped)
        const parsed = statementUpdateSchema.parse(base)
        const input = { ...parsed, tenantId: scoped.tenantId, organizationId: scoped.organizationId }
        return Object.keys(custom).length ? { ...input, customFields: custom } : input
      },
      response: ({ result }) => {
        const updatedAt = result?.updatedAt
        return {
          ok: true,
          updatedAt: updatedAt instanceof Date ? updatedAt.toISOString() : (typeof updatedAt === 'string' ? updatedAt : null),
        }
      },
    },
    delete: {
      commandId: 'eudr.statements.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations()
        return resolveDeleteInput(parsed, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
  },
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

const statementListItemSchema = z.object({
  id: z.string().uuid(),
  title: z.string().nullable().optional(),
  commodity: z.enum(EUDR_COMMODITIES).nullable().optional(),
  referenceNumber: z.string().nullable().optional(),
  verificationNumber: z.string().nullable().optional(),
  status: z.enum(EUDR_STATEMENT_STATUSES).nullable().optional(),
  quantityKg: z.union([z.string(), z.number()]).nullable().optional(),
  orderId: z.string().uuid().nullable().optional(),
  notes: z.string().nullable().optional(),
  createdAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
})

export const openApi = createEudrCrudOpenApi({
  resourceName: 'Due diligence statement',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(statementListItemSchema),
  create: {
    schema: statementCreateSchema,
    description: 'Creates an EUDR due diligence statement for the scoped organization.',
  },
  update: {
    schema: statementUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates an EUDR due diligence statement.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Deletes an EUDR due diligence statement by id. Request body or query may provide the identifier.',
  },
})
