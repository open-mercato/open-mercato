import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { AgentProposal } from '../../data/entities'
import { proposalListQuerySchema } from '../../data/validators'
import {
  createAgentOrchestratorCrudOpenApi,
  createPagedListResponseSchema,
} from '../openapi'

// The entity-part must PascalCase to the MikroORM class name (`AgentProposal`)
// so the query engine resolves it to the real table `agent_proposals` via ORM
// metadata. `agent_orchestrator:proposal` would PascalCase to `Proposal` (no
// such class) and fall back to pluralizing → `proposals` (does not exist).
// Mirrors the runs route's `agent_orchestrator:agent_run` → `AgentRun`.
const ENTITY_TYPE = 'agent_orchestrator:agent_proposal'

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
      'guard_results',
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
      confidence: 'confidence',
      disposition: 'disposition',
      processId: 'process_id',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    defaultSort: { field: 'created_at', dir: 'desc' },
    buildFilters: async (query) => {
      // The query engine auto-excludes soft-deleted rows (`deleted_at IS NULL`)
      // in its base scope, so we do NOT add an explicit `deleted_at` filter here.
      // The hybrid engine compiles `{ $eq: null }` to `deleted_at = NULL` (never
      // true in SQL), which silently returns zero rows — see engine applyColumnFilter.
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = { $eq: query.id }
      if (query.agentId) filters.agent_id = { $eq: query.agentId }
      if (query.processId) filters.process_id = { $eq: query.processId }
      if (query.disposition) {
        const dispositions = query.disposition.split(',')
        filters.disposition = dispositions.length > 1 ? { $in: dispositions } : { $eq: dispositions[0] }
      }
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
