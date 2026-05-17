import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AiChatRequestContext } from './attachment-bridge-types'
import { AiTokenUsageRepository } from '../data/repositories/AiTokenUsageRepository'
import { emitAiAssistantEvent } from '../events'

export interface RecordTokenUsageInput {
  authContext: AiChatRequestContext
  agentId: string
  moduleId: string
  sessionId: string
  turnId: string
  stepIndex: number
  providerId: string
  modelId: string
  usage: {
    inputTokens?: number
    outputTokens?: number
    cachedInputTokens?: number
    reasoningTokens?: number
  }
  finishReason?: string
  loopAbortReason?: string
}

/**
 * Thin fire-and-forget collector that persists one row in `ai_token_usage_events`
 * and upserts the matching `ai_token_usage_daily` row inside a single transaction.
 *
 * CRITICAL SAFETY CONTRACT (R12):
 * - This function MUST NEVER throw — any failure is caught, logged at `warn`,
 *   and silently swallowed so the agent turn is never interrupted.
 * - Callers MUST invoke as `void recordTokenUsage(...)` without awaiting.
 *
 * After writing the row the function emits `ai.token_usage.recorded` so
 * downstream subscribers (cost dashboards, metering) can react without polling.
 *
 * Phase 6.3 of spec `2026-04-28-ai-agents-agentic-loop-controls`.
 */
export async function recordTokenUsage(
  input: RecordTokenUsageInput,
  container: AwilixContainer,
): Promise<void> {
  const tenantId = input.authContext.tenantId
  if (!tenantId) return

  try {
    const em = container.resolve<EntityManager>('em')
    const repo = new AiTokenUsageRepository(em.fork())

    const inputTokens = input.usage.inputTokens ?? 0
    const outputTokens = input.usage.outputTokens ?? 0
    const cachedInputTokens = input.usage.cachedInputTokens ?? 0
    const reasoningTokens = input.usage.reasoningTokens ?? 0

    const now = new Date()
    const day = now.toISOString().slice(0, 10)

    await repo.createEvent({
      tenantId,
      organizationId: input.authContext.organizationId ?? null,
      userId: input.authContext.userId,
      agentId: input.agentId,
      moduleId: input.moduleId,
      sessionId: input.sessionId,
      turnId: input.turnId,
      stepIndex: input.stepIndex,
      providerId: input.providerId,
      modelId: input.modelId,
      inputTokens,
      outputTokens,
      cachedInputTokens: input.usage.cachedInputTokens ?? null,
      reasoningTokens: input.usage.reasoningTokens ?? null,
      finishReason: input.finishReason ?? null,
      loopAbortReason: input.loopAbortReason ?? null,
    })

    await repo.upsertDaily({
      tenantId,
      organizationId: input.authContext.organizationId ?? null,
      day,
      agentId: input.agentId,
      modelId: input.modelId,
      providerId: input.providerId,
      sessionId: input.sessionId,
      inputTokens,
      outputTokens,
      cachedInputTokens,
      reasoningTokens,
    })
  } catch (error) {
    console.warn(
      '[AI token-usage] recordTokenUsage failed (turn continues unaffected):',
      error instanceof Error ? error.message : error,
    )
    return
  }

  // Emit event AFTER successful write — detached from the try/catch so a
  // failed event emission does not retroactively fail the DB write.
  try {
    await emitAiAssistantEvent(
      'ai.token_usage.recorded',
      {
        tenantId,
        agentId: input.agentId,
        sessionId: input.sessionId,
        turnId: input.turnId,
        stepIndex: input.stepIndex,
        modelId: input.modelId,
        inputTokens: input.usage.inputTokens ?? 0,
        outputTokens: input.usage.outputTokens ?? 0,
      },
      { persistent: false },
    )
  } catch (emitError) {
    console.warn(
      '[AI token-usage] Event emit failed (non-fatal):',
      emitError instanceof Error ? emitError.message : emitError,
    )
  }
}
