/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { apiCall, readApiResultOrThrow, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { deleteCrud, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { clearAllOperations, markUndoSuccess, pushOperation } from '@open-mercato/ui/backend/operations/store'
import { serializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'
import TimeTrackingEntriesPage from '../page'

const OPEN_ID = '11111111-1111-4111-8111-111111111111'
const NON_BILLABLE_ID = '22222222-2222-4222-8222-222222222222'
const OVERRIDE_ID = '33333333-3333-4333-8333-333333333333'
const LOCKED_ID = '44444444-4444-4444-8444-444444444444'
const EUR_ID = '55555555-5555-4555-8555-555555555555'
const TASK_ID = '66666666-6666-4666-8666-666666666666'
const PROJECT_ID = '77777777-7777-4777-8777-777777777777'
const REPORT_ID = '88888888-8888-4888-8888-888888888888'
const SELF_MEMBER_ID = '99999999-9999-4999-8999-999999999999'
const OTHER_MEMBER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ENTRIES_PATH = '/backend/staff/time-tracking/entries'

let mockSearch = ''
const mockRouterReplace = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockRouterReplace, push: jest.fn(), refresh: jest.fn() }),
  usePathname: () => '/backend/staff/time-tracking/entries',
  useSearchParams: () => new URLSearchParams(mockSearch),
}))

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    params[key] === undefined ? match : String(params[key]),
  )
}

const mockTranslate = (
  key: string,
  fallbackOrParams?: string | Record<string, string | number>,
  params?: Record<string, string | number>,
): string => {
  if (typeof fallbackOrParams === 'string') return interpolate(fallbackOrParams, params)
  return interpolate(key, fallbackOrParams)
}

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => mockTranslate }))

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => 1,
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))

jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({ useBackendChrome: jest.fn() }))

jest.mock('@open-mercato/ui/backend/conflicts', () => ({ surfaceRecordConflict: jest.fn(() => false) }))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: async ({ operation }: { operation: () => Promise<unknown> }) => operation(),
    retryLastMutation: jest.fn(async () => true),
  }),
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({ useConfirmDialog: jest.fn() }))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => {
  const actual = jest.requireActual('@open-mercato/ui/backend/utils/apiCall')
  return {
    ...actual,
    apiCall: jest.fn(),
    apiCallOrThrow: jest.fn(),
    readApiResultOrThrow: jest.fn(),
    withScopedApiRequestHeaders: jest.fn(
      async (_headers: Record<string, string>, run: () => Promise<unknown>) => run(),
    ),
  }
})

jest.mock('@open-mercato/ui/backend/utils/crud', () => {
  const actual = jest.requireActual('@open-mercato/ui/backend/utils/crud')
  return { ...actual, deleteCrud: jest.fn(), updateCrud: jest.fn() }
})

jest.mock('../../../../../lib/time-tracking-ui/TimeEntryDialog', () => ({
  TimeEntryDialog: () => null,
}))

jest.mock('@open-mercato/ui/backend/RowActions', () => ({
  RowActions: ({ items = [] }: { items?: Array<Record<string, unknown>> }) => (
    <div data-testid="row-actions">
      {items.map((item) =>
        typeof item.href === 'string' ? (
          <a key={String(item.id)} data-testid={`row-action-${String(item.id)}`} href={item.href}>
            {String(item.label)}
          </a>
        ) : (
          <button
            key={String(item.id)}
            type="button"
            data-testid={`row-action-${String(item.id)}`}
            onClick={item.onSelect as () => void}
          >
            {String(item.label)}
          </button>
        ),
      )}
    </div>
  ),
}))

/**
 * The DataTable stand-in renders the real column definitions — every `cell`
 * renderer, header and row action the page declares runs — without dragging in
 * perspectives, virtualization and injection spots, none of which these
 * assertions are about.
 */
jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: ({
    data = [],
    columns = [],
    rowActions,
    actions,
    filters = [],
    activeFilterChips,
  }: {
    data?: Array<Record<string, unknown>>
    columns?: Array<Record<string, unknown>>
    rowActions?: (row: Record<string, unknown>) => React.ReactNode
    actions?: React.ReactNode
    filters?: Array<Record<string, unknown>>
    activeFilterChips?: React.ReactNode
  }) => {
    const columnKey = (column: Record<string, unknown>) => String(column.id ?? column.accessorKey ?? 'column')
    return (
      <div data-testid="data-table">
        <div data-testid="table-actions">{actions}</div>
        <div data-testid="table-filters">
          {filters.map((filter) => (
            <span key={String(filter.id)} data-testid={`filter-${String(filter.id)}`}>
              {String(filter.label)}
            </span>
          ))}
        </div>
        <div data-testid="table-filter-chips">{activeFilterChips}</div>
        <table>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={columnKey(column)} data-testid={`col-${columnKey(column)}`}>
                  {typeof column.header === 'function'
                    ? (column.header as () => React.ReactNode)()
                    : (column.header as React.ReactNode)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <tr key={String(row.id)} data-testid={`row-${String(row.id)}`}>
                {columns.map((column) => (
                  <td key={columnKey(column)} data-testid={`cell-${columnKey(column)}-${String(row.id)}`}>
                    {typeof column.cell === 'function'
                      ? (column.cell as (input: { row: { original: unknown } }) => React.ReactNode)({
                          row: { original: row },
                        })
                      : null}
                  </td>
                ))}
                <td data-testid={`actions-${String(row.id)}`}>{rowActions ? rowActions(row) : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  },
}))

const mockReadApiResult = readApiResultOrThrow as jest.MockedFunction<typeof readApiResultOrThrow>
const mockApiCall = apiCall as jest.MockedFunction<typeof apiCall>
const mockApiCallOrThrow = apiCallOrThrow as jest.MockedFunction<typeof apiCallOrThrow>
const mockDeleteCrud = deleteCrud as jest.MockedFunction<typeof deleteCrud>
const mockUpdateCrud = updateCrud as jest.MockedFunction<typeof updateCrud>
const mockUseBackendChrome = useBackendChrome as jest.MockedFunction<typeof useBackendChrome>
const mockUseConfirmDialog = useConfirmDialog as jest.MockedFunction<typeof useConfirmDialog>

let mockConfirm: jest.Mock

/**
 * jsdom ships a `Response` whose `Headers` do not round-trip, so the delete
 * response is faked down to the one thing the page reads off it.
 */
function responseWithOperationHeader(header: string): Response {
  return { headers: { get: (name: string) => (name === 'x-om-operation' ? header : null) } } as unknown as Response
}

type ApiRow = Record<string, unknown>

function entryRow(overrides: ApiRow = {}): ApiRow {
  return {
    id: OPEN_ID,
    date: '2026-07-20',
    task_id: TASK_ID,
    time_project_id: PROJECT_ID,
    description: 'Poprawki mapowania cen',
    started_at: '09:00',
    ended_at: '11:30',
    duration_minutes: 150,
    roundedMinutes: 150,
    is_billable: true,
    isLocked: false,
    lockedReportId: null,
    cost: 800,
    currencyCode: 'PLN',
    updated_at: '2026-07-20T12:00:00.000Z',
    tags: [],
    ...overrides,
  }
}

let entryRows: ApiRow[] = []
let entryListUrls: string[] = []

function installListRouter() {
  mockReadApiResult.mockImplementation((async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/timesheets/tasks?')) {
      return { items: [{ id: TASK_ID, title: 'Migracja koszyka B2B', time_project_id: PROJECT_ID }] }
    }
    if (url.includes('/timesheets/time-projects?')) {
      return { items: [{ id: PROJECT_ID, name: 'migracja B2B', customer_snapshot: { name: 'Nordvik' } }] }
    }
    entryListUrls.push(url)
    return { items: entryRows, total: entryRows.length, totalPages: 1 }
  }) as never)
}

