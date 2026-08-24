/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { apiCall, apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { autoColorFromName } from '../../timesheets-ui/colors'
import { TimeEntryDialog } from '../TimeEntryDialog'

const TASK_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_TASK_ID = '22222222-2222-4222-8222-222222222222'
const PROJECT_ID = '33333333-3333-4333-8333-333333333333'
const SELF_ID = '44444444-4444-4444-8444-444444444444'
const ENTRY_ID = '55555555-5555-4555-8555-555555555555'
const OVERLAP_ID = '66666666-6666-4666-8666-666666666666'
const REPORT_ID = '77777777-7777-4777-8777-777777777777'
const VERSION = '2026-07-20T10:00:00.000Z'

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

const mockFlash = jest.fn()
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: (...args: unknown[]) => mockFlash(...args) }))

jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({
  useBackendChrome: jest.fn(),
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

const mockConfirm = jest.fn(async () => true)
jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: mockConfirm, ConfirmDialogElement: null }),
}))

/**
 * The task picker is a `LookupSelect` — a search box over a fetched list, whose
 * own behaviour is covered in `packages/ui`. These tests care about what the
 * dialog does with a chosen task, so it is stood in for by a native select that
 * exposes the same contract: options come from `fetchItems`, choosing one calls
 * `onChange` with the id.
 */
/**
 * The task picker is a grouped, keyboard-driven list with its own tests. These
 * tests care about what the dialog does with a chosen task, so it is stood in for
 * by a native select exposing the same contract: options are the items it was
 * given, choosing one calls `onChange` with the id.
 */
jest.mock('../TaskPicker', () => {
  const ReactModule = jest.requireActual('react') as typeof React
  type Item = { id: string; title: string }
  type Props = {
    value: string | null
    onChange: (id: string | null) => void
    items: Item[]
    disabled?: boolean
    onQueryChange?: (query: string) => void
  }
  const TaskPicker = ({ value, onChange, items, disabled, onQueryChange }: Props) =>
    ReactModule.createElement(ReactModule.Fragment, null, [
      ReactModule.createElement(
        'select',
        {
          key: '__select',
          value: value ?? '',
          disabled,
          onChange: (event: React.ChangeEvent<HTMLSelectElement>) => onChange(event.target.value || null),
        },
        [
          ReactModule.createElement('option', { key: '__empty', value: '' }, ''),
          ...items.map((item) => ReactModule.createElement('option', { key: item.id, value: item.id }, item.title)),
        ],
      ),
      // The real picker reports its search box on every keystroke so the dialog
      // can widen `items` with a server-side search; the stand-in exposes the
      // same contract as a plain text box.
      ReactModule.createElement('input', {
        key: '__query',
        'data-testid': 'task-picker-query',
        disabled,
        onChange: (event: React.ChangeEvent<HTMLInputElement>) => onQueryChange?.(event.target.value),
      }),
    ])
  return { TaskPicker, __esModule: true }
})

/** Radix' Select needs pointer geometry jsdom lacks; a native select keeps the contract. */
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
        id: triggerProps.id,
        // React 19 passes `ref` as a plain prop to function components, so the
        // trigger ref the dialog focuses reaches the stand-in element too.
        ref: triggerProps.ref,
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
  return {
    Select,
    SelectTrigger,
    SelectContent,
    SelectItem,
    SelectValue,
    SelectGroup: Slot('group'),
    SelectLabel: Slot('label'),
    SelectSeparator: Slot('separator'),
  }
})

type InjectionTriggerCall = { event: string; fieldId?: string; fieldValue?: unknown }

type BeforeSaveOutcome = {
  ok: boolean
  message?: string
  requestHeaders?: Record<string, string>
}

type FieldChangeOutcome = {
  value?: unknown
  sideEffects?: Record<string, unknown>
  messages?: Array<{ text: string; severity: 'info' | 'warning' | 'error' }>
}

const mockInjection: {
  calls: InjectionTriggerCall[]
  beforeSave: BeforeSaveOutcome
  fieldChange: FieldChangeOutcome | null
} = { calls: [], beforeSave: { ok: true }, fieldChange: null }

