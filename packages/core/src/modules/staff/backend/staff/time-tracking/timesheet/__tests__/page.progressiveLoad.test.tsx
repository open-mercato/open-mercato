/**
 * @jest-environment jsdom
 */
// The timesheet's load used to be one sequential chain of throwing reads: a single
// failing endpoint took the whole period down, flashed once, and left a screen that
// was indistinguishable from an empty week. The assignment list and the entry pages
// are now settled independently, so a partial answer renders as data plus a banner,
// and only a total failure gets the unavailable state. Both carry a retry.

import * as React from 'react'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useSearchParams } from 'next/navigation'
import { todayIso } from '../../../../../lib/time-tracking-ui/timesheetPeriod'
import TimesheetPage from '../page'

const STAFF_MEMBER_ID = '11111111-1111-4111-8111-111111111111'
const PROJECT_ID = '22222222-2222-4222-8222-222222222222'
const ENTRY_ID = '33333333-3333-4333-8333-333333333333'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn(), refresh: jest.fn() }),
  useSearchParams: jest.fn(),
}))

const mockTranslate = (key: string, fallback?: string | Record<string, string | number>): string =>
  typeof fallback === 'string' ? fallback : key

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => mockTranslate }))

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => 1,
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))

jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({ useBackendChrome: jest.fn() }))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({ useConfirmDialog: jest.fn() }))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: async ({ operation }: { operation: () => Promise<unknown> }) => operation(),
    retryLastMutation: jest.fn(async () => true),
  }),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => {
  const actual = jest.requireActual('@open-mercato/ui/backend/utils/apiCall')
  return { ...actual, apiCall: jest.fn(), apiCallOrThrow: jest.fn(), readApiResultOrThrow: jest.fn() }
})

jest.mock('../../../../../lib/timesheets-ui/TimerBar', () => ({ TimerBar: () => null }))
jest.mock('../../../../../lib/timesheets-ui/CreateProjectDialog', () => ({ CreateProjectDialog: () => null }))
jest.mock('../../../../../lib/time-tracking-ui/TimeEntryDialog', () => ({ TimeEntryDialog: () => null }))
jest.mock('../../../../../lib/timesheets-ui/ListView', () => ({
  ListView: () => <div data-testid="list-view" />,
}))
jest.mock('../../../../../lib/time-tracking-ui/TimesheetCalendar', () => ({
  TimesheetCalendar: () => <div data-testid="calendar-view" />,
}))
jest.mock('../../../../../lib/time-tracking-ui/TimesheetPeriodFooter', () => ({
  TimesheetPeriodFooter: () => null,
}))
jest.mock('../../../../../lib/time-tracking-ui/PeriodSelector', () => ({
  PeriodSelector: ({ onAnchorDateChange }: { onAnchorDateChange: (next: string) => void }) => (
    <button type="button" onClick={() => onAnchorDateChange(mockNextAnchor())}>
      change period
    </button>
  ),
  TimesheetFilterSelect: () => null,
}))
jest.mock('../../../../../lib/time-tracking-ui/TimesheetViewSwitch', () => ({
  TimesheetViewSwitch: () => null,
}))
jest.mock('../GridView', () => ({
  GridView: ({ entries }: { entries: unknown[] }) => (
    <div data-testid="grid-view" data-entry-count={entries.length} />
  ),
}))

/** Each click lands on a NEW anchor, or the range never changes and no reload fires. */
const mockAnchors = ['2026-01-15', '2026-03-15', '2026-05-15']
let mockAnchorIndex = 0
function mockNextAnchor(): string {
  return mockAnchors[mockAnchorIndex++ % mockAnchors.length]
}

const readApiResultMock = readApiResultOrThrow as jest.MockedFunction<typeof readApiResultOrThrow>
const useBackendChromeMock = useBackendChrome as jest.MockedFunction<typeof useBackendChrome>
const useConfirmDialogMock = useConfirmDialog as jest.MockedFunction<typeof useConfirmDialog>
const useSearchParamsMock = useSearchParams as jest.MockedFunction<typeof useSearchParams>

const PARTIAL_MESSAGE = 'Some timesheet data could not be loaded. Try again.'
const UNAVAILABLE_MESSAGE = 'Timesheet data is temporarily unavailable.'

type Failing = { assignments?: boolean; entries?: boolean; projects?: boolean; emptyPeriod?: boolean }

/**
 * Every read answers unless this run marks it failing, so each test names only the
 * endpoint it is knocking over.
 */
