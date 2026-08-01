/**
 * @jest-environment jsdom
 *
 * A single activity chip opens the focused single-activity modal, identifying
 * WHICH activity it is (fidelity gap #6 follow-up). When no per-activity handler
 * is wired it falls back to the full-transition section, preserving the prior
 * behavior.
 */
import * as React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { WorkflowRouteChips } from '../WorkflowRouteChips'
import type { RouteChipModel } from '../../lib/route-chips'

const oneActivity: RouteChipModel = {
  conditionSummary: null,
  activities: [{ activityId: 'a1', activityType: 'CALL_API' }],
  overflowCount: 0,
  isOtherwise: false,
  isEmpty: false,
}

describe('WorkflowRouteChips activity chip', () => {
  it('opens the specific activity when a per-activity handler is provided', () => {
    const onOpenActivity = jest.fn()
    const onOpenSection = jest.fn()
    renderWithProviders(
      <WorkflowRouteChips model={oneActivity} onOpenActivity={onOpenActivity} onOpenSection={onOpenSection} />,
    )
    fireEvent.click(screen.getByRole('button'))
    expect(onOpenActivity).toHaveBeenCalledWith('a1')
    expect(onOpenSection).not.toHaveBeenCalled()
  })

  it('falls back to the activities section when no per-activity handler is wired', () => {
    const onOpenSection = jest.fn()
    renderWithProviders(<WorkflowRouteChips model={oneActivity} onOpenSection={onOpenSection} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onOpenSection).toHaveBeenCalledWith('activities')
  })
})
