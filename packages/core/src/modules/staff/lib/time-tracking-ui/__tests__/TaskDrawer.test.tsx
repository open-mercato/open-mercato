/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { apiCall, apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { TaskDrawer } from '../TaskDrawer'
import { todayIsoDate } from '../taskDrawerData'

const PROJECT_ID = '11111111-1111-4111-8111-111111111111'
const BACKLOG_ID = '22222222-2222-4222-8222-222222222222'
const IN_PROGRESS_ID = '33333333-3333-4333-8333-333333333333'
const DONE_ID = '44444444-4444-4444-8444-444444444444'
const TASK_ID = '55555555-5555-4555-8555-555555555555'
const CHILD_ID = '66666666-6666-4666-8666-666666666666'
const OTHER_TASK_ID = '77777777-7777-4777-8777-777777777777'
const SELF_ID = '88888888-8888-4888-8888-888888888888'
const RUNNING_ENTRY_ID = '99999999-9999-4999-8999-999999999999'
const VERSION_ONE = '2026-08-12T10:00:00.000Z'
const VERSION_TWO = '2026-08-12T11:00:00.000Z'

const mockConfirm = jest.fn(async () => true)

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

const mockRouterPush = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockRouterPush, replace: jest.fn() }),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))

jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({
  useBackendChrome: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: mockConfirm, ConfirmDialogElement: null }),
}))

jest.mock('@open-mercato/ui/backend/conflicts', () => ({
  surfaceRecordConflict: jest.fn((error: unknown) => {
    const body = (error as { body?: { code?: string } } | null)?.body
    return body?.code === 'optimistic_lock_conflict'
  }),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: async ({ operation }: { operation: () => Promise<unknown> }) => operation(),
    retryLastMutation: jest.fn(async () => true),
  }),
}))

/**
 * Radix' Select needs pointer geometry jsdom does not have, so the primitive is
 * swapped for a native `<select>` that keeps the trigger's label and test id.
 * The assertions are about what a committed choice writes, not about the popup.
 */
jest.mock('@open-mercato/ui/primitives/select', () => {
  const ReactModule = jest.requireActual('react') as typeof React
  type SlotProps = { children?: React.ReactNode } & Record<string, unknown>
  const Slot = (slot: string) => {
    const Component = ({ children }: SlotProps) => ReactModule.createElement(ReactModule.Fragment, null, children)
    ;(Component as unknown as { __slot: string }).__slot = slot
    return Component
  }
  const SelectTrigger = Slot('trigger')
  const SelectContent = Slot('content')
  const SelectValue = Slot('value')
  const SelectItem = Slot('item')
  const Select = ({
    value,
    onValueChange,
    disabled,
    children,
  }: {
    value?: string
    onValueChange?: (next: string) => void
    disabled?: boolean
    children?: React.ReactNode
  }) => {
    const nodes = ReactModule.Children.toArray(children) as React.ReactElement[]
    const trigger = nodes.find((node) => (node.type as { __slot?: string })?.__slot === 'trigger')
    const content = nodes.find((node) => (node.type as { __slot?: string })?.__slot === 'content')
    const items = content
      ? (ReactModule.Children.toArray(content.props.children) as React.ReactElement[])
      : []
    const triggerProps = (trigger?.props ?? {}) as Record<string, unknown>
    return ReactModule.createElement(
      'select',
      {
        'aria-label': triggerProps['aria-label'],
        'data-testid': triggerProps['data-testid'],
        value: value ?? '',
        disabled,
        onChange: (event: React.ChangeEvent<HTMLSelectElement>) => onValueChange?.(event.target.value),
      },
      [
        ReactModule.createElement('option', { key: '__empty', value: '' }, ''),
        ...items.map((item) =>
          ReactModule.createElement(
            'option',
            { key: String(item.props.value), value: String(item.props.value) },
            item.props.children,
          ),
        ),
      ],
    )
  }
  return { Select, SelectTrigger, SelectContent, SelectItem, SelectValue, SelectGroup: Slot('group'), SelectLabel: Slot('label'), SelectSeparator: Slot('separator') }
})

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => {
  const actual = jest.requireActual('@open-mercato/ui/backend/utils/apiCall')
  return {
    ...actual,
    apiCall: jest.fn(),
    apiCallOrThrow: jest.fn(),
    withScopedApiRequestHeaders: jest.fn(
      async (_headers: Record<string, string>, run: () => Promise<unknown>) => run(),
    ),
  }
})

