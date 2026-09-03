/**
 * DI registration + signature regression guard.
 *
 * The engine resolves every handler by DI token, so both the token set and the
 * legacy instance-based arities are contract surfaces (BACKWARD_COMPATIBILITY
 * § DI keys / signatures). Adding `conditionHandler` must not move any of them.
 */

import { describe, test, expect } from '@jest/globals'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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
      'taskHandler',
      'workInboxService',
    ]
    for (const token of tokens) {
      expect(container.hasRegistration(token)).toBe(true)
    }
  })

  test('exposes the work inbox entry points the inbox routes call', () => {
    const container = buildContainer()
    const workInboxService =
      container.resolve<Record<string, (...args: unknown[]) => unknown>>('workInboxService')

    expect(typeof workInboxService.listWorkInbox).toBe('function')
    expect(typeof workInboxService.listClaimableWorkInbox).toBe('function')
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

  test('exposes the task lifecycle entry points the task routes call', () => {
    const container = buildContainer()
    const taskHandler = container.resolve<Record<string, (...args: unknown[]) => unknown>>('taskHandler')

    expect(taskHandler.completeUserTask.length).toBe(3)
    expect(taskHandler.claimUserTask.length).toBe(5)
  })
})

/**
 * Module rule #1: services are resolved by DI token, never imported from `lib/`
 * and called. The task routes were the module's own exception — they imported
 * `lib/task-handler` directly, which put them outside every DI seam (test
 * doubles, enterprise overrides, request-scoped instrumentation).
 */
describe('task routes resolve the handler through DI', () => {
  const routes = [
    join('tasks', '[id]', 'claim', 'route.ts'),
    join('tasks', '[id]', 'complete', 'route.ts'),
  ]

  for (const route of routes) {
    test(`${route} resolves taskHandler instead of importing the lib`, () => {
      const source = readFileSync(join(__dirname, '..', 'api', route), 'utf8')

      expect(source).toContain("container.resolve<TaskHandlerService>('taskHandler')")
      expect(source).not.toMatch(/^import\s+\{[^}]*\}\s+from\s+'[^']*lib\/task-handler'/m)
    })
  }
})
