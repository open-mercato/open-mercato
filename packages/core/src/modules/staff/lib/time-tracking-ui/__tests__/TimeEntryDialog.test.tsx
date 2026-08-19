/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { apiCall, apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
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
  }
  const TaskPicker = ({ value, onChange, items, disabled }: Props) =>
    ReactModule.createElement(
      'select',
      {
        value: value ?? '',
        disabled,
        onChange: (event: React.ChangeEvent<HTMLSelectElement>) => onChange(event.target.value || null),
      },
      [
        ReactModule.createElement('option', { key: '__empty', value: '' }, ''),
        ...items.map((item) => ReactModule.createElement('option', { key: item.id, value: item.id }, item.title)),
      ],
    )
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
    if (url.includes('/timesheets/tasks')) return ok({ items: taskRows, total: taskRows.length }) as never
    if (url.includes('/timesheets/time-projects')) {
      return ok({ items: projectRows, total: projectRows.length }) as never
    }
    if (url.includes('/timesheets/tags')) return ok({ items: [], total: 0 }) as never
    if (url.includes('/time-entries/overlaps')) {
      return ok({ items: overlapRows, total: overlapRows.length }) as never
    }
    if (url.includes('/time-entries?')) return ok({ items: entryRows, total: entryRows.length }) as never
    return ok({ items: [], total: 0 }) as never
  })
  mockApiCallOrThrow.mockImplementation(async () => ok({ id: ENTRY_ID }) as never)
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
  settingsPayload = {
    rounding: { unitMinutes: 0, direction: 'up' },
    defaults: { billable: true, chainStartFromPreviousEnd: true },
    targets: { dailyHours: 8 },
    warnings: { overlap: true, runningTimer: true },
  }
  overlapRows = []
  entryRows = []
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

  it('saves on ⌘↵ and cancels on Escape', async () => {
    const onOpenChange = jest.fn()
    renderDialog({ onOpenChange })
    await pickTask()
    fireEvent.change(durationInput(), { target: { value: '1h' } })

    const dialog = screen.getByTestId('entry-dialog')
    fireEvent.keyDown(dialog, { key: 'Enter', metaKey: true })
    await waitFor(() => expect(mockApiCallOrThrow).toHaveBeenCalled())
    expect((mockApiCallOrThrow.mock.calls[0]?.[1] as RequestInit).method).toBe('POST')

    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(onOpenChange).toHaveBeenCalledWith(false)
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
