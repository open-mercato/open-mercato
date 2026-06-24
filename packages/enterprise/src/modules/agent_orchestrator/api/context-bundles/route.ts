import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { AgentContextBundle } from '../../data/entities'
import { contextBundleListQuerySchema } from '../../data/validators'
import {
  createAgentOrchestratorCrudOpenApi,
  createPagedListResponseSchema,
} from '../openapi'

const ENTITY_TYPE = 'agent_orchestrator:context_bundle'

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['agent_orchestrator.context.read'] },
}

export const metadata = routeMetadata

const crud = makeCrudRoute<never, never, z.infer<typeof contextBundleListQuerySchema>>({
  metadata: routeMetadata,
  orm: {
    entity: AgentContextBundle,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
  },
  indexer: { entityType: ENTITY_TYPE },
  list: {
    schema: contextBundleListQuerySchema,
    entityId: ENTITY_TYPE,
    fields: [
      'id',
      'agent_run_id',
      'process_id',
      'step_id',
      'capability',
      'routed_sources',
      'pruned_sources',
      'sources',
      'token_budget',
      'tokens_used',
      'redaction_applied',
      'payload_ref',
      'organization_id',
      'tenant_id',
      'created_at',
    ],
    sortFieldMap: {
      capability: 'capability',
      tokenBudget: 'token_budget',
      tokensUsed: 'tokens_used',
      createdAt: 'created_at',
    },
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = { $eq: query.id }
      if (query.agentRunId) filters.agent_run_id = { $eq: query.agentRunId }
      if (query.processId) filters.process_id = { $eq: query.processId }
      if (query.capability) filters.capability = { $eq: query.capability }
      return filters
    },
  },
})

export const GET = crud.GET

const contextBundleListItemSchema = z.object({
  id: z.string().uuid(),
  agent_run_id: z.string().uuid(),
  process_id: z.string().uuid().nullable().optional(),
  step_id: z.string().nullable().optional(),
  capability: z.string(),
  routed_sources: z.unknown(),
  pruned_sources: z.unknown().nullable().optional(),
  sources: z.unknown(),
  token_budget: z.number(),
  tokens_used: z.number(),
  redaction_applied: z.unknown().nullable().optional(),
  payload_ref: z.string().nullable().optional(),
  organization_id: z.string().uuid().nullable().optional(),
  tenant_id: z.string().uuid().nullable().optional(),
  created_at: z.string().nullable().optional(),
})

export const openApi = createAgentOrchestratorCrudOpenApi({
  resourceName: 'Context Bundle',
  pluralName: 'Context Bundles',
  querySchema: contextBundleListQuerySchema,
  listResponseSchema: createPagedListResponseSchema(contextBundleListItemSchema),
})
