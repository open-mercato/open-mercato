import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('agent_orchestrator').child({ component: 'action-vocabulary' })

/**
 * The catalogue that bounds what a proposed action may effect.
 *
 * `effective = (listWorkflowSafeCommands() ∪ workflowActivityTypes()) ∩ agent.allowedActions`
 *
 * The union is the OUTER LIMIT: effects the platform already runs unattended under
 * its own per-tenant + feature gates, plus the registered activity types. An agent
 * therefore introduces no new effect surface. Per-agent narrowing (`allowedActions`)
 * lands with the agent-type work and only ever intersects — it can never widen.
 *
 * Checked again HERE, before the effect runs, and not only at agent registration:
 * an agent registered before a tenant revoked a safe command must not have a stale
 * proposal execute. Fail-closed — a catalogue that cannot be read blocks the effect
 * rather than waving it through, because a silently-dropped permission check reads
 * as a granted one.
 *
 * `workflows` is an OPTIONAL peer, so the catalogue is reached through a dynamic
 * import inside a try, exactly as `lib/disposition/resume.ts` reaches `sendSignal`.
 */
export type ActionVocabulary = {
  /** Workflow-safe command ids the platform declares runnable unattended. */
  commandIds: ReadonlySet<string>
  /** Registered activity type ids. */
  activityTypeIds: ReadonlySet<string>
  /** False when the catalogue could not be read at all (peer absent / load failure). */
  available: boolean
}

const EMPTY_VOCABULARY: ActionVocabulary = {
  commandIds: new Set<string>(),
  activityTypeIds: new Set<string>(),
  available: false,
}

export async function loadActionVocabulary(): Promise<ActionVocabulary> {
  try {
    const [safeCommands, activityRegistry] = await Promise.all([
      import('@open-mercato/core/modules/workflows/lib/workflow-safe-commands') as Promise<
        typeof import('@open-mercato/core/modules/workflows/lib/workflow-safe-commands')
      >,
      import('@open-mercato/core/modules/workflows/lib/activity-registry') as Promise<
        typeof import('@open-mercato/core/modules/workflows/lib/activity-registry')
      >,
    ])
    return {
      commandIds: new Set(safeCommands.listWorkflowSafeCommands().map((entry) => entry.commandId)),
      activityTypeIds: new Set(activityRegistry.listActivityTypes().map((entry) => entry.id)),
      available: true,
    }
  } catch (error) {
    logger.warn('action vocabulary unavailable; effects will be blocked', {
      error: error instanceof Error ? error.message : String(error),
    })
    return EMPTY_VOCABULARY
  }
}

/**
 * True when the resolved effect is still inside the catalogue: either the command the
 * action maps to is a currently-registered workflow-safe command, or the action type
 * itself names a registered activity type.
 */
export function isEffectWithinVocabulary(
  vocabulary: ActionVocabulary,
  actionType: string,
  commandId: string | null,
): boolean {
  if (!vocabulary.available) return false
  if (commandId && vocabulary.commandIds.has(commandId)) return true
  return vocabulary.activityTypeIds.has(actionType)
}
