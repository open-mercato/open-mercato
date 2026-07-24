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

const activities = [
  {
    activityId: 'call_api_1',
    activityName: 'Call API 1',
    activityType: 'CALL_API',
    config: { endpoint: '/api/one' },
  },
  {
    activityId: 'call_api_2',
    activityName: 'Call API 2',
    activityType: 'CALL_API',
    config: { endpoint: '/api/two' },
  },
]

function Harness() {
  const [transitions, setTransitions] = React.useState([
    {
      transitionId: 'transition_1',
      transitionName: 'Transition 1',
      fromStepId: 'start',
      toStepId: 'end',
      trigger: 'auto',
      activities,
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

const configTextareas = () =>
  screen.getAllByLabelText(/workflows\.activities\.config/i) as HTMLTextAreaElement[]

describe('TransitionsEditor activity config JSON', () => {
  it('keeps an invalid intermediate edit visible and reports it inline', () => {
    render(<Harness />)

    fireEvent.change(configTextareas()[0], { target: { value: '{"endpoint": ' } })

    expect(configTextareas()[0]).toHaveValue('{"endpoint": ')
    expect(configTextareas()[0]).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('propagates valid JSON and re-formats it on blur', () => {
    render(<Harness />)

    fireEvent.change(configTextareas()[0], { target: { value: '{"endpoint":"/api/updated"}' } })
    fireEvent.blur(configTextareas()[0])

    expect(configTextareas()[0]).toHaveValue(
      JSON.stringify({ endpoint: '/api/updated' }, null, 2),
    )
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('keeps an invalid draft attached to its activity when activities are reordered', () => {
    render(<Harness />)
    fireEvent.change(configTextareas()[1], { target: { value: '{"endpoint": ' } })

    const moveUpButtons = screen.getAllByTitle('common.moveUp')
    fireEvent.click(moveUpButtons[moveUpButtons.length - 1])

    expect(configTextareas()[0]).toHaveValue('{"endpoint": ')
    expect(configTextareas()[1]).toHaveValue(JSON.stringify({ endpoint: '/api/one' }, null, 2))
  })
})