jest.mock('@open-mercato/ui/backend/injection/InjectionSpot', () => {
  const triggerEvent = async (
    event: string,
    _data: unknown,
    _context: unknown,
    meta?: { fieldId?: string; fieldValue?: unknown },
  ) => {
    mockInjection.calls.push({ event, fieldId: meta?.fieldId, fieldValue: meta?.fieldValue })
    if (event === 'onBeforeSave') return mockInjection.beforeSave
    if (event === 'onFieldChange') {
      return mockInjection.fieldChange
        ? { ok: true, fieldChange: mockInjection.fieldChange }
        : { ok: true, fieldChange: { value: meta?.fieldValue } }
    }
    return { ok: true }
  }
  const events = { triggerEvent, widgets: [] }
  return {
    __esModule: true,
    InjectionSpot: () => null,
    useInjectionWidgets: () => ({ widgets: [], loading: false, error: null }),
    useInjectionSpotEvents: () => events,
  }
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

let settingsPayload: Row
let overlapRows: Row[]
let entryRows: Row[]

function ok<T>(result: T) {
  return { ok: true, status: 200, result, response: {} as Response, cacheStatus: null }
}

const taskRows: Row[] = [
  { id: TASK_ID, title: 'Migracja koszyka B2B', time_project_id: PROJECT_ID },
  { id: OTHER_TASK_ID, title: 'Przegląd zapytań SQL', time_project_id: PROJECT_ID },
]

/**
 * The task the directory page never shows — the whole point of C7 is that a
 * tenant past the first page can still reach it, and only the server can find it.
 */
const REMOTE_TASK_ID = '88888888-8888-4888-8888-888888888888'
const remoteTaskRow: Row = {
  id: REMOTE_TASK_ID,
  reference: 'AWR-412',
  title: 'Zamykanie rozliczeń kwartalnych',
  time_project_id: PROJECT_ID,
}

/** Rows the tags endpoint answers with; a create pushes onto it, like the server. */
let tagRows: Row[] = []

const projectRows: Row[] = [
  {
    id: PROJECT_ID,
    name: 'migracja B2B',
    customer_snapshot: { name: 'Nordvik' },
    hourly_rate: 320,
    currency_code: 'PLN',
    billable_by_default: true,
  },
]

function installApiRouter() {
  mockApiCall.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/timesheets/settings')) return ok(settingsPayload) as never
    if (url.includes('/team-members/self')) {
      return ok({ member: { id: SELF_ID, displayName: 'Anna Nowak' } }) as never
    }
    if (url.includes('/timesheets/tasks')) {
      const query = new URLSearchParams(url.slice(url.indexOf('?') + 1))
      const ids = query.get('ids')
      if (ids) {
        const rows = [...taskRows, remoteTaskRow].filter((row) => ids.split(',').includes(String(row.id)))
        return ok({ items: rows, total: rows.length }) as never
      }
      const term = query.get('q') ?? query.get('reference')
      if (term) {
        const needle = term.toLowerCase()
        const rows = [...taskRows, remoteTaskRow].filter(
          (row) =>
            String(row.title ?? '').toLowerCase().includes(needle) ||
            String(row.reference ?? '').toLowerCase().startsWith(needle),
        )
        return ok({ items: rows, total: rows.length }) as never
      }
      return ok({ items: taskRows, total: taskRows.length }) as never
    }
    if (url.includes('/timesheets/time-projects')) {
      return ok({ items: projectRows, total: projectRows.length }) as never
    }
    if (url.includes('/timesheets/tags')) return ok({ items: tagRows, total: tagRows.length }) as never
    if (url.includes('/time-entries/overlaps')) {
      return ok({ items: overlapRows, total: overlapRows.length }) as never
    }
    if (url.includes('/time-entries?')) return ok({ items: entryRows, total: entryRows.length }) as never
    return ok({ items: [], total: 0 }) as never
  })
  mockApiCallOrThrow.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/timesheets/tags')) {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      const id = `tag-${tagRows.length + 1}`
      tagRows = [...tagRows, { id, label: body.label, slug: body.slug, color: body.color ?? null }]
      return ok({ id }) as never
    }
    return ok({ id: ENTRY_ID }) as never
  })
}

function renderDialog(props: Partial<React.ComponentProps<typeof TimeEntryDialog>> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  const onOpenChange = props.onOpenChange ?? jest.fn()
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <TimeEntryDialog open onOpenChange={onOpenChange} {...props} />
    </QueryClientProvider>,
  )
  return { ...utils, onOpenChange }
}

function startInput() {
  return screen.getByTestId('entry-dialog-start') as HTMLInputElement
}

function endInput() {
  return screen.getByTestId('entry-dialog-end') as HTMLInputElement
}

function durationInput() {
  return document.getElementById('entry-dialog-duration') as HTMLInputElement
}

function saveButton() {
  return screen.getByTestId('entry-dialog-save') as HTMLButtonElement
}

function taskSelect(): HTMLSelectElement {
  const host = screen.getByTestId('entry-dialog-task')
  return (host.tagName === 'SELECT' ? host : host.querySelector('select')) as HTMLSelectElement
}

async function pickTask(taskId: string = TASK_ID) {
  // The testid marks the picker's container, so the control is looked up inside
  // it rather than assuming the container is the control.
  const host = await screen.findByTestId('entry-dialog-task')
  const select = (host.tagName === 'SELECT' ? host : host.querySelector('select')) as HTMLSelectElement
  // The option only exists once the task list answers; setting a value the select
  // does not carry yet would silently select nothing.
  await waitFor(() => expect(select.querySelector(`option[value="${taskId}"]`)).not.toBeNull())
  fireEvent.change(select, { target: { value: taskId } })
  await waitFor(() => expect(select.value).toBe(taskId))
}

function lastWriteBody(): Record<string, unknown> {
  const call = mockApiCallOrThrow.mock.calls[mockApiCallOrThrow.mock.calls.length - 1]
  const init = call?.[1] as RequestInit | undefined
  return JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
}

beforeEach(() => {
  jest.clearAllMocks()
  mockInjection.calls = []
  mockInjection.beforeSave = { ok: true }
  mockInjection.fieldChange = null
  settingsPayload = {
    rounding: { unitMinutes: 0, direction: 'up' },
    defaults: { billable: true, chainStartFromPreviousEnd: true },
    targets: { dailyHours: 8 },
    warnings: { overlap: true, runningTimer: true },
  }
  overlapRows = []
  entryRows = []
  tagRows = []
  mockConfirm.mockResolvedValue(true)
  mockUseBackendChrome.mockReturnValue({
    payload: { grantedFeatures: ['staff.timesheets.manage_own', 'staff.timesheets.rates.view'] },
  } as never)
  installApiRouter()
  ;(window as unknown as { open: jest.Mock }).open = jest.fn()
})