function lastEntryListQuery(): URLSearchParams {
  const url = entryListUrls[entryListUrls.length - 1] ?? ''
  return new URLSearchParams(url.slice(url.indexOf('?') + 1))
}

/**
 * The filter vocabularies. The team-member list is deliberately the real,
 * unscoped one — the whole point of the person-filter gate is that this route
 * answers with the entire team no matter who is asking.
 */
function installVocabularyRouter() {
  mockApiCall.mockImplementation((async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/api/staff/team-members/self')) {
      return { ok: true, result: { member: { id: SELF_MEMBER_ID } } }
    }
    if (url.includes('/api/staff/team-members')) {
      return {
        ok: true,
        result: {
          items: [
            { id: SELF_MEMBER_ID, display_name: 'Ada Kowalska' },
            { id: OTHER_MEMBER_ID, display_name: 'Bartek Nowak' },
          ],
        },
      }
    }
    return { ok: true, result: { items: [] } }
  }) as never)
}

function grantedFeatures(features: string[]) {
  mockUseBackendChrome.mockReturnValue({ payload: { grantedFeatures: features } } as never)
}

async function renderPage() {
  const utils = render(<TimeTrackingEntriesPage />)
  await waitFor(() => expect(screen.getByTestId('data-table')).toBeTruthy())
  await waitFor(() => expect(mockReadApiResult).toHaveBeenCalled())
  return utils
}

beforeEach(() => {
  jest.clearAllMocks()
  clearAllOperations()
  mockSearch = ''
  entryRows = [entryRow()]
  entryListUrls = []
  installListRouter()
  grantedFeatures(['staff.timesheets.view', 'staff.timesheets.manage_own', 'staff.timesheets.rates.view'])
  mockConfirm = jest.fn(async () => true)
  mockUseConfirmDialog.mockReturnValue({ confirm: mockConfirm, ConfirmDialogElement: null } as never)
  mockUpdateCrud.mockResolvedValue({
    ok: true,
    status: 200,
    result: { ok: true },
    response: {} as Response,
    cacheStatus: null,
  } as never)
})

describe('time entries list — inline duration edit (screen 10 note 1)', () => {
  it('saves the new duration on Enter', async () => {
    await renderPage()
    const cell = await screen.findByTestId(`cell-durationMinutes-${OPEN_ID}`)
    const input = within(cell).getByLabelText('Entry duration') as HTMLInputElement
    expect(input.value).toBe('2:30')

    fireEvent.change(input, { target: { value: '3h 15m' } })
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' })
    })

    await waitFor(() => expect(mockUpdateCrud).toHaveBeenCalled())
    expect(mockUpdateCrud.mock.calls[0][0]).toBe('staff/timesheets/time-entries')
    expect(mockUpdateCrud.mock.calls[0][1]).toEqual({ id: OPEN_ID, durationMinutes: 195 })
  })

  it('restores the previous value on Escape and saves nothing', async () => {
    await renderPage()
    const cell = await screen.findByTestId(`cell-durationMinutes-${OPEN_ID}`)
    const input = within(cell).getByLabelText('Entry duration') as HTMLInputElement

    fireEvent.change(input, { target: { value: '9h' } })
    expect((within(cell).getByLabelText('Entry duration') as HTMLInputElement).value).toBe('9h')

    await act(async () => {
      fireEvent.keyDown(input, { key: 'Escape' })
    })

    expect((within(cell).getByLabelText('Entry duration') as HTMLInputElement).value).toBe('2:30')
    expect(mockUpdateCrud).not.toHaveBeenCalled()
  })
})

