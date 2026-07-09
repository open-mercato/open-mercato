import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { AiModerationFlagRepository } from '../data/repositories/AiModerationFlagRepository'
import { emitAiAssistantEvent } from '../events'
import type { ModerationCategoryResult } from './moderation'

export interface RecordModerationFlagInput {
  tenantId: string | null
  organizationId: string | null
  agentId: string
  userId: string
  providerId: string
  modelId: string
  categories: Record<string, ModerationCategoryResult>
}

/**
 * Persists one `ai_moderation_flags` audit row and emits
 * `ai_assistant.moderation_flag.created`, best-effort.
 *
 * SAFETY CONTRACT: this MUST NEVER throw — the moderation rejection is the
 * primary effect and is thrown by the gate regardless. A missing tenant scope
 * (e.g. a system-scope caller) means the row cannot be tenant-scoped, so the
 * audit write is skipped. Any persistence/emit failure is logged and
 * swallowed so the user still receives the rejection.
 *
 * Spec `2026-06-04-ai-input-moderation-and-safety-identifiers`.
 */
export async function recordModerationFlag(
  input: RecordModerationFlagInput,
  container: AwilixContainer | undefined,
): Promise<void> {
  if (!container) return
  if (!input.tenantId) return

  let createdId: string | null = null
  try {
    const em = container.resolve<EntityManager>('em')
    const repo = new AiModerationFlagRepository(em.fork())
    const flag = await repo.create({
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      agentId: input.agentId,
      userId: input.userId,
      providerId: input.providerId,
      modelId: input.modelId,
      categories: input.categories,
    })
    createdId = flag.id
  } catch (error) {
    console.error(
      '[ai_assistant] failed to persist moderation flag (rejection still applies):',
      error instanceof Error ? error.message : error,
    )
    return
  }

  // Emit AFTER a successful write, detached so a failed emit never retroactively
  // fails the audit insert.
  try {
    const flaggedCategories = Object.entries(input.categories)
      .filter(([, value]) => value.flagged)
      .map(([name]) => name)
    await emitAiAssistantEvent('ai_assistant.moderation_flag.created', {
      id: createdId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      agentId: input.agentId,
      userId: input.userId,
      categories: flaggedCategories,
    })
  } catch (error) {
    console.error(
      '[ai_assistant] failed to emit moderation_flag.created (audit row persisted):',
      error instanceof Error ? error.message : error,
    )
  }
}
