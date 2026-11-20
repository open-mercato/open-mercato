import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveCrudRecordId, parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import { StaffSupportRoutingRule } from '../../../data/entities'
import {
  staffSupportRoutingRuleCreateSchema,
  staffSupportRoutingRuleUpdateSchema,
} from '../../../data/validators'
import { staffSupportRoutingRuleCommandIds } from '../../../commands/support-routing-rules'
import { createStaffCrudOpenApi, createPagedListResponseSchema, defaultOkResponseSchema } from '../../openapi'

const SETTINGS_FEATURE = 'staff.timesheets.settings.manage'

const F = {
  id: 'id',
  tenant_id: 'tenant_id',
  organization_id: 'organization_id',
  category_value: 'category_value',
  time_project_id: 'time_project_id',
  is_active: 'is_active',
  created_at: 'created_at',
  updated_at: 'updated_at',
} as const

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: [SETTINGS_FEATURE] },
  POST: { requireAuth: true, requireFeatures: [SETTINGS_FEATURE] },
  PUT: { requireAuth: true, requireFeatures: [SETTINGS_FEATURE] },
  DELETE: { requireAuth: true, requireFeatures: [SETTINGS_FEATURE] },
}

export const metadata = routeMetadata

const rawBodySchema = z.object({}).passthrough()

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(100),
    ids: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: StaffSupportRoutingRule,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: 'staff:staff_support_routing_rule' },
  list: {
    schema: listSchema,
    entityId: 'staff:staff_support_routing_rule',
    fields: [
      F.id,
      F.organization_id,
      F.tenant_id,
      F.category_value,
      F.time_project_id,
      F.is_active,
      F.created_at,
      F.updated_at,
    ],
    defaultSort: { field: F.created_at, dir: 'asc' },
    sortFieldMap: { createdAt: F.created_at, updatedAt: F.updated_at },
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      if (typeof query.ids === 'string' && query.ids.trim().length > 0) {
        const ids = query.ids.split(',').map((value) => value.trim()).filter((value) => value.length > 0)
        if (ids.length > 0) filters[F.id] = { $in: ids }
      }
      return filters
    },
  },
  actions: {
    create: {
      commandId: staffSupportRoutingRuleCommandIds.create,
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(staffSupportRoutingRuleCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.ruleId ?? null }),
      status: 201,
    },
    update: {
      commandId: staffSupportRoutingRuleCommandIds.update,
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(staffSupportRoutingRuleUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: staffSupportRoutingRuleCommandIds.delete,
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations()
        return { id: resolveCrudRecordId(parsed, ctx, translate) }
      },
      response: () => ({ ok: true }),
    },
  },
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

export const supportRoutingRuleListItemSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  organization_id: z.string().uuid().nullable().optional(),
  tenant_id: z.string().uuid().nullable().optional(),
  category_value: z.string().nullable().optional(),
  time_project_id: z.string().uuid().nullable().optional(),
  is_active: z.boolean().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
})

export const openApi = createStaffCrudOpenApi({
  resourceName: 'Support routing rule',
  pluralName: 'Support routing rules',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(supportRoutingRuleListItemSchema),
  create: {
    schema: staffSupportRoutingRuleCreateSchema.omit({ tenantId: true, organizationId: true }),
    responseSchema: z.object({ id: z.string().uuid().nullable() }),
    description:
      'Creates a routing rule. A null `categoryValue` is the organization fallback rule (exactly one; it can be repointed but not deleted or paused). A rule with a category sends that category to its own project.',
  },
  update: {
    schema: staffSupportRoutingRuleUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Repoints a rule at another project or pauses/resumes a per-category rule. Pausing the fallback rule answers 422.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Deletes a per-category rule so the category falls back to the fallback project. Deleting the fallback rule answers 422.',
  },
})
