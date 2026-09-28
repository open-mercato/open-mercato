import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { APPROVAL_ACTIONS, HrApprovalActionLog } from '../../data/entities'
import { createHrCrudOpenApi, createPagedListResponseSchema } from '../openapi'
import { HR_APPROVAL_ACTION_LOG_ENTITY_ID } from '../../commands/hr'
import '../../commands/hr'

/**
 * Read-only view of the approval audit trail.
 *
 * The engine writes these rows and nothing else does, so this route exposes GET only — an editable
 * trail is not a trail. It exists because the inbox has to answer "who decided this, when, and why":
 * until now the log was written but unreachable over HTTP. The indexer is declared even though a
 * read-only route never emits into it, because the repo-wide `crud-indexer-config` guard requires
 * every route that names a `list.entityId` to state its projection.
 */
const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  id: z.string().uuid().optional(),
  ids: z.string().optional(),
  approvalRequestId: z.string().uuid().optional(),
  action: z.enum(APPROVAL_ACTIONS).optional(),
  sortField: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
}).passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['hr.read'] },
}

export const metadata = { path: '/hr_management/approval-logs', ...routeMetadata }

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: { entity: HrApprovalActionLog, idField: 'id', orgField: 'organizationId', tenantField: 'tenantId', softDeleteField: 'deletedAt' },
  indexer: { entityType: HR_APPROVAL_ACTION_LOG_ENTITY_ID },
  list: {
    schema: listSchema,
    entityId: HR_APPROVAL_ACTION_LOG_ENTITY_ID,
    fields: ['id', 'organization_id', 'tenant_id', 'approval_request_id', 'step_order', 'action', 'actor_user_id', 'comment', 'created_at', 'updated_at'],
    sortFieldMap: { approvalRequestId: 'approval_request_id', stepOrder: 'step_order', action: 'action', createdAt: 'created_at', updatedAt: 'updated_at' },
    buildFilters: (query) => ({
      ...(query.id ? { id: { $eq: query.id } } : {}),
      ...(query.ids ? { id: { $in: query.ids.split(',').map((value) => value.trim()).filter(Boolean) } } : {}),
      ...(query.approvalRequestId ? { approval_request_id: { $eq: query.approvalRequestId } } : {}),
      ...(query.action ? { action: { $eq: query.action } } : {}),
    }),
    transformItem: (item) => ({ ...item, updatedAt: item.updated_at ?? null }),
  },
})

export const GET = crud.GET

const itemSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  approval_request_id: z.string().uuid().nullable().optional(),
  step_order: z.number().nullable().optional(),
  action: z.string().nullable().optional(),
  actor_user_id: z.string().uuid().nullable().optional(),
  comment: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
})

export const openApi = createHrCrudOpenApi({
  resourceName: 'Approval action log',
  pluralName: 'Approval action logs',
  description: 'Decisions recorded by the HR approval engine, oldest first per request.',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(itemSchema),
})

