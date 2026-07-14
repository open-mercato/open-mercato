import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import type { CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { AgentTaskDefinition } from '../../data/entities'
import {
  agentTaskDefinitionCreateSchema,
  agentTaskDefinitionListQuerySchema,
  agentTaskDefinitionUpdateSchema,
  type AgentTaskDefinitionCreateInput,
  type AgentTaskDefinitionUpdateInput,
} from '../../data/validators'
import { emitAgentOrchestratorEvent } from '../../events'
import { provisionTaskExecutionPrincipal } from '../../lib/tasks/executionPrincipal'
import { syncTaskSchedule } from '../../lib/tasks/schedule'
import { withScheduleSemanticChecks } from '../../lib/tasks/scheduleValidation'
import {
  createAgentOrchestratorCrudOpenApi,
  createPagedListResponseSchema,
  defaultCreateResponseSchema,
  defaultOkResponseSchema,
} from '../openapi'

const ENTITY_TYPE = 'agent_orchestrator:agent_task_definition'

// Route-layer semantic schedule validation (real cron parse via the scheduler)
// on top of the client-safe shape schemas — see lib/tasks/scheduleValidation.ts.
const createSchemaWithSemantics = withScheduleSemanticChecks(agentTaskDefinitionCreateSchema)
const updateSchemaWithSemantics = withScheduleSemanticChecks(agentTaskDefinitionUpdateSchema)

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['agent_orchestrator.tasks.view'] },
  POST: { requireAuth: true, requireFeatures: ['agent_orchestrator.tasks.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['agent_orchestrator.tasks.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['agent_orchestrator.tasks.manage'] },
}

export const metadata = routeMetadata

function requireScope(ctx: CrudCtx): { tenantId: string; organizationId: string } {
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  const tenantId = ctx.auth?.tenantId ?? null
  if (!organizationId || !tenantId) {
    throw new CrudHttpError(400, { error: '[internal] organization and tenant context required' })
  }
  return { tenantId, organizationId }
}

/**
 * Provision (or re-scope) the task's dedicated execution principal, then sync
 * the cron schedule. Runs after create AND after update — both operations are
 * idempotent, which makes a previously failed sync self-healing on the next
 * edit (spec risk register).
 */
async function syncPrincipalAndSchedule(entity: AgentTaskDefinition, ctx: CrudCtx): Promise<void> {
  const scope = { tenantId: entity.tenantId, organizationId: entity.organizationId }
  const resolved = await provisionTaskExecutionPrincipal(ctx.container, scope, {
    taskDefinitionId: entity.id,
    displayName: `Task: ${entity.name}`,
    grantedFeatures: entity.grantedFeatures ?? [],
  })
  if (entity.executionPrincipalId !== resolved.principal.id) {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const row = await em.findOne(AgentTaskDefinition, { id: entity.id })
    if (row) {
      row.executionPrincipalId = resolved.principal.id
      await em.flush()
    }
    entity.executionPrincipalId = resolved.principal.id
  }
  await syncTaskSchedule(ctx.container, entity)
}

/**
 * Attach a `last_run: { status, finished_at } | null` projection to each list
 * item — one grouped query (`distinct on (task_definition_id)`, newest by
 * created_at) over the page's ids, tenant/org-scoped. Read-only enrichment for
 * the tasks list's Last-run health column; no schema change (UX consistency
 * pass, Area 1).
 */
