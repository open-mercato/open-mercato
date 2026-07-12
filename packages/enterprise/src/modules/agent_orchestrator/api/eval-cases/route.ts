import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { AgentEvalCase } from '../../data/entities'
import { evalCaseListQuerySchema } from '../../data/validators'
import {
  createAgentOrchestratorCrudOpenApi,
  createPagedListResponseSchema,
} from '../openapi'

const ENTITY_TYPE = 'agent_orchestrator:agent_eval_case'

/**
 * Metadata-only projection: the encrypted `input`/`expected` (and `assertions`)
 * columns are deliberately NOT selected, so this route needs no decryption path
 * and can never leak case payloads. Payload access stays with the export route.
 */
export const EVAL_CASE_LIST_FIELDS = [
  'id',
  'status',
  'source_type',
  'source_id',
  'agent_definition_id',
  'created_at',
  'updated_at',
] as const

export function buildEvalCaseListFilters(
  query: z.infer<typeof evalCaseListQuerySchema>,
): Record<string, unknown> {
  const filters: Record<string, unknown> = {}
  if (query.status) filters.status = { $eq: query.status }
  if (query.agentDefinitionId) filters.agent_definition_id = { $eq: query.agentDefinitionId }
  if (query.sourceType) filters.source_type = { $eq: query.sourceType }
  return filters
}

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['agent_orchestrator.eval.manage'] },
}

export const metadata = routeMetadata

const crud = makeCrudRoute<never, never, z.infer<typeof evalCaseListQuerySchema>>({
  metadata: routeMetadata,
  orm: {
    entity: AgentEvalCase,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
  },
  indexer: { entityType: ENTITY_TYPE },
  list: {
    schema: evalCaseListQuerySchema,
    entityId: ENTITY_TYPE,
    fields: [...EVAL_CASE_LIST_FIELDS],
    sortFieldMap: {
      status: 'status',
      agent: 'agent_definition_id',
      sourceType: 'source_type',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    defaultSort: { field: 'created_at', dir: 'desc' },
    buildFilters: async (query) => buildEvalCaseListFilters(query),
  },
})

export const GET = crud.GET

const evalCaseListItemSchema = z.object({
  id: z.string().uuid(),
  status: z.string(),
  source_type: z.string(),
  source_id: z.string().uuid(),
  agent_definition_id: z.string(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
})

export const openApi = createAgentOrchestratorCrudOpenApi({
  resourceName: 'Eval case',
  pluralName: 'Eval cases',
  querySchema: evalCaseListQuerySchema,
  listResponseSchema: createPagedListResponseSchema(evalCaseListItemSchema),
})
