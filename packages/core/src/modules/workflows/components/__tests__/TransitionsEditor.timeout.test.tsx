/** @jest-environment jsdom */

/**
 * This editor's timeout box is millisecond-only, but it displays a legacy
 * `timeout` string normalized to milliseconds. It must therefore drop that
 * alias when it writes, or clearing the box leaves the old timeout in force.
 */
import * as React from 'react'
import { fireEvent, render } from '@testing-library/react'
import { resolveActivityTimeoutMs } from '../../lib/activityTimeoutFields'
import { TransitionsEditor } from '../TransitionsEditor'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => (typeof fallback === 'string' ? fallback : key),
}))

type ActivityFields = { timeout?: string; timeoutMs?: number }

function renderEditor(activity: ActivityFields) {
  const onChange = jest.fn()
  const transitions = [
    {
      transitionId: 'transition_1',
      transitionName: 'Approve',
      fromStepId: 'start',
      toStepId: 'end',
      trigger: 'AUTOMATIC',
      activities: [
        {
          activityId: 'call_api_1',
          activityName: 'Call API',
          activityType: 'CALL_API',
          config: { endpoint: '/api/x' },
          ...activity,
        },
      ],
    },
  ]
  const { container } = render(<TransitionsEditor value={transitions} onChange={onChange} />)
  const input = container.querySelector<HTMLInputElement>('#activity-0-0-timeout')
  if (!input) throw new Error('[internal] timeout input not rendered')
  return { input, onChange }
}

function lastActivity(onChange: jest.Mock): ActivityFields {
  const [transitions] = onChange.mock.calls[onChange.mock.calls.length - 1] as [
    Array<{ activities: ActivityFields[] }>,
  ]
  return transitions[0].activities[0]
}

describe('TransitionsEditor timeout binding', () => {
  it('shows a legacy duration alias normalized to milliseconds', () => {
    const { input } = renderEditor({ timeout: 'PT30S' })
    expect(input.value).toBe('30000')
  })

  it('clears the timeout when the box is emptied on a legacy activity', () => {
    const { input, onChange } = renderEditor({ timeout: 'PT30S' })

    fireEvent.change(input, { target: { value: '' } })

    expect(resolveActivityTimeoutMs(lastActivity(onChange))).toBeUndefined()
  })

  it('replaces a legacy alias with the edited value', () => {
    const { input, onChange } = renderEditor({ timeout: 'PT30S' })

    fireEvent.change(input, { target: { value: '45000' } })

    expect(resolveActivityTimeoutMs(lastActivity(onChange))).toBe(45000)
  })
})