describe('TimeEntryDialog — 2-of-3 arithmetic', () => {
  it('derives the end from a start plus a duration and badges the derived field', async () => {
    renderDialog()
    await pickTask()

    fireEvent.change(startInput(), { target: { value: '15:10' } })
    fireEvent.change(durationInput(), { target: { value: '1h 15m' } })

    await waitFor(() => expect(endInput().value).toBe('16:25'))
    expect(screen.getByTestId('entry-dialog-computed-end')).toBeInTheDocument()
    expect(screen.queryByTestId('entry-dialog-computed-duration')).not.toBeInTheDocument()
  })

  it('moves the badge to the duration when the end is edited', async () => {
    renderDialog()
    await pickTask()

    fireEvent.change(startInput(), { target: { value: '15:10' } })
    fireEvent.change(durationInput(), { target: { value: '1h 15m' } })
    await waitFor(() => expect(endInput().value).toBe('16:25'))

    fireEvent.change(endInput(), { target: { value: '17:00' } })

    await waitFor(() => expect(durationInput().value).toBe('1h 50m'))
    expect(screen.getByTestId('entry-dialog-computed-duration')).toBeInTheDocument()
    expect(screen.queryByTestId('entry-dialog-computed-end')).not.toBeInTheDocument()
    expect(startInput().value).toBe('15:10')
  })

  it('shows the midnight hint for an end before its start and still saves', async () => {
    renderDialog()
    await pickTask()

    fireEvent.change(startInput(), { target: { value: '23:00' } })
    fireEvent.change(endInput(), { target: { value: '01:00' } })

    await waitFor(() => expect(screen.getByTestId('entry-dialog-midnight')).toBeInTheDocument())
    expect(saveButton()).not.toBeDisabled()

    fireEvent.click(saveButton())
    await waitFor(() => expect(mockApiCallOrThrow).toHaveBeenCalled())
    const body = lastWriteBody()
    expect(body.durationMinutes).toBe(120)
    const startedAt = new Date(String(body.startedAt)).getTime()
    const endedAt = new Date(String(body.endedAt)).getTime()
    expect(endedAt - startedAt).toBe(2 * 60 * 60 * 1000)
  })
})

describe('TimeEntryDialog — screen 9 edge states', () => {
  it('keeps unparseable duration text, lists the accepted formats and disables Save', async () => {
    renderDialog()
    await pickTask()

    fireEvent.change(durationInput(), { target: { value: '1godz i troche' } })

    await waitFor(() => expect(saveButton()).toBeDisabled())
    expect(durationInput().value).toBe('1godz i troche')
    expect(
      screen.getByText("I don't understand that format. Try 1h 40m, 1.5h, 90m or 1:40."),
    ).toBeInTheDocument()
  })

  it('warns about an overlap without blocking the save', async () => {
    overlapRows = [
      {
        id: OVERLAP_ID,
        started_at: '11:45',
        ended_at: '13:30',
        duration_minutes: 105,
        task_title: 'Przegląd zapytań SQL',
        project_name: 'audyt wydajności',
      },
    ]
    renderDialog()
    await pickTask()

    fireEvent.change(startInput(), { target: { value: '11:00' } })
    fireEvent.change(endInput(), { target: { value: '13:00' } })

    const alert = await screen.findByTestId('entry-dialog-overlap')
    expect(alert).toHaveTextContent('11:45 – 13:30')
    expect(alert).toHaveTextContent('Przegląd zapytań SQL')
    expect(alert).toHaveTextContent('1:45')
    expect(saveButton()).not.toBeDisabled()
  })

  it('applies the suggested start when "Snap start to" is used', async () => {
    overlapRows = [
      {
        id: OVERLAP_ID,
        started_at: '11:45',
        ended_at: '13:30',
        duration_minutes: 105,
        task_title: 'Przegląd zapytań SQL',
        project_name: 'audyt wydajności',
      },
    ]
    renderDialog()
    await pickTask()

    fireEvent.change(startInput(), { target: { value: '11:00' } })
    fireEvent.change(endInput(), { target: { value: '13:00' } })
    const snap = await screen.findByTestId('entry-dialog-overlap-snap')
    expect(snap).toHaveTextContent('Snap start to 13:30')

    fireEvent.click(snap)

    await waitFor(() => expect(startInput().value).toBe('13:30'))
    expect(endInput().value).toBe('15:30')
    expect(durationInput().value).toBe('2h')
  })

  it('degrades to no warning when the advisory probe fails', async () => {
    mockApiCall.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/time-entries/overlaps')) {
        return { ok: false, status: 500, result: null, response: {} as Response, cacheStatus: null } as never
      }
      if (url.includes('/timesheets/settings')) return ok(settingsPayload) as never
      if (url.includes('/team-members/self')) {
        return ok({ member: { id: SELF_ID, displayName: 'Anna Nowak' } }) as never
      }
      if (url.includes('/timesheets/tasks')) return ok({ items: taskRows, total: taskRows.length }) as never
      if (url.includes('/timesheets/time-projects')) return ok({ items: projectRows, total: 1 }) as never
      return ok({ items: [], total: 0 }) as never
    })
    renderDialog()
    await pickTask()

    fireEvent.change(startInput(), { target: { value: '11:00' } })
    fireEvent.change(endInput(), { target: { value: '13:00' } })

    await waitFor(() => expect(saveButton()).not.toBeDisabled())
    expect(screen.queryByTestId('entry-dialog-overlap')).not.toBeInTheDocument()
  })
})

