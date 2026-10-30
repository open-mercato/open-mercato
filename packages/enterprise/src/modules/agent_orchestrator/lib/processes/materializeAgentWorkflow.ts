import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { ProcessSingleAgent } from '../../data/validators'

const logger = createLogger('agent_orchestrator').child({ component: 'materialize-agent-workflow' })

/**
 * Turns "run this one agent" into a REAL workflow.
 *
 * Removing the agent-as-target shortcut must not remove the ability to express
 * the simplest useful process, so choosing **Single agent** on a process
 * definition generates an ordinary `WorkflowDefinition`:
 *
 *     START ──> INVOKE_AGENT(agentId) ──> END
 *
 * It is a normal row: visible in the Studio, editable by hand, executed by the
 * one engine with the one lifecycle owner. The user who starts with a single
 * agent and later needs a wait state, a branch or a second agent opens the
 * generated workflow and keeps going — there is no migration, because there was
 * never a second kind of process.
 *
 * The graph is deliberately minimal. Everything that could be inferred and
 * baked in here — retries, error routing, notifications — is a workflow
 * capability the user can add explicitly, and guessing at them would make the
 * generated definition harder to read than one they wrote themselves.
 */

export const AGENT_WORKFLOW_OWNER_MODULE = 'agent_orchestrator'

/** The step id the generated graph gives its agent node; stable, so milestones and traces can name it. */
export const SINGLE_AGENT_STEP_ID = 'invoke_agent'

/**
 * The signal the human disposition path resumes on. Without it a proposal parked
 * for review would never wake its instance — the step must declare the signal
 * `agent_orchestrator`'s `proposal.ready` emits after a disposition.
 */
const PROPOSAL_READY_SIGNAL = 'agent_orchestrator.proposal.ready'

/**
 * Deterministic from the process definition id, so regenerating is an update
 * rather than a second workflow, and so a stale row can always be found again.
 */
export function generatedWorkflowId(processDefinitionId: string): string {
  return `process_${processDefinitionId.replace(/-/g, '')}`
}

type WorkflowDefinitionDataLike = Record<string, unknown>

/**
 * Builds the graph. Pure and dependency-free so it can be asserted directly in a
 * test without a container, an ORM or a workflows peer.
 */
export function buildSingleAgentWorkflow(input: {
  singleAgent: ProcessSingleAgent
  /** The declared milestone keys, in order — the last step emits the final one. */
  milestoneKeys?: string[]
}): WorkflowDefinitionDataLike {
  const { singleAgent } = input
  const finalMilestone = input.milestoneKeys?.[input.milestoneKeys.length - 1] ?? null

  return {
    interpolation: 'strict',
    steps: [
      {
        stepId: 'start',
        stepName: 'Start',
        stepType: 'START',
      },
      {
        stepId: SINGLE_AGENT_STEP_ID,
        stepName: 'Run agent',
        stepType: 'AUTOMATED',
        description: `Runs ${singleAgent.agentId} and dispositions any proposal it raises.`,
        // Parks on the human path only; the proposal disposition resumes it.
        signalConfig: { signalName: PROPOSAL_READY_SIGNAL },
        ...(finalMilestone ? { milestone: finalMilestone } : {}),
        activities: [
          {
            activityId: 'invoke_agent',
            activityName: `Invoke ${singleAgent.agentId}`,
            activityType: 'INVOKE_AGENT',
            config: {
              agentId: singleAgent.agentId,
              // The whole start input is the agent's input: a single-agent
              // process has no other context to select from.
              input: {},
              onResult: singleAgent.onResult,
              ...(singleAgent.outputMapping ? { outputMapping: singleAgent.outputMapping } : {}),
            },
          },
        ],
      },
      {
        stepId: 'end',
        stepName: 'Done',
        stepType: 'END',
      },
    ],
    transitions: [
      {
        transitionId: 't_start',
        transitionName: 'Start',
        fromStepId: 'start',
        toStepId: SINGLE_AGENT_STEP_ID,
      },
      {
        transitionId: 't_done',
        transitionName: 'Done',
        fromStepId: SINGLE_AGENT_STEP_ID,
        toStepId: 'end',
      },
    ],
  }
}