export async function attachLastRunProjection(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  items: Array<Record<string, unknown>>,
): Promise<void> {
  const ids = items
    .map((item) => (typeof item.id === 'string' ? item.id : null))
    .filter((id): id is string => !!id)
  if (ids.length === 0) return
  // Scalar placeholders only — an array binding through the ORM's raw-execute
  // layer gets expanded per element, so `= any(?)` reaches Postgres as a bare
  // uuid where an array literal is expected ("malformed array literal").
  const idPlaceholders = ids.map(() => '?').join(', ')
  let rows: Array<{ task_definition_id: string; status: string; completed_at: Date | string | null }> = []
  try {
    rows = (await em.getConnection().execute(
      `select distinct on (task_definition_id)
         task_definition_id, status, completed_at
       from agent_task_runs
       where task_definition_id in (${idPlaceholders}) and tenant_id = ? and organization_id = ?
       order by task_definition_id, created_at desc`,
      [...ids, scope.tenantId, scope.organizationId],
    )) as Array<{ task_definition_id: string; status: string; completed_at: Date | string | null }>
  } catch (err) {
    // The Last-run column is a cosmetic enrichment — it must never take the
    // whole task list down. Fail soft: log and render the list without it.
    console.warn('[internal] agentic-tasks last-run projection failed:', err)
    rows = []
  }
  const byDefinition = new Map(rows.map((row) => [row.task_definition_id, row]))
  for (const item of items) {
    const row = typeof item.id === 'string' ? byDefinition.get(item.id) : undefined
    item.last_run = row
      ? {
          status: row.status,
          finished_at:
            row.completed_at instanceof Date
              ? row.completed_at.toISOString()
              : row.completed_at ?? null,
        }
      : null
  }
}

const crud = makeCrudRoute<
  AgentTaskDefinitionCreateInput,
  AgentTaskDefinitionUpdateInput,
  z.infer<typeof agentTaskDefinitionListQuerySchema>
