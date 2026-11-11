import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { createPagedListResponseSchema } from '@open-mercato/shared/lib/openapi/crud'
import { DocumentReviewRule } from '../../data/entities'
import { reviewRuleCreateSchema, reviewRuleUpdateSchema } from '../../data/validators'
import { DOCUMENTS_ENTITY_IDS } from '../../lib/constants'
import type {
  ReviewRuleCommandResult,
  ReviewRuleCreateCommandInput,
  ReviewRuleDeleteCommandInput,
  ReviewRuleUpdateCommandInput,
} from '../../commands/reviewPlaybooks'
import {
  buildDocumentsCrudOpenApi,
  readExpectedUpdatedAt,
  resolveCrudDeleteId,
  resolveCrudScope,
  reviewMutationResponseSchema,
  reviewPlaybookMutationBodySchema,
  reviewRuleItemSchema,
  toReviewRuleItem,
} from '../_reviewPlaybooks'

const listQuerySchema = z.object({
  playbookId: z.string().uuid(),
  id: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(100),
  search: z.string().trim().max(200).optional(),
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

const ruleMutationResponseSchema = reviewMutationResponseSchema.extend({
  playbookId: z.string().uuid(),
  playbookVersion: z.number().int(),
})

function toMutationResponse(result: ReviewRuleCommandResult) {
  return {
    id: result.id,
    playbookId: result.playbookId,
    updatedAt: result.updatedAt,
    playbookVersion: result.playbookVersion,
  }
}

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: DocumentReviewRule,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: DOCUMENTS_ENTITY_IDS.documentReviewRule },
  list: {
    schema: listQuerySchema,
    entityId: DOCUMENTS_ENTITY_IDS.documentReviewRule,
    fields: [
      'id',
      'playbook_id',
      'code',
      'title',
      'topic',
      'position',
      'preferred_wording',
      'severity',
      'sort_order',
      'is_active',
      'organization_id',
      'tenant_id',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      code: 'code',
      title: 'title',
      severity: 'severity',
      sortOrder: 'sort_order',
      updatedAt: 'updated_at',
    },
    defaultSort: { field: 'sortOrder', dir: 'asc' },
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = { playbook_id: { $eq: query.playbookId } }
      if (query.id) filters.id = { $eq: query.id }
      if (query.isActive) filters.is_active = { $eq: query.isActive === 'true' }
      if (query.search) {
        const pattern = `%${escapeLikePattern(query.search)}%`
        filters.$or = [{ title: { $ilike: pattern } }, { code: { $ilike: pattern } }, { topic: { $ilike: pattern } }]
      }
      return filters
    },
    transformItem: (item: Record<string, unknown>) => toReviewRuleItem(item),
  },
  actions: {
    create: {
      commandId: 'documents.review_rule.create',
      schema: reviewPlaybookMutationBodySchema,
      mapInput: ({ raw, ctx }): ReviewRuleCreateCommandInput => ({
        ...resolveCrudScope(ctx),
        ruleId: randomUUID(),
        rule: reviewRuleCreateSchema.parse(raw ?? {}),
      }),
      response: ({ result }) => toMutationResponse(result as ReviewRuleCommandResult),
      status: 201,
    },
    update: {
      commandId: 'documents.review_rule.update',
      schema: reviewPlaybookMutationBodySchema,
      mapInput: ({ raw, ctx }): ReviewRuleUpdateCommandInput & { id: string } => {
        const rule = reviewRuleUpdateSchema.parse(raw ?? {})
        return { ...resolveCrudScope(ctx), id: rule.id, rule }
      },
      response: ({ result }) => toMutationResponse(result as ReviewRuleCommandResult),
    },
    delete: {
      commandId: 'documents.review_rule.delete',
      schema: reviewPlaybookMutationBodySchema,
      mapInput: ({ parsed, ctx }): ReviewRuleDeleteCommandInput & { id: string } => {
        const ruleId = resolveCrudDeleteId(parsed, ctx)
        return {
          ...resolveCrudScope(ctx),
          id: ruleId,
          ruleId,
          expectedUpdatedAt: readExpectedUpdatedAt(parsed),
        }
      },
      response: ({ result }) => ({ ok: true, ...toMutationResponse(result as ReviewRuleCommandResult) }),
    },
  },
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

export const openApi = buildDocumentsCrudOpenApi({
  resourceName: 'Review rule',
  querySchema: listQuerySchema,
  listResponseSchema: createPagedListResponseSchema(reviewRuleItemSchema),
  create: {
    schema: reviewRuleCreateSchema,
    responseSchema: ruleMutationResponseSchema,
    description: 'Creates a rule in a review playbook and bumps the playbook version. Rule codes are unique per playbook; a playbook holds at most 200 active rules.',
  },
  update: {
    schema: reviewRuleUpdateSchema,
    responseSchema: ruleMutationResponseSchema,
    description: 'Updates a review rule and bumps the playbook version. Honors optimistic locking on updatedAt.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: ruleMutationResponseSchema.extend({ ok: z.literal(true) }),
    description: 'Soft-deletes a review rule and bumps the playbook version.',
  },
})
