/**
 * @jest-environment jsdom
 */
/**
 * T5.4 — the kept editable grid.
 *
 * The point of these tests is that the grid still behaves exactly as it did
 * (`TC-STAFF-027` is the integration counterpart), while gaining the three
 * things the spec asks for:
 *
 *  * the cells parse `1h 40m` and still RENDER `2`, not `2.00` (watch item W3);
 *  * a task row saves with its `taskId`;
 *  * a locked cell has no input at all.
 */

import * as React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrud, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { buildGridCells, buildGridRows, GridView } from '../GridView'
import type { TimesheetEntry } from '../../../../../lib/time-tracking-ui/timesheetData'

const PROJECT_ID = '11111111-1111-4111-8111-111111111111'
const TASK_ID = '22222222-2222-4222-8222-222222222222'
const ENTRY_ID = '33333333-3333-4333-8333-333333333333'
const TASK_ENTRY_ID = '44444444-4444-4444-8444-444444444444'
const STAFF_ID = '55555555-5555-4555-8555-555555555555'
const REPORT_ID = '66666666-6666-4666-8666-666666666666'

const MONDAY = '2026-07-13'
const TUESDAY = '2026-07-14'
const DAYS = [MONDAY, TUESDAY, '2026-07-15', '2026-07-16', '2026-07-17', '2026-07-18', '2026-07-19']

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
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('@open-mercato/ui/backend/conflicts', () => ({ surfaceRecordConflict: jest.fn(() => false) }))
jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: async ({ operation }: { operation: () => Promise<unknown> }) => operation(),
    retryLastMutation: jest.fn(async () => true),
  }),
}))
jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: jest.fn(async () => true), ConfirmDialogElement: null }),
}))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => {
  const actual = jest.requireActual('@open-mercato/ui/backend/utils/apiCall')
  return { ...actual, apiCallOrThrow: jest.fn(async () => ({ ok: true })) }
})
jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  createCrud: jest.fn(async () => ({ ok: true })),
  updateCrud: jest.fn(async () => ({ ok: true })),
  deleteCrud: jest.fn(async () => ({ ok: true })),
}))

const mockApiCallOrThrow = apiCallOrThrow as jest.MockedFunction<typeof apiCallOrThrow>
const mockCreateCrud = createCrud as jest.MockedFunction<typeof createCrud>
const mockUpdateCrud = updateCrud as jest.MockedFunction<typeof updateCrud>

const PROJECT = { id: PROJECT_ID, name: 'Nordvik — B2B', code: 'NORDVIK', color: 'blue' }
const TASK = { id: TASK_ID, title: 'Cart migration', timeProjectId: PROJECT_ID }

function entry(overrides: Partial<TimesheetEntry> & { id: string }): TimesheetEntry {
  return {
    date: MONDAY,
    taskId: null,
    taskTitle: null,
    timeProjectId: PROJECT_ID,
    projectLabel: PROJECT.name,
    description: null,
    startText: '',
    endText: '',
    durationMinutes: 3,
    roundedMinutes: null,
    isBillable: true,
    cost: null,
    currencyCode: null,
    rateOverrideAmount: null,
    isLocked: false,
    lockedReportId: null,
    updatedAt: null,
    tagIds: [],
    staffMemberId: STAFF_ID,
    ...overrides,
  }
}

function renderGrid(
  overrides: Partial<React.ComponentProps<typeof GridView>> = {},
): { onSaved: jest.Mock; rerender: (props?: Partial<React.ComponentProps<typeof GridView>>) => void } {
  const onSaved = jest.fn()
  const props: React.ComponentProps<typeof GridView> = {
    days: DAYS,
    projects: [PROJECT],
    allAssignedProjects: [PROJECT],
    tasks: [TASK],
    entries: [entry({ id: ENTRY_ID })],
    staffMemberId: STAFF_ID,
    canManage: true,
    canManageProjects: false,
    readOnly: false,
    rowMode: 'projects',
    onRowModeChange: jest.fn(),
    onAddProject: jest.fn(),
    onRemoveProject: jest.fn(),
    onCreateProject: jest.fn(),
    onSaved,
    ...overrides,
  }
  const view = render(<GridView {...props} />)
  return {
    onSaved,
    rerender: (next = {}) => view.rerender(<GridView {...props} {...next} />),
  }
}

