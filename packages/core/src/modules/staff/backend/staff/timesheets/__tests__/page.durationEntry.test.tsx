/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import MyTimesheetsPage from '../page'
import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

const mockRunMutation = jest.fn(async ({ operation }: { operation: () => Promise<unknown> }) => {
  await operation()
  return true
})

// The page's loadData callback depends on `t`, so the translator identity must be
// stable across renders exactly as the real context-backed useT is.
jest.mock('@open-mercato/shared/lib/i18n/context', () => {
  const translate = (_key: string, fallback?: string) => fallback ?? _key
  return { useT: () => translate }
})

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => 0,
}))

jest.mock('@open-mercato/shared/lib/logger', () => ({
  createLogger: () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(async () => ({ ok: true, status: 200, result: { ok: true, granted: [] }, response: {} })),
  apiCallOrThrow: jest.fn(async () => ({})),
  readApiResultOrThrow: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({ runMutation: mockRunMutation, retryLastMutation: jest.fn() }),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: jest.fn(async () => true), ConfirmDialogElement: null }),
}))

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  PageBody: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/backend/detail', () => ({
  LoadingMessage: () => <div>loading</div>,
}))

jest.mock('@open-mercato/ui/primitives/button', () => ({
  Button: ({ children, ...rest }: React.ComponentProps<'button'>) => <button {...rest}>{children}</button>,
}))

jest.mock('../../../../lib/timesheets-ui/ViewSwitcher', () => ({ ViewSwitcher: () => null }))
jest.mock('../../../../lib/timesheets-ui/CalendarPicker', () => ({ CalendarPicker: () => null }))
jest.mock('../../../../lib/timesheets-ui/ListView', () => ({ ListView: () => null }))
jest.mock('../../../../lib/timesheets-ui/TimerBar', () => ({ TimerBar: () => null }))
jest.mock('../../../../lib/timesheets-ui/AddRowDropdown', () => ({ AddRowDropdown: () => null }))
jest.mock('../../../../lib/timesheets-ui/CreateProjectDialog', () => ({ CreateProjectDialog: () => null }))
jest.mock('../../../../lib/timesheets-ui/ProjectColorDot', () => ({ ProjectColorDot: () => null }))

const readApiResultOrThrowMock = readApiResultOrThrow as jest.Mock
const apiCallOrThrowMock = apiCallOrThrow as jest.Mock

function stubApiRoutes(): void {
  readApiResultOrThrowMock.mockImplementation(async (url: string) => {
    if (url.includes('/api/staff/team-members/self')) {
      return { member: { id: 'member-1', displayName: 'Tester' } }
    }
    if (url.includes('/api/staff/timesheets/my-projects')) {
      return { items: [{ time_project_id: 'project-1', show_in_grid: true }] }
    }
    if (url.includes('/api/staff/timesheets/time-projects')) {
      return { items: [{ id: 'project-1', name: 'Build', code: 'BLD', color: null }] }
    }
    if (url.includes('/api/staff/timesheets/time-entries')) {
      return { items: [] }
    }
    return { items: [] }
  })
}

function stubTwoProjectApiRoutes(): void {
  readApiResultOrThrowMock.mockImplementation(async (url: string) => {
    if (url.includes('/api/staff/team-members/self')) {
      return { member: { id: 'member-1', displayName: 'Tester' } }
    }
    if (url.includes('/api/staff/timesheets/my-projects')) {
      return {
        items: [
          { time_project_id: 'project-1', show_in_grid: true },
          { time_project_id: 'project-2', show_in_grid: true },
        ],
      }
    }
    if (url.includes('/api/staff/timesheets/time-projects')) {
      return {
        items: [
          { id: 'project-1', name: 'Build', code: 'BLD', color: null },
          { id: 'project-2', name: 'Design', code: 'DSN', color: null },
        ],
      }
    }
    if (url.includes('/api/staff/timesheets/time-entries')) {
      return { items: [] }
    }
    return { items: [] }
  })
}

