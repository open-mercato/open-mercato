/**
 * Derives the current workflow step from the running instance's `currentStepId`
 * and the available workflow steps. This is a pure function of its inputs so the
 * checkout demo can compute it during render instead of mirroring it into state.
 */
export function deriveCurrentStep<TStep extends { stepId: string }>(
  currentStepId: string | undefined,
  steps: TStep[],
): TStep | null {
  if (!currentStepId) return null
  return steps.find((step) => step.stepId === currentStepId) ?? null
}
