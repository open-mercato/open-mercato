import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { buildIlikeTerm } from '@open-mercato/shared/lib/db/buildIlikeTerm'
import { AgentProcess } from '../../data/entities'
import { processListQuerySchema } from '../../data/validators'
import {
  createAgentOrchestratorCrudOpenApi,
  createPagedListResponseSchema,
} from '../openapi'

// PascalCases to the MikroORM class `AgentProcess` → real table `agent_processes`
// via ORM metadata (mirrors the proposals route's naming note).
const ENTITY_TYPE = 'agent_orchestrator:agent_process'

// Pre-Phase-B degradations (spec 2026-06-25): `needs_decision` is status-driven
// (assignment signals are not emitted by workflows yet), and the high-value
// threshold is a fixed default until it becomes a tenant setting.
const NEEDS_DECISION_STATUSES = ['waiting_on_you', 'question_open', 'docs_requested', 'fraud_hold']
const HIGH_VALUE_MINOR = 4_000_000
const STUCK_MS = 24 * 60 * 60 * 1000

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['agent_orchestrator.processes.view'] },
}

export const metadata = routeMetadata

const crud = makeCrudRoute<never, never, z.infer<typeof processListQuerySchema>>({
  metadata: routeMetadata,
  orm: {
    entity: AgentProcess,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
  },
  indexer: { entityType: ENTITY_TYPE },
  list: {
    schema: processListQuerySchema,
    entityId: ENTITY_TYPE,
    fields: [
      'id',
      'process_id',
      'workflow_id',
      'workflow_version',
      'subject_type',
      'subject_id',
      'subject_label',
      'subject_title',
      'subject_value_minor',
      'subject_fraud',
      'subject_facets',
      'status',
      'current_stage',
      'agent_ids',
      'cost_minor',
      'currency',
      'run_count',
      'pending_proposal_count',
      'assignee_user_id',
      'team_id',
      'waiting_since',
      'opened_at',
      'last_activity_at',
      'organization_id',
      'tenant_id',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      age: 'opened_at',
      openedAt: 'opened_at',
      cost: 'cost_minor',
      value: 'subject_value_minor',
      lastActivity: 'last_activity_at',
      status: 'status',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    defaultSort: { field: 'created_at', dir: 'desc' },
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = { $eq: query.id }
      if (query.processId) filters.process_id = { $eq: query.processId }
      if (query.status) filters.status = { $eq: query.status }
      if (query.subjectType) filters.subject_type = { $eq: query.subjectType }
      if (query.q) filters.subject_label = { $ilike: buildIlikeTerm(query.q.trim()) }
      switch (query.scope) {
        case 'needs_decision':
          filters.status = { $in: NEEDS_DECISION_STATUSES }
          break
        case 'stuck_24h':
          filters.waiting_since = { $lte: new Date(Date.now() - STUCK_MS).toISOString() }
          break
        case 'high_value':
          filters.subject_value_minor = { $gte: HIGH_VALUE_MINOR }
          break
        case 'fraud_flagged':
          filters.subject_fraud = { $eq: true }
          break
        default:
          break
      }
      return filters
    },
  },
})

export const GET = crud.GET

const processListItemSchema = z.object({
  id: z.string().uuid(),
  process_id: z.string().uuid(),
  workflow_id: z.string().nullable().optional(),
  workflow_version: z.string().nullable().optional(),
  subject_type: z.string().nullable().optional(),
  subject_id: z.string().nullable().optional(),
  subject_label: z.string().nullable().optional(),
  subject_title: z.string().nullable().optional(),
  subject_value_minor: z.number().nullable().optional(),
  subject_fraud: z.boolean().nullable().optional(),
  subject_facets: z.unknown().nullable().optional(),
  status: z.string(),
  current_stage: z.string().nullable().optional(),
  agent_ids: z.array(z.string()).nullable().optional(),
  cost_minor: z.number().nullable().optional(),
  currency: z.string().nullable().optional(),
  run_count: z.number().nullable().optional(),
  pending_proposal_count: z.number().nullable().optional(),
  assignee_user_id: z.string().uuid().nullable().optional(),
  team_id: z.string().uuid().nullable().optional(),
  waiting_since: z.string().nullable().optional(),
  opened_at: z.string().nullable().optional(),
  last_activity_at: z.string().nullable().optional(),
  organization_id: z.string().uuid().nullable().optional(),
  tenant_id: z.string().uuid().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
})

export const openApi = createAgentOrchestratorCrudOpenApi({
  resourceName: 'Process',
  pluralName: 'Processes',
  querySchema: processListQuerySchema,
  listResponseSchema: createPagedListResponseSchema(processListItemSchema),
})