describe('TimeEntryDialog — money', () => {
  it('renders a read-only cost that states the rounding it applied', async () => {
    settingsPayload = {
      ...settingsPayload,
      rounding: { unitMinutes: 15, direction: 'up' },
    }
    renderDialog()
    await pickTask()

    fireEvent.change(durationInput(), { target: { value: '1:12' } })

    const cost = (await screen.findByTestId('entry-dialog-cost')) as HTMLInputElement
    expect(cost).toHaveAttribute('readonly')
    await waitFor(() =>
      expect(screen.getByTestId('entry-dialog-cost-hint')).toHaveTextContent('1:12 rounded to 1:15'),
    )
    // 1:15 at the project rate of 320 PLN/h.
    expect(cost.value).toContain('400')
  })

  it('hides rates and cost without staff.timesheets.rates.view', async () => {
    mockUseBackendChrome.mockReturnValue({
      payload: { grantedFeatures: ['staff.timesheets.manage_own'] },
    } as never)
    renderDialog()
    await pickTask()

    fireEvent.change(durationInput(), { target: { value: '1h' } })

    expect(await screen.findByTestId('entry-dialog-money-hidden')).toBeInTheDocument()
    expect(screen.queryByTestId('entry-dialog-cost')).not.toBeInTheDocument()
    expect(screen.queryByTestId('entry-dialog-rate-badge')).not.toBeInTheDocument()
  })
})

describe('TimeEntryDialog — saving', () => {
  it('save and add another keeps the dialog open and chains the start from the previous end', async () => {
    const onOpenChange = jest.fn()
    renderDialog({ onOpenChange })
    await pickTask()

    fireEvent.change(screen.getByTestId('entry-dialog-description'), {
      target: { value: 'Poprawki mapowania cen kontraktowych' },
    })
    fireEvent.change(startInput(), { target: { value: '15:10' } })
    fireEvent.change(durationInput(), { target: { value: '1h 15m' } })
    await waitFor(() => expect(endInput().value).toBe('16:25'))

    fireEvent.click(screen.getByTestId('entry-dialog-save-again'))

    await waitFor(() => expect(startInput().value).toBe('16:25'))
    expect(onOpenChange).not.toHaveBeenCalled()
    expect((screen.getByTestId('entry-dialog-description') as HTMLInputElement).value).toBe('')
    expect(endInput().value).toBe('')
    expect(durationInput().value).toBe('')
    expect(taskSelect().value).toBe(TASK_ID)
  })

  it('sends the optimistic lock header when editing an existing entry', async () => {
    entryRows = [
      {
        id: ENTRY_ID,
        date: '2026-07-20',
        started_at: '2026-07-20T09:00:00.000Z',
        ended_at: '2026-07-20T10:00:00.000Z',
        duration_minutes: 60,
        description: 'Analiza planów zapytań',
        task_id: TASK_ID,
        time_project_id: PROJECT_ID,
        is_billable: true,
        isLocked: false,
        updated_at: VERSION,
        tags: [],
      },
    ]
    renderDialog({ entryId: ENTRY_ID })

    await waitFor(() =>
      expect((screen.getByTestId('entry-dialog-description') as HTMLInputElement).value).toBe(
        'Analiza planów zapytań',
      ),
    )

    fireEvent.click(saveButton())

    await waitFor(() => expect(mockApiCallOrThrow).toHaveBeenCalled())
    expect(mockWithScopedHeaders).toHaveBeenCalledWith(
      { [OPTIMISTIC_LOCK_HEADER_NAME]: VERSION },
      expect.any(Function),
    )
    const call = mockApiCallOrThrow.mock.calls[0]
    expect((call?.[1] as RequestInit).method).toBe('PUT')
    expect(lastWriteBody().id).toBe(ENTRY_ID)
  })

  it('asks for the entry by `ids`, the parameter the list schema actually reads', async () => {
    entryRows = [
      {
        id: ENTRY_ID,
        date: '2026-07-20',
        duration_minutes: 60,
        description: 'Analiza planów zapytań',
        task_id: TASK_ID,
        time_project_id: PROJECT_ID,
        is_billable: true,
        isLocked: false,
        updated_at: VERSION,
        tags: [],
      },
    ]
    renderDialog({ entryId: ENTRY_ID })

    await waitFor(() =>
      expect((screen.getByTestId('entry-dialog-description') as HTMLInputElement).value).toBe(
        'Analiza planów zapytań',
      ),
    )

    // The list schema declares `ids` and is `.passthrough()`, so `?id=` was
    // accepted, never read, and the filter silently disappeared — every row then
    // opened whichever entry happened to sort first.
    const entryRequest = mockApiCall.mock.calls
      .map((call) => String(call[0]))
      .find((url) => url.includes('/time-entries?'))
    expect(entryRequest).toContain(`ids=${ENTRY_ID}`)
    expect(entryRequest).not.toMatch(/[?&]id=/)
  })

  it('refuses to populate when the response carries a different entry', async () => {
    // Only a dropped filter can produce this, and populating anyway would write
    // one entry's values onto another the moment the user pressed Save.
    entryRows = [
      {
        id: OVERLAP_ID,
        date: '2026-07-20',
        duration_minutes: 180,
        description: 'Wpis innego zadania',
        task_id: OTHER_TASK_ID,
        time_project_id: PROJECT_ID,
        is_billable: true,
        isLocked: false,
        updated_at: VERSION,
        tags: [],
      },
    ]
    renderDialog({ entryId: ENTRY_ID })

    await waitFor(() =>
      expect(screen.getByText('Could not load the time entry.')).toBeInTheDocument(),
    )
    expect(screen.queryByTestId('entry-dialog-description')).not.toBeInTheDocument()
  })

  it('opens a locked entry read-only with a link to its report', async () => {
    entryRows = [
      {
        id: ENTRY_ID,
        date: '2026-07-20',
        started_at: '2026-07-20T09:00:00.000Z',
        duration_minutes: 60,
        description: 'Zamknięty wpis',
        task_id: TASK_ID,
        time_project_id: PROJECT_ID,
        is_billable: true,
        isLocked: true,
        lockedReportId: REPORT_ID,
        updated_at: VERSION,
        tags: [],
      },
    ]
    renderDialog({ entryId: ENTRY_ID })

    expect(await screen.findByTestId('entry-dialog-locked')).toBeInTheDocument()
    expect(screen.queryByTestId('entry-dialog-save')).not.toBeInTheDocument()
    expect(screen.queryByTestId('entry-dialog-save-again')).not.toBeInTheDocument()
    expect(taskSelect()).toBeDisabled()
    expect(screen.getByTestId('entry-dialog-description')).toBeDisabled()

    fireEvent.click(screen.getByTestId('entry-dialog-locked-report'))
    expect(window.open).toHaveBeenCalledWith(
      expect.stringContaining(REPORT_ID),
      '_blank',
      'noopener',
    )
  })

  it('saves on ⌘↵', async () => {
    renderDialog()
    await pickTask()
    fireEvent.change(durationInput(), { target: { value: '1h' } })

    fireEvent.keyDown(screen.getByTestId('entry-dialog'), { key: 'Enter', metaKey: true })

    await waitFor(() => expect(mockApiCallOrThrow).toHaveBeenCalled())
    expect((mockApiCallOrThrow.mock.calls[0]?.[1] as RequestInit).method).toBe('POST')
  })
})

