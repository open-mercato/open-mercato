/**
 * The one seam between this module and the AI runtime (spec §9).
 *
 * `@open-mercato/ai-assistant` is an OPTIONAL peer of `@open-mercato/core`: a
 * deployment can ship without it, and until `yarn generate` has run the agent
 * registry does not know this module's agent either. So the runtime is reached
 * through a DYNAMIC import inside a try/catch — the same shape
 * `agent_orchestrator` uses to reach this module's disposition task, and the
 * same rule `packages/core/AGENTS.md` states for an optional peer.
 *
 * Absence is a NORMAL outcome here, not an error: `resolveWorkflowDraftRunner`
 * answers `null`, the route reports "AI authoring is not available", and the
 * canvas is untouched. Tests stub THIS module rather than the AI package, so no
 * test path can reach a real model.
 *
 * SERVER ONLY. Never import from a client component.
 */

import type { AwilixContainer } from 'awilix'
import type { ZodTypeAny } from 'zod'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('workflows')

export interface WorkflowDraftAuthContext {
  tenantId: string | null
  organizationId: string | null
  userId: string
  features: string[]
  isSuperAdmin: boolean
}

export interface WorkflowDraftRunnerInput {
  agentId: string
  prompt: string
  schemaName: string
  schema: ZodTypeAny
  authContext: WorkflowDraftAuthContext
  container: AwilixContainer
}

/** Whatever the model produced, unvalidated — the caller owns interpretation. */
export type WorkflowDraftRunner = (input: WorkflowDraftRunnerInput) => Promise<unknown>

type AgentRuntimeModule = {
  runAiAgentObject?: (input: Record<string, unknown>) => Promise<{ mode: string; object: unknown }>
}

type AgentRegistryModule = {
  loadAgentRegistry?: () => Promise<unknown>
}

/**
 * Resolve the object-mode runner, or `null` when the AI runtime is not
 * installed. Never throws: a missing optional peer is a configuration fact, not
 * a failure to report as a stack trace.
 */
export async function resolveWorkflowDraftRunner(): Promise<WorkflowDraftRunner | null> {
  let runtime: AgentRuntimeModule
  let registry: AgentRegistryModule
  try {
    runtime = (await import(
      '@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-runtime'
    )) as unknown as AgentRuntimeModule
    registry = (await import(
      '@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-registry'
    )) as unknown as AgentRegistryModule
  } catch (error) {
    logger.debug('AI assistant runtime is not installed; workflow draft authoring is unavailable', {
      err: error,
    })
    return null
  }

  const runAiAgentObject = runtime.runAiAgentObject
  if (typeof runAiAgentObject !== 'function') return null

  return async (input) => {
    // The generated agent registry is what makes this module's agent
    // resolvable; without it the runtime answers `agent_unknown`, which the
    // caller classifies as "unavailable".
    if (typeof registry.loadAgentRegistry === 'function') await registry.loadAgentRegistry()

    const result = await runAiAgentObject({
      agentId: input.agentId,
      input: input.prompt,
      authContext: input.authContext,
      container: input.container,
      // Object-mode tool loop: the agent's one read-only tool
      // (workflows.validate_workflow_definition) lets it self-correct against
      // the real definition schema before returning. The runtime's `enableTools`
      // branch still finalizes through `Output.object`, so `mode` stays
      // 'generate' and the assertion below is unaffected.
      enableTools: true,
      output: { schemaName: input.schemaName, schema: input.schema, mode: 'generate' },
    })

    if (result.mode !== 'generate') {
      throw Object.assign(new Error('[internal] Workflow draft agent must run in generate mode'), {
        code: 'execution_mode_not_supported',
      })
    }
    return result.object
  }
}