function firstCell(): HTMLInputElement {
  const row = screen.getByRole('row', { name: /Nordvik/ })
  return row.querySelectorAll('input[type="text"]')[0] as HTMLInputElement
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('the grid keeps its look (W3)', () => {
  it('renders 3 minutes as 0.05 and 75 minutes as 1.25 — decimals, trailing zeros stripped', () => {
    renderGrid()
    expect(firstCell().value).toBe('0.05')
  })

  it('renders a whole number of hours without decimals', () => {
    renderGrid({ entries: [entry({ id: ENTRY_ID, durationMinutes: 120 })] })
    expect(firstCell().value).toBe('2')
  })

  it('sums the entries of a cell, as it always has', () => {
    renderGrid({
      entries: [
        entry({ id: ENTRY_ID, durationMinutes: 30 }),
        entry({ id: `${ENTRY_ID}-b`, durationMinutes: 45 }),
      ],
    })
    expect(firstCell().value).toBe('1.25')
  })
})

describe('the cells now use the shared parser', () => {
  it('accepts 1h 40m, which the old private parser answered 0 for', async () => {
    renderGrid()
    const cell = firstCell()
    fireEvent.change(cell, { target: { value: '1h 40m' } })
    fireEvent.blur(cell)
    expect(cell.value).toBe('1.67')

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    })
    const body = JSON.parse(String(mockApiCallOrThrow.mock.calls[0][1]?.body))
    expect(body.entries).toEqual([
      { id: ENTRY_ID, date: MONDAY, timeProjectId: PROJECT_ID, durationMinutes: 100 },
    ])
  })

  it('keeps unparseable text and blocks Save instead of silently writing a zero', () => {
    renderGrid()
    const cell = firstCell()
    fireEvent.change(cell, { target: { value: 'lunch' } })
    expect(cell.value).toBe('lunch')
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled()
    expect(screen.getByText('Fix the highlighted cell before saving.')).toBeInTheDocument()
  })

  it('leaves Save disabled until a cell is actually edited (TC-STAFF-027 case 2)', () => {
    renderGrid()
    const cell = firstCell()
    fireEvent.focus(cell)
    fireEvent.blur(cell)
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled()
    expect(mockApiCallOrThrow).not.toHaveBeenCalled()
  })

  it('creates a cell that had no entry at all', async () => {
    renderGrid({ entries: [] })
    const row = screen.getByRole('row', { name: /Nordvik/ })
    const tuesday = row.querySelectorAll('input[type="text"]')[1] as HTMLInputElement
    fireEvent.change(tuesday, { target: { value: '2.5' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    })
    const body = JSON.parse(String(mockApiCallOrThrow.mock.calls[0][1]?.body))
    expect(body.entries).toEqual([
      { date: TUESDAY, timeProjectId: PROJECT_ID, durationMinutes: 150 },
    ])
  })
})

