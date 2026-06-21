import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { AgentProposal } from '../../data/entities'
import { proposalListQuerySchema } from '../../data/validators'
import {
  createAgentOrchestratorCrudOpenApi,
  createPagedListResponseSchema,
} from '../openapi'

const ENTITY_TYPE = 'agent_orchestrator:proposal'

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['agent_orchestrator.proposals.view'] },
}

export const metadata = routeMetadata

const crud = makeCrudRoute<never, never, z.infer<typeof proposalListQuerySchema>>({
  metadata: routeMetadata,
  orm: {
    entity: AgentProposal,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
  },
  indexer: { entityType: ENTITY_TYPE },
  list: {
    schema: proposalListQuerySchema,
    entityId: ENTITY_TYPE,
    fields: [
      'id',
      'agent_id',
      'run_id',
      'process_id',
      'step_id',
      'payload',
      'confidence',
      'disposition',
      'disposition_by',
      'disposition_reason',
      'organization_id',
      'tenant_id',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      agentId: 'agent_id',
      disposition: 'disposition',
      processId: 'process_id',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = { deleted_at: { $eq: null } }
      if (query.id) filters.id = { $eq: query.id }
      if (query.agentId) filters.agent_id = { $eq: query.agentId }
      if (query.processId) filters.process_id = { $eq: query.processId }
      if (query.disposition) filters.disposition = { $eq: query.disposition }
      return filters
    },
  },
})

export const GET = crud.GET

const proposalListItemSchema = z.object({
  id: z.string().uuid(),
  agent_id: z.string(),
  run_id: z.string().uuid(),
  process_id: z.string().uuid().nullable().optional(),
  step_id: z.string().nullable().optional(),
  payload: z.unknown(),
  confidence: z.number().nullable().optional(),
  disposition: z.string(),
  disposition_by: z.string().nullable().optional(),
  disposition_reason: z.string().nullable().optional(),
  organization_id: z.string().uuid().nullable().optional(),
  tenant_id: z.string().uuid().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
})

export const openApi = createAgentOrchestratorCrudOpenApi({
  resourceName: 'Proposal',
  pluralName: 'Proposals',
  querySchema: proposalListQuerySchema,
  listResponseSchema: createPagedListResponseSchema(proposalListItemSchema),
})
