/**
 * `workflows.*` agent-authoring tool pack (spec §9.5 "Agent-as-author").
 *
 * A person can author a workflow in the Studio; this pack lets an agent do the
 * same through the SAME surfaces. It is deliberately thin: the activity
 * registry, the context ledger and the structured issue body already ARE the
 * agent API, so every tool below delegates to an existing exported function
 * rather than growing a parallel engine surface.
 *
 * What each tool reuses:
 *  - `list_activity_types`  → `listActivityTypes()` + the OpenAPI `zodToJsonSchema`
 *  - `get_context_schema`   → the context-schema route's own resolver + ledger
 *  - `validate_definition`  → `evaluateWorkflowDefinition` (Problems panel + 400 body)
 *  - `create_definition`    → `createWorkflowDefinitionInputCheckedSchema` (the route's gate)
 *  - `update_definition`    → the per-user `workflow_definition_drafts` layer
 *  - `start_test_run`       → `startWorkflow({ isDryRun: true })` + `buildWouldDoReport`
 *
 * Two safety invariants hold for every write here:
 *  1. NEVER auto-published. `create_definition` mints the row with
 *     `enabled: false`, which `findWorkflowDefinition` treats as unresolvable
 *     for execution, and `update_definition` writes a draft, never the
 *     definition. Neither tool exposes `enabled` or `lifecycle` as an input.
 *  2. NEVER cross-tenant. Every read and write is scoped by `tenantId`, so a
 *     foreign definition is invisible rather than merely forbidden.
 */

import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { zodToJsonSchema } from '@open-mercato/shared/lib/openapi'
import {
  WorkflowDefinition,
  WorkflowDefinitionDraft,
  WorkflowEvent,
  WorkflowInstance,
  StepInstance,
  type WorkflowDefinitionData,
} from '../data/entities'
import {
  createWorkflowDefinitionInputCheckedSchema,
  workflowDefinitionDataSchema,
} from '../data/validators'
import { workflowDraftGenerationSchema } from '../lib/ai-authoring'
import { isComponentKind } from '../lib/component-guard'
import {
  computeDefinitionContextLedger,
  narrowLedgerToStep,
  resolveDefinitionDataForLedger,
  warmContextLedgerResolvers,
} from '../lib/definition-context-schema'
import {
  evaluateWorkflowDefinition,
  type EvaluateWorkflowDefinitionOptions,
} from '../lib/definition-evaluation'
import { getWorkflowOutOfBandAgentIds } from '../lib/server-output-contract'
import { normalizeDefinitionValidationIssues } from '../lib/definition-error-body'
import {
  DRY_RUN_EVENT_TYPES,
  buildWouldDoReport,
  type WouldDoSourceEvent,
} from '../lib/dry-run'
import { findWorkflowDefinition } from '../lib/find-definition'
import { listActivityTypes } from '../lib/activity-registry'
import '../lib/activity-registry-bootstrap'
import { invalidateTriggerCache } from '../lib/event-trigger-service'
import {
  MISSING_TENANT_ISSUE,
  failure,
  featureRefusal,
  issue,
  missingFeatures,
  organizationWhere,
  resolveScope,
  type WorkflowsAiToolDefinition,
  type WorkflowsToolContext,
} from './types'

const DEFINITIONS_VIEW = 'workflows.definitions.view'
const DEFINITIONS_CREATE = 'workflows.definitions.create'
const DEFINITIONS_EDIT = 'workflows.definitions.edit'
const DEFINITIONS_TEST_RUN = 'workflows.definitions.test_run'
const INSTANCES_VIEW = 'workflows.instances.view'
const INSTANCES_CREATE = 'workflows.instances.create'

function resolveEm(ctx: WorkflowsToolContext): EntityManager {
  return ctx.container.resolve<EntityManager>('em')
}

/**
 * Definition ids accepted by the context-schema route: a DB UUID, or
 * `code:<workflowId>` / the synthetic code UUID for code-defined workflows.
 */
const definitionIdSchema = z
  .string()
  .min(1)
  .describe('Definition UUID, or "code:<workflowId>" for a code-defined workflow')

