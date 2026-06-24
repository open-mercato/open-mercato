import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { ProposedAction } from '../../data/validators'

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
  for (const action of actions) {
    const commandId = ctx.actionCommandMap[action.type]
    if (!commandId) {
      results.push({ type: action.type, status: 'skipped', reason: `no command mapped for action type "${action.type}"` })
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
