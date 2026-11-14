import { LEGAL_MATTER_STAGES, type LegalMatterStage } from '../data/validators'

export type LegalMatterStepState = 'complete' | 'current' | 'pending'

export type LegalMatterStep = {
  stage: LegalMatterStage
  state: LegalMatterStepState
}

export function isLegalMatterStage(value: unknown): value is LegalMatterStage {
  return typeof value === 'string' && (LEGAL_MATTER_STAGES as readonly string[]).includes(value)
}

export function normalizeLegalMatterStage(value: unknown): LegalMatterStage {
  return isLegalMatterStage(value) ? value : 'requested'
}

/** Only matters still before release can be released; repeats are no-ops. */
export function canReleaseFromStage(value: unknown): boolean {
  const stage = normalizeLegalMatterStage(value)
  return stage === 'requested' || stage === 'review'
}

/** The four-step tracker: steps before the current stage are complete. */
export function buildLegalMatterSteps(current: unknown): LegalMatterStep[] {
  const currentIndex = LEGAL_MATTER_STAGES.indexOf(normalizeLegalMatterStage(current))
  return LEGAL_MATTER_STAGES.map((stage, index) => ({
    stage,
    state: index < currentIndex ? 'complete' : index === currentIndex ? 'current' : 'pending',
  }))
}
