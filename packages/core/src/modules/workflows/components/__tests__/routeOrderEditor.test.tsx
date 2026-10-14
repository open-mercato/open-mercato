/**
 * @jest-environment jsdom
 *
 * Step 2.11 (workflows UX Phase 3a): the route-order inspector. Reordering
 * derives the priorities; the raw number is demoted behind an advanced toggle
 * and stays editable there. Drag is an enhancement — the move buttons are the
 * keyboard-reachable path.
 */
import * as React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { RouteOrderEditor } from '../fields/RouteOrderEditor'
import { canNormalizeRoutePriorities, type RouteOrderEntry } from '../../lib/route-priority'

const entries: RouteOrderEntry[] = [
  { transitionId: 'e_a', toStepId: 'approve', label: 'High value', priority: 100, hasCondition: true, isOtherwise: false },
  { transitionId: 'e_b', toStepId: 'review', label: 'Needs review', priority: 90, hasCondition: true, isOtherwise: false },
  { transitionId: 'e_c', toStepId: 'auto', label: 'Fallback', priority: 0, hasCondition: false, isOtherwise: true },
]

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => {
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    writable: true,
    value: ResizeObserverMock,
  })
})

describe('RouteOrderEditor', () => {
  it('renders routes in evaluation order with the derived priority visible', () => {
    renderWithProviders(<RouteOrderEditor id="routes" value={entries} setValue={jest.fn()} />)

    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveTextContent('High value')
    expect(rows[0]).toHaveTextContent('100')
    expect(rows[2]).toHaveTextContent('workflows.routeChips.otherwise')
  })

  it('moving a route up re-derives every priority', () => {
    const setValue = jest.fn()
    renderWithProviders(<RouteOrderEditor id="routes" value={entries} setValue={setValue} />)

    fireEvent.click(screen.getAllByRole('button', { name: 'workflows.routeOrder.moveUp' })[1])

    expect(setValue).toHaveBeenCalledWith([
      expect.objectContaining({ transitionId: 'e_b', priority: 100 }),
      expect.objectContaining({ transitionId: 'e_a', priority: 90 }),
      expect.objectContaining({ transitionId: 'e_c', priority: 0 }),
    ])
  })

  it('moving the default route up promotes it off the reserved 0 slot', () => {
    const setValue = jest.fn()
    renderWithProviders(<RouteOrderEditor id="routes" value={entries} setValue={setValue} />)

    fireEvent.click(screen.getAllByRole('button', { name: 'workflows.routeOrder.moveUp' })[2])

    expect(setValue).toHaveBeenCalledWith([
      expect.objectContaining({ transitionId: 'e_a', priority: 100 }),
      expect.objectContaining({ transitionId: 'e_c', priority: 90, isOtherwise: false }),
      expect.objectContaining({ transitionId: 'e_b', priority: 80 }),
    ])
  })

  it('disables the move buttons at the ends of the list', () => {
    renderWithProviders(<RouteOrderEditor id="routes" value={entries} setValue={jest.fn()} />)

    expect(screen.getAllByRole('button', { name: 'workflows.routeOrder.moveUp' })[0]).toBeDisabled()
    expect(screen.getAllByRole('button', { name: 'workflows.routeOrder.moveDown' })[2]).toBeDisabled()
  })

  it('reorders by drag and drop', () => {
    const setValue = jest.fn()
    renderWithProviders(<RouteOrderEditor id="routes" value={entries} setValue={setValue} />)

    const rows = screen.getAllByRole('listitem')
    fireEvent.dragStart(rows[2])
    fireEvent.dragOver(rows[0])
    fireEvent.drop(rows[0])

    expect(setValue).toHaveBeenCalledWith([
      expect.objectContaining({ transitionId: 'e_c', priority: 100 }),
      expect.objectContaining({ transitionId: 'e_a', priority: 90 }),
      expect.objectContaining({ transitionId: 'e_b', priority: 80 }),
    ])
  })

  it('keeps the raw priority number behind the advanced toggle', () => {
    const setValue = jest.fn()
    renderWithProviders(<RouteOrderEditor id="routes" value={entries} setValue={setValue} />)

    expect(screen.queryByLabelText('workflows.edgeEditor.priority')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('switch', { name: 'workflows.routeOrder.showPriorityNumbers' }))

    const inputs = screen.getAllByLabelText('workflows.edgeEditor.priority')
    expect(inputs).toHaveLength(3)

    fireEvent.change(inputs[0], { target: { value: '250' } })
    expect(setValue).toHaveBeenCalledWith([
      expect.objectContaining({ transitionId: 'e_a', priority: 250 }),
      expect.objectContaining({ transitionId: 'e_b', priority: 90 }),
      expect.objectContaining({ transitionId: 'e_c', priority: 0 }),
    ])
  })

  it('prompts to connect the step when it has no routes yet', () => {
    renderWithProviders(<RouteOrderEditor id="routes" value={[]} setValue={jest.fn()} />)
    expect(screen.getByText('workflows.routeOrder.empty')).toBeInTheDocument()
    expect(screen.queryByTestId('route-order-editor')).not.toBeInTheDocument()
  })
})

describe('code-source gating', () => {
  it('refuses to normalize a code-defined definition and allows its customized override', () => {
    expect(canNormalizeRoutePriorities('code')).toBe(false)
    expect(canNormalizeRoutePriorities('code_override')).toBe(true)
    expect(canNormalizeRoutePriorities('database')).toBe(true)
    expect(canNormalizeRoutePriorities(undefined)).toBe(true)
  })
})
