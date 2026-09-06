import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { buildIlikeTerm } from '@open-mercato/shared/lib/db/buildIlikeTerm'
import { ProcessInstance } from '../../data/entities'
import {
  processExecutionListQuerySchema,
  processMilestoneReachedSchema,
  processRunTriggeredBySchema,
} from '../../data/validators'
import { readProcessOutcome, type ProcessOutcomeColumns } from '../../lib/tasks/outcome'
import { resolveOutcomeHref } from '../../lib/tasks/outcomeLink'
import {
  createAgentOrchestratorCrudOpenApi,
  createPagedListResponseSchema,
} from '../openapi'

// PascalCases to the MikroORM class `ProcessInstance` → real table
// `process_instances` via ORM metadata (mirrors the proposals route's naming note).
const ENTITY_TYPE = 'agent_orchestrator:process_instance'

// `needs_decision` is status-driven (assignment signals are not emitted by
// workflows yet), and the high-value threshold is a fixed default until it
// becomes a tenant setting.
const NEEDS_DECISION_STATUSES = ['waiting_on_you', 'question_open', 'docs_requested', 'fraud_hold']
const HIGH_VALUE_MINOR = 4_000_000
const STUCK_MS = 24 * 60 * 60 * 1000

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['agent_orchestrator.processes.view'] },
}

export const metadata = routeMetadata

/**
 * The ONE business-execution surface.
 *
 * It replaces the split between a run ledger and a projection list — two reads
 * over the same execution that could disagree about its status. Everything a
 * business reader or an external integrator needs is here: the derived status,
 * the milestones reached, the proposal counters, the outcome, and how the
 * execution was entered.
 *
 * Read-only. Executions are created by `processes.startExecution` and advanced by
 * the workflow engine; there is deliberately no POST/PUT/DELETE.
 */
const crud = makeCrudRoute<never, never, z.infer<typeof processExecutionListQuerySchema>>({
  metadata: routeMetadata,
  orm: {
    entity: ProcessInstance,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
  },
  indexer: { entityType: ENTITY_TYPE },
  list: {
    schema: processExecutionListQuerySchema,
    entityId: ENTITY_TYPE,
    fields: [
      'id',
      'workflow_instance_id',
      'process_definition_id',
      'workflow_id',
      'workflow_version',
      'triggered_by',
      'idempotency_key',
      'source_entity_type',
      'source_entity_id',
      'subject_type',
      'subject_id',
      'subject_label',
      'subject_title',
      'subject_value_minor',
      'subject_fraud',
      'subject_facets',
      'status',
      'current_stage',
      'milestones_reached',
      'agent_ids',
      'cost_minor',
      'currency',
      'run_count',
      'pending_proposal_count',
      'outcome_type',
      'outcome_id',
      'outcome_label',
      'failure_reason',
      'assignee_user_id',
      'team_id',
      'waiting_since',
      'opened_at',
      'completed_at',
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
      completedAt: 'completed_at',
    },
    defaultSort: { field: 'created_at', dir: 'desc' },
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = { $eq: query.id }
      if (query.workflowInstanceId) filters.workflow_instance_id = { $eq: query.workflowInstanceId }
      if (query.processDefinitionId) filters.process_definition_id = { $eq: query.processDefinitionId }
      if (query.status) filters.status = { $eq: query.status }
      if (query.subjectType) filters.subject_type = { $eq: query.subjectType }
      if (query.sourceEntityType) filters.source_entity_type = { $eq: query.sourceEntityType }
      if (query.sourceEntityId) filters.source_entity_id = { $eq: query.sourceEntityId }
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
    /**
     * The outcome's owning module is resolved HERE, server-side: the module
     * registry lives on the server, and the client must never guess a URL for a
     * module that is not part of the deployment. A null href is the honest
     * degraded answer — the client falls back to the label snapshot.
     */
    transformItem: (item: ProcessOutcomeColumns & Record<string, unknown>) => {
      const outcome = readProcessOutcome(item)
      return { ...item, outcome_href: outcome ? resolveOutcomeHref(outcome) : null }
    },
  },
})

export const GET = crud.GET

const executionListItemSchema = z.object({
  id: z.string().uuid(),
  workflow_instance_id: z.string().uuid().nullable().optional(),
  process_definition_id: z.string().uuid().nullable().optional(),
  workflow_id: z.string().nullable().optional(),
  workflow_version: z.string().nullable().optional(),
  triggered_by: processRunTriggeredBySchema.nullable().optional(),
  idempotency_key: z.string().nullable().optional(),
  source_entity_type: z.string().nullable().optional(),
  source_entity_id: z.string().uuid().nullable().optional(),
  subject_type: z.string().nullable().optional(),
  subject_id: z.string().nullable().optional(),
  subject_label: z.string().nullable().optional(),
  subject_title: z.string().nullable().optional(),
  subject_value_minor: z.number().nullable().optional(),
  subject_fraud: z.boolean().nullable().optional(),
  subject_facets: z.unknown().nullable().optional(),
  status: z.string(),
  current_stage: z.string().nullable().optional(),
  milestones_reached: z.array(processMilestoneReachedSchema).nullable().optional(),
  agent_ids: z.array(z.string()).nullable().optional(),
  cost_minor: z.number().nullable().optional(),
  currency: z.string().nullable().optional(),
  run_count: z.number().nullable().optional(),
  pending_proposal_count: z.number().nullable().optional(),
  outcome_type: z.string().nullable().optional(),
  outcome_id: z.string().nullable().optional(),
  outcome_label: z.string().nullable().optional(),
  /** Resolved server-side; null when the owning module is absent from this deployment. */
  outcome_href: z.string().nullable().optional(),
  failure_reason: z.string().nullable().optional(),
  assignee_user_id: z.string().uuid().nullable().optional(),
  team_id: z.string().uuid().nullable().optional(),
  waiting_since: z.string().nullable().optional(),
  opened_at: z.string().nullable().optional(),
  completed_at: z.string().nullable().optional(),
  last_activity_at: z.string().nullable().optional(),
  organization_id: z.string().uuid().nullable().optional(),
  tenant_id: z.string().uuid().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
})

export const openApi = createAgentOrchestratorCrudOpenApi({
  resourceName: 'ProcessExecution',
  pluralName: 'Process executions',
  querySchema: processExecutionListQuerySchema,
  listResponseSchema: createPagedListResponseSchema(executionListItemSchema),
})
