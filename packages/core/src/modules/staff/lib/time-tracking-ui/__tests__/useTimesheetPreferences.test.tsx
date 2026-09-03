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

function ViewHarness({
  periodKind,
  userKey,
  urlOverride,
}: {
  periodKind: TimesheetPeriodKind
  userKey?: string | null
  urlOverride?: string | null
}) {
  const [view, setView] = usePersistedView(periodKind, { userKey, urlOverride })
  return (
    <div>
      <span data-testid="view">{view}</span>
      <button type="button" onClick={() => setView('list')}>
        list
      </button>
    </div>
  )
}

function PeriodHarness({ userKey, urlOverride }: { userKey?: string | null; urlOverride?: string | null }) {
  const [kind, setKind] = usePersistedPeriodKind({ userKey, urlOverride })
  return (
    <div>
      <span data-testid="kind">{kind}</span>
      <button type="button" onClick={() => setKind('month')}>
        month
      </button>
    </div>
  )
}

function FilterHarness({ userKey }: { userKey?: string | null }) {
  const [value, setValue] = usePersistedFilterValue('project', { userKey })
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

/**
 * W1 — the documented `?period=` / `?view=` deep link. The query string is a
 * deliberate statement about what to show; `localStorage` is only a memory of
 * what was shown last, so the parameter outranks it — but a malformed one is
 * ignored rather than obeyed, because a broken link must still open a timesheet.
 */
describe('query-string overrides', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('lets a valid period parameter win over the remembered kind', () => {
    window.localStorage.setItem('staff.time_tracking.timesheet.period', 'week')
    render(<PeriodHarness urlOverride="quarter" />)
    expect(screen.getByTestId('kind')).toHaveTextContent('quarter')
  })

  it('lets a valid view parameter win over the remembered view', () => {
    window.localStorage.setItem('staff.time_tracking.timesheet.view:week', 'calendar')
    render(<ViewHarness periodKind="week" urlOverride="list" />)
    expect(screen.getByTestId('view')).toHaveTextContent('list')
  })

  it('falls an invalid parameter back to the remembered value', () => {
    window.localStorage.setItem('staff.time_tracking.timesheet.period', 'month')
    window.localStorage.setItem('staff.time_tracking.timesheet.view:month', 'list')
    render(
      <div>
        <PeriodHarness urlOverride="fortnight" />
        <ViewHarness periodKind="month" urlOverride="gantt" />
      </div>,
    )
    expect(screen.getByTestId('kind')).toHaveTextContent('month')
    expect(screen.getByTestId('view')).toHaveTextContent('list')
  })

  it('falls an invalid parameter back to the default when nothing is remembered', () => {
    render(
      <div>
        <PeriodHarness urlOverride="" />
        <ViewHarness periodKind="week" urlOverride="???" />
      </div>,
    )
    expect(screen.getByTestId('kind')).toHaveTextContent('week')
    expect(screen.getByTestId('view')).toHaveTextContent('grid')
  })

  it('re-asserts the link when the query string changes under it (back/forward)', () => {
    const { rerender } = render(<PeriodHarness urlOverride="month" />)
    expect(screen.getByTestId('kind')).toHaveTextContent('month')
    rerender(<PeriodHarness urlOverride="year" />)
    expect(screen.getByTestId('kind')).toHaveTextContent('year')
  })

  it('keeps the per-period memory when the period changes under a view parameter', () => {
    window.localStorage.setItem('staff.time_tracking.timesheet.view:month', 'list')
    const { rerender } = render(<ViewHarness periodKind="week" urlOverride="grid" />)
    expect(screen.getByTestId('view')).toHaveTextContent('grid')
    rerender(<ViewHarness periodKind="month" urlOverride="grid" />)
    expect(screen.getByTestId('view')).toHaveTextContent('list')
  })
})

/**
 * W10 — the preference is the signed-in person's, not the browser profile's.
 * The unscoped entry survives as a first-paint hint for the render that happens
 * before the staff member id resolves; the scoped entry is what each person
 * actually gets back.
 */
describe('per-user scoping', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it("keeps two people on the same browser out of each other's filters", () => {
    const first = render(<FilterHarness userKey="member-a" />)
    act(() => {
      screen.getByRole('button', { name: 'pick' }).click()
    })
    first.unmount()

    // Somebody else then picks a different project from the same browser.
    window.localStorage.setItem('staff.time_tracking.timesheet.projectId:member-b', 'project-2')
    window.localStorage.setItem('staff.time_tracking.timesheet.projectId', 'project-2')

    const mine = render(<FilterHarness userKey="member-a" />)
    expect(screen.getByTestId('project')).toHaveTextContent('project-9')
    mine.unmount()

    render(<FilterHarness userKey="member-b" />)
    expect(screen.getByTestId('project')).toHaveTextContent('project-2')
  })

  it('hydrates from the scoped entry once the staff member id arrives', () => {
    window.localStorage.setItem('staff.time_tracking.timesheet.period', 'week')
    window.localStorage.setItem('staff.time_tracking.timesheet.period:member-a', 'year')

    const { rerender } = render(<PeriodHarness userKey={null} />)
    expect(screen.getByTestId('kind')).toHaveTextContent('week')

    rerender(<PeriodHarness userKey="member-a" />)
    expect(screen.getByTestId('kind')).toHaveTextContent('year')
  })

  it('writes the unscoped hint alongside the scoped entry so the next first paint agrees', () => {
    render(<PeriodHarness userKey="member-a" />)
    act(() => {
      screen.getByRole('button', { name: 'month' }).click()
    })
    expect(window.localStorage.getItem('staff.time_tracking.timesheet.period:member-a')).toBe('month')
    expect(window.localStorage.getItem('staff.time_tracking.timesheet.period')).toBe('month')
  })
})