function cellsFor(projectName: string): HTMLInputElement[] {
  return screen.queryAllByRole('textbox', {
    name: new RegExp(`^Duration for ${projectName} on `),
  }) as HTMLInputElement[]
}

function bulkSaveCall(): [string, { body: string }] | undefined {
  return apiCallOrThrowMock.mock.calls.find(
    ([url]) => url === '/api/staff/timesheets/time-entries/bulk',
  ) as [string, { body: string }] | undefined
}

async function renderGrid(): Promise<HTMLInputElement[]> {
  render(<MyTimesheetsPage />)
  await waitFor(() => {
    expect(screen.getAllByPlaceholderText('0').length).toBeGreaterThan(0)
  })
  return screen.getAllByPlaceholderText('0') as HTMLInputElement[]
}

function saveButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Save Changes' }) as HTMLButtonElement
}

// The grid's column headers render each visible day's day-of-month number, so a
// document-wide query for a bare digit can match a calendar header instead of a
// total. Scope every total assertion to the footer row that carries them.
function totalsRow(): HTMLElement {
  return screen.getByText('Daily Total').closest('tr') as HTMLElement
}

function typeAndBlur(input: HTMLInputElement, value: string): void {
  fireEvent.change(input, { target: { value } })
  fireEvent.blur(input, { target: { value } })
}

