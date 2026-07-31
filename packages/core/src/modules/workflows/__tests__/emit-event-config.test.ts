import { describe, expect, test } from '@jest/globals'
import { workflowsConfig } from '../workflows'

/**
 * Guards issue #4322: the EMIT_EVENT activity executor requires a
 * `config.eventName` field and throws at runtime when it is missing
 * (`executeEmitEvent` in lib/activity-executor.ts). The simple-approval
 * example shipped with `config.eventType` instead, so every started
 * instance failed at its first async activity. This walks all code-defined
 * workflows shipped by this module and asserts each EMIT_EVENT activity
 * carries a usable `eventName` (and not the silently ignored `eventType`).
 */
describe('code-defined workflows EMIT_EVENT config', () => {
  const emitEventActivities = workflowsConfig.workflows.flatMap((workflow) =>
    workflow.definition.transitions.flatMap((transition) =>
      (transition.activities ?? [])
        .filter((activity) => activity.activityType === 'EMIT_EVENT')
        .map((activity) => ({
          workflowId: workflow.workflowId,
          transitionId: transition.transitionId,
          activityId: activity.activityId,
          config: (activity.config ?? {}) as Record<string, unknown>,
        })),
    ),
  )

  test('module ships EMIT_EVENT activities to guard', () => {
    expect(emitEventActivities.length).toBeGreaterThan(0)
  })

  test.each(emitEventActivities.map((entry) => [
    `${entry.workflowId} / ${entry.transitionId} / ${entry.activityId}`,
    entry,
  ] as const))('%s declares eventName required by the executor', (_label, entry) => {
    expect(typeof entry.config.eventName).toBe('string')
    expect((entry.config.eventName as string).length).toBeGreaterThan(0)
    expect(entry.config).not.toHaveProperty('eventType')
  })
})