describe('project + task rows', () => {
  it('splits a project into its task-less row and one row per task with time', () => {
    const rows = buildGridRows(
      [PROJECT],
      [TASK],
      [entry({ id: TASK_ENTRY_ID, taskId: TASK_ID })],
      'tasks',
      new Set(),
    )
    expect(rows.map((row) => row.key)).toEqual([PROJECT_ID, `${PROJECT_ID}:${TASK_ID}`])
    expect(rows[1].taskTitle).toBe('Cart migration')
  })

  it('keeps task time out of the project row in task mode, and merges it in project mode', () => {
    const entries = [entry({ id: ENTRY_ID, durationMinutes: 60 }), entry({ id: TASK_ENTRY_ID, taskId: TASK_ID, durationMinutes: 30 })]
    const taskCells = buildGridCells(entries, 'tasks')
    expect(taskCells.get(`${PROJECT_ID}|${MONDAY}`)?.minutes).toBe(60)
    expect(taskCells.get(`${PROJECT_ID}:${TASK_ID}|${MONDAY}`)?.minutes).toBe(30)

    const projectCells = buildGridCells(entries, 'projects')
    expect(projectCells.get(`${PROJECT_ID}|${MONDAY}`)?.minutes).toBe(90)
  })

  it('saves a task cell with its taskId through the single-entry route', async () => {
    renderGrid({
      rowMode: 'tasks',
      entries: [entry({ id: TASK_ENTRY_ID, taskId: TASK_ID, durationMinutes: 60 })],
    })
    const taskRow = screen.getByRole('row', { name: /Cart migration/ })
    const monday = taskRow.querySelectorAll('input[type="text"]')[0] as HTMLInputElement
    expect(monday.value).toBe('1')
    fireEvent.change(monday, { target: { value: '2' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    })
    // The bulk endpoint is not used for a task row — see the file header.
    expect(mockApiCallOrThrow).not.toHaveBeenCalled()
    expect(mockUpdateCrud).toHaveBeenCalledWith(
      'staff/timesheets/time-entries',
      { id: TASK_ENTRY_ID, durationMinutes: 120 },
      expect.anything(),
    )
  })

  it('creates a new task cell carrying the task', async () => {
    renderGrid({ rowMode: 'tasks', entries: [entry({ id: TASK_ENTRY_ID, taskId: TASK_ID, durationMinutes: 60 })] })
    const taskRow = screen.getByRole('row', { name: /Cart migration/ })
    const tuesday = taskRow.querySelectorAll('input[type="text"]')[1] as HTMLInputElement
    fireEvent.change(tuesday, { target: { value: '1.5' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    })
    expect(mockCreateCrud).toHaveBeenCalledWith(
      'staff/timesheets/time-entries',
      expect.objectContaining({ taskId: TASK_ID, timeProjectId: PROJECT_ID, date: TUESDAY, durationMinutes: 90 }),
      expect.anything(),
    )
  })
})

describe('locked cells', () => {
  it('renders a locked cell read-only with its value and no input', () => {
    renderGrid({
      entries: [
        entry({ id: ENTRY_ID, durationMinutes: 120, isLocked: true, lockedReportId: REPORT_ID }),
      ],
    })
    const row = screen.getByRole('row', { name: /Nordvik/ })
    const inputs = row.querySelectorAll('input[type="text"]')
    // Mon is locked and the empty weekend renders a dash, so Tue–Fri are the
    // only editable cells left.
    expect(inputs).toHaveLength(4)
    expect(screen.getByTitle('Locked by a closed report')).toHaveTextContent('2')
  })

  it('marks the cells a 409 named, so the refusal lands per cell rather than as a batch failure', async () => {
    const conflict = Object.assign(new Error('locked'), {
      body: { code: 'time_entry_locked', lockedEntryIds: [ENTRY_ID] },
    })
    mockApiCallOrThrow.mockRejectedValueOnce(conflict)
    renderGrid({ entries: [entry({ id: ENTRY_ID, durationMinutes: 60 })] })
    const cell = firstCell()
    fireEvent.change(cell, { target: { value: '3' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    })
    expect(screen.getByTitle('Locked by a closed report')).toBeInTheDocument()
  })
})

describe('read-only mode', () => {
  it('offers no inputs and no Save when looking at somebody else’s timesheet', () => {
    renderGrid({ readOnly: true })
    const row = screen.getByRole('row', { name: /Nordvik/ })
    expect(row.querySelectorAll('input[type="text"]')).toHaveLength(0)
    expect(screen.queryByRole('button', { name: 'Save Changes' })).not.toBeInTheDocument()
  })
})