describe('MyTimesheetsPage — duration entry (#4846)', () => {
  // The page derives the visible week from the wall clock, so an unpinned clock makes
  // every rendered day number — and any assertion that could collide with one — depend
  // on the day the suite runs. Pin it to a week that deliberately contains a day
  // numbered 2 (2026-09-02) so the totals-scoping guard below is exercised on every run
  // instead of only during weeks that happen to contain that collision. Local-time parts
  // keep this independent of the runner's timezone, and only Date is faked so the timer
  // functions Testing Library's waitFor relies on stay real.
  beforeAll(() => {
    jest.useFakeTimers({
      doNotFake: [
        'cancelAnimationFrame',
        'cancelIdleCallback',
        'clearImmediate',
        'clearInterval',
        'clearTimeout',
        'hrtime',
        'nextTick',
        'performance',
        'queueMicrotask',
        'requestAnimationFrame',
        'requestIdleCallback',
        'setImmediate',
        'setInterval',
        'setTimeout',
      ],
      now: new Date(2026, 8, 1, 12, 0, 0),
    })
  })

  afterAll(() => {
    jest.useRealTimers()
  })

  beforeEach(() => {
    jest.clearAllMocks()
    stubApiRoutes()
    mockRunMutation.mockImplementation(async ({ operation }: { operation: () => Promise<unknown> }) => {
      await operation()
      return true
    })
  })

  it('keeps the colon in 1:30 and saves 90 minutes rather than a clamped day', async () => {
    const inputs = await renderGrid()
    typeAndBlur(inputs[0], '1:30')

    await waitFor(() => expect(saveButton()).not.toBeDisabled())
    fireEvent.click(saveButton())

    await waitFor(() => expect(apiCallOrThrowMock).toHaveBeenCalled())
    const [url, init] = apiCallOrThrowMock.mock.calls[0]
    expect(url).toBe('/api/staff/timesheets/time-entries/bulk')
    const payload = JSON.parse((init as { body: string }).body)
    expect(payload.entries).toHaveLength(1)
    expect(payload.entries[0].durationMinutes).toBe(90)
  })

  it('saves 90 minutes for the 90m minute form', async () => {
    const inputs = await renderGrid()
    typeAndBlur(inputs[0], '90m')

    await waitFor(() => expect(saveButton()).not.toBeDisabled())
    fireEvent.click(saveButton())

    await waitFor(() => expect(apiCallOrThrowMock).toHaveBeenCalled())
    const payload = JSON.parse((apiCallOrThrowMock.mock.calls[0][1] as { body: string }).body)
    expect(payload.entries[0].durationMinutes).toBe(90)
  })

  it('blocks the save and flags the cell instead of storing a clamped 24h day for a bare 30', async () => {
    const inputs = await renderGrid()
    typeAndBlur(inputs[0], '30')

    await waitFor(() => expect(inputs[0]).toHaveAttribute('aria-invalid', 'true'))
    expect(saveButton()).toBeDisabled()
    expect(screen.getByText('Fix the highlighted durations to save')).toBeInTheDocument()

    fireEvent.click(saveButton())
    expect(apiCallOrThrowMock).not.toHaveBeenCalled()
  })

  it('blocks the save on unparseable text instead of silently reverting to zero', async () => {
    const inputs = await renderGrid()
    typeAndBlur(inputs[0], 'abc')

    await waitFor(() => expect(inputs[0]).toHaveAttribute('aria-invalid', 'true'))
    expect(inputs[0]).toHaveValue('abc')
    expect(saveButton()).toBeDisabled()

    fireEvent.click(saveButton())
    expect(apiCallOrThrowMock).not.toHaveBeenCalled()
  })

  it('clears the error and re-enables the save once the cell is corrected', async () => {
    const inputs = await renderGrid()
    typeAndBlur(inputs[0], '1:70')
    await waitFor(() => expect(saveButton()).toBeDisabled())

    typeAndBlur(inputs[0], '1:30')
    await waitFor(() => expect(saveButton()).not.toBeDisabled())
    expect(inputs[0]).not.toHaveAttribute('aria-invalid', 'true')

    fireEvent.click(saveButton())
    await waitFor(() => expect(apiCallOrThrowMock).toHaveBeenCalled())
    const payload = JSON.parse((apiCallOrThrowMock.mock.calls[0][1] as { body: string }).body)
    expect(payload.entries[0].durationMinutes).toBe(90)
  })

  it('stops counting a cell in the totals once its pending value becomes invalid', async () => {
    const inputs = await renderGrid()
    typeAndBlur(inputs[0], '2')
    await waitFor(() => expect(within(totalsRow()).getAllByText('2').length).toBeGreaterThan(0))

    typeAndBlur(inputs[0], 'abc')
    await waitFor(() => expect(inputs[0]).toHaveAttribute('aria-invalid', 'true'))
    expect(within(totalsRow()).queryAllByText('2')).toHaveLength(0)
    // The pinned week still renders a day-of-month header reading 2, which is exactly
    // what a document-wide query would wrongly count as a surviving total.
    expect(screen.getAllByText('2').length).toBeGreaterThan(0)
  })

  it('names every duration cell after its own project and date', async () => {
    const inputs = await renderGrid()
    const names = inputs.map((input) => input.getAttribute('aria-label') ?? '')

    expect(names).toHaveLength(inputs.length)
    for (const name of names) {
      expect(name).toMatch(/^Duration for Build on .+/)
    }
    expect(new Set(names).size).toBe(names.length)
  })

  it('keeps the accessible name on a rejected cell so the invalid state is announced with it', async () => {
    const inputs = await renderGrid()
    const accessibleName = inputs[0].getAttribute('aria-label') as string
    typeAndBlur(inputs[0], 'abc')

    await waitFor(() => expect(inputs[0]).toHaveAttribute('aria-invalid', 'true'))
    const byAccessibleName = screen.getByRole('textbox', { name: accessibleName })
    expect(byAccessibleName).toBe(inputs[0])
    expect(byAccessibleName).toHaveAttribute('aria-invalid', 'true')
    expect(byAccessibleName).toHaveValue('abc')
  })

  it('drops a removed row’s validation error so the remaining valid edits can still be saved', async () => {
    stubTwoProjectApiRoutes()
    render(<MyTimesheetsPage />)
    await waitFor(() => expect(cellsFor('Design').length).toBeGreaterThan(0))

    typeAndBlur(cellsFor('Build')[0], 'abc')
    await waitFor(() => expect(saveButton()).toBeDisabled())

    typeAndBlur(cellsFor('Design')[0], '1:30')
    expect(saveButton()).toBeDisabled()

    fireEvent.click(screen.getAllByRole('button', { name: 'Remove from grid' })[0])
    await waitFor(() => expect(cellsFor('Build')).toHaveLength(0))

    await waitFor(() => expect(saveButton()).not.toBeDisabled())
    expect(screen.queryByText('Fix the highlighted durations to save')).not.toBeInTheDocument()

    fireEvent.click(saveButton())
    await waitFor(() => expect(bulkSaveCall()).toBeDefined())
    const payload = JSON.parse((bulkSaveCall() as [string, { body: string }])[1].body)
    expect(payload.entries).toHaveLength(1)
    expect(payload.entries[0].timeProjectId).toBe('project-2')
    expect(payload.entries[0].durationMinutes).toBe(90)
  })

  it('renders the duration format hint so the accepted forms are discoverable', async () => {
    await renderGrid()
    expect(
      screen.getAllByText('Enter hours (8 or 1.5), h:mm (1:30) or minutes (90m). Max 24h per day.').length,
    ).toBeGreaterThan(0)
  })
})