describe('time entries list — optimistic delete with undo (screen 10 note 2)', () => {
  it('drops the row immediately and brings it back when the operation is undone', async () => {
    const undoToken = 'undo-token-1'
    const operationHeader = serializeOperationMetadata({
      id: 'log-1',
      undoToken,
      commandId: 'staff.timesheets.time_entries.delete',
      actionLabel: null,
      resourceKind: 'staff.timesheets.time_entry',
      resourceId: OPEN_ID,
      executedAt: new Date().toISOString(),
    })
    mockDeleteCrud.mockResolvedValue({
      ok: true,
      status: 200,
      result: { ok: true },
      response: responseWithOperationHeader(operationHeader),
      cacheStatus: null,
    } as never)

    await renderPage()
    expect(screen.getByTestId(`row-${OPEN_ID}`)).toBeTruthy()

    await act(async () => {
      fireEvent.click(within(screen.getByTestId(`actions-${OPEN_ID}`)).getByTestId('row-action-delete'))
    })

    await waitFor(() => expect(screen.queryByTestId(`row-${OPEN_ID}`)).toBeNull())
    expect(mockDeleteCrud).toHaveBeenCalledWith(
      'staff/timesheets/time-entries',
      OPEN_ID,
      expect.objectContaining({ errorMessage: expect.any(String) }),
    )

    await act(async () => {
      pushOperation({
        id: 'log-1',
        undoToken,
        commandId: 'staff.timesheets.time_entries.delete',
        actionLabel: null,
        resourceKind: 'staff.timesheets.time_entry',
        resourceId: OPEN_ID,
        executedAt: new Date().toISOString(),
      })
      markUndoSuccess(undoToken)
    })

    await waitFor(() => expect(screen.getByTestId(`row-${OPEN_ID}`)).toBeTruthy())
  })
})

describe('time entries list — locked rows (screen 10 note 4)', () => {
  it('drops the checkbox and the edit/delete actions, and keeps the link to the report', async () => {
    entryRows = [entryRow({ id: LOCKED_ID, isLocked: true, lockedReportId: REPORT_ID, duration_minutes: 360 })]
    await renderPage()

    const selectCell = screen.getByTestId(`cell-select-${LOCKED_ID}`)
    expect(within(selectCell).queryByRole('checkbox')).toBeNull()

    expect(screen.getByTestId('entry-locked-badge').textContent).toContain('locked')

    const durationCell = screen.getByTestId(`cell-durationMinutes-${LOCKED_ID}`)
    expect(within(durationCell).queryByLabelText('Entry duration')).toBeNull()
    expect(within(durationCell).getByTestId('entry-duration-locked').textContent).toContain('6:00')

    const actions = screen.getByTestId(`actions-${LOCKED_ID}`)
    expect(within(actions).queryByTestId('row-action-delete')).toBeNull()
    expect(within(actions).queryByTestId('row-action-duplicate')).toBeNull()
    const reportLink = within(actions).getByTestId('row-action-show-report') as HTMLAnchorElement
    expect(reportLink.getAttribute('href')).toContain(REPORT_ID)
  })
})

describe('time entries list — money (screen 10 notes 3 and 5)', () => {
  it('marks a rate-override row with its amount', async () => {
    entryRows = [entryRow({ id: OVERRIDE_ID, rate_override_amount: 260, currencyCode: 'PLN', cost: 1105 })]
    await renderPage()
    const badge = await screen.findByTestId('entry-rate-override')
    expect(badge.textContent).toContain('260')
    expect(badge.textContent).toContain('/h')
  })

  it('leaves the cost cell empty for a non-billable row instead of showing a zero', async () => {
    entryRows = [entryRow({ id: NON_BILLABLE_ID, is_billable: false, cost: null, duration_minutes: 45 })]
    await renderPage()
    const costCell = screen.getByTestId(`cell-cost-${NON_BILLABLE_ID}`)
    expect(within(costCell).getByTestId('entry-cost-empty').textContent).toBe('—')
    expect(costCell.textContent).not.toContain('0,00')
    expect(costCell.textContent).not.toContain('0.00')
  })

  it('has no money columns at all without staff.timesheets.rates.view', async () => {
    grantedFeatures(['staff.timesheets.view', 'staff.timesheets.manage_own'])
    entryRows = [entryRow({ rate_override_amount: 260 })]
    await renderPage()
    expect(screen.queryByTestId('col-cost')).toBeNull()
    expect(screen.queryByTestId(`cell-cost-${OPEN_ID}`)).toBeNull()
    expect(screen.queryByTestId('entry-rate-override')).toBeNull()
    expect(screen.queryByTestId('entries-summary-money')).toBeNull()
  })
})

