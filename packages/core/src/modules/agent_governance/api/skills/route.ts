import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { parseScopedCommandInput, resolveCrudRecordId } from '@open-mercato/shared/lib/api/scoped'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { AgentGovernanceSkill } from '../../data/entities'
import { agentSkillCreateSchema, agentSkillUpdateSchema } from '../../data/validators'
import {
  createAgentGovernanceCrudOpenApi,
  createPagedListResponseSchema,
  defaultOkResponseSchema,
} from '../openapi'

const rawBodySchema = z.object({}).passthrough()

const listSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  ids: z.string().optional(),
  search: z.string().optional(),
  status: z.enum(['draft', 'validated', 'active', 'deprecated']).optional(),
  sourceType: z.enum(['interview', 'trace_mining', 'hybrid']).optional(),
  sortField: z.enum(['name', 'status', 'createdAt', 'updatedAt']).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
}).passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['agent_governance.view'] },
  POST: { requireAuth: true, requireFeatures: ['agent_governance.skills.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['agent_governance.skills.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['agent_governance.skills.manage'] },
}

export const metadata = routeMetadata

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: AgentGovernanceSkill,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: 'agent_governance:agent_governance_skill' },
  list: {
    schema: listSchema,
    sortFieldMap: {
      name: 'name',
      status: 'status',
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
      if (query.status) filters.status = query.status
      if (query.sourceType) filters.sourceType = query.sourceType
      if (typeof query.search === 'string' && query.search.trim().length > 0) {
        const pattern = `%${escapeLikePattern(query.search.trim())}%`
        filters.$or = [{ name: { $ilike: pattern } }, { description: { $ilike: pattern } }]
      }
      return filters
    },
  },
  actions: {
    create: {
      commandId: 'agent_governance.skills.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(agentSkillCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.skillId ?? null }),
      status: 201,
    },
    update: {
      commandId: 'agent_governance.skills.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(agentSkillUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'agent_governance.skills.delete',
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

const skillListItemSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  tenant_id: z.string().uuid().nullable().optional(),
  organization_id: z.string().uuid().nullable().optional(),
  name: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  source_type: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
})

export const openApi = createAgentGovernanceCrudOpenApi({
  resourceName: 'Skill',
  pluralName: 'Skills',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(skillListItemSchema),
  create: {
    schema: agentSkillCreateSchema,
    description: 'Creates an agent skill.',
  },
  update: {
    schema: agentSkillUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates an agent skill by id.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Deletes an agent skill by id.',
  },
})
