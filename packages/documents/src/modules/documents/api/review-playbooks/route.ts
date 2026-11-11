import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { createPagedListResponseSchema } from '@open-mercato/shared/lib/openapi/crud'
import { DocumentReviewPlaybook } from '../../data/entities'
import { reviewPlaybookCreateSchema, reviewPlaybookUpdateSchema } from '../../data/validators'
import { DOCUMENTS_ENTITY_IDS } from '../../lib/constants'
import type {
  ReviewPlaybookCommandResult,
  ReviewPlaybookCreateCommandInput,
  ReviewPlaybookDeleteCommandInput,
  ReviewPlaybookUpdateCommandInput,
} from '../../commands/reviewPlaybooks'
import {
  buildDocumentsCrudOpenApi,
  readExpectedUpdatedAt,
  resolveCrudDeleteId,
  resolveCrudScope,
  reviewMutationResponseSchema,
  reviewPlaybookItemSchema,
  reviewPlaybookMutationBodySchema,
  toReviewPlaybookItem,
} from '../_reviewPlaybooks'

const listQuerySchema = z.object({
  id: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  search: z.string().trim().max(200).optional(),
  code: z.string().trim().max(64).optional(),
  isActive: z.enum(['true', 'false']).optional(),
  sortField: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
}).passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['documents.view'] },
  POST: { requireAuth: true, requireFeatures: ['documents.review_playbooks.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['documents.review_playbooks.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['documents.review_playbooks.manage'] },
}

export const metadata = routeMetadata

function toMutationResponse(result: ReviewPlaybookCommandResult) {
  return { id: result.id, updatedAt: result.updatedAt, version: result.version }
}

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: DocumentReviewPlaybook,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: DOCUMENTS_ENTITY_IDS.documentReviewPlaybook },
  list: {
    schema: listQuerySchema,
    entityId: DOCUMENTS_ENTITY_IDS.documentReviewPlaybook,
    fields: [
      'id',
      'code',
      'name',
      'description',
      'instructions',
      'version',
      'is_active',
      'organization_id',
      'tenant_id',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      code: 'code',
      name: 'name',
      version: 'version',
      updatedAt: 'updated_at',
      createdAt: 'created_at',
    },
    defaultSort: { field: 'name', dir: 'asc' },
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = { $eq: query.id }
      if (query.code) filters.code = { $eq: query.code }
      if (query.isActive) filters.is_active = { $eq: query.isActive === 'true' }
      if (query.search) {
        const pattern = `%${escapeLikePattern(query.search)}%`
        filters.$or = [{ name: { $ilike: pattern } }, { code: { $ilike: pattern } }]
      }
      return filters
    },
    transformItem: (item: Record<string, unknown>) => toReviewPlaybookItem(item),
  },
  actions: {
    create: {
      commandId: 'documents.review_playbook.create',
      schema: reviewPlaybookMutationBodySchema,
      mapInput: ({ raw, ctx }): ReviewPlaybookCreateCommandInput => ({
        ...resolveCrudScope(ctx),
        playbookId: randomUUID(),
        playbook: reviewPlaybookCreateSchema.parse(raw ?? {}),
      }),
      response: ({ result }) => toMutationResponse(result as ReviewPlaybookCommandResult),
      status: 201,
    },
    update: {
      commandId: 'documents.review_playbook.update',
      schema: reviewPlaybookMutationBodySchema,
      mapInput: ({ raw, ctx }): ReviewPlaybookUpdateCommandInput & { id: string } => {
        const playbook = reviewPlaybookUpdateSchema.parse(raw ?? {})
        return { ...resolveCrudScope(ctx), id: playbook.id, playbook }
      },
      response: ({ result }) => toMutationResponse(result as ReviewPlaybookCommandResult),
    },
    delete: {
      commandId: 'documents.review_playbook.delete',
      schema: reviewPlaybookMutationBodySchema,
      mapInput: ({ parsed, ctx }): ReviewPlaybookDeleteCommandInput & { id: string } => {
        const playbookId = resolveCrudDeleteId(parsed, ctx)
        return {
          ...resolveCrudScope(ctx),
          id: playbookId,
          playbookId,
          expectedUpdatedAt: readExpectedUpdatedAt(parsed),
        }
      },
      response: ({ result }) => ({ ok: true, ...toMutationResponse(result as ReviewPlaybookCommandResult) }),
    },
  },
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

export const openApi = buildDocumentsCrudOpenApi({
  resourceName: 'Review playbook',
  querySchema: listQuerySchema,
  listResponseSchema: createPagedListResponseSchema(reviewPlaybookItemSchema),
  create: {
    schema: reviewPlaybookCreateSchema,
    responseSchema: reviewMutationResponseSchema.extend({ version: z.number().int() }),
    description: 'Creates a review playbook. The code is unique per organization among non-deleted playbooks.',
  },
  update: {
    schema: reviewPlaybookUpdateSchema,
    responseSchema: reviewMutationResponseSchema.extend({ version: z.number().int() }),
    description: 'Updates a review playbook and bumps its version. Honors optimistic locking on updatedAt.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: reviewMutationResponseSchema.extend({ ok: z.literal(true), version: z.number().int() }),
    description: 'Soft-deletes a review playbook. The id may be given in the body or the query string.',
  },
})
