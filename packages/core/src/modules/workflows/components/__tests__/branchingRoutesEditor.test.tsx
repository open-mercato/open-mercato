/**
 * @jest-environment jsdom
 *
 * Step 2.2 (workflows UX Phase 3a): the If/Else and Switch route inspectors.
 * Both edit the branching step's OUTGOING TRANSITIONS — a case route carries an
 * inline condition (ConditionBuilder) or a Business Rule reference, exactly one
 * route stays unconditioned as the otherwise route, and duplicate Switch case
 * values are surfaced as a warning.
 */
import * as React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { IfElseRoutesField, SwitchRoutesField } from '../fields/BranchingRoutesEditor'
import { buildCaseCondition, type BranchingRouteDraft } from '../../lib/branching-routes'

const CASE_BADGE_TEXT = 'Case'
const OTHERWISE_BADGE_TEXT = 'Otherwise'
const MAKE_OTHERWISE_TEXT = 'Use as otherwise'
const USE_RULE_TEXT = 'Use a Business Rule instead'
const SELECT_RULE_TEXT = 'Select rule'
const DUPLICATE_TEXT = /Duplicate case value/
const NO_ROUTES_TEXT = /Connect this step to its next steps/

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
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => undefined
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined
})

const twoUnconditionedRoutes: BranchingRouteDraft[] = [
  { transitionId: 'e_branch_approve', toStepId: 'approve', kind: 'otherwise', mode: 'inline' },
  { transitionId: 'e_branch_reject', toStepId: 'reject', kind: 'otherwise', mode: 'inline' },
]

describe('IfElseRoutesField', () => {
  it('auto-designates one otherwise route and keeps the first connection as the case', () => {
    renderWithProviders(
      <IfElseRoutesField id="routes" value={twoUnconditionedRoutes} setValue={jest.fn()} />,
    )

    expect(screen.getAllByText(CASE_BADGE_TEXT)).toHaveLength(1)
    expect(screen.getAllByText(OTHERWISE_BADGE_TEXT)).toHaveLength(1)
  })

  it('lets the author move the otherwise designation to another route', () => {
    const setValue = jest.fn()
    renderWithProviders(
      <IfElseRoutesField id="routes" value={twoUnconditionedRoutes} setValue={setValue} />,
    )

    fireEvent.click(screen.getByRole('button', { name: MAKE_OTHERWISE_TEXT }))

    expect(setValue).toHaveBeenCalledWith([
      expect.objectContaining({ transitionId: 'e_branch_approve', kind: 'otherwise' }),
      expect.objectContaining({ transitionId: 'e_branch_reject', kind: 'case' }),
    ])
  })

  it('switches the case route between an inline condition and a Business Rule reference', () => {
    const setValue = jest.fn()
    const routes: BranchingRouteDraft[] = [
      {
        transitionId: 'e_branch_approve',
        toStepId: 'approve',
        kind: 'case',
        mode: 'inline',
        condition: buildCaseCondition('total', '100'),
      },
      { transitionId: 'e_branch_reject', toStepId: 'reject', kind: 'otherwise', mode: 'inline' },
    ]

    const { rerender } = renderWithProviders(
      <IfElseRoutesField id="routes" value={routes} setValue={setValue} />,
    )

    expect(screen.queryByRole('button', { name: SELECT_RULE_TEXT })).not.toBeInTheDocument()

    fireEvent.click(screen.getByLabelText(USE_RULE_TEXT))
    expect(setValue).toHaveBeenCalledWith([
      expect.objectContaining({ transitionId: 'e_branch_approve', mode: 'rule' }),
      expect.objectContaining({ transitionId: 'e_branch_reject', kind: 'otherwise' }),
    ])

    rerender(
      <IfElseRoutesField
        id="routes"
        value={routes.map((route) => (route.kind === 'case' ? { ...route, mode: 'rule' as const } : route))}
        setValue={setValue}
      />,
    )
    expect(screen.getByRole('button', { name: SELECT_RULE_TEXT })).toBeInTheDocument()
  })

  it('explains that routes come from canvas connections when there are none', () => {
    renderWithProviders(<IfElseRoutesField id="routes" value={[]} setValue={jest.fn()} />)
    expect(screen.getByText(NO_ROUTES_TEXT)).toBeInTheDocument()
  })
})

describe('SwitchRoutesField', () => {
  const switchValue = {
    field: 'order.status',
    routes: [
      {
        transitionId: 'e_branch_paid',
        toStepId: 'paid',
        kind: 'case' as const,
        mode: 'inline' as const,
        caseLabel: 'Paid',
        caseValue: 'paid',
      },
      { transitionId: 'e_branch_other', toStepId: 'other', kind: 'otherwise' as const, mode: 'inline' as const },
    ],
  }

  it('edits the switched field and keeps the required otherwise route', () => {
    const setValue = jest.fn()
    renderWithProviders(<SwitchRoutesField id="switch" value={switchValue} setValue={setValue} />)

    expect(screen.getByDisplayValue('order.status')).toBeInTheDocument()
    expect(screen.getAllByText(OTHERWISE_BADGE_TEXT)).toHaveLength(1)

    fireEvent.change(screen.getByDisplayValue('order.status'), { target: { value: 'order.channel' } })
    expect(setValue).toHaveBeenCalledWith(
      expect.objectContaining({ field: 'order.channel', routes: expect.any(Array) }),
    )
  })

  it('records a case value edit on the right route', () => {
    const setValue = jest.fn()
    renderWithProviders(<SwitchRoutesField id="switch" value={switchValue} setValue={setValue} />)

    fireEvent.change(screen.getByDisplayValue('paid'), { target: { value: 'refunded' } })

    expect(setValue).toHaveBeenCalledWith({
      field: 'order.status',
      routes: [
        expect.objectContaining({ transitionId: 'e_branch_paid', caseValue: 'refunded' }),
        expect.objectContaining({ transitionId: 'e_branch_other', kind: 'otherwise' }),
      ],
    })
  })

  it('warns about duplicate case values', () => {
    renderWithProviders(
      <SwitchRoutesField
        id="switch"
        value={{
          field: 'order.status',
          routes: [
            {
              transitionId: 'a',
              toStepId: 'x',
              kind: 'case',
              mode: 'inline',
              caseValue: 'paid',
            },
            {
              transitionId: 'b',
              toStepId: 'y',
              kind: 'case',
              mode: 'inline',
              caseValue: 'paid',
            },
            { transitionId: 'c', toStepId: 'z', kind: 'otherwise', mode: 'inline' },
          ],
        }}
        setValue={jest.fn()}
      />,
    )

    expect(screen.getByText(DUPLICATE_TEXT)).toBeInTheDocument()
  })
})
