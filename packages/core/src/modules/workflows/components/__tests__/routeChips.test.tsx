/**
 * @jest-environment jsdom
 *
 * Step 2.10 (workflows UX Phase 3a, issue #4244): the chip row rendered along a
 * transition. Covers the condition chip, the activity-icon cap with its `+N`
 * overflow badge, the `otherwise` chip, semantic-zoom collapse to dots, the
 * accessible (never colour-only) labelling, and the chip → dialog-section bridge.
 */
import * as React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { WorkflowRouteChips } from '../WorkflowRouteChips'
import { buildRouteChipModel } from '../../lib/route-chips'
import { WORKFLOW_ROUTE_CHIP_EVENT, requestRouteChipSection, type RouteChipEventDetail } from '../../lib/route-chip-events'

const activity = (activityType: string, index: number) => ({
  activityId: `a${index}`,
  activityName: `Activity ${index}`,
  activityType,
  config: {},
})

describe('WorkflowRouteChips', () => {
  it('renders the condition summary and opens the condition section on click', () => {
    const onOpenSection = jest.fn()
    const model = buildRouteChipModel({ condition: { field: 'amount', operator: '>', value: 5000 } })

    renderWithProviders(<WorkflowRouteChips model={model} onOpenSection={onOpenSection} />)

    expect(screen.getByText('amount > 5000')).toBeInTheDocument()
    fireEvent.click(screen.getByText('amount > 5000'))
    expect(onOpenSection).toHaveBeenCalledWith('condition')
  })

  it('caps activity chips at three and renders a +N overflow badge', () => {
    const model = buildRouteChipModel({
      activities: [0, 1, 2, 3, 4].map((index) => activity('SEND_EMAIL', index)),
    })

    renderWithProviders(<WorkflowRouteChips model={model} onOpenSection={jest.fn()} />)

    const activityChips = screen.getAllByRole('button', { name: 'workflows.routeChips.activityLabel' })
    expect(activityChips).toHaveLength(3)
    expect(screen.getByTestId('route-chip-overflow')).toHaveTextContent('+2')
  })

  it('opens the activities section from the overflow badge', () => {
    const onOpenSection = jest.fn()
    const model = buildRouteChipModel({ activities: [0, 1, 2, 3].map((index) => activity('WAIT', index)) })

    renderWithProviders(<WorkflowRouteChips model={model} onOpenSection={onOpenSection} />)

    fireEvent.click(screen.getByTestId('route-chip-overflow'))
    expect(onOpenSection).toHaveBeenCalledWith('activities')
  })

  it('renders the otherwise chip with an icon, not colour alone', () => {
    const model = buildRouteChipModel({ hasConditionedSibling: true })

    const { container } = renderWithProviders(<WorkflowRouteChips model={model} />)

    const chip = screen.getByTestId('route-chip-otherwise')
    expect(chip).toHaveTextContent('workflows.routeChips.otherwise')
    expect(container.querySelector('[data-testid="route-chip-otherwise"] svg')).not.toBeNull()
  })

  it('collapses to dots below the semantic-zoom threshold', () => {
    const model = buildRouteChipModel({
      condition: { field: 'amount', operator: '>', value: 5000 },
      activities: [activity('WAIT', 0)],
    })

    renderWithProviders(<WorkflowRouteChips model={model} collapsed />)

    expect(screen.queryByTestId('route-chips')).not.toBeInTheDocument()
    const collapsed = screen.getByTestId('route-chips-collapsed')
    expect(collapsed).toHaveAttribute('aria-label', 'workflows.routeChips.collapsed')
    expect(collapsed.querySelectorAll('span')).toHaveLength(2)
  })

  it('renders nothing for a bare route', () => {
    renderWithProviders(<WorkflowRouteChips model={buildRouteChipModel({})} />)
    expect(screen.queryByTestId('route-chips')).not.toBeInTheDocument()
    expect(screen.queryByTestId('route-chips-collapsed')).not.toBeInTheDocument()
  })

  it('every chip carries an accessible label', () => {
    const model = buildRouteChipModel({
      condition: { field: 'amount', operator: '>', value: 1 },
      activities: [0, 1, 2, 3].map((index) => activity('CALL_API', index)),
    })

    renderWithProviders(<WorkflowRouteChips model={model} />)

    for (const button of screen.getAllByRole('button')) {
      expect(button.getAttribute('aria-label')).toBeTruthy()
    }
  })
})

describe('route chip radius', () => {
  it('uses a DS radius step, never the 4px `rounded` that is on neither scale', () => {
    const model = buildRouteChipModel({ condition: { field: 'amount', operator: '>', value: 5000 } })
    renderWithProviders(<WorkflowRouteChips model={model} />)

    const chip = screen.getAllByRole('button')[0]
    expect(chip.className).toContain('rounded-md')
    expect(chip.className).not.toMatch(/(?:^|\s)rounded(?:\s|$)/)
  })
})

describe('route chip → dialog bridge', () => {
  it('announces the requested edge and section on window', () => {
    const received: RouteChipEventDetail[] = []
    const listener = (event: Event) => received.push((event as CustomEvent<RouteChipEventDetail>).detail)
    window.addEventListener(WORKFLOW_ROUTE_CHIP_EVENT, listener)

    requestRouteChipSection('e_start_end', 'activities')

    window.removeEventListener(WORKFLOW_ROUTE_CHIP_EVENT, listener)
    expect(received).toEqual([{ edgeId: 'e_start_end', section: 'activities' }])
  })
})
