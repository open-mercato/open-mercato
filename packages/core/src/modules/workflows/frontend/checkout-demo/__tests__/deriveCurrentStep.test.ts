/**
 * Regression tests for the checkout demo current-step derivation.
 *
 * The checkout demo page used to mirror `currentStep` into React state and keep
 * it in sync with an effect. This pins the derivation semantics that effect
 * produced so the render-time computation stays behavior-identical (#3172).
 */

import { describe, test, expect } from '@jest/globals'
import { deriveCurrentStep } from '../deriveCurrentStep'

const steps = [
  { stepId: 'start', stepName: 'Start', stepType: 'START' },
  { stepId: 'customer_info', stepName: 'Customer Information', stepType: 'USER_TASK' },
  { stepId: 'end', stepName: 'Complete', stepType: 'END' },
]

describe('deriveCurrentStep', () => {
  test('returns the matching step when currentStepId resolves to a known step', () => {
    expect(deriveCurrentStep('customer_info', steps)).toBe(steps[1])
  })

  test('returns null when there is no current step id (initial / reset state)', () => {
    expect(deriveCurrentStep(undefined, steps)).toBeNull()
  })

  test('returns null when currentStepId does not match any known step', () => {
    expect(deriveCurrentStep('unknown_step', steps)).toBeNull()
  })

  test('preserves the resolved step object so callers can read its stepType', () => {
    expect(deriveCurrentStep('end', steps)?.stepType).toBe('END')
  })

  test('is a pure derivation that never throws on an empty step list', () => {
    expect(deriveCurrentStep('customer_info', [])).toBeNull()
  })
})
