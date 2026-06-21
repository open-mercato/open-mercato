import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { AgentRun } from '../../data/entities'
import { runListQuerySchema } from '../../data/validators'
import {
  createAgentOrchestratorCrudOpenApi,
  createPagedListResponseSchema,
} from '../openapi'

const ENTITY_TYPE = 'agent_orchestrator:agent_run'

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['agent_orchestrator.agents.view'] },
}

export const metadata = routeMetadata

const crud = makeCrudRoute<never, never, z.infer<typeof runListQuerySchema>>({
  metadata: routeMetadata,
  orm: {
    entity: AgentRun,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
  },
  indexer: { entityType: ENTITY_TYPE },
  list: {
    schema: runListQuerySchema,
    entityId: ENTITY_TYPE,
    fields: [
      'id',
      'agent_id',
      'status',
      'result_kind',
      'input',
      'output',
      'error_message',
      'organization_id',
      'tenant_id',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      agentId: 'agent_id',
      status: 'status',
      resultKind: 'result_kind',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = { $eq: query.id }
      if (query.agentId) filters.agent_id = { $eq: query.agentId }
      if (query.status) filters.status = { $eq: query.status }
      if (query.resultKind) filters.result_kind = { $eq: query.resultKind }
      return filters
    },
  },
})

export const GET = crud.GET

const runListItemSchema = z.object({
  id: z.string().uuid(),
  agent_id: z.string(),
  status: z.string().nullable().optional(),
  result_kind: z.string().nullable().optional(),
  error_message: z.string().nullable().optional(),
  organization_id: z.string().uuid().nullable().optional(),
  tenant_id: z.string().uuid().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
})

export const openApi = createAgentOrchestratorCrudOpenApi({
  resourceName: 'Run',
  pluralName: 'Runs',
  querySchema: runListQuerySchema,
  listResponseSchema: createPagedListResponseSchema(runListItemSchema),
})
