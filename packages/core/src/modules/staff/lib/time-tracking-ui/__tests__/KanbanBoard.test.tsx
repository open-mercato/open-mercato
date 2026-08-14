/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { apiCall, apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { KanbanBoard, TASK_STATUS_CHANGED_EVENT } from '../KanbanBoard'

const PROJECT_ID = '11111111-1111-4111-8111-111111111111'
const BACKLOG_ID = '22222222-2222-4222-8222-222222222222'
const IN_PROGRESS_ID = '33333333-3333-4333-8333-333333333333'
const DONE_ID = '44444444-4444-4444-8444-444444444444'
const TASK_ID = '55555555-5555-4555-8555-555555555555'
const CHILD_ID = '66666666-6666-4666-8666-666666666666'
const TASK_VERSION = '2026-08-12T10:00:00.000Z'

let dragEndHandler: ((event: unknown) => void) | null = null

jest.mock('@dnd-kit/core', () => ({
  DndContext: ({ children, onDragEnd }: { children: React.ReactNode; onDragEnd: (event: unknown) => void }) => {
    dragEndHandler = onDragEnd
    return <div data-testid="dnd-context">{children}</div>
  },
  DragOverlay: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  // `activators` is required: `packages/ui`'s CrudForm subclasses KeyboardSensor at
  // module load, and it reaches this module through the shared `backend/detail` barrel.
  KeyboardSensor: class KeyboardSensor {
    static activators: unknown[] = []
  },
  PointerSensor: class PointerSensor {
    static activators: unknown[] = []
  },
  MeasuringStrategy: { BeforeDragging: 'before-dragging' },
  pointerWithin: () => [],
  useSensor: () => ({}),
  useSensors: () => [],
  useDraggable: () => ({ attributes: {}, listeners: {}, setNodeRef: () => {}, isDragging: false }),
  useDroppable: () => ({ setNodeRef: () => {}, isOver: false }),
}))

jest.mock('@dnd-kit/sortable', () => ({ sortableKeyboardCoordinates: () => undefined }))

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

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))

jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({
  useBackendChrome: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/conflicts', () => ({
  // Mirrors the real helper: it owns the surface only for an optimistic-lock 409.
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
const mockWithScopedHeaders = withScopedApiRequestHeaders as jest.MockedFunction<
  typeof withScopedApiRequestHeaders
>
const mockSurfaceRecordConflict = surfaceRecordConflict as jest.MockedFunction<typeof surfaceRecordConflict>
const mockUseBackendChrome = useBackendChrome as jest.MockedFunction<typeof useBackendChrome>

type TaskRow = Record<string, unknown>

const statusRows = [
  { id: BACKLOG_ID, name: 'Backlog', slug: 'backlog', color: 'indigo', position: 1000, is_default: true, is_done: false },
  { id: IN_PROGRESS_ID, name: 'W toku', slug: 'in-progress', color: 'blue', position: 2000, is_default: false, is_done: false },
  { id: DONE_ID, name: 'Zrobione', slug: 'done', color: 'emerald', position: 3000, is_default: false, is_done: true },
]

/** The server the board is talking to, so a refetch reflects what a write did. */
let tasksByStatus: Record<string, TaskRow[]> = {}

function baseTask(overrides: TaskRow = {}): TaskRow {
  return {
    id: TASK_ID,
    title: 'Migracja koszyka B2B',
    time_project_id: PROJECT_ID,
    parent_task_id: null,
    task_status_id: BACKLOG_ID,
    assignee_staff_member_id: null,
    position: 1000,
    ownMinutes: 0,
    loggedMinutes: 0,
    childCount: 0,
    closed_at: null,
    updated_at: TASK_VERSION,
    ...overrides,
  }
}

function applyMoveToFixture(taskId: string, targetStatusId: string) {
  for (const [statusId, rows] of Object.entries(tasksByStatus)) {
    const index = rows.findIndex((row) => row.id === taskId)
    if (index < 0) continue
    const [row] = rows.splice(index, 1)
    tasksByStatus[targetStatusId] = [
      { ...row, task_status_id: targetStatusId },
      ...(tasksByStatus[targetStatusId] ?? []),
    ]
    void statusId
    return
  }
}

function ok<T>(result: T) {
  return { ok: true, status: 200, result, response: {} as Response, cacheStatus: null }
}

function installApiRouter() {
  mockApiCall.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/task-statuses')) return ok({ items: statusRows, total: statusRows.length }) as never
    if (url.includes('/timesheets/tasks?')) {
      const parsed = new URL(url, 'https://test.local')
      const statusId = parsed.searchParams.get('taskStatusId')
      if (statusId) {
        const items = tasksByStatus[statusId] ?? []
        return ok({ items, total: items.length }) as never
      }
      const all = Object.values(tasksByStatus).flat()
      return ok({ items: all, total: all.length }) as never
    }
    if (url.includes('/team-members/self')) return ok({ member: { id: 'staff-self' } }) as never
    return ok({ items: [], total: 0 }) as never
  })
}