type WorkflowDefinitionAuthoringLike = {
  upsertOwnedDefinition: (
    em: EntityManager,
    input: {
      ownerModule: string
      ownerId: string
      workflowId: string
      workflowName: string
      description?: string | null
      definition: unknown
      metadata?: Record<string, unknown> | null
      grantedFeatures?: string[] | null
      enabled?: boolean
      tenantId: string
      organizationId: string
      actorUserId?: string | null
    },
  ) => Promise<
    | { ok: true; definition: { workflowId: string }; created: boolean }
    | { ok: false; reason: 'owned_by_other'; definition: { workflowId: string } }
  >
  deleteOwnedDefinition: (
    em: EntityManager,
    params: { workflowId: string; ownerModule: string; ownerId: string; tenantId: string; organizationId: string },
  ) => Promise<boolean>
  findDefinitionsByWorkflowIds?: (
    em: EntityManager,
    params: { workflowIds: string[]; tenantId: string; organizationId: string },
  ) => Promise<Array<{ workflowId: string; definition?: unknown; grantedFeatures?: string[] | null }>>
}

/**
 * Local `tryResolve` for the OPTIONAL `workflows` peer, per
 * `packages/core/AGENTS.md` § Cross-Module Coupling — never a hard `requires`,
 * never an unconditional `container.resolve`.
 */
function tryResolveAuthoring(container: AwilixContainer): WorkflowDefinitionAuthoringLike | null {
  try {
    const service = container.resolve('workflowDefinitionAuthoring') as WorkflowDefinitionAuthoringLike | null
    return service && typeof service.upsertOwnedDefinition === 'function' ? service : null
  } catch {
    return null
  }
}

export type MaterializeResult =
  | { ok: true; workflowId: string }
  | { ok: false; reason: 'workflows_unavailable' | 'owned_by_other' }

/**
 * Generates (or refreshes) the workflow behind a single-agent process definition.
 *
 * `grantedFeatures` is passed straight through to the workflow, which is where
 * execution identity lives: a generated workflow runs as its own least-privilege
 * principal exactly like a hand-authored one. This module no longer provisions a
 * principal of its own — there is one execution-identity system and it belongs to
 * the definition that actually executes.
 */
export async function materializeSingleAgentWorkflow(
  container: AwilixContainer,
  em: EntityManager,
  input: {
    processDefinitionId: string
    processName: string
    description?: string | null
    singleAgent: ProcessSingleAgent
    milestoneKeys?: string[]
    grantedFeatures?: string[] | null
    enabled?: boolean
    tenantId: string
    organizationId: string
    actorUserId?: string | null
  },
): Promise<MaterializeResult> {
  const authoring = tryResolveAuthoring(container)
  if (!authoring) {
    logger.warn('workflows peer unavailable — cannot materialize the single-agent workflow', {
      processDefinitionId: input.processDefinitionId,
    })
    return { ok: false, reason: 'workflows_unavailable' }
  }

  const workflowId = generatedWorkflowId(input.processDefinitionId)
  const result = await authoring.upsertOwnedDefinition(em, {
    ownerModule: AGENT_WORKFLOW_OWNER_MODULE,
    ownerId: input.processDefinitionId,
    workflowId,
    workflowName: input.processName,
    description: input.description ?? null,
    definition: buildSingleAgentWorkflow({
      singleAgent: input.singleAgent,
      milestoneKeys: input.milestoneKeys,
    }),
    metadata: { category: 'Processes', tags: ['agent'] },
    grantedFeatures: input.grantedFeatures ?? null,
    enabled: input.enabled ?? true,
    tenantId: input.tenantId,
    organizationId: input.organizationId,
    actorUserId: input.actorUserId ?? null,
  })

  if (!result.ok) return { ok: false, reason: 'owned_by_other' }
  return { ok: true, workflowId }
}