const rawDefinitionSchema = z
  .record(z.string(), z.unknown())
  .describe('The workflow definition JSON — the same object the Studio Code view round-trips')

function asDefinitionData(value: Record<string, unknown>): WorkflowDefinitionData {
  return value as unknown as WorkflowDefinitionData
}

/**
 * Everything `evaluateWorkflowDefinition` needs from the SERVER for one
 * definition: the context ledger, and the agent ids the OPTIONAL
 * `agent_orchestrator` peer reports as answering out of band. Both come from the
 * one warm-up, and each degrades to `null` on its own — a malformed graph must
 * not cost the agent check, and an absent peer must not cost the ledger.
 */
async function tryResolveEvaluationOptions(
  ctx: WorkflowsToolContext,
  definition: WorkflowDefinitionData,
): Promise<EvaluateWorkflowDefinitionOptions> {
  try {
    await warmContextLedgerResolvers(ctx.container)
  } catch {
    return { ledger: null, outOfBandAgentIds: null }
  }
  const outOfBandAgentIds = getWorkflowOutOfBandAgentIds()
  try {
    return { ledger: computeDefinitionContextLedger(definition), outOfBandAgentIds }
  } catch {
    return { ledger: null, outOfBandAgentIds }
  }
}

// ===========================================================================
// workflows.list_activity_types
// ===========================================================================

const listActivityTypesInput = z.object({
  activityType: z
    .string()
    .optional()
    .describe('Return only this activity type instead of the whole registry'),
})

const listActivityTypesTool: WorkflowsAiToolDefinition<
  z.infer<typeof listActivityTypesInput>
> = {
  name: 'workflows.list_activity_types',
  displayName: 'List workflow activity types',
  description:
    'List every registered workflow activity type with its JSON-Schema config contract, form fields, async capability, compensability and dry-run mock mode. This registry IS the authoring contract — read it before writing any activity config so the config validates on the first attempt.',
  inputSchema: listActivityTypesInput,
  requiredFeatures: [DEFINITIONS_VIEW],
  tags: ['read', 'workflows', 'authoring'],
  isMutation: false,
  handler: async (input, ctx) => {
    const missing = missingFeatures(ctx, [DEFINITIONS_VIEW])
    if (missing.length) return featureRefusal(missing)

    const entries = listActivityTypes().filter(
      (entry) => !input.activityType || entry.id === input.activityType,
    )

    if (input.activityType && entries.length === 0) {
      return failure(
        issue(
          ['activityType'],
          'unknown_activity_type',
          `Unknown activity type "${input.activityType}"`,
          { expected: listActivityTypes().map((entry) => entry.id).join(' | '), got: input.activityType },
        ),
      )
    }

    return {
      ok: true,
      issues: [],
      activityTypes: entries.map((entry) => ({
        id: entry.id,
        icon: entry.icon,
        i18nKey: entry.i18nKey,
        configSchema: zodToJsonSchema(entry.configSchema) ?? null,
        form: entry.form.map((field) => ({
          id: field.id,
          component: field.component,
          required: field.required ?? false,
        })),
        async: entry.async,
        compensable: entry.compensable ?? false,
        // 'refuse' and 'none' both stop a dry run at this activity.
        dryRunMock:
          entry.mock === 'refuse' ? 'refuse' : entry.mock === undefined ? 'none' : 'simulated',
      })),
    }
  },
}

// ===========================================================================
// workflows.get_context_schema
// ===========================================================================

const getContextSchemaInput = z.object({
  definitionId: definitionIdSchema,
  stepId: z
    .string()
    .optional()
    .describe('Narrow the response to one step instead of returning every step'),
})

const getContextSchemaTool: WorkflowsAiToolDefinition<
  z.infer<typeof getContextSchemaInput>
