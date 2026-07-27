/**
 * DI registration + signature regression guard.
 *
 * The engine resolves every handler by DI token, so both the token set and the
 * legacy instance-based arities are contract surfaces (BACKWARD_COMPATIBILITY
 * § DI keys / signatures). Adding `conditionHandler` must not move any of them.
 */

import { describe, test, expect } from '@jest/globals'
import { createContainer, asValue } from 'awilix'
import { register } from '../di'

function buildContainer() {
  const container = createContainer()
  container.register({ em: asValue({}) })
  register(container)
  return container
}

describe('workflows DI registrations', () => {
  test('registers every engine handler token, including conditionHandler', () => {
    const container = buildContainer()
    const tokens = [
      'workflowExecutor',
      'stepHandler',
      'transitionHandler',
      'activityExecutor',
      'eventLogger',
      'signalHandler',
      'timerHandler',
      'conditionHandler',
    ]
    for (const token of tokens) {
      expect(container.hasRegistration(token)).toBe(true)
    }
  })

  test('preserves the legacy instance-based handler signatures', () => {
    const container = buildContainer()

    const stepHandler = container.resolve<Record<string, (...args: unknown[]) => unknown>>('stepHandler')
    expect(stepHandler.enterStep.length).toBe(5)
    expect(stepHandler.exitStep.length).toBe(3)
    expect(stepHandler.executeStep.length).toBe(6)

    const transitionHandler =
      container.resolve<Record<string, (...args: unknown[]) => unknown>>('transitionHandler')
    expect(transitionHandler.findValidTransitions.length).toBe(4)
    expect(transitionHandler.executeTransition.length).toBe(6)

    const timerHandler = container.resolve<Record<string, (...args: unknown[]) => unknown>>('timerHandler')
    expect(timerHandler.fireTimer.length).toBe(3)
  })

  test('exposes the condition handler entry points the worker and wake API call', () => {
    const container = buildContainer()
    const conditionHandler =
      container.resolve<Record<string, (...args: unknown[]) => unknown>>('conditionHandler')

    expect(typeof conditionHandler.evaluateWaitCondition).toBe('function')
    expect(typeof conditionHandler.wakeConditionWaiters).toBe('function')
    expect(conditionHandler.evaluateWaitCondition.length).toBe(3)
    expect(conditionHandler.wakeConditionWaiters.length).toBe(3)
  })
})