/**
 * U2 — the dialog holds work that exists nowhere else until Save, so every way
 * out of it has to ask first. The routes differ (Escape, the ×, the overlay,
 * Cancel) but they all reach Radix's `onOpenChange`, which is where the guard is.
 */
describe('TimeEntryDialog — unsaved work', () => {
  it('asks before discarding a half-entered entry and keeps it when declined', async () => {
    mockConfirm.mockResolvedValue(false)
    const onOpenChange = jest.fn()
    renderDialog({ onOpenChange })
    await pickTask()
    fireEvent.change(screen.getByTestId('entry-dialog-description'), {
      target: { value: 'Poprawki mapowania cen' },
    })

    fireEvent.keyDown(screen.getByTestId('entry-dialog'), { key: 'Escape' })

    await waitFor(() => expect(mockConfirm).toHaveBeenCalled())
    expect(mockConfirm.mock.calls[0]?.[0]).toMatchObject({ variant: 'destructive' })
    expect(onOpenChange).not.toHaveBeenCalled()
    expect((screen.getByTestId('entry-dialog-description') as HTMLInputElement).value).toBe(
      'Poprawki mapowania cen',
    )
  })

  it('closes once the discard is confirmed', async () => {
    mockConfirm.mockResolvedValue(true)
    const onOpenChange = jest.fn()
    renderDialog({ onOpenChange })
    await pickTask()

    fireEvent.click(screen.getByText('Cancel'))

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(mockConfirm).toHaveBeenCalled()
  })

  it('closes an untouched form without a prompt', async () => {
    const onOpenChange = jest.fn()
    renderDialog({ onOpenChange })
    // Wait for the seed to land, so "untouched" means seeded-and-untouched
    // rather than not-yet-seeded.
    await screen.findByTestId('entry-dialog-description')

    fireEvent.click(screen.getByText('Cancel'))

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(mockConfirm).not.toHaveBeenCalled()
  })

  it('does not treat a saved entry reopened for editing as dirty', async () => {
    entryRows = [
      {
        id: ENTRY_ID,
        date: '2026-07-20',
        started_at: '2026-07-20T09:00:00.000Z',
        ended_at: '2026-07-20T10:00:00.000Z',
        duration_minutes: 60,
        description: 'Analiza planów zapytań',
        task_id: TASK_ID,
        time_project_id: PROJECT_ID,
        is_billable: true,
        isLocked: false,
        updated_at: VERSION,
        tags: [],
      },
    ]
    const onOpenChange = jest.fn()
    renderDialog({ entryId: ENTRY_ID, onOpenChange })
    await waitFor(() =>
      expect((screen.getByTestId('entry-dialog-description') as HTMLInputElement).value).toBe(
        'Analiza planów zapytań',
      ),
    )

    fireEvent.keyDown(screen.getByTestId('entry-dialog'), { key: 'Escape' })

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(mockConfirm).not.toHaveBeenCalled()
  })

  it('keeps the dialog open when Escape dismisses the tag popover instead', async () => {
    const onOpenChange = jest.fn()
    renderDialog({ onOpenChange })
    await pickTask()

    fireEvent.click(await screen.findByTestId('entry-dialog-tag-select'))
    expect(screen.getByTestId('entry-dialog-tag-search')).toBeInTheDocument()

    // Dispatched on the search box, as a real keystroke would be: the popover
    // consumes it before Radix's document-capture dismissal ever sees it.
    fireEvent.keyDown(screen.getByTestId('entry-dialog-tag-search'), { key: 'Escape' })

    await waitFor(() => expect(screen.queryByTestId('entry-dialog-tag-search')).not.toBeInTheDocument())
    expect(mockConfirm).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
  })
})

