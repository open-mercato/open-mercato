import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { AgentEvalCase } from '../../data/entities'
import {
  evalCaseCreateSchema,
  evalCaseListQuerySchema,
  evalCaseUpdateSchema,
  type EvalCaseCreateInput,
  type EvalCaseUpdateInput,
} from '../../data/validators'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
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
  POST: { requireAuth: true, requireFeatures: ['agent_orchestrator.eval.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['agent_orchestrator.eval.manage'] },
}

export const metadata = routeMetadata

const crud = makeCrudRoute<EvalCaseCreateInput, EvalCaseUpdateInput, z.infer<typeof evalCaseListQuerySchema>>({
  metadata: routeMetadata,
  orm: {
    entity: AgentEvalCase,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
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
  create: {
    schema: evalCaseCreateSchema,
    mapToEntity: (input, ctx) => {
      const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
      const tenantId = ctx.auth?.tenantId ?? null
      if (!organizationId || !tenantId) {
        throw new CrudHttpError(400, { error: '[internal] organization and tenant context required' })
      }
      return {
        tenantId,
        organizationId,
        // A hand-authored case is a golden run whose source IS itself: there is no
        // originating correction or production run to point at.
        sourceType: 'golden_run' as const,
        sourceId: randomUUID(),
        agentDefinitionId: input.agentDefinitionId,
        processType: input.processType ?? null,
        input: input.input ?? null,
        expected: input.expected ?? null,
        assertions: input.assertions ?? null,
        // Authored cases still require review before they can gate anything.
        status: 'draft' as const,
      }
    },
    response: (entity) => ({ id: String((entity as { id: string }).id) }),
  },
  update: {
    schema: evalCaseUpdateSchema,
    getId: (input) => input.id,
    applyToEntity: (entity, input) => {
      const row = entity as AgentEvalCase
      const contentChanged =
        (input.agentDefinitionId !== undefined && input.agentDefinitionId !== row.agentDefinitionId) ||
        (input.input !== undefined && JSON.stringify(input.input ?? null) !== JSON.stringify(row.input ?? null)) ||
        (input.expected !== undefined && JSON.stringify(input.expected ?? null) !== JSON.stringify(row.expected ?? null)) ||
        (input.assertions !== undefined && JSON.stringify(input.assertions ?? null) !== JSON.stringify(row.assertions ?? null))

      if (input.agentDefinitionId !== undefined) row.agentDefinitionId = input.agentDefinitionId
      if (input.processType !== undefined) row.processType = input.processType ?? null
      if (input.input !== undefined) row.input = input.input ?? null
      if (input.expected !== undefined) row.expected = input.expected ?? null
      if (input.assertions !== undefined) row.assertions = input.assertions ?? null

      // Rewriting what an APPROVED case asserts demotes it back to draft. Without
      // this, someone whose change is failing the gate could edit the blocking
      // case's `expected` to match the new behaviour — the row would stay
      // `approved`, keep the original reviewer's `approvedByUserId`, and remain
      // eligible for the next gate run. Metadata-only edits do not demote.
      if (contentChanged && row.status === 'approved') {
        row.status = 'draft'
        row.approvedByUserId = null
      }
    },
    response: (entity) => {
      const updatedAt = (entity as AgentEvalCase).updatedAt
      return { ok: true, updatedAt: updatedAt instanceof Date ? updatedAt.toISOString() : null }
    },
  },
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT

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
