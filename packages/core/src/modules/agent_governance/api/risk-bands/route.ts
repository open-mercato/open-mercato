import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { parseScopedCommandInput, resolveCrudRecordId } from '@open-mercato/shared/lib/api/scoped'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { AgentGovernanceRiskBand } from '../../data/entities'
import { agentRiskBandCreateSchema, agentRiskBandUpdateSchema } from '../../data/validators'
import { createAgentGovernanceCrudOpenApi, createPagedListResponseSchema, defaultOkResponseSchema } from '../openapi'

const rawBodySchema = z.object({}).passthrough()

const listSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  ids: z.string().optional(),
  search: z.string().optional(),
  riskLevel: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  sortField: z.enum(['name', 'createdAt', 'updatedAt']).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
}).passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['agent_governance.view'] },
  POST: { requireAuth: true, requireFeatures: ['agent_governance.risk_bands.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['agent_governance.risk_bands.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['agent_governance.risk_bands.manage'] },
}

export const metadata = routeMetadata

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: AgentGovernanceRiskBand,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: 'agent_governance:agent_governance_risk_band' },
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
      if (query.riskLevel) {
        filters.riskLevel = query.riskLevel
      }
      return filters
    },
  },
  actions: {
    create: {
      commandId: 'agent_governance.risk_bands.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(agentRiskBandCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.riskBandId ?? null }),
      status: 201,
    },
    update: {
      commandId: 'agent_governance.risk_bands.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(agentRiskBandUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'agent_governance.risk_bands.delete',
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

const riskBandListItemSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  tenant_id: z.string().uuid().nullable().optional(),
  organization_id: z.string().uuid().nullable().optional(),
  name: z.string().nullable().optional(),
  risk_level: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  requires_approval: z.boolean().nullable().optional(),
  fail_closed: z.boolean().nullable().optional(),
  is_default: z.boolean().nullable().optional(),
  min_score: z.number().nullable().optional(),
  max_score: z.number().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
})

export const openApi = createAgentGovernanceCrudOpenApi({
  resourceName: 'Risk Band',
  pluralName: 'Risk Bands',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(riskBandListItemSchema),
  create: {
    schema: agentRiskBandCreateSchema,
    description: 'Creates a risk band definition.',
  },
  update: {
    schema: agentRiskBandUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates a risk band by id.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Deletes a risk band by id.',
  },
})