/** C7 — the picker used to filter a fixed first page, so task 101 did not exist. */
describe('TimeEntryDialog — task search', () => {
  it('finds a task the directory page never returned', async () => {
    renderDialog()
    const select = taskSelect()
    await waitFor(() => expect(select.querySelector(`option[value="${TASK_ID}"]`)).not.toBeNull())
    expect(select.querySelector(`option[value="${REMOTE_TASK_ID}"]`)).toBeNull()

    fireEvent.change(screen.getByTestId('task-picker-query'), { target: { value: 'kwartalnych' } })

    await waitFor(() => expect(taskSelect().querySelector(`option[value="${REMOTE_TASK_ID}"]`)).not.toBeNull())
    // Both fields are asked, because one term cannot be routed to one of them.
    const searchUrls = mockApiCall.mock.calls
      .map((call) => String(call[0]))
      .filter((url) => url.includes('/timesheets/tasks') && url.includes('kwartalnych'))
    expect(searchUrls.some((url) => url.includes('q=kwartalnych'))).toBe(true)
    expect(searchUrls.some((url) => url.includes('reference=kwartalnych'))).toBe(true)
    for (const url of searchUrls) {
      expect(Number(new URLSearchParams(url.slice(url.indexOf('?') + 1)).get('pageSize'))).toBeLessThanOrEqual(100)
    }
  })

  it('debounces the remote search rather than asking once per keystroke', async () => {
    renderDialog()
    await waitFor(() => expect(taskSelect().querySelector(`option[value="${TASK_ID}"]`)).not.toBeNull())
    const queryBox = screen.getByTestId('task-picker-query')

    fireEvent.change(queryBox, { target: { value: 'k' } })
    fireEvent.change(queryBox, { target: { value: 'kw' } })
    fireEvent.change(queryBox, { target: { value: 'kwartalnych' } })

    await waitFor(() => expect(taskSelect().querySelector(`option[value="${REMOTE_TASK_ID}"]`)).not.toBeNull())
    const searched = mockApiCall.mock.calls
      .map((call) => String(call[0]))
      .filter((url) => url.includes('/timesheets/tasks') && (url.includes('&q=') || url.includes('&reference=')))
    // Two requests — the title one and the reference one — for the settled term.
    expect(searched).toHaveLength(2)
  })

  it('keeps a searched task selected after the search box is cleared', async () => {
    renderDialog()
    await waitFor(() => expect(taskSelect().querySelector(`option[value="${TASK_ID}"]`)).not.toBeNull())

    fireEvent.change(screen.getByTestId('task-picker-query'), { target: { value: 'AWR-412' } })
    await waitFor(() => expect(taskSelect().querySelector(`option[value="${REMOTE_TASK_ID}"]`)).not.toBeNull())
    fireEvent.change(taskSelect(), { target: { value: REMOTE_TASK_ID } })
    fireEvent.change(screen.getByTestId('task-picker-query'), { target: { value: '' } })

    await waitFor(() => expect(taskSelect().value).toBe(REMOTE_TASK_ID))
    expect(taskSelect().querySelector(`option[value="${REMOTE_TASK_ID}"]`)).not.toBeNull()
  })
})

/** C9 — the chip and the picker dot have to name the same colour. */
describe('TimeEntryDialog — inline tag creation', () => {
  it('sends the name-derived colour so the chip is not grey', async () => {
    renderDialog()
    await pickTask()

    fireEvent.click(await screen.findByTestId('entry-dialog-tag-select'))
    fireEvent.change(screen.getByTestId('entry-dialog-tag-search'), { target: { value: 'Rozliczenia' } })
    fireEvent.click(screen.getByTestId('entry-dialog-tag-create'))

    await waitFor(() => expect(tagRows).toHaveLength(1))
    const createCall = mockApiCallOrThrow.mock.calls.find((call) => String(call[0]).includes('/timesheets/tags'))
    const body = JSON.parse(String((createCall?.[1] as RequestInit).body)) as Record<string, unknown>
    expect(body.label).toBe('Rozliczenia')
    // The same hue the picker's dot is tinted with, not a server default of null.
    expect(body.color).toBe(autoColorFromName('Rozliczenia').key)
    expect(tagRows[0].color).toBe(body.color)

    const chip = await screen.findByText('Rozliczenia')
    const chipElement = chip.closest('[style]') as HTMLElement | null
    expect(chipElement?.style.backgroundColor).not.toBe('')
  })
})