describe('time entries list — footer totals', () => {
  it('keeps two currencies apart instead of adding them together', async () => {
    entryRows = [
      entryRow({ id: OPEN_ID, cost: 800, currencyCode: 'PLN', duration_minutes: 150 }),
      entryRow({ id: EUR_ID, cost: 200, currencyCode: 'EUR', duration_minutes: 105 }),
    ]
    await renderPage()

    const footer = await screen.findByTestId('entries-summary-footer')
    expect(within(footer).getByTestId('entries-summary-duration').textContent).toBe('4:15')
    expect(within(footer).getByTestId('entries-summary-money-multi')).toBeTruthy()
    expect(within(footer).getAllByTestId('entries-summary-money')).toHaveLength(2)
    expect(footer.textContent).not.toContain('1000')
    expect(footer.textContent).not.toContain('1,000')
  })
})

describe('time entries list — copy yesterday (screen 1 note 5)', () => {
  it('turns the 409 into the allowDuplicates choice instead of a dead end', async () => {
    const conflict = Object.assign(new Error('target not empty'), {
      status: 409,
      code: 'copy_day_target_not_empty',
      toDate: '2026-07-21',
      existingEntryCount: 2,
      existingEntryIds: [OPEN_ID, EUR_ID],
    })
    mockApiCallOrThrow
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        result: { copied: 3, created: [], skipped: [] },
        response: {} as Response,
        cacheStatus: null,
      } as never)

    await renderPage()
    await act(async () => {
      fireEvent.click(screen.getByText('Copy yesterday'))
    })

    await waitFor(() => expect(mockConfirm).toHaveBeenCalled())
    expect(String(mockConfirm.mock.calls[0][0].text)).toContain('2')

    await waitFor(() => expect(mockApiCallOrThrow).toHaveBeenCalledTimes(2))
    const firstBody = JSON.parse(String((mockApiCallOrThrow.mock.calls[0][1] as RequestInit).body))
    const secondBody = JSON.parse(String((mockApiCallOrThrow.mock.calls[1][1] as RequestInit).body))
    expect(firstBody.allowDuplicates).toBe(false)
    expect(secondBody.allowDuplicates).toBe(true)
    expect(secondBody.fromDate).not.toBe(secondBody.toDate)
  })

  it('does not copy anything when the user declines the duplicate confirmation', async () => {
    mockConfirm.mockResolvedValue(false)
    mockApiCallOrThrow.mockRejectedValueOnce(
      Object.assign(new Error('target not empty'), {
        status: 409,
        code: 'copy_day_target_not_empty',
        existingEntryCount: 1,
        existingEntryIds: [OPEN_ID],
      }),
    )

    await renderPage()
    await act(async () => {
      fireEvent.click(screen.getByText('Copy yesterday'))
    })

    await waitFor(() => expect(mockConfirm).toHaveBeenCalled())
    expect(mockApiCallOrThrow).toHaveBeenCalledTimes(1)
  })
})

/**
 * FIX C5. `manage_own` is the right to edit YOUR OWN time; reading somebody
 * else's is `manage_all`. `/api/staff/team-members` is unscoped, so gating the
 * person filter on `manage_own` handed a consultant a dropdown of the whole
 * team whose every entry answered with an empty list — the list route narrows
 * the query back to the caller regardless of what the control asked for.
 */