function renderBoard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries')
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <KanbanBoard timeProjectId={PROJECT_ID} projectName="Nordvik" />
    </QueryClientProvider>,
  )
  return { ...utils, queryClient, invalidateSpy }
}

function cardIn(container: HTMLElement, statusId: string, taskId: string): Element | null {
  return container.querySelector(`[data-kanban-column="${statusId}"] [data-task-card="${taskId}"]`)
}

function dropOn(statusId: string) {
  act(() => {
    dragEndHandler?.({ active: { id: TASK_ID }, over: { id: `kanban-column:${statusId}` } })
  })
}

function broadcastStatusChange(taskStatusId: string) {
  act(() => {
    window.dispatchEvent(
      new CustomEvent('om:event', {
        detail: {
          id: TASK_STATUS_CHANGED_EVENT,
          timestamp: Date.now(),
          organizationId: 'org-1',
          payload: {
            taskId: TASK_ID,
            timeProjectId: PROJECT_ID,
            taskStatusId,
            previousTaskStatusId: BACKLOG_ID,
          },
        },
      }),
    )
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  dragEndHandler = null
  tasksByStatus = {
    [BACKLOG_ID]: [baseTask({ loggedMinutes: 45, ownMinutes: 45 })],
    [IN_PROGRESS_ID]: [],
    [DONE_ID]: [],
  }
  installApiRouter()
  mockApiCallOrThrow.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input)
    const match = url.match(/\/tasks\/([^/]+)\/status$/)
    if (match) applyMoveToFixture(match[1], IN_PROGRESS_ID)
    return ok({ ok: true }) as never
  })
  mockUseBackendChrome.mockReturnValue({
    payload: { grantedFeatures: ['staff.timesheets.tasks.manage'] },
    isLoading: false,
    isReady: true,
    refresh: async () => {},
  } as never)
})