/**
 * T7.4 — the whole loop (pick task → duration → save → next) has to be doable
 * without a pointer. Saving already worked; what did not was getting back to the
 * top of the loop afterwards.
 */
describe('TimeEntryDialog — keyboard loop', () => {
  it('saves and stays open on ⌘⇧↵, so a run of entries never needs the mouse', async () => {
    const onOpenChange = jest.fn()
    renderDialog({ onOpenChange })
    await pickTask()
    fireEvent.change(startInput(), { target: { value: '15:10' } })
    fireEvent.change(durationInput(), { target: { value: '1h' } })

    fireEvent.keyDown(screen.getByTestId('entry-dialog'), { key: 'Enter', metaKey: true, shiftKey: true })

    await waitFor(() => expect(mockApiCallOrThrow).toHaveBeenCalled())
    await waitFor(() => expect(startInput().value).toBe('16:10'))
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('returns focus to the task picker after save and add another', async () => {
    renderDialog({})
    await pickTask()
    fireEvent.change(durationInput(), { target: { value: '1h' } })

    fireEvent.click(screen.getByTestId('entry-dialog-save-again'))

    await waitFor(() => expect(durationInput().value).toBe(''))
    // The picker is a container holding a search input, so focus lands on the
    // control inside it rather than on the container itself.
    expect(screen.getByTestId('entry-dialog-task').contains(document.activeElement)).toBe(true)
  })

  it('advertises both save shortcuts and the cancel one', async () => {
    renderDialog({})
    await pickTask()

    const dialog = screen.getByTestId('entry-dialog')
    expect(dialog.textContent).toContain('save and add another')
    expect(dialog.textContent).toContain('cancel')
  })
})

/**
 * U7 — the buttons only went `disabled` while a write was in flight, which on a
 * slow connection is indistinguishable from a dialog that stopped responding.
 * The spinner has to land on the button that was actually pressed.
 */
describe('TimeEntryDialog — pending state', () => {
  it('spins the Save button while the write is in flight', async () => {
    let release: (() => void) | null = null
    mockApiCallOrThrow.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve(ok({ id: ENTRY_ID }) as never)
        }) as never,
    )

    renderDialog()
    await pickTask()
    fireEvent.change(durationInput(), { target: { value: '1h' } })

    fireEvent.click(saveButton())

    await waitFor(() => expect(saveButton().querySelector('[role="status"]')).not.toBeNull())
    expect(screen.getByTestId('entry-dialog-save-again').querySelector('[role="status"]')).toBeNull()
    expect(saveButton()).toBeDisabled()

    release?.()
    await waitFor(() => expect(saveButton().querySelector('[role="status"]')).toBeNull())
  })

  it('spins the save-and-add-another button instead when that one is pressed', async () => {
    let release: (() => void) | null = null
    mockApiCallOrThrow.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve(ok({ id: ENTRY_ID }) as never)
        }) as never,
    )

    renderDialog()
    await pickTask()
    fireEvent.change(durationInput(), { target: { value: '1h' } })

    fireEvent.click(screen.getByTestId('entry-dialog-save-again'))

    await waitFor(() =>
      expect(screen.getByTestId('entry-dialog-save-again').querySelector('[role="status"]')).not.toBeNull(),
    )
    expect(saveButton().querySelector('[role="status"]')).toBeNull()

    release?.()
    await waitFor(() =>
      expect(screen.getByTestId('entry-dialog-save-again').querySelector('[role="status"]')).toBeNull(),
    )
  })
})

/**
 * U8 — a disabled Save cannot say which of the two required fields it is waiting
 * for, and a field-shaped server complaint said in a toast makes the reader hunt
 * for the control it is about. Both now answer under the offending control; only
 * genuinely global failures stay in the flash.
 */