describe('time entries list — who may filter by person', () => {
  it('offers the person filter to a staff.timesheets.manage_all holder', async () => {
    grantedFeatures(['staff.timesheets.view', 'staff.timesheets.manage_own', 'staff.timesheets.manage_all'])
    installVocabularyRouter()
    await renderPage()

    await waitFor(() => expect(screen.getByTestId('filter-staffMemberId')).toBeTruthy())
    expect(screen.getByTestId('filter-staffMemberId').textContent).toBe('Person')
  })

  it('withholds it from a caller who can only manage their own entries', async () => {
    grantedFeatures(['staff.timesheets.view', 'staff.timesheets.manage_own'])
    installVocabularyRouter()
    await renderPage()

    // The self filter still seeds, so the vocabulary has certainly loaded by
    // the time its chip appears — the control is absent, not merely late.
    await waitFor(() =>
      expect(within(screen.getByTestId('table-filter-chips')).getByText('Ada Kowalska')).toBeTruthy(),
    )
    expect(screen.queryByTestId('filter-staffMemberId')).toBeNull()
  })

  it('follows a wildcard grant the same way the server does', async () => {
    grantedFeatures(['staff.*'])
    installVocabularyRouter()
    await renderPage()

    await waitFor(() => expect(screen.getByTestId('filter-staffMemberId')).toBeTruthy())
  })
})

/**
 * FIX W2. The task drawer's "show all" and the entry dialog's overlap jump both
 * push a query string at this page. Asserting that those links are BUILT
 * correctly (as `TaskDrawer.test.tsx` does) says nothing about whether they
 * work; these assert that the receiving list actually narrows.
 */
describe('time entries list — deep links from the drawer and the dialog', () => {
  it('filters by the task the drawer pointed at instead of showing this week', async () => {
    mockSearch = `taskId=${TASK_ID}`
    installVocabularyRouter()
    await renderPage()

    await waitFor(() => expect(entryListUrls.length).toBeGreaterThan(0))
    const query = lastEntryListQuery()
    expect(query.get('taskId')).toBe(TASK_ID)
    // The default seeding must lose: an entry logged last month would otherwise
    // be filtered straight back out of the list the link exists to show.
    expect(query.get('from')).toBeNull()
    expect(query.get('to')).toBeNull()
    expect(query.get('staffMemberId')).toBeNull()
  })

  it('says which task narrowed the list, and lets the reader drop it', async () => {
    mockSearch = `taskId=${TASK_ID}`
    installVocabularyRouter()
    await renderPage()

    const chips = await screen.findByTestId('entry-filter-chips')
    expect(chips.textContent).toContain('Task')
    expect(chips.textContent).toContain('Migracja koszyka B2B')

    await act(async () => {
      fireEvent.click(screen.getByTestId('entry-filter-chip-remove-taskId'))
    })

    await waitFor(() => expect(lastEntryListQuery().get('taskId')).toBeNull())
    expect(screen.queryByTestId('entry-filter-chip-remove-taskId')).toBeNull()
    // The address bar has to agree with the screen, or a re-render puts the
    // narrowing straight back.
    expect(mockRouterReplace).toHaveBeenCalledWith(ENTRIES_PATH)
  })

  it('filters down to the overlapping entry the dialog pointed at', async () => {
    mockSearch = `ids=${EUR_ID}`
    entryRows = [entryRow({ id: EUR_ID, description: 'Nakładający się wpis' })]
    installVocabularyRouter()
    await renderPage()

    await waitFor(() => expect(entryListUrls.length).toBeGreaterThan(0))
    const query = lastEntryListQuery()
    expect(query.get('ids')).toBe(EUR_ID)
    expect(query.get('from')).toBeNull()
    expect(query.get('staffMemberId')).toBeNull()

    const chips = await screen.findByTestId('entry-filter-chips')
    expect(chips.textContent).toContain('Entry')
    expect(screen.getByTestId('entry-filter-chip-remove-ids')).toBeTruthy()
  })
})
