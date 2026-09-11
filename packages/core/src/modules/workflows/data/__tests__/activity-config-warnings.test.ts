import { describe, test, expect } from '@jest/globals'
import { collectActivityConfigWarnings } from '../activity-config-warnings'

const activity = (
  activityType: string,
  config: Record<string, unknown>,
  suffix = '1',
) => ({
  activityId: `act-${suffix}`,
  activityName: `Activity ${suffix}`,
  activityType,
  config,
})

const definitionWithTransitionActivities = (activities: unknown[]) => ({
  steps: [
    { stepId: 'start', stepName: 'Start', stepType: 'START' },
    { stepId: 'end', stepName: 'End', stepType: 'END' },
  ],
  transitions: [
    {
      transitionId: 't-start-end',
      fromStepId: 'start',
      toStepId: 'end',
      trigger: 'auto',
      activities,
    },
  ],
})

describe('collectActivityConfigWarnings', () => {
  test('returns no warnings for valid configs', () => {
    const definition = definitionWithTransitionActivities([
      activity('SEND_EMAIL', { to: 'ops@example.com', subject: 'Order shipped' }, '1'),
      activity('UPDATE_ENTITY', { commandId: 'sales.orders.update', input: { status: 'done' } }, '2'),
      activity('WAIT', { duration: '5m' }, '3'),
    ])

    expect(collectActivityConfigWarnings(definition)).toEqual([])
  })

  test('returns no warnings for template-string configs', () => {
    const definition = definitionWithTransitionActivities([
      activity('SEND_EMAIL', { to: '{{context.email}}', subject: '{{context.subject}}' }, '1'),
      activity('WAIT', { duration: '{{context.delay}}' }, '2'),
    ])

    expect(collectActivityConfigWarnings(definition)).toEqual([])
  })

  test('flags SEND_EMAIL missing "to" with a transition-scoped config path', () => {
    const definition = definitionWithTransitionActivities([
      activity('SEND_EMAIL', { subject: 'Order shipped' }),
    ])

    const warnings = collectActivityConfigWarnings(definition)
    expect(warnings).toHaveLength(1)
    expect(warnings[0].path).toEqual(['transitions', 0, 'activities', 0, 'config', 'to'])
    expect(warnings[0].message).toContain('expected string')
  })

  test('flags UPDATE_ENTITY missing "commandId"', () => {
    const definition = definitionWithTransitionActivities([
      activity('SEND_EMAIL', { to: 'ops@example.com', subject: 'ok' }, '1'),
      activity('UPDATE_ENTITY', { input: {} }, '2'),
    ])

    const warnings = collectActivityConfigWarnings(definition)
    expect(warnings).toHaveLength(1)
    expect(warnings[0].path).toEqual(['transitions', 0, 'activities', 1, 'config', 'commandId'])
  })

  test('walks step-level activities with a steps-scoped path', () => {
    const definition = {
      steps: [
        { stepId: 'start', stepName: 'Start', stepType: 'START' },
        {
          stepId: 'notify',
          stepName: 'Notify',
          stepType: 'AUTOMATED',
          activities: [activity('EMIT_EVENT', {})],
        },
      ],
      transitions: [],
    }

    const warnings = collectActivityConfigWarnings(definition)
    expect(warnings).toHaveLength(1)
    expect(warnings[0].path).toEqual(['steps', 1, 'activities', 0, 'config', 'eventName'])
  })

  test('ignores unknown activity types and malformed shapes', () => {
    const definition = {
      steps: [{ stepId: 'start', activities: [activity('CUSTOM_TYPE', {})] }],
      transitions: [
        { transitionId: 't1', activities: 'not-an-array' },
        null,
        { transitionId: 't2', activities: [null, { config: {} }] },
      ],
    }

    expect(collectActivityConfigWarnings(definition)).toEqual([])
  })
})
