import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { HrApprovalRequest } from '../../data/entities'
import { createHrCrudOpenApi, createPagedListResponseSchema } from '../openapi'
import { HR_APPROVAL_REQUEST_ENTITY_ID } from '../../commands/hr'
import '../../commands/hr'

/**
 * Read-only view of the approval queue.
 *
 * Lifecycle fields (`status`, `current_step_order`, `decided_at`) are written by the
 * approval engine and nothing else. An editable request row bypassed the action log and
 * the target effect, and could be created already approved, so this surface exposes GET
 * only; submit and the four decisions have their own action routes.
 */
const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  id: z.string().uuid().optional(),
  ids: z.string().optional(),
  workflowId: z.string().uuid().optional(),
  status: z.string().optional(),
  entityType: z.string().optional(),
  // The pair the index `hr_approval_requests_entity_idx` covers: "is there already a request about
  // this record?" is the question every approval entry point has to ask before offering to submit one.
  entityId: z.string().uuid().optional(),
  search: z.string().optional(),
  sortField: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
}).passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['hr.read'] },
}

export const metadata = { path: '/hr_management/approval-requests', ...routeMetadata }

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: { entity: HrApprovalRequest, idField: 'id', orgField: 'organizationId', tenantField: 'tenantId', softDeleteField: 'deletedAt' },
  indexer: { entityType: HR_APPROVAL_REQUEST_ENTITY_ID },
  list: {
    schema: listSchema,
    entityId: HR_APPROVAL_REQUEST_ENTITY_ID,
    fields: ['id', 'organization_id', 'tenant_id', 'workflow_id', 'entity_type', 'entity_id', 'status', 'current_step_order', 'requested_by_user_id', 'decided_at', 'summary', 'payload', 'created_at', 'updated_at'],
    sortFieldMap: { workflowId: 'workflow_id', entityType: 'entity_type', entityId: 'entity_id', status: 'status', createdAt: 'created_at', updatedAt: 'updated_at' },
    buildFilters: (query) => ({
      ...(query.id ? { id: { $eq: query.id } } : {}),
      ...(query.ids ? { id: { $in: query.ids.split(',').map((value) => value.trim()).filter(Boolean) } } : {}),
      ...(query.workflowId ? { workflow_id: { $eq: query.workflowId } } : {}),
      ...(query.status ? { status: { $eq: query.status } } : {}),
      // The inbox's request-type filter is the one an operator reaches for when the queue mixes
      // leave requests with permissions, so it has to reach the query rather than being dropped by
      // `passthrough()` and quietly returning everything.
      ...(query.entityType ? { entity_type: { $eq: query.entityType } } : {}),
      ...(query.entityId ? { entity_id: { $eq: query.entityId } } : {}),
      // The search box looks for what the operator sees: the summary they wrote or the request type.
      // `summary` is nullable, so a null row simply never matches.
      ...(query.search ? { $or: [
        { summary: { $ilike: `%${escapeLikePattern(query.search)}%` } },
        { entity_type: { $ilike: `%${escapeLikePattern(query.search)}%` } },
      ] } : {}),
    }),
    transformItem: (item) => ({ ...item, updatedAt: item.updated_at ?? null }),
  },
})

export const GET = crud.GET

const itemSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  workflow_id: z.string().uuid().nullable().optional(),
  entity_type: z.string().nullable().optional(),
  entity_id: z.string().uuid().nullable().optional(),
  status: z.string().nullable().optional(),
  current_step_order: z.number().nullable().optional(),
  requested_by_user_id: z.string().uuid().nullable().optional(),
  decided_at: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  payload: z.unknown().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
})

export const openApi = createHrCrudOpenApi({
  resourceName: 'Approval request',
  pluralName: 'Approval requests',
  description: 'The approval queue, written by the approval engine and exposed read-only.',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(itemSchema),
})
