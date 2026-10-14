/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { apiCall, apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { TaskDrawer } from '../TaskDrawer'
import { buildEntryClocks } from '../taskDrawerData'
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
const TAG_BACKEND_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const TAG_DESIGN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const TAG_NEW_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
/** `purple` in `PROJECT_COLORS`, as jsdom serialises the tinted chip. */
const PURPLE_RGB = 'rgba(168, 85, 247'
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
let tagRows: Row[]

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
    if (url.includes('/timesheets/tags?')) return ok({ items: tagRows, total: tagRows.length }) as never
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
  tagRows = [
    { id: TAG_BACKEND_ID, label: 'Backend', color: 'purple' },
    { id: TAG_DESIGN_ID, label: 'Design', color: 'teal' },
  ]
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

  it('logs a described, back-dated, non-billable hour from the Details block', async () => {
    // US-C5's defaults are right for the common case and wrong often enough to
    // matter: yesterday's forgotten hour and any non-billable hour could not be
    // logged from the drawer at all before this.
    renderDrawer()
    const field = await screen.findByLabelText('Time to log')
    fireEvent.change(field, { target: { value: '45m' } })

    fireEvent.click(screen.getByTestId('task-drawer-quick-log-toggle'))
    fireEvent.change(screen.getByTestId('task-drawer-quick-log-description'), {
      target: { value: 'Refinement with the client' },
    })
    fireEvent.change(screen.getByTestId('task-drawer-quick-log-date'), {
      target: { value: '2026-07-14' },
    })
    fireEvent.click(screen.getByTestId('task-drawer-quick-log-billable'))

    fireEvent.click(screen.getByTestId('task-drawer-quick-log-submit'))

    await waitFor(() => expect(writeCalls('/time-entries').length).toBe(1))
    const body = JSON.parse(String(writeCalls('/time-entries')[0][1]?.body))
    expect(body.durationMinutes).toBe(45)
    expect(body.description).toBe('Refinement with the client')
    expect(body.date).toBe('2026-07-14')
    expect(body.isBillable).toBe(false)
    // The person is never overridable here — that is a different act with
    // different permissions and belongs to the full entry form.
    expect(body.staffMemberId).toBe(SELF_ID)
  })

  it('sends the clocks when the Details block supplies them', async () => {
    renderDrawer()
    const field = await screen.findByLabelText('Time to log')
    fireEvent.change(field, { target: { value: '2h' } })

    fireEvent.click(screen.getByTestId('task-drawer-quick-log-toggle'))
    fireEvent.change(screen.getByTestId('task-drawer-quick-log-date'), { target: { value: '2026-07-14' } })
    fireEvent.change(screen.getByTestId('task-drawer-quick-log-start'), { target: { value: '09:30' } })
    fireEvent.change(screen.getByTestId('task-drawer-quick-log-end'), { target: { value: '11:30' } })
    fireEvent.click(screen.getByTestId('task-drawer-quick-log-submit'))

    await waitFor(() => expect(writeCalls('/time-entries').length).toBe(1))
    const body = JSON.parse(String(writeCalls('/time-entries')[0][1]?.body))
    expect(body.startedAt).toBe('2026-07-14T09:30')
    expect(body.endedAt).toBe('2026-07-14T11:30')
    expect(body.durationMinutes).toBe(120)
  })

  it('leaves the clocks unset when they are not filled in', async () => {
    // A duration-only entry must stay duration-only rather than being pinned to
    // a time nobody chose.
    renderDrawer()
    const field = await screen.findByLabelText('Time to log')
    fireEvent.change(field, { target: { value: '30m' } })
    fireEvent.click(screen.getByTestId('task-drawer-quick-log-submit'))

    await waitFor(() => expect(writeCalls('/time-entries').length).toBe(1))
    const body = JSON.parse(String(writeCalls('/time-entries')[0][1]?.body))
    expect(body.startedAt).toBeUndefined()
    expect(body.endedAt).toBeUndefined()
  })

  it('keeps the collapsed quick log to one field so the common path stays fast', async () => {
    renderDrawer()
    await screen.findByLabelText('Time to log')
    expect(screen.queryByTestId('task-drawer-quick-log-description')).not.toBeInTheDocument()
    expect(screen.queryByTestId('task-drawer-quick-log-date')).not.toBeInTheDocument()
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

  it('renders the assigned tags tinted with the colour the tags API returns', async () => {
    // W10: the drawer's tags query projected only `{ id, label }`, so its chips were
    // grey while the entry dialog tinted the same rows from `staff_time_tags.color`.
    taskRow = { ...taskRow, tag_ids: [TAG_BACKEND_ID] }
    renderDrawer()

    const chip = await screen.findByText('Backend')
    expect(chip.style.backgroundColor).toContain(PURPLE_RGB)
    expect(chip.style.borderColor).toContain(PURPLE_RGB)
  })

  it('searches the tag list instead of showing every tag at once', async () => {
    renderDrawer()

    fireEvent.click(await screen.findByTestId('task-drawer-tag-select'))
    fireEvent.change(screen.getByTestId('task-drawer-tag-search'), { target: { value: 'des' } })

    const options = within(screen.getByRole('listbox')).getAllByRole('option')
    expect(options.map((option) => option.textContent)).toEqual(['Design'])
  })

  it('assigns a searched tag through the task-assignments endpoint', async () => {
    renderDrawer()

    fireEvent.click(await screen.findByTestId('task-drawer-tag-select'))
    fireEvent.change(screen.getByTestId('task-drawer-tag-search'), { target: { value: 'back' } })
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'Backend' }))

    await waitFor(() => expect(writeCalls('/tags/task-assignments').length).toBe(1))
    const [, init] = writeCalls('/tags/task-assignments')[0]
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({ taskId: TASK_ID, tagIds: [TAG_BACKEND_ID] })
    // The swap must not reroute the write through the entry dialog's tag path.
    expect(writeCalls('/timesheets/time-entries').length).toBe(0)
  })

  it('creates a tag inline and assigns the id the create route returned', async () => {
    mockApiCallOrThrow.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/staff/timesheets/tags') {
        tagRows = [...tagRows, { id: TAG_NEW_ID, label: 'Refaktor', color: 'emerald' }]
        return ok({ id: TAG_NEW_ID }) as never
      }
      return ok({ ok: true }) as never
    })
    renderDrawer()

    fireEvent.click(await screen.findByTestId('task-drawer-tag-select'))
    fireEvent.change(screen.getByTestId('task-drawer-tag-search'), { target: { value: 'Refaktor' } })
    fireEvent.click(await screen.findByTestId('task-drawer-tag-create'))

    await waitFor(() => expect(writeCalls('/tags/task-assignments').length).toBe(1))
    const createCall = mockApiCallOrThrow.mock.calls.find(([url]) => String(url) === '/api/staff/timesheets/tags')
    expect(createCall?.[1]?.method).toBe('POST')
    expect(JSON.parse(String(createCall?.[1]?.body))).toEqual({ label: 'Refaktor', slug: 'refaktor' })
    expect(JSON.parse(String(writeCalls('/tags/task-assignments')[0][1]?.body))).toEqual({
      taskId: TASK_ID,
      tagIds: [TAG_NEW_ID],
    })
  })

  it('removes a tag through the same endpoint and leaves the version pipeline intact', async () => {
    taskRow = { ...taskRow, tag_ids: [TAG_BACKEND_ID] }
    renderDrawer()

    fireEvent.click(await screen.findByLabelText('Remove tag Backend'))

    await waitFor(() => expect(writeCalls('/tags/task-assignments').length).toBe(1))
    const [, init] = writeCalls('/tags/task-assignments')[0]
    expect(init?.method).toBe('DELETE')
    expect(JSON.parse(String(init?.body))).toEqual({ taskId: TASK_ID, tagIds: [TAG_BACKEND_ID] })
    // Tag assignments are their own resource and carry no task version; the swap
    // must leave the per-field lock header pipeline exactly where it was.
    await waitFor(() => expect(screen.getByTestId('task-drawer-status-select')).toBeTruthy())
    fireEvent.change(screen.getByTestId('task-drawer-status-select'), { target: { value: DONE_ID } })
    await waitFor(() => expect(writeCalls(`/tasks/${TASK_ID}/status`).length).toBe(1))
    const lastHeader = mockWithScopedHeaders.mock.calls[mockWithScopedHeaders.mock.calls.length - 1][0]
    expect(lastHeader).toEqual({ [OPTIMISTIC_LOCK_HEADER_NAME]: VERSION_ONE })
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

describe('buildEntryClocks', () => {
  it('derives the end from a lone start so the entry is not a running timer', () => {
    // `started_at IS NOT NULL AND ended_at IS NULL` is how the list identifies a
    // running timer, and no segment exists to stop one created this way.
    expect(buildEntryClocks({ date: '2026-08-10', startClock: '12:00', endClock: null, minutes: 120 }))
      .toEqual({ startedAt: '2026-08-10T12:00', endedAt: '2026-08-10T14:00' })
  })

  it('derives the start from a lone end', () => {
    expect(buildEntryClocks({ date: '2026-08-10', startClock: null, endClock: '17:30', minutes: 90 }))
      .toEqual({ startedAt: '2026-08-10T16:00', endedAt: '2026-08-10T17:30' })
  })

  it('leaves a duration-only entry alone', () => {
    expect(buildEntryClocks({ date: '2026-08-10', startClock: null, endClock: null, minutes: 30 })).toEqual({})
  })

  it('keeps both clocks when both are given, even if they disagree with the duration', () => {
    // The user typed them; the form does not silently overrule what they entered.
    expect(buildEntryClocks({ date: '2026-08-10', startClock: '09:00', endClock: '10:00', minutes: 240 }))
      .toEqual({ startedAt: '2026-08-10T09:00', endedAt: '2026-08-10T10:00' })
  })

  it('wraps a derived end past midnight rather than producing an invalid clock', () => {
    expect(buildEntryClocks({ date: '2026-08-10', startClock: '23:30', endClock: null, minutes: 60 }))
      .toEqual({ startedAt: '2026-08-10T23:30', endedAt: '2026-08-10T00:30' })
  })
})
