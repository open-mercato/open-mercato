/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallbackOrParams?: unknown) =>
    typeof fallbackOrParams === 'string' ? fallbackOrParams : key,
}))

import { TransitionsEditor } from '../TransitionsEditor'

function Harness() {
  const [transitions, setTransitions] = React.useState([
    {
      transitionId: 'transition_1',
      transitionName: 'Transition 1',
      fromStepId: 'start',
      toStepId: 'end',
      trigger: 'auto',
      activities: [
        {
          activityId: 'call_api_1',
          activityName: 'Call API 1',
          activityType: 'CALL_API',
          config: { endpoint: '/api/one' },
        },
      ],
    },
  ])
  return (
    <TransitionsEditor
      value={transitions}
      onChange={setTransitions}
      steps={[
        { stepId: 'start', stepName: 'Start' },
        { stepId: 'end', stepName: 'End' },
      ]}
    />
  )
}

const activityIdInput = () =>
  document.getElementById('activity-0-0-id') as HTMLInputElement

const configTextarea = () =>
  document.getElementById('activity-0-0-config') as HTMLTextAreaElement

describe('TransitionsEditor activity identity fields', () => {
  it('keeps the activity id input mounted and focused while typing', () => {
    render(<Harness />)
    const before = activityIdInput()
    before.focus()
    expect(document.activeElement).toBe(before)

    fireEvent.change(before, { target: { value: 'call_api_1x' } })

    const after = activityIdInput()
    expect(after).toHaveValue('call_api_1x')
    expect(after).toBe(before)
    expect(document.activeElement).toBe(after)
  })

  it('keeps an in-progress config draft when the activity id is edited', () => {
    render(<Harness />)
    fireEvent.change(configTextarea(), { target: { value: '{"endpoint": ' } })
    expect(configTextarea()).toHaveValue('{"endpoint": ')

    fireEvent.change(activityIdInput(), { target: { value: 'call_api_renamed' } })

    expect(configTextarea()).toHaveValue('{"endpoint": ')
  })

  it('keeps an in-progress config draft when the transition id is edited', () => {
    render(<Harness />)
    fireEvent.change(configTextarea(), { target: { value: '{"endpoint": ' } })

    const transitionIdInput = document.getElementById('transition-0-id') as HTMLInputElement
    transitionIdInput.focus()
    fireEvent.change(transitionIdInput, { target: { value: 'transition_renamed' } })

    expect(document.activeElement).toBe(document.getElementById('transition-0-id'))
    expect(configTextarea()).toHaveValue('{"endpoint": ')
  })
})
