/**
 * @jest-environment jsdom
 */
// T5.1 / T5.5 — the persisted chrome: which period, which view, which filters.
//
// The period-dependent default is the interesting part: a week opens on the grid
// (the fastest surface for filling one in) and everything longer opens on the
// calendar, and remembering a choice for one must not silently override the
// other.

import * as React from 'react'
import { act, render, screen } from '@testing-library/react'
import {
  defaultViewForPeriod,
  usePersistedFilterValue,
  usePersistedPeriodKind,
  usePersistedView,
  resolveEffectiveView,
  viewsForPeriod,
  ALL_OPTION_VALUE,
} from '../useTimesheetPreferences'
import type { TimesheetPeriodKind } from '../timesheetPeriod'

function ViewHarness({ periodKind }: { periodKind: TimesheetPeriodKind }) {
  const [view, setView] = usePersistedView(periodKind)
  return (
    <div>
      <span data-testid="view">{view}</span>
      <button type="button" onClick={() => setView('list')}>
        list
      </button>
    </div>
  )
}

function PeriodHarness() {
  const [kind, setKind] = usePersistedPeriodKind()
  return (
    <div>
      <span data-testid="kind">{kind}</span>
      <button type="button" onClick={() => setKind('month')}>
        month
      </button>
    </div>
  )
}

function FilterHarness() {
  const [value, setValue] = usePersistedFilterValue('project')
  return (
    <div>
      <span data-testid="project">{value}</span>
      <button type="button" onClick={() => setValue('project-9')}>
        pick
      </button>
    </div>
  )
}

describe('timesheet preferences', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('defaults the view to the grid for a week and the calendar for longer periods', () => {
    expect(defaultViewForPeriod('week')).toBe('grid')
    expect(defaultViewForPeriod('month')).toBe('calendar')
    expect(defaultViewForPeriod('quarter')).toBe('calendar')
    expect(defaultViewForPeriod('year')).toBe('calendar')
  })

  it('remembers the view per period kind, so a month choice does not override the week default', () => {
    const { rerender } = render(<ViewHarness periodKind="month" />)
    expect(screen.getByTestId('view')).toHaveTextContent('calendar')
    act(() => {
      screen.getByRole('button', { name: 'list' }).click()
    })
    expect(screen.getByTestId('view')).toHaveTextContent('list')

    rerender(<ViewHarness periodKind="week" />)
    expect(screen.getByTestId('view')).toHaveTextContent('grid')

    rerender(<ViewHarness periodKind="month" />)
    expect(screen.getByTestId('view')).toHaveTextContent('list')
  })

  it('restores the period kind on a remount', () => {
    const first = render(<PeriodHarness />)
    expect(screen.getByTestId('kind')).toHaveTextContent('week')
    act(() => {
      screen.getByRole('button', { name: 'month' }).click()
    })
    first.unmount()

    render(<PeriodHarness />)
    expect(screen.getByTestId('kind')).toHaveTextContent('month')
  })

  it('restores a filter and starts on "all"', () => {
    const first = render(<FilterHarness />)
    expect(screen.getByTestId('project')).toHaveTextContent(ALL_OPTION_VALUE)
    act(() => {
      screen.getByRole('button', { name: 'pick' }).click()
    })
    first.unmount()

    render(<FilterHarness />)
    expect(screen.getByTestId('project')).toHaveTextContent('project-9')
  })
})

describe('views available per period', () => {
  it('offers the grid for a week and a month only', () => {
    expect(viewsForPeriod('week')).toEqual(['calendar', 'list', 'grid'])
    expect(viewsForPeriod('month')).toEqual(['calendar', 'list', 'grid'])
    expect(viewsForPeriod('quarter')).toEqual(['calendar', 'list'])
    expect(viewsForPeriod('year')).toEqual(['calendar', 'list'])
  })

  it('falls a remembered grid choice back to the calendar on a period that has no grid', () => {
    expect(resolveEffectiveView('week', 'grid')).toBe('grid')
    expect(resolveEffectiveView('year', 'grid')).toBe('calendar')
    expect(resolveEffectiveView('year', 'list')).toBe('list')
  })
})
