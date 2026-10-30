import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { ProposedAction } from '../../data/validators'
import {
  isEffectWithinVocabulary,
  loadActionVocabulary,
  type ActionVocabulary,
} from './actionVocabulary'

export type ExecuteProposalCtx = {
  commandBus: CommandBus
  commandCtx: CommandRuntimeContext
  /**
   * Maps a proposed action `type` to the OM command id that effects it. Callers
   * (area 03 disposition) supply this so each action runs through the audited
   * command runner (audit/events/index fire). Actions whose type has no mapping
   * are returned as `skipped`.
   */
  actionCommandMap: Record<string, string>
  /**
   * Pre-resolved action vocabulary. Callers running many proposals may load it once;
   * omitted, it is read per call. Never widen it — it is the catalogue, not a grant.
   */
  vocabulary?: ActionVocabulary
  /**
   * The proposing agent's narrowed vocabulary (`AgentRegistryEntry.allowedActions`).
   * Omitted/null means the agent declared no narrowing and is bounded by the catalogue
   * alone; an EMPTY list denies every action, which is what a declaration whose entries
   * were all dropped at registration must mean.
   */
  allowedActions?: readonly string[] | null
}

export type ExecuteProposalActionResult =
  | { type: string; status: 'ok'; result: unknown }
  | { type: string; status: 'skipped'; reason: string }
  | { type: string; status: 'error'; error: string }

/**
 * Optional helper: run a proposal's actions through OM Commands, audited.
 * Callers that gate proposals (area 03) call this only AFTER disposition; the
 * playground never auto-executes. Disposition (area 03) may instead run
 * effectors as workflow activities — this helper is not mandatory in the MVP.
 */
export async function executeProposal(
  actions: ProposedAction[],
  ctx: ExecuteProposalCtx,
): Promise<ExecuteProposalActionResult[]> {
  const results: ExecuteProposalActionResult[] = []
  // Server-side vocabulary re-check, immediately before the effect. The proposal may
  // have been made under a catalogue the tenant has since narrowed; a stale approval
  // must not carry an effect the platform no longer declares runnable.
  const vocabulary = ctx.vocabulary ?? (await loadActionVocabulary())
  for (const action of actions) {
    const commandId = ctx.actionCommandMap[action.type]
    if (!commandId) {
      results.push({ type: action.type, status: 'skipped', reason: `no command mapped for action type "${action.type}"` })
      continue
    }
    if (!isEffectWithinVocabulary(vocabulary, action.type, commandId, ctx.allowedActions)) {
      results.push({
        type: action.type,
        status: 'skipped',
        reason: `action type "${action.type}" is outside the effective action vocabulary`,
      })
      continue
    }
    try {
      const { result } = await ctx.commandBus.execute(commandId, {
        input: action.payload,
        ctx: ctx.commandCtx,
      })
      results.push({ type: action.type, status: 'ok', result })
    } catch (err) {
      results.push({ type: action.type, status: 'error', error: err instanceof Error ? err.message : String(err) })
    }
  }
  return results
}