>({
  metadata: routeMetadata,
  orm: {
    entity: AgentTaskDefinition,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: ENTITY_TYPE },
  list: {
    schema: agentTaskDefinitionListQuerySchema,
    entityId: ENTITY_TYPE,
    defaultSort: { field: 'created_at', dir: 'desc' },
    fields: [
      'id',
      'name',
      'description',
      'target_type',
      'target_agent_id',
      'target_workflow_id',
      'input_defaults',
      'input_schema',
      'execution_principal_id',
      'granted_features',
      'schedule_cron',
      'schedule_timezone',
      'schedule_enabled',
      'enabled',
      'organization_id',
      'tenant_id',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      name: 'name',
      targetType: 'target_type',
      enabled: 'enabled',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = { $eq: query.id }
      if (query.targetType) filters.target_type = { $eq: query.targetType }
      if (typeof query.enabled === 'boolean') filters.enabled = { $eq: query.enabled }
      return filters
    },
  },
  create: {
    schema: createSchemaWithSemantics,
    mapToEntity: (input, ctx) => {
      const scope = requireScope(ctx)
      return {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        name: input.name,
        description: input.description ?? null,
        targetType: input.targetType,
        targetAgentId: input.targetType === 'agent' ? input.targetAgentId ?? null : null,
        targetWorkflowId: input.targetType === 'workflow' ? input.targetWorkflowId ?? null : null,
        inputDefaults: input.inputDefaults ?? null,
        inputSchema: input.inputSchema ?? null,
        grantedFeatures: input.grantedFeatures ?? [],
        scheduleCron: input.scheduleCron ?? null,
        scheduleTimezone: input.scheduleTimezone ?? null,
        scheduleEnabled: input.scheduleEnabled ?? true,
        enabled: input.enabled ?? true,
        createdBy: ctx.auth?.sub ?? null,
      }
    },
    response: (entity) => ({ id: String((entity as { id: string }).id) }),
  },
  update: {
    schema: updateSchemaWithSemantics,
    getId: (input) => input.id,
    applyToEntity: (entity, input) => {
      const row = entity as AgentTaskDefinition
      if (input.name !== undefined) row.name = input.name
      if (input.description !== undefined) row.description = input.description ?? null
      if (input.targetType !== undefined) row.targetType = input.targetType
      if (input.targetAgentId !== undefined) row.targetAgentId = input.targetAgentId ?? null
      if (input.targetWorkflowId !== undefined) row.targetWorkflowId = input.targetWorkflowId ?? null
      if (row.targetType === 'agent') row.targetWorkflowId = null
      if (row.targetType === 'workflow') row.targetAgentId = null
      if (input.inputDefaults !== undefined) row.inputDefaults = input.inputDefaults ?? null
      if (input.inputSchema !== undefined) row.inputSchema = input.inputSchema ?? null
      if (input.grantedFeatures !== undefined) row.grantedFeatures = input.grantedFeatures
      if (input.scheduleCron !== undefined) row.scheduleCron = input.scheduleCron ?? null
      if (input.scheduleTimezone !== undefined) row.scheduleTimezone = input.scheduleTimezone ?? null
      if (input.scheduleEnabled !== undefined) row.scheduleEnabled = input.scheduleEnabled
      if (input.enabled !== undefined) row.enabled = input.enabled
    },
    response: (entity) => {
      const updatedAt = (entity as AgentTaskDefinition).updatedAt
      return {
        ok: true,
        updatedAt: updatedAt instanceof Date ? updatedAt.toISOString() : null,
      }
    },
  },
  del: { idFrom: 'query', softDelete: true },
  hooks: {
    afterList: async (payload, ctx) => {
      const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
      const tenantId = ctx.auth?.tenantId ?? null
      const items = Array.isArray((payload as { items?: unknown }).items)
        ? ((payload as { items: Array<Record<string, unknown>> }).items)
        : []
      if (!organizationId || !tenantId || items.length === 0) return
      const em = (ctx.container.resolve('em') as EntityManager).fork()
      await attachLastRunProjection(em, { tenantId, organizationId }, items)
    },
    afterCreate: async (entity, ctx) => {
      const row = entity as AgentTaskDefinition
      await syncPrincipalAndSchedule(row, ctx)
      await emitAgentOrchestratorEvent('agent_orchestrator.task.created', {
        id: row.id,
        name: row.name,
        targetType: row.targetType,
        tenantId: row.tenantId,
        organizationId: row.organizationId,
      }, { persistent: true })
    },
    afterUpdate: async (entity, ctx) => {
      const row = entity as AgentTaskDefinition
      await syncPrincipalAndSchedule(row, ctx)
      await emitAgentOrchestratorEvent('agent_orchestrator.task.updated', {
        id: row.id,
        name: row.name,
        targetType: row.targetType,
        tenantId: row.tenantId,
        organizationId: row.organizationId,
      }, { persistent: true })
    },
    afterDelete: async (id, ctx) => {
      const em = (ctx.container.resolve('em') as EntityManager).fork()
      const row = await em.findOne(AgentTaskDefinition, { id })
      if (row) {
        await syncTaskSchedule(ctx.container, row)
        await emitAgentOrchestratorEvent('agent_orchestrator.task.deleted', {
          id: row.id,
          tenantId: row.tenantId,
          organizationId: row.organizationId,
        }, { persistent: true })
      }
    },
  },
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

const taskListItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable().optional(),
  target_type: z.string(),
  target_agent_id: z.string().nullable().optional(),
  target_workflow_id: z.string().nullable().optional(),
  input_defaults: z.unknown().nullable().optional(),
  input_schema: z.unknown().nullable().optional(),
  execution_principal_id: z.string().uuid().nullable().optional(),
  granted_features: z.array(z.string()).nullable().optional(),
  schedule_cron: z.string().nullable().optional(),
  schedule_timezone: z.string().nullable().optional(),
  schedule_enabled: z.boolean().optional(),
  enabled: z.boolean().optional(),
  organization_id: z.string().uuid().nullable().optional(),
  tenant_id: z.string().uuid().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  last_run: z
    .object({ status: z.string(), finished_at: z.string().nullable() })
    .nullable()
    .optional(),
})

export const openApi = createAgentOrchestratorCrudOpenApi({
  resourceName: 'AgenticTask',
  pluralName: 'Agentic tasks',
  querySchema: agentTaskDefinitionListQuerySchema,
  listResponseSchema: createPagedListResponseSchema(taskListItemSchema),
  create: {
    schema: agentTaskDefinitionCreateSchema,
    responseSchema: defaultCreateResponseSchema,
    description:
      'Creates an agentic task definition. Auto-provisions a dedicated execution principal (agent user + least-privilege role scoped to `grantedFeatures`) and registers the cron schedule when set.',
  },
  update: {
    schema: agentTaskDefinitionUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description:
      'Updates an agentic task definition (optimistic-locked on updatedAt). Re-scopes the execution principal role when `grantedFeatures` changed and re-syncs the schedule.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Soft-deletes an agentic task definition and unregisters any active schedule.',
  },
})
