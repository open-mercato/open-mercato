import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { AgentRun } from '../../data/entities'
import { runIdPrefixRange, runListQuerySchema } from '../../data/validators'
import {
  createAgentOrchestratorCrudOpenApi,
  createPagedListResponseSchema,
} from '../openapi'

const ENTITY_TYPE = 'agent_orchestrator:agent_run'

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['agent_orchestrator.trace.view'] },
}

export const metadata = routeMetadata

const LOW_CONFIDENCE_THRESHOLD = 0.5
const WINDOW_MS: Record<string, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
}

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
      'runtime',
      'external_run_id',
      'model',
      'confidence',
      'eval_score',
      'eval_passed',
      'latency_ms',
      'cost_minor',
      'currency',
      'input_tokens',
      'output_tokens',
      'process_id',
      'proposal_id',
      'human_confirmed_at',
      'organization_id',
      'tenant_id',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      agentId: 'agent_id',
      status: 'status',
      resultKind: 'result_kind',
      confidence: 'confidence',
      latencyMs: 'latency_ms',
      costMinor: 'cost_minor',
      evalScore: 'eval_score',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    defaultSort: { field: 'created_at', dir: 'desc' },
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = { $eq: query.id }
      else if (query.idPrefix) {
        // Prefix search as an inclusive uuid range — `ilike` on a uuid column
        // errors in Postgres, while uuid ordering is bytewise (= hex order).
        const range = runIdPrefixRange(query.idPrefix)
        if (range) filters.id = { $gte: range.from, $lte: range.to }
      }
      if (query.agentId) filters.agent_id = { $eq: query.agentId }
      if (query.status) filters.status = { $eq: query.status }
      if (query.resultKind) filters.result_kind = { $eq: query.resultKind }
      if (query.flagged) filters.flagged_at = { $ne: null }
      if (query.window && WINDOW_MS[query.window]) {
        filters.created_at = { $gte: new Date(Date.now() - WINDOW_MS[query.window]).toISOString() }
      }
      // 'overridden' joins on AgentCorrection, which lands in PR2; until then only
      // the self-contained facets are honored.
      if (query.filter === 'eval-fail') filters.eval_passed = { $eq: false }
      else if (query.filter === 'low-confidence') filters.confidence = { $lt: LOW_CONFIDENCE_THRESHOLD }
      else if (query.filter === 'needs-review') {
        // The traces-list union facet: failed eval OR low confidence.
        filters.$or = [
          { eval_passed: { $eq: false } },
          { confidence: { $lt: LOW_CONFIDENCE_THRESHOLD } },
        ]
      }
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
  runtime: z.string().nullable().optional(),
  external_run_id: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  confidence: z.number().nullable().optional(),
  eval_score: z.number().nullable().optional(),
  eval_passed: z.boolean().nullable().optional(),
  latency_ms: z.number().nullable().optional(),
  cost_minor: z.number().nullable().optional(),
  currency: z.string().nullable().optional(),
  input_tokens: z.number().nullable().optional(),
  output_tokens: z.number().nullable().optional(),
  process_id: z.string().uuid().nullable().optional(),
  proposal_id: z.string().uuid().nullable().optional(),
  human_confirmed_at: z.string().nullable().optional(),
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