function describingNodesFor(input: HTMLInputElement): HTMLElement[] {
  const ids = (input.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean)
  return ids.flatMap((id) => {
    const node = document.getElementById(id)
    return node ? [node] : []
  })
}

function describedTextFor(input: HTMLInputElement): string[] {
  return describingNodesFor(input).map((node) => node.textContent ?? '')
}

function alertNodeFor(input: HTMLInputElement): HTMLElement | undefined {
  return describingNodesFor(input).find((node) => node.getAttribute('role') === 'alert')
}

describe('MyTimesheetsPage — duration error accessibility (#5507)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    stubApiRoutes()
  })

  it('describes every cell with the accepted duration formats, not only a native tooltip', async () => {
    const inputs = await renderGrid()

    expect(describedTextFor(inputs[0])).toContain(
      'Enter hours (8 or 1.5), h:mm (1:30) or minutes (90m). Max 24h per day.',
    )
  })

  it('exposes the out-of-range reason to assistive tech instead of hiding it in the title attribute', async () => {
    const inputs = await renderGrid()
    typeAndBlur(inputs[0], '30')

    await waitFor(() => expect(inputs[0]).toHaveAttribute('aria-invalid', 'true'))
    const message = 'Maximum 24h per day. Use 1:30 or 90m for shorter entries.'
    expect(describedTextFor(inputs[0])).toContain(message)
    expect(alertNodeFor(inputs[0])).toHaveTextContent(message)
  })

  it('exposes the unparseable-input reason the same way', async () => {
    const inputs = await renderGrid()
    typeAndBlur(inputs[0], 'abc')

    await waitFor(() => expect(inputs[0]).toHaveAttribute('aria-invalid', 'true'))
    expect(describedTextFor(inputs[0])).toContain(
      'Unrecognised duration. Use 8, 1.5, 1:30, 90m or 1h 30m.',
    )
  })

  it('describes only the offending cell, leaving its neighbours announced as valid', async () => {
    const inputs = await renderGrid()
    typeAndBlur(inputs[0], 'abc')

    await waitFor(() => expect(inputs[0]).toHaveAttribute('aria-invalid', 'true'))
    expect(alertNodeFor(inputs[1])).toBeUndefined()
    expect(describedTextFor(inputs[1])).not.toContain(
      'Unrecognised duration. Use 8, 1.5, 1:30, 90m or 1h 30m.',
    )
  })

  it('withdraws the announced error once the cell is corrected', async () => {
    const inputs = await renderGrid()
    typeAndBlur(inputs[0], 'abc')
    await waitFor(() => expect(alertNodeFor(inputs[0])).toBeDefined())
    const errorId = (alertNodeFor(inputs[0]) as HTMLElement).id

    typeAndBlur(inputs[0], '1:30')
    await waitFor(() => expect(inputs[0]).not.toHaveAttribute('aria-invalid', 'true'))
    expect(alertNodeFor(inputs[0])).toBeUndefined()
    expect(document.getElementById(errorId)).toBeNull()
  })
})
