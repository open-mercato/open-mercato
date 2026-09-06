import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import type { CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { ProcessDefinition } from '../../data/entities'
import {
  processDefinitionCreateSchema,
  processDefinitionListQuerySchema,
  processDefinitionUpdateSchema,
  processMilestoneSchema,
  processSingleAgentSchema,
  processTriggerSchema,
  type ProcessDefinitionCreateInput,
  type ProcessDefinitionUpdateInput,
  type ProcessSingleAgent,
} from '../../data/validators'
import { emitAgentOrchestratorEvent } from '../../events'
import { orderedMilestones } from '../../lib/tasks/milestones'
import {
  generatedWorkflowId,
  materializeSingleAgentWorkflow,
  readWorkflowFacts,
  removeGeneratedWorkflow,
} from '../../lib/processes/materializeAgentWorkflow'
import { authorizeProcessWorkflowGrant } from '../../lib/processes/workflowGrant'
import { syncProcessSchedule } from '../../lib/tasks/schedule'
import { withScheduleSemanticChecks } from '../../lib/tasks/scheduleValidation'
import {
  createAgentOrchestratorCrudOpenApi,
  createPagedListResponseSchema,
  defaultCreateResponseSchema,
  defaultOkResponseSchema,
} from '../openapi'

const logger = createLogger('agent_orchestrator').child({ component: 'processes-api' })

const ENTITY_TYPE = 'agent_orchestrator:process_definition'

// Route-layer semantic schedule validation (real cron parse via the scheduler)
// on top of the client-safe shape schemas — see lib/tasks/scheduleValidation.ts.
const createSchemaWithSemantics = withScheduleSemanticChecks(processDefinitionCreateSchema)
const updateSchemaWithSemantics = withScheduleSemanticChecks(processDefinitionUpdateSchema)

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['agent_orchestrator.processes.view'] },
  POST: { requireAuth: true, requireFeatures: ['agent_orchestrator.processes.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['agent_orchestrator.processes.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['agent_orchestrator.processes.manage'] },
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
 * Binds the definition to a workflow, generating one when the author chose the
 * single-agent shortcut, then syncs the declared schedules.
 *
 * Execution identity travels WITH the workflow: `grantedFeatures` is applied to
 * the workflow definition, which is where core provisions the least-privilege
 * principal every run acts as. This module deliberately provisions none of its
 * own any more — one process, one workflow, one execution identity.
 *
 * Runs after create AND after update; both are idempotent, which makes a
 * previously failed sync self-healing on the next edit.
 */
async function bindWorkflowAndSchedule(
  entity: ProcessDefinition,
  ctx: CrudCtx,
  input: {
    /** The grant the bound workflow already carries, so a no-op change needs no gate. */
    currentGrantedFeatures?: string[]
    workflowMode: 'single_agent' | 'workflow'
    /**
     * NOT stored on the definition: the generated workflow is the source of
     * truth for it, and a second copy here is how the two drift. It travels on
     * the write payload only, which the CRUD factory hands back on `ctx.input`.
     */
    singleAgent?: ProcessSingleAgent | null
    grantedFeatures?: string[]
  },
): Promise<void> {
  // Declaring what a workflow may DO is a privilege decision, and it does not
  // come free with `processes.manage`. Core gates its own definitions API on
  // `workflows.definitions.grant_features` plus a subset check against the
  // saving user's own features; routing a grant through this module without the
  // same gates would be a way to mint a principal holding features the author
  // does not hold.
  const grantFailure = await authorizeProcessWorkflowGrant(ctx, {
    requested: input.grantedFeatures ?? [],
    current: input.currentGrantedFeatures ?? [],
  })
  if (grantFailure) throw new CrudHttpError(grantFailure.status, grantFailure.body)

  if (input.workflowMode === 'single_agent') {
    const singleAgent = input.singleAgent
    if (!singleAgent) {
      throw new CrudHttpError(400, { error: 'Single-agent process requires an agent' })
    }
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const result = await materializeSingleAgentWorkflow(ctx.container, em, {
      processDefinitionId: entity.id,
      processName: entity.name,
      description: entity.description,
      singleAgent,
      milestoneKeys: orderedMilestones(entity.milestones ?? []).map((milestone) => milestone.key),
      grantedFeatures: input.grantedFeatures ?? [],
      enabled: entity.enabled,
      tenantId: entity.tenantId,
      organizationId: entity.organizationId,
      actorUserId: ctx.auth?.sub ?? null,
    })
    if (!result.ok) {
      throw new CrudHttpError(result.reason === 'workflows_unavailable' ? 503 : 409, {
        error:
          result.reason === 'workflows_unavailable'
            ? 'The workflows module is unavailable, so the process workflow could not be generated.'
            : 'A workflow with the generated id already exists and is owned by someone else.',
      })
    }
    if (entity.workflowId !== result.workflowId) {
      const row = await em.findOne(ProcessDefinition, { id: entity.id })
      if (row) {
        row.workflowId = result.workflowId
        await em.flush()
      }
      entity.workflowId = result.workflowId
    }
  }

  await syncProcessSchedule(ctx.container, entity)
}

/**
 * Attach a `last_execution: { status, completed_at } | null` projection to each
 * list item — one grouped query (`distinct on (process_definition_id)`, newest by
 * created_at) over the page's ids, tenant/org-scoped. Read-only enrichment for the
 * list's health column; no schema change.
 */
export async function attachLastExecutionProjection(
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
  let rows: Array<{ process_definition_id: string; status: string; completed_at: Date | string | null }> = []
  try {
    rows = (await em.getConnection().execute(
      `select distinct on (process_definition_id)
         process_definition_id, status, completed_at
       from process_instances
       where process_definition_id in (${idPlaceholders}) and tenant_id = ? and organization_id = ?
       order by process_definition_id, created_at desc`,
      [...ids, scope.tenantId, scope.organizationId],
    )) as Array<{ process_definition_id: string; status: string; completed_at: Date | string | null }>
  } catch (err) {
    // The last-execution column is a cosmetic enrichment — it must never take the
    // whole list down. Fail soft: log and render the list without it.
    logger.warn('process definitions last-execution projection failed', {
      error: err instanceof Error ? err.message : String(err),
    })
    rows = []
  }
  const byDefinition = new Map(rows.map((row) => [row.process_definition_id, row]))
  for (const item of items) {
    const row = typeof item.id === 'string' ? byDefinition.get(item.id) : undefined
    item.last_execution = row
      ? {
          status: row.status,
          completed_at:
            row.completed_at instanceof Date
              ? row.completed_at.toISOString()
              : row.completed_at ?? null,
        }
      : null
  }
}

/**
 * Attaches what the BOUND WORKFLOW knows about each definition: whether it is one
 * this process generated, the agent config inside it, and the execution grant.
 *
 * None of it is stored on the definition. The workflow is the single source of
 * truth for its own graph and its own execution identity, so the form reads them
 * back from there — a shadow copy here would silently drift the moment someone
 * edited the workflow in the Studio.
 */
export async function attachWorkflowFacts(
  container: CrudCtx['container'],
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  items: Array<Record<string, unknown>>,
): Promise<void> {
  const workflowIds = Array.from(
    new Set(
      items
        .map((item) => (typeof item.workflow_id === 'string' ? item.workflow_id : null))
        .filter((id): id is string => !!id),
    ),
  )
  const facts = await readWorkflowFacts(container, em, { ...scope, workflowIds })
  for (const item of items) {
    const id = typeof item.id === 'string' ? item.id : null
    const workflowId = typeof item.workflow_id === 'string' ? item.workflow_id : null
    const fact = workflowId ? facts.get(workflowId) : undefined
    // The MODE is derivable without reading anything: a definition bound to the
    // workflow id it would generate is in single-agent mode.
    item.workflow_mode = id && workflowId === generatedWorkflowId(id) ? 'single_agent' : 'workflow'
    item.single_agent = fact?.singleAgent ?? null
    item.granted_features = fact?.grantedFeatures ?? []
  }
}

const crud = makeCrudRoute<
  ProcessDefinitionCreateInput,
  ProcessDefinitionUpdateInput,
  z.infer<typeof processDefinitionListQuerySchema>
>({
  metadata: routeMetadata,
  orm: {
    entity: ProcessDefinition,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: ENTITY_TYPE },
  list: {
    schema: processDefinitionListQuerySchema,
    entityId: ENTITY_TYPE,
    defaultSort: { field: 'created_at', dir: 'desc' },
    fields: [
      'id',
      'name',
      'description',
      'workflow_id',
      'input_defaults',
      'input_schema',
      'outcome_schema',
      'triggers',
      'milestones',
      'ui_metadata',
      'enabled',
      'organization_id',
      'tenant_id',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      name: 'name',
      enabled: 'enabled',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = { $eq: query.id }
      if (query.workflowId) filters.workflow_id = { $eq: query.workflowId }
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
        // In single-agent mode the real id is stamped by the after-hook once the
        // workflow exists; a placeholder here would be a workflow nothing can start.
        workflowId: input.workflowMode === 'workflow' ? (input.workflowId as string) : '',
        inputDefaults: input.inputDefaults ?? null,
        inputSchema: input.inputSchema ?? null,
        outcomeSchema: input.outcomeSchema ?? null,
        triggers: input.triggers ?? [],
        milestones: input.milestones ?? [],
        uiMetadata: input.uiMetadata ?? null,
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
      const row = entity as ProcessDefinition
      if (input.name !== undefined) row.name = input.name
      if (input.description !== undefined) row.description = input.description ?? null
      if (input.workflowMode === 'workflow' && input.workflowId) row.workflowId = input.workflowId
      if (input.inputDefaults !== undefined) row.inputDefaults = input.inputDefaults ?? null
      if (input.inputSchema !== undefined) row.inputSchema = input.inputSchema ?? null
      if (input.outcomeSchema !== undefined) row.outcomeSchema = input.outcomeSchema ?? null
      if (input.triggers !== undefined) row.triggers = input.triggers
      if (input.milestones !== undefined) row.milestones = input.milestones
      if (input.uiMetadata !== undefined) row.uiMetadata = input.uiMetadata ?? null
      if (input.enabled !== undefined) row.enabled = input.enabled
    },
    response: (entity) => {
      const updatedAt = (entity as ProcessDefinition).updatedAt
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
      await attachLastExecutionProjection(em, { tenantId, organizationId }, items)
      await attachWorkflowFacts(ctx.container, em, { tenantId, organizationId }, items)
    },
    afterCreate: async (entity, ctx) => {
      const row = entity as ProcessDefinition
      await bindWorkflowAndSchedule(row, ctx, {
        workflowMode: ctx.input.workflowMode,
        singleAgent: ctx.input.singleAgent,
        grantedFeatures: ctx.input.grantedFeatures,
        // A brand-new definition holds no grant yet, so every feature it asks
        // for is a change and must be authorised.
        currentGrantedFeatures: [],
      })
      await emitAgentOrchestratorEvent('agent_orchestrator.process_definition.created', {
        id: row.id,
        name: row.name,
        workflowId: row.workflowId,
        tenantId: row.tenantId,
        organizationId: row.organizationId,
      }, { persistent: true })
    },
    afterUpdate: async (entity, ctx) => {
      const row = entity as ProcessDefinition
      const em = (ctx.container.resolve('em') as EntityManager).fork()
      const facts = await readWorkflowFacts(ctx.container, em, {
        workflowIds: [row.workflowId].filter(Boolean),
        tenantId: row.tenantId,
        organizationId: row.organizationId,
      })
      await bindWorkflowAndSchedule(row, ctx, {
        workflowMode: ctx.input.workflowMode,
        singleAgent: ctx.input.singleAgent,
        grantedFeatures: ctx.input.grantedFeatures,
        currentGrantedFeatures: facts.get(row.workflowId)?.grantedFeatures ?? [],
      })
      await emitAgentOrchestratorEvent('agent_orchestrator.process_definition.updated', {
        id: row.id,
        name: row.name,
        workflowId: row.workflowId,
        tenantId: row.tenantId,
        organizationId: row.organizationId,
      }, { persistent: true })
    },
    afterDelete: async (id, ctx) => {
      const em = (ctx.container.resolve('em') as EntityManager).fork()
      const row = await em.findOne(ProcessDefinition, { id })
      if (!row) return
      await syncProcessSchedule(ctx.container, row)
      // Only a workflow THIS definition generated is removed; a hand-authored one
      // outlives the process that pointed at it.
      await removeGeneratedWorkflow(ctx.container, em, {
        processDefinitionId: row.id,
        workflowId: row.workflowId,
        tenantId: row.tenantId,
        organizationId: row.organizationId,
      })
      await emitAgentOrchestratorEvent('agent_orchestrator.process_definition.deleted', {
        id: row.id,
        tenantId: row.tenantId,
        organizationId: row.organizationId,
      }, { persistent: true })
    },
  },
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

const processDefinitionListItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable().optional(),
  workflow_id: z.string(),
  input_defaults: z.unknown().nullable().optional(),
  input_schema: z.unknown().nullable().optional(),
  outcome_schema: z.unknown().nullable().optional(),
  triggers: z.array(processTriggerSchema).nullable().optional(),
  milestones: z.array(processMilestoneSchema).nullable().optional(),
  ui_metadata: z.unknown().nullable().optional(),
  enabled: z.boolean().optional(),
  organization_id: z.string().uuid().nullable().optional(),
  tenant_id: z.string().uuid().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  last_execution: z
    .object({ status: z.string(), completed_at: z.string().nullable() })
    .nullable()
    .optional(),
  /** Derived, not stored: `single_agent` when the bound workflow is the one this definition generates. */
  workflow_mode: z.enum(['single_agent', 'workflow']).optional(),
  /** Read back from the generated workflow — the source of truth for it. Null once the workflow has been extended by hand. */
  single_agent: processSingleAgentSchema.nullable().optional(),
  /** The bound workflow's execution grant, read back from it. */
  granted_features: z.array(z.string()).nullable().optional(),
})

export const openApi = createAgentOrchestratorCrudOpenApi({
  resourceName: 'ProcessDefinition',
  pluralName: 'Processes',
  querySchema: processDefinitionListQuerySchema,
  listResponseSchema: createPagedListResponseSchema(processDefinitionListItemSchema),
  create: {
    schema: processDefinitionCreateSchema,
    responseSchema: defaultCreateResponseSchema,
    description:
      'Creates a process definition. Every process points at a workflow: `workflowMode: "workflow"` binds an existing one, `"single_agent"` generates a real START → INVOKE_AGENT → END workflow owned by this definition and editable in the Studio. `grantedFeatures` is applied to that workflow, which owns the least-privilege execution identity every run acts as. Registers a scheduler job for each declared `{ kind: "schedule" }` trigger.',
  },
  update: {
    schema: processDefinitionUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description:
      'Updates a process definition (optimistic-locked on updatedAt). Regenerates the bound workflow in single-agent mode and re-syncs every declared schedule trigger.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description:
      'Soft-deletes a process definition, unregisters every schedule it registered, and removes the workflow it generated (a hand-authored workflow is left alone).',
  },
})
