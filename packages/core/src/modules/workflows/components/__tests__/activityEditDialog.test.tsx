/**
 * @jest-environment jsdom
 *
 * ActivityEditDialog (fidelity gap #6 follow-up) — clicking one activity chip
 * edits exactly that activity, not the whole transition. Pins the dialog's
 * contract: working copy (Cancel reverts), Save commits the edited activity,
 * Remove deletes it, and an escape hatch opens the full transition inspector.
 * `ActivityConfigFields`/`useActivityTypeOptions` are stubbed — they pull the
 * activity registry and have their own suites.
 */
import * as React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import type { Activity } from '../fields/ActivityArrayEditor'

jest.mock('../fields/ActivityConfigFields', () => ({
  ActivityConfigFields: () => <div data-testid="config-fields" />,
  hasActivityConfigForm: () => true,
}))
jest.mock('../fields/useActivityTypeOptions', () => ({
  useActivityTypeOptions: () => [{ value: 'INVOKE_AGENT', label: 'Invoke agent' }],
}))

import { ActivityEditDialog } from '../ActivityEditDialog'

const activity: Activity = {
  activityId: 'a1',
  activityName: 'Assess',
  activityType: 'INVOKE_AGENT',
  config: {},
}

function setup(overrides: Partial<React.ComponentProps<typeof ActivityEditDialog>> = {}) {
  const props = {
    open: true,
    onOpenChange: jest.fn(),
    activity,
    routeLabel: 'Assess → Issue refund',
    onSave: jest.fn(),
    onRemove: jest.fn(),
    onOpenFullTransition: jest.fn(),
    ...overrides,
  }
  renderWithProviders(<ActivityEditDialog {...props} />)
  return props
}

describe('ActivityEditDialog', () => {
  it('titles the modal for the activity and its route', () => {
    setup()
    expect(screen.getByTestId('workflow-activity-dialog')).toBeInTheDocument()
    expect(screen.getByText(/Edit activity/)).toBeInTheDocument()
    expect(screen.getByText(/Assess → Issue refund/)).toBeInTheDocument()
  })

  it('commits the edited activity only on Save (working copy)', () => {
    const props = setup()
    const nameInput = screen.getByDisplayValue('Assess')
    fireEvent.change(nameInput, { target: { value: 'Assess v2' } })
    expect(props.onSave).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Save activity' }))
    expect(props.onSave).toHaveBeenCalledTimes(1)
    expect(props.onSave.mock.calls[0][0]).toMatchObject({ activityId: 'a1', activityName: 'Assess v2' })
    expect(props.onOpenChange).toHaveBeenLastCalledWith(false)
  })

  it('does not commit on Cancel', () => {
    const props = setup()
    fireEvent.change(screen.getByDisplayValue('Assess'), { target: { value: 'Nope' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(props.onSave).not.toHaveBeenCalled()
    expect(props.onOpenChange).toHaveBeenLastCalledWith(false)
  })

  it('removes the activity and closes', () => {
    const props = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Remove activity' }))
    expect(props.onRemove).toHaveBeenCalledTimes(1)
    expect(props.onOpenChange).toHaveBeenLastCalledWith(false)
  })

  it('hands off to the full transition inspector', () => {
    const props = setup()
    fireEvent.click(screen.getByRole('button', { name: /Open full transition/ }))
    expect(props.onOpenFullTransition).toHaveBeenCalledTimes(1)
    expect(props.onOpenChange).toHaveBeenLastCalledWith(false)
  })

  it('saves on Cmd/Ctrl+Enter', () => {
    const props = setup()
    fireEvent.keyDown(screen.getByTestId('workflow-activity-dialog'), { key: 'Enter', metaKey: true })
    expect(props.onSave).toHaveBeenCalledTimes(1)
  })
})
