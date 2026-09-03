import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { AgentGuardrailCheck } from '../../data/entities'
import { guardrailCheckListQuerySchema } from '../../data/validators'
import {
  createAgentOrchestratorCrudOpenApi,
  createPagedListResponseSchema,
} from '../openapi'

const ENTITY_TYPE = 'agent_orchestrator:guardrail_check'

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['agent_orchestrator.guardrail.read'] },
}

export const metadata = routeMetadata

const crud = makeCrudRoute<never, never, z.infer<typeof guardrailCheckListQuerySchema>>({
  metadata: routeMetadata,
  orm: {
    entity: AgentGuardrailCheck,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
  },
  indexer: { entityType: ENTITY_TYPE },
  list: {
    schema: guardrailCheckListQuerySchema,
    entityId: ENTITY_TYPE,
    fields: [
      'id',
      'agent_run_id',
      'proposal_id',
      'guardrail_set_version',
      'capability',
      'phase',
      'kind',
      'result',
      'evidence',
      'organization_id',
      'tenant_id',
      'created_at',
    ],
    sortFieldMap: {
      capability: 'capability',
      phase: 'phase',
      kind: 'kind',
      result: 'result',
      createdAt: 'created_at',
    },
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = { $eq: query.id }
      if (query.agentRunId) filters.agent_run_id = { $eq: query.agentRunId }
      if (query.proposalId) filters.proposal_id = { $eq: query.proposalId }
      if (query.phase) filters.phase = { $eq: query.phase }
      if (query.kind) filters.kind = { $eq: query.kind }
      if (query.result) filters.result = { $eq: query.result }
      return filters
    },
  },
})

export const GET = crud.GET

const guardrailCheckListItemSchema = z.object({
  id: z.string().uuid(),
  agent_run_id: z.string().uuid(),
  proposal_id: z.string().uuid().nullable().optional(),
  guardrail_set_version: z.string(),
  capability: z.string(),
  phase: z.string(),
  kind: z.string(),
  result: z.string(),
  evidence: z.unknown().nullable().optional(),
  organization_id: z.string().uuid().nullable().optional(),
  tenant_id: z.string().uuid().nullable().optional(),
  created_at: z.string().nullable().optional(),
})

export const openApi = createAgentOrchestratorCrudOpenApi({
  resourceName: 'Guardrail Check',
  pluralName: 'Guardrail Checks',
  querySchema: guardrailCheckListQuerySchema,
  listResponseSchema: createPagedListResponseSchema(guardrailCheckListItemSchema),
})
