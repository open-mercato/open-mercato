/**
 * @jest-environment jsdom
 */
// W1 — the timesheet's query-string contract (spec § screens 11/12):
// `/backend/staff/time-tracking/timesheet?period=<week|month>&view=<calendar|list|grid>`.
//
// The assertions here are about the wiring the page owns: the URL beating the
// remembered preference on mount, the URL being rewritten in place (never
// pushed) when a control changes, and back/forward re-asserting the link. The
// preference semantics themselves live in the hook's own suite.

import * as React from 'react'
import { act, render, screen } from '@testing-library/react'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useSearchParams } from 'next/navigation'
import TimesheetPage from '../page'

const STAFF_MEMBER_ID = '11111111-1111-4111-8111-111111111111'

const replaceMock = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, push: jest.fn(), refresh: jest.fn() }),
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
jest.mock('../GridView', () => ({ GridView: () => <div data-testid="grid-view" /> }))

/**
 * The period selector and the view switch stand in as plain buttons: what these
 * tests assert is which value the page hands them and what it does with the one
 * they hand back, not how a segmented control renders.
 */
jest.mock('../../../../../lib/time-tracking-ui/PeriodSelector', () => ({
  PeriodSelector: ({
    periodKind,
    onPeriodKindChange,
  }: {
    periodKind: string
    onPeriodKindChange: (next: string) => void
  }) => (
    <div>
      <span data-testid="period-kind">{periodKind}</span>
      <button type="button" onClick={() => onPeriodKindChange('quarter')}>
        pick quarter
      </button>
    </div>
  ),
  TimesheetFilterSelect: () => null,
}))

jest.mock('../../../../../lib/time-tracking-ui/TimesheetViewSwitch', () => ({
  TimesheetViewSwitch: ({ view, onViewChange }: { view: string; onViewChange: (next: string) => void }) => (
    <div>
      <span data-testid="view">{view}</span>
      <button type="button" onClick={() => onViewChange('list')}>
        pick list
      </button>
    </div>
  ),
}))

const readApiResultMock = readApiResultOrThrow as jest.MockedFunction<typeof readApiResultOrThrow>
const useBackendChromeMock = useBackendChrome as jest.MockedFunction<typeof useBackendChrome>
const useConfirmDialogMock = useConfirmDialog as jest.MockedFunction<typeof useConfirmDialog>
const useSearchParamsMock = useSearchParams as jest.MockedFunction<typeof useSearchParams>

function stubApi(url: string): unknown {
  if (url.startsWith('/api/staff/team-members/self')) return { member: { id: STAFF_MEMBER_ID } }
  if (url.startsWith('/api/staff/timesheets/my-projects')) return { items: [] }
  if (url.startsWith('/api/staff/timesheets/time-entries')) return { items: [], totalPages: 1 }
  if (url.startsWith('/api/staff/timesheets/settings')) return { targets: { dailyHours: null } }
  return {}
}

function setSearch(query: string): void {
  useSearchParamsMock.mockReturnValue(new URLSearchParams(query) as unknown as ReturnType<typeof useSearchParams>)
}

async function renderPage(): Promise<void> {
  await act(async () => {
    render(<TimesheetPage />)
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  window.localStorage.clear()
  readApiResultMock.mockImplementation(async (url: string) => stubApi(url) as never)
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
  setSearch('')
})

describe('timesheet query-string contract', () => {
  it('lets ?period= and ?view= win over the remembered preference', async () => {
    window.localStorage.setItem('staff.time_tracking.timesheet.period', 'week')
    window.localStorage.setItem('staff.time_tracking.timesheet.view:month', 'grid')
    setSearch('period=month&view=list')

    await renderPage()

    expect(screen.getByTestId('period-kind')).toHaveTextContent('month')
    expect(screen.getByTestId('view')).toHaveTextContent('list')
    expect(screen.getByTestId('list-view')).toBeInTheDocument()
  })

  it('falls an unparseable parameter back to the remembered preference instead of crashing', async () => {
    window.localStorage.setItem('staff.time_tracking.timesheet.period', 'month')
    window.localStorage.setItem('staff.time_tracking.timesheet.view:month', 'list')
    setSearch('period=fortnight&view=gantt')

    await renderPage()

    expect(screen.getByTestId('period-kind')).toHaveTextContent('month')
    expect(screen.getByTestId('view')).toHaveTextContent('list')
  })

  it('replaces the URL in place when the period changes, preserving the other parameters', async () => {
    setSearch('view=calendar&panel=team')

    await renderPage()
    await act(async () => {
      screen.getByRole('button', { name: 'pick quarter' }).click()
    })

    expect(replaceMock).toHaveBeenCalledTimes(1)
    const [target, options] = replaceMock.mock.calls[0]
    const params = new URLSearchParams(String(target).slice(1))
    expect(params.get('period')).toBe('quarter')
    expect(params.get('view')).toBe('calendar')
    expect(params.get('panel')).toBe('team')
    expect(options).toEqual({ scroll: false })
    expect(screen.getByTestId('period-kind')).toHaveTextContent('quarter')
  })

  it('replaces the URL in place when the view changes', async () => {
    setSearch('period=week')

    await renderPage()
    await act(async () => {
      screen.getByRole('button', { name: 'pick list' }).click()
    })

    expect(replaceMock).toHaveBeenCalledTimes(1)
    const params = new URLSearchParams(String(replaceMock.mock.calls[0][0]).slice(1))
    expect(params.get('view')).toBe('list')
    expect(params.get('period')).toBe('week')
    expect(screen.getByTestId('view')).toHaveTextContent('list')
  })

  it('follows a back/forward navigation that changes the query string', async () => {
    setSearch('period=month&view=list')
    let rendered: ReturnType<typeof render> | null = null
    await act(async () => {
      rendered = render(<TimesheetPage />)
    })
    expect(screen.getByTestId('period-kind')).toHaveTextContent('month')

    setSearch('period=year&view=calendar')
    await act(async () => {
      rendered?.rerender(<TimesheetPage />)
    })

    expect(screen.getByTestId('period-kind')).toHaveTextContent('year')
    expect(screen.getByTestId('view')).toHaveTextContent('calendar')
  })

  it('scopes the remembered preference to the resolved staff member', async () => {
    await renderPage()
    await act(async () => {
      screen.getByRole('button', { name: 'pick quarter' }).click()
    })

    expect(window.localStorage.getItem(`staff.time_tracking.timesheet.period:${STAFF_MEMBER_ID}`)).toBe('quarter')
  })
})