> = {
  name: 'workflows.get_context_schema',
  displayName: 'Get workflow context ledger',
  description:
    'Return the per-step context ledger for a saved workflow definition: for every step, which context paths are available when it runs, with type, presence (always/maybe) and the producing source. Use this to discover the exact {{context.*}} paths a step may reference before writing any expression.',
  inputSchema: getContextSchemaInput,
  requiredFeatures: [DEFINITIONS_VIEW],
  tags: ['read', 'workflows', 'authoring'],
  isMutation: false,
  handler: async (input, ctx) => {
    const missing = missingFeatures(ctx, [DEFINITIONS_VIEW])
    if (missing.length) return featureRefusal(missing)

    const scope = resolveScope(ctx)
    if (!scope) return failure(MISSING_TENANT_ISSUE)

    await warmContextLedgerResolvers(ctx.container)

    const definitionData = await resolveDefinitionDataForLedger(
      resolveEm(ctx),
      input.definitionId,
      { tenantId: scope.tenantId, organizationWhere: organizationWhere(scope) },
    )

    if (!definitionData) {
      return failure(
        issue(
          ['definitionId'],
          'not_found',
          'Workflow definition not found',
          { got: input.definitionId },
        ),
      )
    }

    const ledger = computeDefinitionContextLedger(definitionData)

    if (input.stepId === undefined) {
      return { ok: true, issues: [], steps: ledger.steps }
    }

    const stepView = narrowLedgerToStep(ledger, input.stepId)
    if (!stepView) {
      return failure(
        issue(
          ['stepId'],
          'not_found',
          'Step not found in workflow definition',
          { got: input.stepId },
        ),
      )
    }

    return { ok: true, issues: [], steps: { [input.stepId]: stepView } }
  },
}

// ===========================================================================
// workflows.validate_definition
// ===========================================================================

const validateDefinitionInput = z
  .object({
    definition: rawDefinitionSchema
      .optional()
      .describe('Validate this definition JSON directly, without saving anything'),
    definitionId: definitionIdSchema
      .optional()
      .describe('Validate the definition stored under this id instead'),
  })
  .describe('Supply exactly one of `definition` or `definitionId`')

const validateDefinitionTool: WorkflowsAiToolDefinition<
  z.infer<typeof validateDefinitionInput>
> = {
  name: 'workflows.validate_definition',
  displayName: 'Validate a workflow definition',
  description:
    'Run the full workflow validation pass over a definition without saving it. Returns `issues` (the same structured {path, code, message, expected, got} list the definition API returns on a 400) and `problems` (exactly what the Studio Problems panel would show, errors first). Call this before create_definition or update_definition and fix every error.',
  inputSchema: validateDefinitionInput,
  requiredFeatures: [DEFINITIONS_VIEW],
  tags: ['read', 'workflows', 'authoring'],
  isMutation: false,
  handler: async (input, ctx) => {
    const missing = missingFeatures(ctx, [DEFINITIONS_VIEW])
    if (missing.length) return featureRefusal(missing)

    if ((input.definition && input.definitionId) || (!input.definition && !input.definitionId)) {
      return failure(
        issue(
          ['definition'],
          'invalid_input',
          'Supply exactly one of `definition` or `definitionId`',
          { expected: 'definition | definitionId' },
        ),
      )
    }

    let definitionData: WorkflowDefinitionData
    if (input.definitionId) {
      const scope = resolveScope(ctx)
      if (!scope) return failure(MISSING_TENANT_ISSUE)
      const resolved = await resolveDefinitionDataForLedger(
        resolveEm(ctx),
        input.definitionId,
        { tenantId: scope.tenantId, organizationWhere: organizationWhere(scope) },
      )
      if (!resolved) {
        return failure(
          issue(['definitionId'], 'not_found', 'Workflow definition not found', {
            got: input.definitionId,
          }),
        )
      }
      definitionData = resolved
    } else {
      definitionData = asDefinitionData(input.definition!)
    }

    const evaluationOptions = await tryResolveEvaluationOptions(ctx, definitionData)
    const evaluation = evaluateWorkflowDefinition(definitionData, evaluationOptions)

    return {
      ok: evaluation.valid,
      issues: evaluation.issues,
      problems: evaluation.problems,
      valid: evaluation.valid,
      errorCount: evaluation.errorCount,
      warningCount: evaluation.warningCount,
    }
  },
}

// ===========================================================================
// workflows.create_definition
// ===========================================================================

