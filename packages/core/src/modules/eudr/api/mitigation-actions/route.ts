import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { splitCustomFieldPayload } from '@open-mercato/shared/lib/crud/custom-fields'
import { withScopedPayload } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { E } from '#generated/entities.ids.generated'
import { EudrMitigationAction } from '../../data/entities'
import {
  EUDR_MITIGATION_STATUSES,
  EUDR_MITIGATION_TYPES,
  mitigationActionCreateSchema,
  mitigationActionUpdateSchema,
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
  riskAssessmentId: z.string().uuid().optional(),
  status: z.enum(EUDR_MITIGATION_STATUSES).optional(),
  actionType: z.enum(EUDR_MITIGATION_TYPES).optional(),
  id: z.string().uuid().optional(),
  ids: z.string().optional(),
  sortField: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
})

type MitigationActionListQuery = z.infer<typeof listSchema>

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['eudr.risk.view'] },
  POST: { requireAuth: true, requireFeatures: ['eudr.risk.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['eudr.risk.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['eudr.risk.manage'] },
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

function asRecord(value: object): Record<string, unknown> {
  return value as Record<string, unknown>
}

function resolveDeleteInput(parsed: unknown, ctx: { request?: Request }, translate: TranslateFn) {
  const record = parsed && typeof parsed === 'object' ? asRecord(parsed) : {}
  const body = record.body && typeof record.body === 'object' ? asRecord(record.body) : null
  const query = record.query && typeof record.query === 'object' ? asRecord(record.query) : null
  const requestId = ctx.request ? new URL(ctx.request.url).searchParams.get('id') : null
  const id = asStringOrNull(body?.id) ?? asStringOrNull(record.id) ?? asStringOrNull(query?.id) ?? requestId
  if (!id) {
    throw new CrudHttpError(400, { error: translate('eudr.errors.mitigation_action_required', 'Mitigation action id is required') })
  }
  return { id }
}

function buildFilters(query: MitigationActionListQuery): Record<string, unknown> {
  const filters: Record<string, unknown> = {}
  if (query.id) filters.id = { $eq: query.id }
  if (query.riskAssessmentId) filters.risk_assessment_id = { $eq: query.riskAssessmentId }
  if (query.status) filters.status = { $eq: query.status }
  if (query.actionType) filters.action_type = { $eq: query.actionType }
  return filters
}

function transformMitigationActionItem(item: unknown) {
  if (!item || typeof item !== 'object') return item
  const record = item as Record<string, unknown>
  return {
    id: record.id,
    riskAssessmentId: record.risk_assessment_id ?? null,
    actionType: record.action_type ?? null,
    title: record.title ?? null,
    description: record.description ?? null,
    status: record.status ?? null,
    dueDate: toIsoString(record.due_date),
    completedAt: toIsoString(record.completed_at),
    notes: record.notes ?? null,
    createdAt: toIsoString(record.created_at),
    updatedAt: toIsoString(record.updated_at),
  }
}

const listFields = [
  'id',
  'risk_assessment_id',
  'action_type',
  'title',
  'description',
  'status',
  'due_date',
  'completed_at',
  'created_at',
  'updated_at',
]

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: EudrMitigationAction,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: E.eudr.eudr_mitigation_action },
  list: {
    schema: listSchema,
    entityId: E.eudr.eudr_mitigation_action,
    fields: listFields,
    sortFieldMap: {
      created_at: 'created_at',
      createdAt: 'created_at',
      due_date: 'due_date',
      dueDate: 'due_date',
      status: 'status',
    },
    buildFilters,
    transformItem: transformMitigationActionItem,
  },
  actions: {
    create: {
      commandId: 'eudr.mitigation_actions.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        const { base, custom } = splitCustomFieldPayload(scoped)
        const parsed = mitigationActionCreateSchema.parse(base)
        const input = { ...parsed, tenantId: scoped.tenantId, organizationId: scoped.organizationId }
        return Object.keys(custom).length ? { ...input, customFields: custom } : input
      },
      response: ({ result }) => ({ id: result?.entityId ?? result?.id ?? null }),
      status: 201,
    },
    update: {
      commandId: 'eudr.mitigation_actions.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        const { base, custom } = splitCustomFieldPayload(scoped)
        const parsed = mitigationActionUpdateSchema.parse(base)
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
      commandId: 'eudr.mitigation_actions.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations()
        return resolveDeleteInput(parsed, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
  },
  hooks: {
    afterList: async (payload, ctx) => {
      const detailRead = (typeof ctx.query.id === 'string' && ctx.query.id.length > 0)
        || (typeof ctx.query.ids === 'string' && ctx.query.ids.length > 0)
      if (!detailRead) return
      const items: unknown[] = Array.isArray(payload?.items) ? payload.items : []
      if (!items.length) return
      const tenantId = ctx.auth?.tenantId ?? null
      const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
      if (!tenantId || !organizationId) return
      const ids = items
        .map((item) => (item && typeof item === 'object' ? asStringOrNull((item as Record<string, unknown>).id) : null))
        .filter((id): id is string => id !== null)
      if (!ids.length) return
      const em = ctx.container.resolve('em') as EntityManager
      const where: FilterQuery<EudrMitigationAction> = {
        id: { $in: ids },
        deletedAt: null,
        tenantId,
        organizationId,
      }
      const decrypted = await findWithDecryption(
        em,
        EudrMitigationAction,
        where,
        {},
        { tenantId, organizationId },
      )
      const byId = new Map(decrypted.map((action) => [action.id, action]))
      for (const item of items) {
        if (!item || typeof item !== 'object') continue
        const record = item as Record<string, unknown>
        const id = asStringOrNull(record.id)
        const action = id ? byId.get(id) : null
        if (!action) continue
        record.notes = action.notes ?? null
      }
    },
  },
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

const mitigationActionListItemSchema = z.object({
  id: z.string().uuid(),
  riskAssessmentId: z.string().uuid().nullable().optional(),
  actionType: z.enum(EUDR_MITIGATION_TYPES).nullable().optional(),
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  status: z.enum(EUDR_MITIGATION_STATUSES).nullable().optional(),
  dueDate: z.string().nullable().optional(),
  completedAt: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  createdAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
})

export const openApi = createEudrCrudOpenApi({
  resourceName: 'Mitigation action',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(mitigationActionListItemSchema),
  create: {
    schema: mitigationActionCreateSchema,
    description: 'Creates an EUDR mitigation action for the scoped organization.',
  },
  update: {
    schema: mitigationActionUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates an EUDR mitigation action.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Deletes an EUDR mitigation action by id. Request body or query may provide the identifier.',
  },
})
