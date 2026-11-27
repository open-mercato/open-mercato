import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { emitAgentOrchestratorEvent } from '../../../events'
import type { AgentInvoker } from '../../runtime/persistence'
import type { IntegrityReviewRequest } from './types'

const logger = createLogger('agent_orchestrator').child({ component: 'integrity-review-requested' })

export type RunReviewRequestedInput = {
  agentRunId: string
  agentId: string
  workflowInstanceId?: string | null
  tenantId: string
  organizationId: string
  reviewRequest: IntegrityReviewRequest | undefined
  invokedByUserId?: string | null
}

/**
 * The human who started the run in person, or null for unattended runs
 * (workflow, API key, external agent token). Only an interactive caller is
 * addressed directly by the review-requested notification; everything else
 * goes to the module's narrow reviewer group.
 */
export function resolveInteractiveInvokerUserId(ctx: {
  userId?: string | null
  workflowInstanceId?: string | null
  invoker?: AgentInvoker
}): string | null {
  if (ctx.invoker) return ctx.invoker.kind === 'user' ? ctx.invoker.userId : null
  if (ctx.workflowInstanceId) return null
  return ctx.userId && ctx.userId.trim().length > 0 ? ctx.userId : null
}

export async function emitRunReviewRequested(
  input: RunReviewRequestedInput,
  emit: typeof emitAgentOrchestratorEvent = emitAgentOrchestratorEvent,
): Promise<boolean> {
  const { reviewRequest } = input
  if (!reviewRequest || reviewRequest.route !== 'review') return false
  try {
    await emit(
      'agent_orchestrator.run.review_requested',
      {
        agentRunId: input.agentRunId,
        agentId: input.agentId,
        ruleId: reviewRequest.ruleId,
        reasons: reviewRequest.reasons,
        ...(input.workflowInstanceId ? { workflowInstanceId: input.workflowInstanceId } : {}),
        ...(input.invokedByUserId ? { invokedByUserId: input.invokedByUserId } : {}),
        tenantId: input.tenantId,
        organizationId: input.organizationId,
      },
      { persistent: true },
    )
    return true
  } catch (error) {
    logger.warn('run.review_requested emit failed', {
      runId: input.agentRunId,
      error: error instanceof Error ? error.message : String(error),
    })
    getTelemetryRuntime()?.reportError(error, {
      module: 'agent_orchestrator',
      code: 'agent_orchestrator.review_requested_emit_failed',
      attributes: { runId: input.agentRunId },
    })
    return false
  }
}
