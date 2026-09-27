import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { parseScopedCommandInput, resolveCrudRecordId } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { HrApprovalStepDefinition } from '../../data/entities'
import { createApprovalStepDefinitionSchema, updateApprovalStepDefinitionSchema } from '../../data/validators'
import { createHrCrudOpenApi, createPagedListResponseSchema, defaultOkResponseSchema } from '../openapi'
import { HR_APPROVAL_STEP_ENTITY_ID } from '../../commands/hr'
import '../../commands/hr'

const rawBodySchema = z.object({}).passthrough()
const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  id: z.string().uuid().optional(),
  ids: z.string().optional(),
  workflowId: z.string().uuid().optional(),
  sortField: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
}).passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['hr.read'] },
  POST: { requireAuth: true, requireFeatures: ['hr.write'] },
  PUT: { requireAuth: true, requireFeatures: ['hr.write'] },
  DELETE: { requireAuth: true, requireFeatures: ['hr.write'] },
}

export const metadata = { path: '/hr_management/approval-steps', ...routeMetadata }

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: { entity: HrApprovalStepDefinition, idField: 'id', orgField: 'organizationId', tenantField: 'tenantId', softDeleteField: 'deletedAt' },
  indexer: { entityType: HR_APPROVAL_STEP_ENTITY_ID },
  list: {
    schema: listSchema,
    entityId: HR_APPROVAL_STEP_ENTITY_ID,
    fields: ['id', 'organization_id', 'tenant_id', 'workflow_id', 'step_order', 'name', 'approver_type', 'approver_role_id', 'approver_user_id', 'required_approvals', 'is_final', 'created_at', 'updated_at'],
    sortFieldMap: { workflowId: 'workflow_id', stepOrder: 'step_order', name: 'name', approverType: 'approver_type', createdAt: 'created_at', updatedAt: 'updated_at' },
    buildFilters: (query) => ({
      ...(query.id ? { id: { $eq: query.id } } : {}),
      ...(query.ids ? { id: { $in: query.ids.split(',').map((value) => value.trim()).filter(Boolean) } } : {}),
      ...(query.workflowId ? { workflowId: { $eq: query.workflowId } } : {}),
    }),
    transformItem: (item) => ({ ...item, updatedAt: item.updated_at ?? null }),
  },
  actions: {
    create: {
      commandId: 'hr_management.approval_steps.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => { const { translate } = await resolveTranslations(); return parseScopedCommandInput(createApprovalStepDefinitionSchema, raw ?? {}, ctx, translate) },
      response: ({ result }) => ({ id: result?.id ?? null, updatedAt: result?.updatedAt?.toISOString?.() ?? null }),
      status: 201,
    },
    update: {
      commandId: 'hr_management.approval_steps.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => { const { translate } = await resolveTranslations(); return parseScopedCommandInput(updateApprovalStepDefinitionSchema, raw ?? {}, ctx, translate) },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'hr_management.approval_steps.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => { const { translate } = await resolveTranslations(); return { id: resolveCrudRecordId(parsed, ctx, translate) } },
      response: () => ({ ok: true }),
    },
  },
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

const itemSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  workflow_id: z.string().uuid().nullable().optional(),
  step_order: z.number().nullable().optional(),
  name: z.string().nullable().optional(),
  approver_type: z.string().nullable().optional(),
  approver_role_id: z.string().uuid().nullable().optional(),
  approver_user_id: z.string().uuid().nullable().optional(),
  required_approvals: z.number().nullable().optional(),
  is_final: z.boolean().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
})

export const openApi = createHrCrudOpenApi({
  resourceName: 'Approval step', pluralName: 'Approval steps', querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(itemSchema),
  create: { schema: createApprovalStepDefinitionSchema, description: 'Creates a approval step.' },
  update: { schema: updateApprovalStepDefinitionSchema, responseSchema: defaultOkResponseSchema, description: 'Updates a approval step.' },
  del: { schema: z.object({ id: z.string().uuid() }), responseSchema: defaultOkResponseSchema, description: 'Soft-deletes a approval step.' },
})