describe('TimeEntryDialog — field-level validation', () => {
  it('names the missing task under the picker rather than only greying out Save', async () => {
    renderDialog()
    fireEvent.change(durationInput(), { target: { value: '1h' } })

    expect(saveButton()).not.toBeDisabled()
    fireEvent.click(saveButton())

    const message = await screen.findByTestId('entry-dialog-task-error')
    expect(message).toHaveAttribute('role', 'alert')
    expect(message.textContent).toBe('Pick the task this time belongs to.')
    expect(mockApiCallOrThrow).not.toHaveBeenCalled()
    expect(mockFlash).not.toHaveBeenCalled()
  })

  it('names the missing duration under the duration field', async () => {
    renderDialog()
    await pickTask()

    expect(saveButton()).not.toBeDisabled()
    fireEvent.click(saveButton())

    const message = await screen.findByText('Enter how long the work took.')
    expect(message).toHaveAttribute('role', 'alert')
    expect(mockApiCallOrThrow).not.toHaveBeenCalled()
    expect(mockFlash).not.toHaveBeenCalled()
  })

  it('drops the message as soon as the field is filled in, and then saves', async () => {
    renderDialog()
    fireEvent.change(durationInput(), { target: { value: '1h' } })
    fireEvent.click(saveButton())
    await screen.findByTestId('entry-dialog-task-error')

    await pickTask()

    await waitFor(() => expect(screen.queryByTestId('entry-dialog-task-error')).not.toBeInTheDocument())
    fireEvent.click(saveButton())
    await waitFor(() => expect(mockApiCallOrThrow).toHaveBeenCalled())
  })

  it('puts a field-shaped server refusal under its field instead of in a toast', async () => {
    mockApiCallOrThrow.mockRejectedValue(
      Object.assign(new Error('Invalid input'), {
        body: { error: 'Invalid input', details: [{ path: ['durationMinutes'], message: 'Must be under 24 hours.' }] },
      }),
    )

    renderDialog()
    await pickTask()
    fireEvent.change(durationInput(), { target: { value: '1h' } })
    fireEvent.click(saveButton())

    const message = await screen.findByText('Must be under 24 hours.')
    expect(message).toHaveAttribute('role', 'alert')
    expect(mockFlash).not.toHaveBeenCalled()
  })

  it('still flashes a network failure, which belongs to no field', async () => {
    mockApiCallOrThrow.mockRejectedValue(new Error('Network request failed'))

    renderDialog()
    await pickTask()
    fireEvent.change(durationInput(), { target: { value: '1h' } })
    fireEvent.click(saveButton())

    await waitFor(() => expect(mockFlash).toHaveBeenCalledWith('Network request failed', 'error'))
    expect(screen.queryByTestId('entry-dialog-task-error')).not.toBeInTheDocument()
  })

  it('keeps the 409 conflict on its own path', async () => {
    mockApiCallOrThrow.mockRejectedValue(
      Object.assign(new Error('Conflict'), { body: { code: 'optimistic_lock_conflict' } }),
    )

    renderDialog()
    await pickTask()
    fireEvent.change(durationInput(), { target: { value: '1h' } })
    fireEvent.click(saveButton())

    await waitFor(() => expect(mockApiCallOrThrow).toHaveBeenCalled())
    await waitFor(() => expect(mockFlash).not.toHaveBeenCalled())
    expect(screen.queryByTestId('entry-dialog-task-error')).not.toBeInTheDocument()
  })
})

/**
 * EP-29: the dialog is hand-rolled, so it plays the `CrudForm` host contract by
 * hand. These pin the three lifecycle semantics `CrudForm` guarantees.
 */
describe('TimeEntryDialog — crud-form host lifecycle', () => {
  it('blocks the save when a widget returns ok: false and surfaces its message', async () => {
    mockInjection.beforeSave = { ok: false, message: 'Needs a purchase order' }

    renderDialog()
    await pickTask()
    fireEvent.change(durationInput(), { target: { value: '1h' } })
    fireEvent.click(saveButton())

    await waitFor(() => expect(mockFlash).toHaveBeenCalledWith('Needs a purchase order', 'error'))
    expect(mockApiCallOrThrow).not.toHaveBeenCalled()
  })

  it('merges widget request headers without displacing the optimistic lock header', async () => {
    mockInjection.beforeSave = { ok: true, requestHeaders: { 'x-purchase-order': 'PO-42' } }
    entryRows = [
      {
        id: ENTRY_ID,
        date: '2026-07-20',
        started_at: '2026-07-20T09:00:00.000Z',
        ended_at: '2026-07-20T10:00:00.000Z',
        duration_minutes: 60,
        description: 'Analiza planów zapytań',
        task_id: TASK_ID,
        time_project_id: PROJECT_ID,
        is_billable: true,
        isLocked: false,
        updated_at: VERSION,
        tags: [],
      },
    ]

    renderDialog({ entryId: ENTRY_ID })
    await waitFor(() =>
      expect((screen.getByTestId('entry-dialog-description') as HTMLInputElement).value).toBe(
        'Analiza planów zapytań',
      ),
    )
    fireEvent.click(saveButton())

    await waitFor(() => expect(mockApiCallOrThrow).toHaveBeenCalled())
    expect(mockWithScopedHeaders).toHaveBeenCalledWith(
      { 'x-purchase-order': 'PO-42', [OPTIMISTIC_LOCK_HEADER_NAME]: VERSION },
      expect.any(Function),
    )
  })

  it('runs onAfterSave once the write succeeded', async () => {
    renderDialog()
    await pickTask()
    fireEvent.change(durationInput(), { target: { value: '1h' } })
    fireEvent.click(saveButton())

    await waitFor(() => expect(mockInjection.calls.some((call) => call.event === 'onAfterSave')).toBe(true))
    const order = mockInjection.calls.map((call) => call.event)
    expect(order.indexOf('onBeforeSave')).toBeLessThan(order.indexOf('onAfterSave'))
  })

  it('dispatches onFieldChange for an edited field and writes the returned value back', async () => {
    mockInjection.fieldChange = { value: 'Rewritten by the widget' }

    renderDialog()
    await pickTask()
    fireEvent.change(screen.getByTestId('entry-dialog-description'), { target: { value: 'Typed' } })

    await waitFor(() =>
      expect((screen.getByTestId('entry-dialog-description') as HTMLInputElement).value).toBe(
        'Rewritten by the widget',
      ),
    )
    expect(
      mockInjection.calls.some((call) => call.event === 'onFieldChange' && call.fieldId === 'description'),
    ).toBe(true)
  })
})
