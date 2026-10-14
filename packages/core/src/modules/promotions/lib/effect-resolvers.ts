import type { EvaluationContext, NormalizedBenefit, ResolvedEffect } from './types'

// Intentional placeholder for Step 2.3 — the real per-benefit-type effect math (amounts,
// unit selection via `selectUnits`, quantity-cap budget spending) ships there with its
// own spec read and its own tests. Do not flesh this out in Step 2.1.
export function resolveEffects(benefits: NormalizedBenefit[], context: EvaluationContext): ResolvedEffect[] {
  throw new Error('[internal] resolveEffects not implemented until Step 2.3')
}
