import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { parseScopedCommandInput, resolveCrudRecordId } from '@open-mercato/shared/lib/api/scoped'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { AgentGovernancePlaybook } from '../../data/entities'
import { agentPlaybookCreateSchema, agentPlaybookUpdateSchema } from '../../data/validators'
import { createAgentGovernanceCrudOpenApi, createPagedListResponseSchema, defaultOkResponseSchema } from '../openapi'

const rawBodySchema = z.object({}).passthrough()

const listSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  ids: z.string().optional(),
  search: z.string().optional(),
  triggerType: z.enum(['manual', 'scheduled']).optional(),
  isActive: z.string().optional(),
  sortField: z.enum(['name', 'createdAt', 'updatedAt']).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
}).passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['agent_governance.view'] },
  POST: { requireAuth: true, requireFeatures: ['agent_governance.playbooks.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['agent_governance.playbooks.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['agent_governance.playbooks.manage'] },
}

export const metadata = routeMetadata

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: AgentGovernancePlaybook,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: 'agent_governance:agent_governance_playbook' },
  list: {
    schema: listSchema,
    sortFieldMap: {
      name: 'name',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      const ids = (query.ids ?? '')
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
      if (ids.length > 0) {
        filters.id = { $in: ids }
      }
      if (typeof query.search === 'string' && query.search.trim().length > 0) {
        const pattern = `%${escapeLikePattern(query.search.trim())}%`
        filters.name = { $ilike: pattern }
      }
      if (query.triggerType) {
        filters.triggerType = query.triggerType
      }
      if (typeof query.isActive === 'string') {
        const normalized = query.isActive.trim().toLowerCase()
        if (normalized === 'true') filters.isActive = true
        if (normalized === 'false') filters.isActive = false
      }
      return filters
    },
  },
  actions: {
    create: {
      commandId: 'agent_governance.playbooks.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(agentPlaybookCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.playbookId ?? null }),
      status: 201,
    },
    update: {
      commandId: 'agent_governance.playbooks.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(agentPlaybookUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'agent_governance.playbooks.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations()
        const id = resolveCrudRecordId(parsed, ctx, translate)
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

const playbookListItemSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  tenant_id: z.string().uuid().nullable().optional(),
  organization_id: z.string().uuid().nullable().optional(),
  name: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  policy_id: z.string().uuid().nullable().optional(),
  risk_band_id: z.string().uuid().nullable().optional(),
  trigger_type: z.string().nullable().optional(),
  schedule_cron: z.string().nullable().optional(),
  is_active: z.boolean().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
})

export const openApi = createAgentGovernanceCrudOpenApi({
  resourceName: 'Playbook',
  pluralName: 'Playbooks',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(playbookListItemSchema),
  create: {
    schema: agentPlaybookCreateSchema,
    description: 'Creates a governance playbook.',
  },
  update: {
    schema: agentPlaybookUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates a governance playbook by id.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Deletes a governance playbook by id.',
  },
})