function stubReads(failing: Failing = {}): void {
  readApiResultMock.mockImplementation(async (url) => {
    const href = String(url)
    if (href.startsWith('/api/staff/team-members/self')) {
      return { member: { id: STAFF_MEMBER_ID } } as never
    }
    if (href.startsWith('/api/staff/timesheets/my-projects')) {
      if (failing.assignments) throw new Error('assignments unavailable')
      return { items: [{ time_project_id: PROJECT_ID, show_in_grid: true }] } as never
    }
    if (href.startsWith('/api/staff/timesheets/time-entries')) {
      if (failing.entries) throw new Error('entries unavailable')
      if (failing.emptyPeriod) return { items: [], totalPages: 1 } as never
      return {
        items: [
          {
            id: ENTRY_ID,
            date: todayIso(),
            time_project_id: PROJECT_ID,
            duration_minutes: 60,
            staff_member_id: STAFF_MEMBER_ID,
          },
        ],
        totalPages: 1,
      } as never
    }
    if (href.startsWith('/api/staff/timesheets/time-projects')) {
      if (failing.projects) throw new Error('projects unavailable')
      return { items: [{ id: PROJECT_ID, name: 'Apollo', code: 'APL', color: null }] } as never
    }
    if (href.startsWith('/api/staff/timesheets/settings')) {
      return { targets: { dailyHours: null } } as never
    }
    return {} as never
  })
}

/**
 * Like `stubReads`, but every entry read parks on a promise this returns control
 * over, so two loads can be held in flight and settled out of order.
 */
function stubDeferredEntries(): {
  release: (index: number, rows: Record<string, unknown>[]) => void
  pending: () => number
} {
  const gates: Array<(rows: Record<string, unknown>[]) => void> = []
  readApiResultMock.mockImplementation(async (url: string | URL | Request) => {
    const href = String(url)
    if (href.startsWith('/api/staff/team-members/self')) {
      return { member: { id: STAFF_MEMBER_ID } } as never
    }
    if (href.startsWith('/api/staff/timesheets/my-projects')) {
      return { items: [{ time_project_id: PROJECT_ID, show_in_grid: true }] } as never
    }
    if (href.startsWith('/api/staff/timesheets/time-entries')) {
      return new Promise((resolve) => {
        gates.push((rows) => resolve({ items: rows, totalPages: 1 } as never))
      }) as never
    }
    if (href.startsWith('/api/staff/timesheets/time-projects')) {
      return { items: [{ id: PROJECT_ID, name: 'Apollo', code: 'APL', color: null }] } as never
    }
    if (href.startsWith('/api/staff/timesheets/settings')) {
      return { targets: { dailyHours: null } } as never
    }
    return {} as never
  })
  return {
    release: (index, rows) => gates[index]?.(rows),
    pending: () => gates.length,
  }
}

function entryRow(id: string): Record<string, unknown> {
  return {
    id,
    date: todayIso(),
    time_project_id: PROJECT_ID,
    duration_minutes: 60,
    staff_member_id: STAFF_MEMBER_ID,
  }
}

