import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { readContextId } from '../context'
import { recordSimulationDecision } from './hooks'
import { takePendingSimulationDecision } from './pendingDecisions'

let decisionTranslator: TranslateFn | null = null

/** Registered by the mounted apply widget so the (non-React) `onAfterSave` handler can report a failure. */
export function setSimulationDecisionTranslator(t: TranslateFn | null): void {
  decisionTranslator = t
}

/**
 * Records the `applied` decision of the pending simulation run after an owning editor saved (the
 * save itself is the guarded mutation and carries the optimistic lock). Never blocks or fails the
 * save: an already recorded decision (`decision_exists`) is silent, any other failure is flashed so
 * the user can record it from the result page; the server decides whether what was saved matches
 * the simulation.
 */
export async function recordAppliedSimulationAfterSave(_data: unknown, context: unknown): Promise<void> {
  const pending = takePendingSimulationDecision(readContextId(context, 'formId'), readContextId(context, 'recordId'))
  if (!pending) return
  const outcome = await recordSimulationDecision(pending.runId, 'applied')
  if (outcome.ok || outcome.code === 'decision_exists') return
  if (decisionTranslator) flash(decisionTranslator('insights.simulation.ui.apply.decisionFailed'), 'warning')
}