const mockApiCall = apiCall as jest.MockedFunction<typeof apiCall>
const mockApiCallOrThrow = apiCallOrThrow as jest.MockedFunction<typeof apiCallOrThrow>
const mockWithScopedHeaders = withScopedApiRequestHeaders as jest.MockedFunction<typeof withScopedApiRequestHeaders>
const mockUseBackendChrome = useBackendChrome as jest.MockedFunction<typeof useBackendChrome>

type Row = Record<string, unknown>

const statusRows: Row[] = [
  { id: BACKLOG_ID, name: 'Backlog', slug: 'backlog', color: 'indigo', position: 1000, is_default: true, is_done: false },
  { id: IN_PROGRESS_ID, name: 'W toku', slug: 'in-progress', color: 'blue', position: 2000, is_default: false, is_done: false },
  { id: DONE_ID, name: 'Zrobione', slug: 'done', color: 'emerald', position: 3000, is_default: false, is_done: true },
]

/** The server the drawer talks to, so a refetch reflects what a write did. */
let taskRow: Row
let childRows: Row[]
let commentRows: Row[]
let entryRows: Row[]
let runningRows: Row[]

function ok<T>(result: T) {
  return { ok: true, status: 200, result, response: {} as Response, cacheStatus: null }
}

function installApiRouter() {
  mockApiCall.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/comments')) return ok({ items: commentRows, total: commentRows.length }) as never
    if (url.includes('/task-statuses')) return ok({ items: statusRows, total: statusRows.length }) as never
    if (url.includes('/timesheets/tasks?')) {
      const parsed = new URL(url, 'https://test.local')
      if (parsed.searchParams.get('parentTaskId')) {
        return ok({ items: childRows, total: childRows.length }) as never
      }
      return ok({ items: [taskRow], total: 1 }) as never
    }
    if (url.includes('/time-entries?')) {
      if (url.includes('running=true')) return ok({ items: runningRows, total: runningRows.length }) as never
      return ok({ items: entryRows, total: entryRows.length }) as never
    }
    if (url.includes('/team-members/self')) return ok({ member: { id: SELF_ID } }) as never
    if (url.includes('/team-members?')) {
      return ok({ items: [{ id: SELF_ID, display_name: 'Anna Nowak' }], total: 1 }) as never
    }
    if (url.includes('/timesheets/tags?')) return ok({ items: [], total: 0 }) as never
    return ok({ items: [], total: 0 }) as never
  })
  mockApiCallOrThrow.mockImplementation(async () => ok({ ok: true }) as never)
}

function renderDrawer(props: Partial<React.ComponentProps<typeof TaskDrawer>> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <TaskDrawer taskId={TASK_ID} open onOpenChange={jest.fn()} projectName="Nordvik" {...props} />
    </QueryClientProvider>,
  )
}

function writeCalls(pattern: string) {
  return mockApiCallOrThrow.mock.calls.filter(([url]) => String(url).includes(pattern))
}