async function renderPage(): Promise<void> {
  await act(async () => {
    render(<TimesheetPage />)
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockAnchorIndex = 0
  window.localStorage.clear()
  useBackendChromeMock.mockReturnValue({
    payload: { grantedFeatures: ['staff.timesheets.manage_own'] },
    isLoading: false,
    isReady: true,
    refresh: jest.fn(),
  } as unknown as ReturnType<typeof useBackendChrome>)
  useConfirmDialogMock.mockReturnValue({
    confirm: jest.fn(async () => true),
    ConfirmDialogElement: null,
  } as unknown as ReturnType<typeof useConfirmDialog>)
  useSearchParamsMock.mockReturnValue(
    new URLSearchParams('view=grid') as unknown as ReturnType<typeof useSearchParams>,
  )
})

describe('timesheet progressive load', () => {
  it('renders the period with a banner when only the assignment read fails', async () => {
    stubReads({ assignments: true })

    await renderPage()

    // The entries answered, so the view is still on screen — the banner reports
    // what is missing rather than replacing everything with an error.
    expect(screen.getByTestId('grid-view')).toBeInTheDocument()
    expect(screen.getByText(PARTIAL_MESSAGE)).toBeInTheDocument()
    expect(screen.queryByText(UNAVAILABLE_MESSAGE)).not.toBeInTheDocument()
  })

  it('withholds the period entirely when the entry read fails', async () => {
    // Entries are not one degradable read among several: without them the numbers
    // for this period are unknown, and this screen feeds `rounded_minutes` (D-7 —
    // the only input to cost). Showing a grid whose cells cannot be trusted would
    // be worse than showing nothing, so this failure is never a mere banner.
    stubReads({ entries: true })

    await renderPage()

    expect(screen.getByText(UNAVAILABLE_MESSAGE)).toBeInTheDocument()
    expect(screen.queryByTestId('grid-view')).not.toBeInTheDocument()
    expect(screen.queryByText(PARTIAL_MESSAGE)).not.toBeInTheDocument()
  })

  it('shows the unavailable state, not an empty period, when nothing loads', async () => {
    stubReads({ assignments: true, entries: true })

    await renderPage()

    expect(screen.getByText(UNAVAILABLE_MESSAGE)).toBeInTheDocument()
    expect(screen.queryByTestId('grid-view')).not.toBeInTheDocument()
  })

  it('clears the failure state when a retry succeeds', async () => {
    stubReads({ assignments: true, entries: true })
    await renderPage()
    expect(screen.getByText(UNAVAILABLE_MESSAGE)).toBeInTheDocument()

    stubReads()
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    })

    expect(screen.queryByText(UNAVAILABLE_MESSAGE)).not.toBeInTheDocument()
    expect(screen.queryByText(PARTIAL_MESSAGE)).not.toBeInTheDocument()
    expect(screen.getByTestId('grid-view')).toBeInTheDocument()
  })

  it('treats an empty period as loaded, not as a failure, when assignments fail', async () => {
    // An ordinary week with nothing logged yet answers with zero rows. That is a
    // truthful period, so it must still render its views — hiding them behind the
    // unavailable state would leave the member unable to add the first entry.
    stubReads({ assignments: true, emptyPeriod: true })

    await renderPage()

    expect(screen.getByTestId('grid-view')).toBeInTheDocument()
    expect(screen.getByText(PARTIAL_MESSAGE)).toBeInTheDocument()
    expect(screen.queryByText(UNAVAILABLE_MESSAGE)).not.toBeInTheDocument()
  })

  it('renders an empty period cleanly when every read succeeds', async () => {
    stubReads({ emptyPeriod: true })

    await renderPage()

    expect(screen.getByTestId('grid-view')).toBeInTheDocument()
    expect(screen.queryByText(PARTIAL_MESSAGE)).not.toBeInTheDocument()
    expect(screen.queryByText(UNAVAILABLE_MESSAGE)).not.toBeInTheDocument()
  })

  it('degrades a failing project read to a banner instead of unwinding the load', async () => {
    // `allowNullResult` tolerates an empty body but not a non-2xx, so this read
    // used to throw past `setData` and strand the previous period on screen.
    stubReads({ projects: true })

    await renderPage()

    expect(screen.getByTestId('grid-view')).toBeInTheDocument()
    expect(screen.getByText(PARTIAL_MESSAGE)).toBeInTheDocument()
    expect(screen.queryByText(UNAVAILABLE_MESSAGE)).not.toBeInTheDocument()
  })

  it('never shows the previous period once a reload leaves the period unknown', async () => {
    // Opens degraded-but-loaded, which is what puts a Retry on screen to drive
    // the reload with.
    stubReads({ projects: true })
    await renderPage()
    expect(screen.getByTestId('grid-view')).toBeInTheDocument()

    // The entry read is what makes a period knowable; losing it must take the
    // views down rather than leave last period's numbers labelled as this one's.
    stubReads({ entries: true })
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    })

    expect(screen.getByText(UNAVAILABLE_MESSAGE)).toBeInTheDocument()
    expect(screen.queryByTestId('grid-view')).not.toBeInTheDocument()
  })

  it('ignores a superseded load that settles after the one that replaced it', async () => {
    // `loadData` is rebuilt whenever the period or a filter changes, so two loads
    // can be in flight — and the read timeout makes it easy for the OLDER one to
    // be the slower. Last-writer-wins would put the previous period's entries
    // under the current period's heading, which is exactly the symptom the
    // failure states below exist to prevent.
    stubReads()
    await renderPage()

    // Armed only now, so the two loads the period changes trigger both park.
    const gate = stubDeferredEntries()
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'change period' }))
    })
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'change period' }))
    })
    expect(gate.pending()).toBe(2)

    // The newer load answers first with one entry, then the older one it
    // superseded answers with three.
    await act(async () => {
      gate.release(1, [entryRow(ENTRY_ID)])
    })
    await act(async () => {
      gate.release(0, [entryRow('a'), entryRow('b'), entryRow('c')])
    })

    expect(screen.getByTestId('grid-view')).toHaveAttribute('data-entry-count', '1')
  })

  it('does not let a superseded load clear the spinner of the load that replaced it', async () => {
    stubReads()
    await renderPage()

    const gate = stubDeferredEntries()
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'change period' }))
    })
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'change period' }))
    })

    // Only the older load settles; the newer one is still in flight, so the page
    // must still read as refreshing rather than announcing itself done.
    await act(async () => {
      gate.release(0, [entryRow('a')])
    })

    expect(document.querySelector('.opacity-50')).not.toBeNull()
  })

  it('drops the previous period when the self read is what fails', async () => {
    // `/self` is the one read left that can unwind the whole load, and it lands
    // in the outer catch — which is half the fix for showing a stale period, and
    // was the half nothing covered.
    stubReads()
    await renderPage()
    expect(screen.getByTestId('grid-view')).toHaveAttribute('data-entry-count', '1')

    readApiResultMock.mockImplementation(async (url: string | URL | Request) => {
      if (String(url).startsWith('/api/staff/team-members/self')) throw new Error('self unavailable')
      return {} as never
    })
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'change period' }))
    })

    expect(screen.getByText(UNAVAILABLE_MESSAGE)).toBeInTheDocument()
    expect(screen.queryByTestId('grid-view')).not.toBeInTheDocument()
  })

  it('keeps a healthy load free of both failure states', async () => {
    stubReads()

    await renderPage()

    expect(screen.getByTestId('grid-view')).toBeInTheDocument()
    expect(screen.queryByText(PARTIAL_MESSAGE)).not.toBeInTheDocument()
    expect(screen.queryByText(UNAVAILABLE_MESSAGE)).not.toBeInTheDocument()
  })
})