/**
 * Reads back the agent config a generated workflow carries.
 *
 * The generated workflow is the SINGLE source of truth for it — the process
 * definition deliberately stores no copy — so the edit form re-reads it from
 * there rather than from a shadow column that could drift out of sync with the
 * graph the user may have edited in the Studio.
 *
 * Returns null for a workflow that is not a single generated agent step, which is
 * also the honest answer for one the user has since extended: once it has grown
 * past START → INVOKE_AGENT → END it is an ordinary workflow and the simplified
 * form can no longer describe it.
 */
export function readSingleAgentFromWorkflow(definitionData: unknown): ProcessSingleAgent | null {
  if (!definitionData || typeof definitionData !== 'object') return null
  const steps = (definitionData as { steps?: unknown }).steps
  if (!Array.isArray(steps)) return null
  const agentStep = steps.find(
    (step) => step && typeof step === 'object' && (step as Record<string, unknown>).stepId === SINGLE_AGENT_STEP_ID,
  ) as Record<string, unknown> | undefined
  if (!agentStep) return null
  const activities = agentStep.activities
  if (!Array.isArray(activities)) return null
  const invoke = activities.find(
    (activity) =>
      activity && typeof activity === 'object' && (activity as Record<string, unknown>).activityType === 'INVOKE_AGENT',
  ) as Record<string, unknown> | undefined
  if (!invoke) return null
  const config = invoke.config
  if (!config || typeof config !== 'object') return null
  const record = config as Record<string, unknown>
  const agentId = typeof record.agentId === 'string' ? record.agentId : null
  if (!agentId) return null
  const onResult = record.onResult
  if (!onResult || typeof onResult !== 'object') return null
  return {
    agentId,
    onResult: onResult as ProcessSingleAgent['onResult'],
    outputMapping:
      record.outputMapping && typeof record.outputMapping === 'object'
        ? (record.outputMapping as Record<string, string>)
        : null,
  }
}

/**
 * The per-definition workflow facts the process form needs, resolved in ONE query
 * for a whole list page. Fail-soft: an unavailable peer degrades every row to
 * "workflow mode, no grant visible" rather than taking the list down.
 */
export async function readWorkflowFacts(
  container: AwilixContainer,
  em: EntityManager,
  params: { workflowIds: string[]; tenantId: string; organizationId: string },
): Promise<Map<string, { singleAgent: ProcessSingleAgent | null; grantedFeatures: string[] }>> {
  const facts = new Map<string, { singleAgent: ProcessSingleAgent | null; grantedFeatures: string[] }>()
  const authoring = tryResolveAuthoring(container)
  if (!authoring || typeof authoring.findDefinitionsByWorkflowIds !== 'function') return facts
  try {
    const rows = await authoring.findDefinitionsByWorkflowIds(em, params)
    for (const row of rows) {
      if (facts.has(row.workflowId)) continue
      facts.set(row.workflowId, {
        singleAgent: readSingleAgentFromWorkflow(row.definition),
        grantedFeatures: Array.isArray(row.grantedFeatures) ? row.grantedFeatures : [],
      })
    }
  } catch (error) {
    logger.warn('workflow facts lookup failed', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
  return facts
}

/** Soft-deletes the generated workflow when its process definition is deleted. Best-effort. */
export async function removeGeneratedWorkflow(
  container: AwilixContainer,
  em: EntityManager,
  input: { processDefinitionId: string; workflowId: string; tenantId: string; organizationId: string },
): Promise<void> {
  const authoring = tryResolveAuthoring(container)
  if (!authoring) return
  try {
    await authoring.deleteOwnedDefinition(em, {
      workflowId: input.workflowId,
      ownerModule: AGENT_WORKFLOW_OWNER_MODULE,
      ownerId: input.processDefinitionId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
    })
  } catch (error) {
    logger.warn('generated workflow cleanup failed', {
      processDefinitionId: input.processDefinitionId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