beforeEach(() => {
  jest.clearAllMocks()
  taskRow = {
    id: TASK_ID,
    title: 'Migracja koszyka B2B',
    reference: 'TT-142',
    time_project_id: PROJECT_ID,
    parent_task_id: null,
    task_status_id: IN_PROGRESS_ID,
    assignee_staff_member_id: null,
    position: 1000,
    ownMinutes: 600,
    loggedMinutes: 1365,
    childCount: 1,
    closed_at: null,
    created_at: '2026-06-04T08:00:00.000Z',
    updated_at: VERSION_ONE,
  }
  childRows = [
    {
      id: CHILD_ID,
      title: 'Model danych koszyka',
      time_project_id: PROJECT_ID,
      parent_task_id: TASK_ID,
      task_status_id: BACKLOG_ID,
      assignee_staff_member_id: SELF_ID,
      position: 1000,
      ownMinutes: 765,
      loggedMinutes: 765,
      childCount: 0,
      closed_at: null,
      updated_at: VERSION_ONE,
    },
  ]
  commentRows = []
  entryRows = [
    {
      id: 'entry-1',
      task_id: TASK_ID,
      date: '2026-07-20',
      description: 'Poprawki mapowania cen',
      duration_minutes: 150,
      is_billable: true,
      cost: 800,
      currencyCode: 'PLN',
    },
    {
      id: 'entry-2',
      task_id: CHILD_ID,
      date: '2026-07-17',
      description: 'Rabaty kontraktowe',
      duration_minutes: 90,
      is_billable: false,
      cost: null,
      currencyCode: 'PLN',
    },
  ]
  runningRows = []
  installApiRouter()
  mockUseBackendChrome.mockReturnValue({
    payload: {
      grantedFeatures: ['staff.timesheets.tasks.manage', 'staff.timesheets.rates.view'],
    },
    isLoading: false,
    isReady: true,
    refresh: async () => {},
  } as never)
})