describe('KanbanBoard', () => {
  it('sends the PATCH with the optimistic-lock header when a card is dropped on another column', async () => {
    const { container } = renderBoard()
    await waitFor(() => expect(cardIn(container, BACKLOG_ID, TASK_ID)).not.toBeNull())

    dropOn(IN_PROGRESS_ID)

    await waitFor(() => expect(mockApiCallOrThrow).toHaveBeenCalled())
    const [url, init] = mockApiCallOrThrow.mock.calls[0]
    expect(String(url)).toContain(`/api/staff/timesheets/tasks/${TASK_ID}/status`)
    expect(init?.method).toBe('PATCH')
    expect(JSON.parse(String(init?.body))).toMatchObject({ taskStatusId: IN_PROGRESS_ID })
    expect(mockWithScopedHeaders.mock.calls[0][0]).toEqual({
      [OPTIMISTIC_LOCK_HEADER_NAME]: TASK_VERSION,
    })
  })

  it('lands the card in the target column before the request resolves', async () => {
    let settle: (() => void) | null = null
    mockApiCallOrThrow.mockImplementation(
      () =>
        new Promise((resolve) => {
          settle = () => resolve(ok({ ok: true }) as never)
        }) as never,
    )

    const { container } = renderBoard()
    await waitFor(() => expect(cardIn(container, BACKLOG_ID, TASK_ID)).not.toBeNull())

    dropOn(IN_PROGRESS_ID)

    // The PATCH has not answered yet — the card is already in the new column.
    await waitFor(() => expect(cardIn(container, IN_PROGRESS_ID, TASK_ID)).not.toBeNull())
    expect(cardIn(container, BACKLOG_ID, TASK_ID)).toBeNull()

    applyMoveToFixture(TASK_ID, IN_PROGRESS_ID)
    await act(async () => {
      settle?.()
    })
    await waitFor(() => expect(cardIn(container, IN_PROGRESS_ID, TASK_ID)).not.toBeNull())
  })

  it('returns the card to its origin column and offers a retry when the PATCH fails', async () => {
    mockApiCallOrThrow.mockRejectedValue(new Error('boom'))
    const { container } = renderBoard()
    await waitFor(() => expect(cardIn(container, BACKLOG_ID, TASK_ID)).not.toBeNull())

    dropOn(IN_PROGRESS_ID)

    await waitFor(() => expect(screen.getByTestId('kanban-move-retry')).toBeTruthy())
    expect(cardIn(container, BACKLOG_ID, TASK_ID)).not.toBeNull()
    expect(cardIn(container, IN_PROGRESS_ID, TASK_ID)).toBeNull()

    // The retry affordance re-issues the move rather than being decorative.
    fireEvent.click(screen.getByText('Retry'))
    await waitFor(() => expect(mockApiCallOrThrow).toHaveBeenCalledTimes(2))
  })

  it('surfaces a conflict instead of retrying when the PATCH answers 409', async () => {
    const conflict = Object.assign(new Error('conflict'), {
      status: 409,
      body: { code: 'optimistic_lock_conflict', currentUpdatedAt: '2026-08-12T11:00:00.000Z' },
    })
    mockApiCallOrThrow.mockRejectedValue(conflict)

    const { container } = renderBoard()
    await waitFor(() => expect(cardIn(container, BACKLOG_ID, TASK_ID)).not.toBeNull())

    dropOn(IN_PROGRESS_ID)

    await waitFor(() => expect(mockSurfaceRecordConflict).toHaveBeenCalledWith(conflict, expect.anything()))
    await waitFor(() => expect(cardIn(container, BACKLOG_ID, TASK_ID)).not.toBeNull())
    expect(screen.queryByTestId('kanban-move-retry')).toBeNull()
    // A stale move must never be replayed — that would overwrite the other person's move.
    expect(mockApiCallOrThrow).toHaveBeenCalledTimes(1)
  })

  it('creates a task in place from the column quick-add, with that column status and no modal', async () => {
    const { container } = renderBoard()
    await waitFor(() => expect(cardIn(container, BACKLOG_ID, TASK_ID)).not.toBeNull())

    fireEvent.click(screen.getByTestId(`kanban-quick-add-${IN_PROGRESS_ID}`))
    const input = await screen.findByTestId(`kanban-quick-add-input-${IN_PROGRESS_ID}`)
    fireEvent.change(input, { target: { value: 'Walidacja adresów dostawy' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(mockApiCallOrThrow).toHaveBeenCalled())
    const [url, init] = mockApiCallOrThrow.mock.calls[0]
    expect(String(url)).toBe('/api/staff/timesheets/tasks')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({
      timeProjectId: PROJECT_ID,
      taskStatusId: IN_PROGRESS_ID,
      title: 'Walidacja adresów dostawy',
      assigneeStaffMemberId: 'staff-self',
    })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('sums column hours through the shared helper, so a parent and its child never double-count', async () => {
    tasksByStatus = {
      [BACKLOG_ID]: [
        baseTask({ loggedMinutes: 100, ownMinutes: 60, childCount: 1 }),
        baseTask({ id: CHILD_ID, parent_task_id: TASK_ID, loggedMinutes: 40, ownMinutes: 40, position: 1500 }),
      ],
      [IN_PROGRESS_ID]: [],
      [DONE_ID]: [],
    }

    renderBoard()

    // 100 — the parent's inclusive rollup. An inline sum would say 140 (2:20).
    await waitFor(() => expect(screen.getByTestId(`kanban-hours-${BACKLOG_ID}`).textContent).toBe('1:40'))
  })

  it('hides the add-status affordance from a member without projects.manage', async () => {
    const { container } = renderBoard()
    await waitFor(() => expect(cardIn(container, BACKLOG_ID, TASK_ID)).not.toBeNull())
    expect(screen.queryByTestId('kanban-add-status')).toBeNull()
  })

  it('shows the add-status affordance to a Team Leader with projects.manage', async () => {
    mockUseBackendChrome.mockReturnValue({
      payload: { grantedFeatures: ['staff.timesheets.projects.manage'] },
      isLoading: false,
      isReady: true,
      refresh: async () => {},
    } as never)

    const { container } = renderBoard()
    await waitFor(() => expect(cardIn(container, BACKLOG_ID, TASK_ID)).not.toBeNull())
    expect(screen.getByTestId('kanban-add-status')).toBeTruthy()
  })

  it('moves a card when another client broadcasts a status change', async () => {
    const { container } = renderBoard()
    await waitFor(() => expect(cardIn(container, BACKLOG_ID, TASK_ID)).not.toBeNull())

    // The colleague's move is already persisted; the refetch is what this board sees.
    applyMoveToFixture(TASK_ID, IN_PROGRESS_ID)
    broadcastStatusChange(IN_PROGRESS_ID)

    await waitFor(() => expect(cardIn(container, IN_PROGRESS_ID, TASK_ID)).not.toBeNull())
    expect(cardIn(container, BACKLOG_ID, TASK_ID)).toBeNull()
  })

  it('ignores the echo of a move this board issued itself', async () => {
    const { container, invalidateSpy } = renderBoard()
    await waitFor(() => expect(cardIn(container, BACKLOG_ID, TASK_ID)).not.toBeNull())

    dropOn(IN_PROGRESS_ID)
    await waitFor(() => expect(cardIn(container, IN_PROGRESS_ID, TASK_ID)).not.toBeNull())
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalled())

    const callsAfterOwnMove = invalidateSpy.mock.calls.length
    broadcastStatusChange(IN_PROGRESS_ID)

    expect(invalidateSpy.mock.calls.length).toBe(callsAfterOwnMove)
    expect(cardIn(container, IN_PROGRESS_ID, TASK_ID)).not.toBeNull()
  })
})
