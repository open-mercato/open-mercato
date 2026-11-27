import { z } from 'zod'
import { makeCrudRoute, type CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { createCrudOpenApiFactory, createPagedListResponseSchema } from '@open-mercato/shared/lib/openapi/crud'
import { LegalMatter } from '../../data/entities'
import {
  legalMatterCreateSchema,
  legalMatterItemSchema,
  legalMatterListQuerySchema,
  legalMatterUpdateSchema,
  type LegalMatterCreateInput,
  type LegalMatterItem,
  type LegalMatterUpdateInput,
} from '../../data/validators'
import { LEGAL_MATTER_ENTITY_ID, applyUserLabels, toLegalMatterItem } from '../../lib/matterItems'

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['legal_review.matters.view'] },
  POST: { requireAuth: true, requireFeatures: ['legal_review.matters.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['legal_review.matters.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['legal_review.matters.manage'] },
}

export const metadata = routeMetadata

const UPDATABLE_FIELDS = [
  'reference',
  'counterparty',
  'purpose',
  'jurisdiction',
  'agreementType',
  'paper',
  'requestedByUserId',
  'assigneeUserId',
  'stage',
  'dueAt',
] as const

function resolveRequestScope(ctx: CrudCtx): { tenantId: string; organizationId: string } | null {
  const tenantId = ctx.auth?.tenantId ?? null
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  return tenantId && organizationId ? { tenantId, organizationId } : null
}

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: LegalMatter,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  events: { module: 'legal_review', entity: 'matter', persistent: true },
  list: {
    schema: legalMatterListQuerySchema,
    entityId: LEGAL_MATTER_ENTITY_ID,
    fields: [
      'id',
      'document_id',
      'reference',
      'counterparty',
      'purpose',
      'jurisdiction',
      'agreement_type',
      'paper',
      'requested_by_user_id',
      'assignee_user_id',
      'stage',
      'due_at',
      'organization_id',
      'tenant_id',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      reference: 'reference',
      counterparty: 'counterparty',
      stage: 'stage',
      dueAt: 'due_at',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    defaultSort: { field: 'created_at', dir: 'desc' },
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = { $eq: query.id }
      if (query.documentId) filters.document_id = { $eq: query.documentId }
      if (query.stage) filters.stage = { $eq: query.stage }
      return filters
    },
    transformItem: (item: Record<string, unknown>) => toLegalMatterItem(item),
  },
  hooks: {
    afterList: async (payload: { items?: LegalMatterItem[] }, ctx) => {
      const scope = resolveRequestScope(ctx)
      if (!scope || !Array.isArray(payload.items)) return
      payload.items = await applyUserLabels(ctx.container, scope, payload.items)
    },
  },
  create: {
    schema: legalMatterCreateSchema,
    mapToEntity: (input: LegalMatterCreateInput) => ({
      documentId: input.documentId,
      reference: input.reference,
      counterparty: input.counterparty,
      purpose: input.purpose ?? null,
      jurisdiction: input.jurisdiction ?? null,
      agreementType: input.agreementType,
      paper: input.paper,
      requestedByUserId: input.requestedByUserId ?? null,
      assigneeUserId: input.assigneeUserId ?? null,
      stage: input.stage,
      dueAt: input.dueAt ?? null,
    }),
    response: (entity: LegalMatter) => ({
      id: entity.id,
      updatedAt: entity.updatedAt instanceof Date ? entity.updatedAt.toISOString() : null,
    }),
  },
  update: {
    schema: legalMatterUpdateSchema,
    applyToEntity: (entity: LegalMatter, input: LegalMatterUpdateInput) => {
      const target = entity as unknown as Record<string, unknown>
      for (const field of UPDATABLE_FIELDS) {
        if (input[field] !== undefined) target[field] = input[field]
      }
    },
    response: (entity: LegalMatter) => ({
      id: entity.id,
      updatedAt: entity.updatedAt instanceof Date ? entity.updatedAt.toISOString() : null,
    }),
  },
  del: { idFrom: 'query', softDelete: true },
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

const buildLegalReviewCrudOpenApi = createCrudOpenApiFactory({ defaultTag: 'Legal Review' })

const mutationResponseSchema = z.object({
  id: z.string().uuid(),
  updatedAt: z.string().nullable(),
})

export const openApi = buildLegalReviewCrudOpenApi({
  resourceName: 'Legal matter',
  querySchema: legalMatterListQuerySchema,
  listResponseSchema: createPagedListResponseSchema(legalMatterItemSchema),
  create: {
    schema: legalMatterCreateSchema,
    responseSchema: mutationResponseSchema,
    description: 'Creates a legal matter for a document. The document is referenced by id only.',
  },
  update: {
    schema: legalMatterUpdateSchema,
    responseSchema: mutationResponseSchema,
    description: 'Updates a legal matter. Honors optimistic locking on updatedAt.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: z.object({ ok: z.literal(true) }),
    description: 'Soft-deletes a legal matter. The id is taken from the query string.',
  },
})
