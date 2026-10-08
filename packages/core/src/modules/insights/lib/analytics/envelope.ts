import { isLowConfidence } from './stats'
import type { ResolvedWindow } from './window'
import type { AnalyticsEnvelope, SuppressionSummary } from './types'

export type EnvelopeBase = Omit<AnalyticsEnvelope, 'n' | 'lowConfidence' | 'suppressed'>

/** What every result builder needs: the window, the k threshold and the envelope fields. */
export type BuildContext = {
  window: ResolvedWindow
  k: number
  includeSyncRun: boolean
  envelope: EnvelopeBase
}

export function buildEnvelope(base: EnvelopeBase, n: number, suppressed: SuppressionSummary): AnalyticsEnvelope {
  return { ...base, n, lowConfidence: isLowConfidence(n), suppressed }
}