const createDefinitionInput = z.object({
  workflowId: z
    .string()
    .min(1)
    .max(100)
    .describe('Stable machine id, lowercase letters/numbers/dots/hyphens/underscores'),
  workflowName: z.string().min(1).max(255),
  description: z.string().max(2000).optional().nullable(),
  definition: rawDefinitionSchema,
  metadata: z.record(z.string(), z.unknown()).optional().nullable(),
})

const createDefinitionTool: WorkflowsAiToolDefinition<
  z.infer<typeof createDefinitionInput>
> = {
  name: 'workflows.create_definition',
  displayName: 'Create a workflow definition (disabled draft)',
  description:
    'Create a new workflow definition. It is ALWAYS created disabled: it appears in the Studio for a human to review and enable, and the engine will not resolve it for execution or fire its triggers until a person publishes it. Validate with validate_definition first — this tool applies the identical schema gate the REST API applies and returns the same structured issues on rejection.',
  inputSchema: createDefinitionInput,
  requiredFeatures: [DEFINITIONS_CREATE],
  tags: ['write', 'workflows', 'authoring'],
  isMutation: true,
  handler: async (input, ctx) => {
    const missing = missingFeatures(ctx, [DEFINITIONS_CREATE])
    if (missing.length) return featureRefusal(missing)

    const scope = resolveScope(ctx)
    if (!scope) return failure(MISSING_TENANT_ISSUE)
    if (!scope.organizationId) {
      return failure(
        issue(
          ['organizationId'],
          'missing_organization_context',
          'An organization context is required to create a workflow definition',
        ),
      )
    }

    // The exact gate the POST /api/workflows/definitions route applies, so an
    // agent-authored payload is rejected for exactly the same reasons, with
    // exactly the same structured issues, as a human-authored one.
    const validation = createWorkflowDefinitionInputCheckedSchema.safeParse({
      workflowId: input.workflowId,
      workflowName: input.workflowName,
      description: input.description,
      definition: input.definition,
      metadata: input.metadata,
    })
    if (!validation.success) {
      return failure(...normalizeDefinitionValidationIssues(validation.error))
    }

    const em = resolveEm(ctx)
    const existing = await em.findOne(
      WorkflowDefinition,
      { workflowId: input.workflowId, tenantId: scope.tenantId },
      { orderBy: { version: 'DESC' } },
    )
    if (existing) {
      return failure(
        issue(
          ['workflowId'],
          'already_exists',
          `Workflow definition with ID "${input.workflowId}" already exists`,
          { got: input.workflowId },
        ),
      )
    }

    // New definitions default to strict interpolation, matching the create route.
    const definitionData = validation.data.definition.interpolation
      ? validation.data.definition
      : { ...validation.data.definition, interpolation: 'strict' as const }

    const created = em.create(WorkflowDefinition, {
      workflowId: validation.data.workflowId,
      workflowName: validation.data.workflowName,
      description: validation.data.description,
      version: validation.data.version,
      definition: definitionData,
      metadata: validation.data.metadata,
      // NEVER auto-published (spec §9.5). `findWorkflowDefinition` requires
      // `enabled = true` to resolve a workflow for execution, so a human
      // enabling it in the Studio is the only way this ever runs.
      enabled: false,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      createdBy: ctx.userId ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    await em.persist(created).flush()
    invalidateTriggerCache(scope.tenantId, scope.organizationId ?? undefined)

    const evaluationOptions = await tryResolveEvaluationOptions(
      ctx,
      definitionData as WorkflowDefinitionData,
    )
    const evaluation = evaluateWorkflowDefinition(
      definitionData as WorkflowDefinitionData,
      evaluationOptions,
    )

    return {
      ok: true,
      issues: [],
      definitionId: created.id,
      workflowId: created.workflowId,
      version: created.version,
      enabled: false,
      published: false,
      problems: evaluation.problems,
      errorCount: evaluation.errorCount,
      warningCount: evaluation.warningCount,
    }
  },
}

// ===========================================================================
// workflows.update_definition
// ===========================================================================

const updateDefinitionInput = z.object({
  definitionId: z.uuid().describe('UUID of the saved definition to draft changes against'),
  definition: rawDefinitionSchema,
  metadata: z.record(z.string(), z.unknown()).optional().nullable(),
})

const updateDefinitionTool: WorkflowsAiToolDefinition<
  z.infer<typeof updateDefinitionInput>
> = {
  name: 'workflows.update_definition',
  displayName: 'Update a workflow definition (as a review draft)',
  description:
    'Write proposed changes to a saved workflow definition as a per-user editor DRAFT. The published definition is never modified: the next person to open that definition in the Studio sees the draft offered for restore, reviews the visual and JSON diff, and decides whether to save it. Returns the Problems-panel result for the drafted definition so you can self-correct before a human looks.',
  inputSchema: updateDefinitionInput,
  requiredFeatures: [DEFINITIONS_EDIT],
  tags: ['write', 'workflows', 'authoring'],
  isMutation: true,
  handler: async (input, ctx) => {
    const missing = missingFeatures(ctx, [DEFINITIONS_EDIT])
    if (missing.length) return featureRefusal(missing)

    const scope = resolveScope(ctx)
    if (!scope) return failure(MISSING_TENANT_ISSUE)

    // A draft belongs to a person — it is the working copy they will be shown
    // on their next Studio visit. Without a user there is nobody to review it.
    if (!ctx.userId) {
      return failure(
        issue(
          ['userId'],
          'missing_user_context',
          'A user context is required: drafts are per-user review copies',
        ),
      )
    }

    const parsed = workflowDefinitionDataSchema.safeParse(input.definition)
    if (!parsed.success) {
      return failure(...normalizeDefinitionValidationIssues(parsed.error))
    }

    const em = resolveEm(ctx)
    const definition = await em.findOne(WorkflowDefinition, {
      id: input.definitionId,
      tenantId: scope.tenantId,
      ...organizationWhere(scope),
      deletedAt: null,
    })

    if (!definition) {
      return failure(
        issue(['definitionId'], 'not_found', 'Workflow definition not found', {
          got: input.definitionId,
        }),
      )
    }

    // Matches the draft route's upsert key: (definitionId, userId, tenantId).
    const existingDraft = await em.findOne(WorkflowDefinitionDraft, {
      definitionId: input.definitionId,
      userId: ctx.userId,
      tenantId: scope.tenantId,
    })

    let draft: WorkflowDefinitionDraft
    if (existingDraft) {
      existingDraft.deletedAt = null
      existingDraft.organizationId = scope.organizationId ?? existingDraft.organizationId
      existingDraft.definition = parsed.data as WorkflowDefinitionData
      if (input.metadata !== undefined) {
        existingDraft.metadata = input.metadata as WorkflowDefinitionDraft['metadata']
      }
      existingDraft.baseUpdatedAt = definition.updatedAt
      draft = existingDraft
    } else {
      draft = em.create(WorkflowDefinitionDraft, {
        definitionId: input.definitionId,
        userId: ctx.userId,
        definition: parsed.data as WorkflowDefinitionData,
        metadata: (input.metadata ?? null) as WorkflowDefinitionDraft['metadata'],
        baseUpdatedAt: definition.updatedAt,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId ?? definition.organizationId,
      })
      em.persist(draft)
    }

    await em.flush()

    const definitionData = parsed.data as WorkflowDefinitionData
    const evaluationOptions = await tryResolveEvaluationOptions(ctx, definitionData)
    const evaluation = evaluateWorkflowDefinition(definitionData, evaluationOptions)

    return {
      ok: true,
      issues: [],
      draftId: draft.id,
      definitionId: input.definitionId,
      // The published definition was not touched, and its optimistic lock was
      // not taken — drafts deliberately sit outside it.
      published: false,
      definitionUpdatedAt: definition.updatedAt.toISOString(),
      problems: evaluation.problems,
      errorCount: evaluation.errorCount,
      warningCount: evaluation.warningCount,
    }
  },
}

// ===========================================================================
// workflows.start_test_run
// ===========================================================================

const startTestRunInput = z.object({
  workflowId: z.string().min(1).describe('The definition workflowId to test'),
  version: z.number().int().positive().optional(),
  initialContext: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Starting workflow context, shaped by the definition contextSchema.input'),
  correlationKey: z.string().optional(),
})

const startTestRunTool: WorkflowsAiToolDefinition<z.infer<typeof startTestRunInput>> = {
  name: 'workflows.start_test_run',
  displayName: 'Start a workflow dry run',
  description:
    'Start an isolated DRY RUN of a workflow and return the "would do" report: every side effect the run suppressed, in order. Activities are simulated from their registry mocks (an activity with no mock refuses and stops the run), user tasks are recorded but never created, and nothing reaches real data. This is always a dry run — there is no option to make it real.',
  inputSchema: startTestRunInput,
  requiredFeatures: [INSTANCES_VIEW, INSTANCES_CREATE, DEFINITIONS_TEST_RUN],
  tags: ['write', 'workflows', 'testing'],
  isMutation: true,
  handler: async (input, ctx) => {
    const missing = missingFeatures(ctx, [INSTANCES_VIEW, INSTANCES_CREATE, DEFINITIONS_TEST_RUN])
    if (missing.length) return featureRefusal(missing)

    const scope = resolveScope(ctx)
    if (!scope) return failure(MISSING_TENANT_ISSUE)
    if (!scope.organizationId) {
      return failure(
        issue(
          ['organizationId'],
          'missing_organization_context',
          'An organization context is required to start a workflow run',
        ),
      )
    }

    const em = resolveEm(ctx)
    const definition = await findWorkflowDefinition(em, {
      workflowId: input.workflowId,
      version: input.version,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })

    if (!definition) {
      return failure(
        issue(['workflowId'], 'not_found', 'Workflow definition not found', {
          got: input.workflowId,
        }),
      )
    }

    if (isComponentKind(definition.kind)) {
      return failure(
        issue(
          ['workflowId'],
          'component_not_startable',
          'This workflow is a reusable component and cannot be started standalone; invoke it from a SUB_WORKFLOW step',
        ),
      )
    }

    const workflowExecutor = ctx.container.resolve<{
      startWorkflow: (
        em: EntityManager,
        options: Record<string, unknown>,
      ) => Promise<WorkflowInstance>
      executeWorkflow: (
        em: EntityManager,
        container: unknown,
        instanceId: string,
        options: { userId?: string | null },
      ) => Promise<unknown>
    }>('workflowExecutor')

    const instance = await workflowExecutor.startWorkflow(em, {
      workflowId: input.workflowId,
      version: input.version,
      initialContext: input.initialContext ?? {},
      correlationKey: input.correlationKey,
      metadata: { initiatedBy: ctx.userId ?? null },
      // Forced, never an input. Dry-run isolation is the engine's own
      // mechanism: mocked effectors, suppressed USER_TASKs, no enqueueing.
      isDryRun: true,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })

    let executionError: string | null = null
    try {
      await workflowExecutor.executeWorkflow(em, ctx.container, instance.id, {
        userId: ctx.userId,
      })
    } catch (error) {
      executionError = error instanceof Error ? error.message : String(error)
    }

    const events = await em.find(
      WorkflowEvent,
      {
        workflowInstanceId: instance.id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        eventType: {
          $in: [
            DRY_RUN_EVENT_TYPES.activitySimulated,
            DRY_RUN_EVENT_TYPES.activityRefused,
            DRY_RUN_EVENT_TYPES.userTaskSimulated,
            DRY_RUN_EVENT_TYPES.businessRuleActionsSuppressed,
          ],
        },
      },
      { orderBy: [{ occurredAt: 'ASC' }, { id: 'ASC' }], limit: 100 },
    )

    const stepInstanceIds = Array.from(
      new Set(
        events
          .map((event) => event.stepInstanceId)
          .filter((id): id is string => typeof id === 'string' && id.length > 0),
      ),
    )
    const stepInstances = stepInstanceIds.length
      ? await em.find(StepInstance, {
          id: { $in: stepInstanceIds },
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
        })
      : []
    const stepIdByInstanceId = new Map(stepInstances.map((step) => [step.id, step.stepId]))

    const sourceEvents: WouldDoSourceEvent[] = events.map((event) => ({
      id: event.id,
      eventType: event.eventType,
      stepId: event.stepInstanceId ? stepIdByInstanceId.get(event.stepInstanceId) ?? null : null,
      occurredAt: event.occurredAt,
      eventData: (event.eventData ?? null) as Record<string, unknown> | null,
    }))
    const report = buildWouldDoReport(sourceEvents)

    const refreshed = await em.findOne(WorkflowInstance, {
      id: instance.id,
      tenantId: scope.tenantId,
    })

    return {
      ok: executionError === null,
      issues: executionError
        ? [issue(['execution'], 'execution_failed', executionError)]
        : [],
      instanceId: instance.id,
      isDryRun: true,
      status: refreshed?.status ?? instance.status,
      currentStepId: refreshed?.currentStepId ?? null,
      wouldDo: report.entries,
      stoppedByRefusal: report.stoppedByRefusal,
    }
  },
}

// ===========================================================================
// workflows.validate_workflow_definition
// ===========================================================================

/**
 * Validate a DRAFT in the exact shape the in-Studio `workflows.workflow_author`
 * agent emits, so that agent can self-correct inside its tool loop before a
 * draft ever reaches the generate route.
 *
 * This mirrors `api/definitions/generate/route.ts` step for step — reshape the
 * draft's `{ steps, transitions, contextSchema }` into a definition, parse it
 * through the one `workflowDefinitionDataSchema`, then run the same
 * `evaluateWorkflowDefinition` Problems pass — but is gated on
 * `definitions.create` (what the draft path itself requires) rather than the
 * broader `validate_definition` tool's `definitions.view`. It is READ-ONLY: it
 * persists nothing and reads no tenant rows, so an author self-correcting a
 * draft never touches data.
 */
const validateWorkflowDraftTool: WorkflowsAiToolDefinition<
  z.infer<typeof workflowDraftGenerationSchema>
> = {
  name: 'workflows.validate_workflow_definition',
  displayName: 'Validate a draft workflow definition',
  description:
    'Validate a DRAFT workflow (the {summary, steps, transitions, contextSchema} object you are authoring) without saving it. Returns the same structured {path, code, message, expected, got} issues and Problems-panel entries the generate route would. Call this before returning a draft and fix every error — in particular, an INVOKE_AGENT activity requires a string `config.agentId` and a `config.onResult`.',
  inputSchema: workflowDraftGenerationSchema,
  requiredFeatures: [DEFINITIONS_CREATE],
  tags: ['read', 'workflows', 'authoring'],
  isMutation: false,
  handler: async (input, ctx) => {
    const missing = missingFeatures(ctx, [DEFINITIONS_CREATE])
    if (missing.length) return featureRefusal(missing)

    const candidate: Record<string, unknown> = {
      steps: input.steps,
      transitions: input.transitions,
      ...(input.contextSchema ? { contextSchema: input.contextSchema } : {}),
    }

    const parsed = workflowDefinitionDataSchema.safeParse(candidate)
    if (!parsed.success) {
      return failure(
        ...parsed.error.issues.map((zodIssue) =>
          issue(
            [...zodIssue.path] as Array<string | number>,
            zodIssue.code,
            zodIssue.message,
          ),
        ),
      )
    }

    const definitionData = asDefinitionData(parsed.data as Record<string, unknown>)
    const evaluationOptions = await tryResolveEvaluationOptions(ctx, definitionData)
    const evaluation = evaluateWorkflowDefinition(definitionData, evaluationOptions)

    return {
      ok: evaluation.valid,
      issues: evaluation.issues,
      problems: evaluation.problems,
      valid: evaluation.valid,
      errorCount: evaluation.errorCount,
      warningCount: evaluation.warningCount,
    }
  },
}

export const workflowsAuthoringAiTools: WorkflowsAiToolDefinition<never, never>[] = [
  listActivityTypesTool,
  getContextSchemaTool,
  validateDefinitionTool,
  validateWorkflowDraftTool,
  createDefinitionTool,
  updateDefinitionTool,
  startTestRunTool,
] as unknown as WorkflowsAiToolDefinition<never, never>[]

export default workflowsAuthoringAiTools