describe('TaskDrawer', () => {
  it('logs time from the single field with today / me / billable defaults', async () => {
    renderDrawer()
    const field = await screen.findByLabelText('Time to log')

    fireEvent.change(field, { target: { value: '1h 40m' } })
    fireEvent.click(screen.getByTestId('task-drawer-quick-log-submit'))

    await waitFor(() => expect(writeCalls('/time-entries').length).toBe(1))
    const [, init] = writeCalls('/time-entries')[0]
    expect(init?.method).toBe('POST')
    const body = JSON.parse(String(init?.body))
    // The shared duration parser, not a local one: `1h 40m` is 100 minutes.
    expect(body.durationMinutes).toBe(100)
    expect(body.staffMemberId).toBe(SELF_ID)
    expect(body.isBillable).toBe(true)
    expect(body.taskId).toBe(TASK_ID)
    // `todayIsoDate` reads local calendar fields, so asserting against
    // `toISOString()` (UTC) fails between midnight and the UTC offset — 00:00–02:00
    // in CEST. Compare against the same helper the component uses.
    expect(body.date).toBe(todayIsoDate())
  })

  it('keeps unparseable duration text in place and refuses to log it', async () => {
    renderDrawer()
    const field = await screen.findByLabelText('Time to log')

    fireEvent.change(field, { target: { value: '1godz i troche' } })

    expect((field as HTMLInputElement).value).toBe('1godz i troche')
    expect(screen.getByTestId('task-drawer-quick-log-submit')).toBeDisabled()
    expect(screen.getByRole('alert').textContent).toContain('1h 40m')
    expect(writeCalls('/time-entries').length).toBe(0)
  })

  it('asks to stop the timer running on another task before starting one here', async () => {
    runningRows = [
      { id: RUNNING_ENTRY_ID, task_id: OTHER_TASK_ID, started_at: '2026-08-12T09:00:00.000Z', ended_at: null },
    ]
    renderDrawer()

    fireEvent.click(await screen.findByTestId('task-drawer-timer-start'))

    await waitFor(() => expect(mockConfirm).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(writeCalls('/start-timer').length).toBe(1))
    const stopCall = writeCalls(`/${RUNNING_ENTRY_ID}/timer-stop`)
    expect(stopCall.length).toBe(1)
    // The other timer is stopped first — never two running at once.
    const stopIndex = mockApiCallOrThrow.mock.calls.findIndex(([url]) => String(url).includes('timer-stop'))
    const startIndex = mockApiCallOrThrow.mock.calls.findIndex(([url]) => String(url).includes('start-timer'))
    expect(stopIndex).toBeLessThan(startIndex)
  })

  it('starts without a prompt when no other timer is running', async () => {
    renderDrawer()

    fireEvent.click(await screen.findByTestId('task-drawer-timer-start'))

    await waitFor(() => expect(writeCalls('/start-timer').length).toBe(1))
    expect(mockConfirm).not.toHaveBeenCalled()
  })

  it('ticks a subtask by moving it to the done column, not by writing a boolean', async () => {
    renderDrawer()
    const checkbox = await screen.findByRole('checkbox', { name: 'Mark Model danych koszyka as done' })

    fireEvent.click(checkbox)

    await waitFor(() => expect(writeCalls(`/tasks/${CHILD_ID}/status`).length).toBe(1))
    const [, init] = writeCalls(`/tasks/${CHILD_ID}/status`)[0]
    expect(init?.method).toBe('PATCH')
    expect(JSON.parse(String(init?.body))).toEqual({ taskStatusId: DONE_ID })
    // No task PUT at all — there is no `done` flag on a task (D-2).
    expect(writeCalls('/api/staff/timesheets/tasks').filter(([url]) => !String(url).includes('/status')).length).toBe(0)
    expect(mockWithScopedHeaders.mock.calls[0][0]).toEqual({ [OPTIMISTIC_LOCK_HEADER_NAME]: VERSION_ONE })
  })

  it('returns an unticked subtask to the default column', async () => {
    childRows = [{ ...childRows[0], task_status_id: DONE_ID }]
    renderDrawer()
    const checkbox = await screen.findByRole('checkbox', { name: 'Mark Model danych koszyka as done' })

    fireEvent.click(checkbox)

    await waitFor(() => expect(writeCalls(`/tasks/${CHILD_ID}/status`).length).toBe(1))
    const [, init] = writeCalls(`/tasks/${CHILD_ID}/status`)[0]
    expect(JSON.parse(String(init?.body))).toEqual({ taskStatusId: BACKLOG_ID })
  })

  it('offers no subtask section on a child task, because depth is capped at one', async () => {
    taskRow = { ...taskRow, id: CHILD_ID, parent_task_id: TASK_ID, childCount: 0 }
    renderDrawer({ taskId: CHILD_ID })

    await screen.findByTestId('task-drawer-logged')
    expect(screen.queryByTestId('task-drawer-add-subtask')).toBeNull()
    expect(screen.queryByTestId('task-drawer-subtasks')).toBeNull()
  })

  it('saves a property change with the lock header and refreshes the token for the next save', async () => {
    renderDrawer()
    const assignee = await screen.findByTestId('task-drawer-assignee-select')

    // The row moves on after the first save, exactly as the server would.
    mockApiCallOrThrow.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes('/api/staff/timesheets/tasks')) {
        taskRow = { ...taskRow, updated_at: VERSION_TWO, assignee_staff_member_id: SELF_ID }
      }
      return ok({ ok: true }) as never
    })

    fireEvent.change(assignee, { target: { value: SELF_ID } })

    await waitFor(() => expect(writeCalls('/api/staff/timesheets/tasks').length).toBe(1))
    const [, firstInit] = writeCalls('/api/staff/timesheets/tasks')[0]
    expect(firstInit?.method).toBe('PUT')
    expect(JSON.parse(String(firstInit?.body))).toEqual({ id: TASK_ID, assigneeStaffMemberId: SELF_ID })
    expect(mockWithScopedHeaders.mock.calls[0][0]).toEqual({ [OPTIMISTIC_LOCK_HEADER_NAME]: VERSION_ONE })

    // The second field must leave with the version the first one produced.
    await waitFor(() => expect(screen.getByTestId('task-drawer-status-select')).toBeTruthy())
    fireEvent.change(screen.getByTestId('task-drawer-status-select'), { target: { value: DONE_ID } })

    await waitFor(() => expect(writeCalls(`/tasks/${TASK_ID}/status`).length).toBe(1))
    const lastHeader = mockWithScopedHeaders.mock.calls[mockWithScopedHeaders.mock.calls.length - 1][0]
    expect(lastHeader).toEqual({ [OPTIMISTIC_LOCK_HEADER_NAME]: VERSION_TWO })
  })

  it('chains two saves fired before any re-render onto the refreshed token', async () => {
    renderDrawer()
    const assignee = await screen.findByTestId('task-drawer-assignee-select')
    const status = screen.getByTestId('task-drawer-status-select')

    mockApiCallOrThrow.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes('/api/staff/timesheets/tasks') && !String(input).includes('/status')) {
        taskRow = { ...taskRow, updated_at: VERSION_TWO, assignee_staff_member_id: SELF_ID }
      }
      return ok({ ok: true }) as never
    })

    // Both fire in the same tick: the second save's closure was built when the
    // token was still VERSION_ONE, so only the ref can save it from a false 409.
    fireEvent.change(assignee, { target: { value: SELF_ID } })
    fireEvent.change(status, { target: { value: DONE_ID } })

    await waitFor(() => expect(writeCalls(`/tasks/${TASK_ID}/status`).length).toBe(1))
    const lastHeader = mockWithScopedHeaders.mock.calls[mockWithScopedHeaders.mock.calls.length - 1][0]
    expect(lastHeader).toEqual({ [OPTIMISTIC_LOCK_HEADER_NAME]: VERSION_TWO })
  })

  it('posts a comment on ⌘↵', async () => {
    renderDrawer()
    const box = await screen.findByTestId('task-drawer-comment-input')

    fireEvent.change(box, { target: { value: 'Rabaty liczymy od netto.' } })
    fireEvent.keyDown(box, { key: 'Enter', metaKey: true })

    await waitFor(() => expect(writeCalls(`/tasks/${TASK_ID}/comments`).length).toBe(1))
    const [, init] = writeCalls(`/tasks/${TASK_ID}/comments`)[0]
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({ body: 'Rabaty liczymy od netto.' })
  })

  it('shows the inclusive rollup as the headline and the own/children split beneath it', async () => {
    renderDrawer()

    // 1365 minutes is the rollup; 600 is this task's own time.
    expect((await screen.findByTestId('task-drawer-logged-total')).textContent).toBe('22:45')
    expect(screen.getByTestId('task-drawer-logged-split').textContent).toBe('own 10h · subtasks 12h 45m')
  })

  it('renders the cost badge for a caller holding rates.view', async () => {
    renderDrawer()
    expect(await screen.findByTestId('task-drawer-cost')).toBeTruthy()
  })

  it('renders no money at all without rates.view', async () => {
    mockUseBackendChrome.mockReturnValue({
      payload: { grantedFeatures: ['staff.timesheets.tasks.manage'] },
      isLoading: false,
      isReady: true,
      refresh: async () => {},
    } as never)
    renderDrawer()

    await screen.findByTestId('task-drawer-logged')
    expect(screen.queryByTestId('task-drawer-cost')).toBeNull()
  })

  it('links "show all" at the entries list, scoped to this task', async () => {
    renderDrawer()
    fireEvent.click(await screen.findByText('Show all'))
    expect(mockRouterPush).toHaveBeenCalledWith(`/backend/staff/time-tracking/entries?taskId=${TASK_ID}`)
  })

  it('creates a subtask as a child task of this one', async () => {
    renderDrawer()
    fireEvent.click(await screen.findByTestId('task-drawer-add-subtask'))
    const input = screen.getByTestId('task-drawer-subtask-input')

    fireEvent.change(input, { target: { value: 'Testy wydajnościowe' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(writeCalls('/api/staff/timesheets/tasks').length).toBe(1))
    const [, init] = writeCalls('/api/staff/timesheets/tasks')[0]
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toMatchObject({
      parentTaskId: TASK_ID,
      timeProjectId: PROJECT_ID,
      title: 'Testy wydajnościowe',
    })
  })
})
