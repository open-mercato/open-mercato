import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { AgentTaskRun } from '../../data/entities'
import { agentTaskRunListQuerySchema } from '../../data/validators'
import {
  createAgentOrchestratorCrudOpenApi,
  createPagedListResponseSchema,
} from '../openapi'

const ENTITY_TYPE = 'agent_orchestrator:agent_task_run'

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['agent_orchestrator.tasks.view'] },
}

export const metadata = routeMetadata

/**
 * Read-only run-history ledger (the Zapier-style flat index over both target
 * types). Writes happen only through the enqueueRun command and the executor
 * worker — there is deliberately no POST/PUT/DELETE here.
 */
const crud = makeCrudRoute<never, never, z.infer<typeof agentTaskRunListQuerySchema>>({
  metadata: routeMetadata,
  orm: {
    entity: AgentTaskRun,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
  },
  indexer: { entityType: ENTITY_TYPE },
  list: {
    schema: agentTaskRunListQuerySchema,
    entityId: ENTITY_TYPE,
    defaultSort: { field: 'created_at', dir: 'desc' },
    fields: [
      'id',
      'task_definition_id',
      'target_type',
      'target_agent_id',
      'target_workflow_id',
      'status',
      'agent_run_id',
      'workflow_instance_id',
      'source_entity_type',
      'source_entity_id',
      'triggered_by',
      'started_at',
      'completed_at',
      'failure_reason',
      'organization_id',
      'tenant_id',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      status: 'status',
      targetType: 'target_type',
      createdAt: 'created_at',
      completedAt: 'completed_at',
    },
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = { $eq: query.id }
      if (query.taskDefinitionId) filters.task_definition_id = { $eq: query.taskDefinitionId }
      if (query.status) filters.status = { $eq: query.status }
      if (query.sourceEntityType) filters.source_entity_type = { $eq: query.sourceEntityType }
      if (query.sourceEntityId) filters.source_entity_id = { $eq: query.sourceEntityId }
      return filters
    },
  },
})

export const GET = crud.GET

const taskRunListItemSchema = z.object({
  id: z.string().uuid(),
  task_definition_id: z.string().uuid(),
  target_type: z.string(),
  target_agent_id: z.string().nullable().optional(),
  target_workflow_id: z.string().nullable().optional(),
  status: z.string(),
  agent_run_id: z.string().uuid().nullable().optional(),
  workflow_instance_id: z.string().uuid().nullable().optional(),
  source_entity_type: z.string().nullable().optional(),
  source_entity_id: z.string().uuid().nullable().optional(),
  triggered_by: z.string(),
  started_at: z.string().nullable().optional(),
  completed_at: z.string().nullable().optional(),
  failure_reason: z.string().nullable().optional(),
  organization_id: z.string().uuid().nullable().optional(),
  tenant_id: z.string().uuid().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
})

export const openApi = createAgentOrchestratorCrudOpenApi({
  resourceName: 'AgentTaskRun',
  pluralName: 'Agentic task runs',
  querySchema: agentTaskRunListQuerySchema,
  listResponseSchema: createPagedListResponseSchema(taskRunListItemSchema),
})
