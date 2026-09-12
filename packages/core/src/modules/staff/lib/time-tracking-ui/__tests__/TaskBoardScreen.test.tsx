/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { TaskBoardScreen } from '../TaskBoardScreen'

const PROJECT_ID = '11111111-1111-4111-8111-111111111111'
const BACKLOG_ID = '22222222-2222-4222-8222-222222222222'
const IN_PROGRESS_ID = '33333333-3333-4333-8333-333333333333'
const SELF_ID = '44444444-4444-4444-8444-444444444444'
const OTHER_ID = '55555555-5555-4555-8555-555555555555'
const PARENT_TASK_ID = '66666666-6666-4666-8666-666666666666'
const CHILD_TASK_ID = '77777777-7777-4777-8777-777777777777'
const OTHER_TASK_ID = '88888888-8888-4888-8888-888888888888'
const TAG_BACKEND_ID = '99999999-9999-4999-8999-999999999999'
const TAG_QA_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

// Radix popovers measure their trigger; jsdom ships neither observer nor pointer capture.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub
Element.prototype.hasPointerCapture = Element.prototype.hasPointerCapture ?? (() => false)
Element.prototype.setPointerCapture = Element.prototype.setPointerCapture ?? (() => {})
Element.prototype.releasePointerCapture = Element.prototype.releasePointerCapture ?? (() => {})
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {})

jest.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DragOverlay: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
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
  surfaceRecordConflict: jest.fn(() => false),
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
const mockUseBackendChrome = useBackendChrome as jest.MockedFunction<typeof useBackendChrome>

type TaskRow = Record<string, unknown>

const statusRows = [
  { id: BACKLOG_ID, name: 'Backlog', slug: 'backlog', color: 'indigo', position: 1000, is_default: true, is_done: false },
  {
    id: IN_PROGRESS_ID,
    name: 'W toku',
    slug: 'in-progress',
    color: 'blue',
    position: 2000,
    is_default: false,
    is_done: false,
  },
]

let taskRows: TaskRow[] = []

function ok<T>(result: T) {
  return { ok: true, status: 200, result, response: {} as Response, cacheStatus: null }
}

function taskUrls(): string[] {
  return mockApiCall.mock.calls
    .map(([input]) => String(input))
    .filter((url) => url.includes('/timesheets/tasks?'))
}

function installApiRouter() {
  mockApiCall.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/task-statuses')) return ok({ items: statusRows, total: statusRows.length }) as never
    if (url.includes('/timesheets/tasks?')) {
      const parsed = new URL(url, 'https://test.local')
      const statusId = parsed.searchParams.get('taskStatusId')
      const assigneeId = parsed.searchParams.get('assigneeStaffMemberId')
      // Mirrors the route's `tagIds` filter (W9): every listed tag must be present.
      const tagIds = (parsed.searchParams.get('tagIds') ?? '').split(',').filter(Boolean)
      const items = taskRows.filter((row) => {
        if (statusId && row.task_status_id !== statusId) return false
        if (assigneeId && row.assignee_staff_member_id !== assigneeId) return false
        const rowTags = Array.isArray(row.tagIds) ? (row.tagIds as string[]) : []
        if (tagIds.some((tagId) => !rowTags.includes(tagId))) return false
        return true
      })
      return ok({ items, total: items.length }) as never
    }
    if (url.includes('/team-members/self')) {
      return ok({ member: { id: SELF_ID, displayName: 'Anna Nowak' } }) as never
    }
    if (url.includes('/team-members')) {
      return ok({
        items: [
          { id: SELF_ID, display_name: 'Anna Nowak' },
          { id: OTHER_ID, display_name: 'Piotr Zawada' },
        ],
        total: 2,
      }) as never
    }
    if (url.includes('/timesheets/tags')) {
      return ok({
        items: [
          { id: TAG_BACKEND_ID, label: 'backend' },
          { id: TAG_QA_ID, label: 'QA' },
        ],
        total: 2,
      }) as never
    }
    return ok({ items: [], total: 0 }) as never
  })
}

function baseTask(overrides: TaskRow = {}): TaskRow {
  return {
    id: PARENT_TASK_ID,
    title: 'Migracja koszyka B2B',
    time_project_id: PROJECT_ID,
    parent_task_id: null,
    task_status_id: BACKLOG_ID,
    assignee_staff_member_id: SELF_ID,
    position: 1000,
    ownMinutes: 0,
    loggedMinutes: 0,
    childCount: 0,
    closed_at: null,
    updated_at: '2026-08-12T10:00:00.000Z',
    tagIds: [],
    ...overrides,
  }
}

function renderScreen() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <TaskBoardScreen timeProjectId={PROJECT_ID} projectName="Nordvik — migracja B2B" />
      </QueryClientProvider>,
    ),
  }
}

async function applyAssignedToMe() {
  fireEvent.click(screen.getByTestId('board-filter-add-chip'))
  const option = await screen.findByTestId('board-filter-assigned-to-me')
  await act(async () => {
    fireEvent.click(option)
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  window.localStorage.clear()
  taskRows = [
    baseTask({ tagIds: [TAG_BACKEND_ID] }),
    baseTask({
      id: OTHER_TASK_ID,
      title: 'Mapowanie cen katalogowych',
      assignee_staff_member_id: OTHER_ID,
      position: 2000,
      tagIds: [TAG_QA_ID],
    }),
  ]
  installApiRouter()
  mockUseBackendChrome.mockReturnValue({
    payload: { grantedFeatures: ['staff.timesheets.tasks.manage'] },
    isLoading: false,
    isReady: true,
    refresh: async () => {},
  } as never)
})

describe('TaskBoardScreen', () => {
  it('narrows the board query and shows a removable chip when "assigned to me" is picked', async () => {
    const { container } = renderScreen()
    await waitFor(() =>
      expect(container.querySelector(`[data-task-card="${OTHER_TASK_ID}"]`)).not.toBeNull(),
    )

    await applyAssignedToMe()

    // The caller's own staff member — resolved from /team-members/self, not guessed.
    await waitFor(() =>
      expect(taskUrls().some((url) => url.includes(`assigneeStaffMemberId=${SELF_ID}`))).toBe(true),
    )
    expect(screen.getByTestId('board-filter-chip-assignee').textContent).toContain('Assigned to me')
    expect(screen.getByTestId('board-filter-chip-assignee-remove')).toBeTruthy()
    expect(screen.getByTestId('board-filters-count').textContent).toBe('1')

    await waitFor(() =>
      expect(container.querySelector(`[data-task-card="${OTHER_TASK_ID}"]`)).toBeNull(),
    )
    expect(container.querySelector(`[data-task-card="${PARENT_TASK_ID}"]`)).not.toBeNull()
  })

  it('narrows by tag on the server, so a match on a later page is not invisible (W9)', async () => {
    const { container } = renderScreen()
    await waitFor(() =>
      expect(container.querySelector(`[data-task-card="${OTHER_TASK_ID}"]`)).not.toBeNull(),
    )

    fireEvent.click(screen.getByTestId('board-filter-add-chip'))
    const option = await screen.findByTestId(`board-filter-tag-${TAG_BACKEND_ID}`)
    await act(async () => {
      fireEvent.click(option)
    })

    await waitFor(() =>
      expect(container.querySelector(`[data-task-card="${OTHER_TASK_ID}"]`)).toBeNull(),
    )
    expect(container.querySelector(`[data-task-card="${PARENT_TASK_ID}"]`)).not.toBeNull()
    expect(screen.getByTestId(`board-filter-chip-tag-${TAG_BACKEND_ID}`).textContent).toContain(
      'backend',
    )
    // The chip is a request parameter now, so the column counts describe the whole
    // filtered set rather than the part that happens to be loaded.
    expect(taskUrls().some((url) => url.includes(`tagIds=${TAG_BACKEND_ID}`))).toBe(true)
  })

  it('restores the unfiltered board when the chip is removed', async () => {
    const { container } = renderScreen()
    await waitFor(() =>
      expect(container.querySelector(`[data-task-card="${OTHER_TASK_ID}"]`)).not.toBeNull(),
    )

    await applyAssignedToMe()
    await waitFor(() =>
      expect(container.querySelector(`[data-task-card="${OTHER_TASK_ID}"]`)).toBeNull(),
    )

    await act(async () => {
      fireEvent.click(screen.getByTestId('board-filter-chip-assignee-remove'))
    })

    await waitFor(() =>
      expect(container.querySelector(`[data-task-card="${OTHER_TASK_ID}"]`)).not.toBeNull(),
    )
    expect(screen.queryByTestId('board-filter-chip-assignee')).toBeNull()
    expect(screen.queryByTestId('board-filters-count')).toBeNull()
  })

  it('keeps the filter after a remount, so returning to the board restores the view', async () => {
    const first = renderScreen()
    await waitFor(() =>
      expect(first.container.querySelector(`[data-task-card="${OTHER_TASK_ID}"]`)).not.toBeNull(),
    )
    await applyAssignedToMe()
    await waitFor(() => expect(screen.getByTestId('board-filter-chip-assignee')).toBeTruthy())
    first.unmount()

    const second = renderScreen()
    expect(await screen.findByTestId('board-filter-chip-assignee')).toBeTruthy()
    await waitFor(() =>
      expect(second.container.querySelector(`[data-task-card="${PARENT_TASK_ID}"]`)).not.toBeNull(),
    )
    expect(second.container.querySelector(`[data-task-card="${OTHER_TASK_ID}"]`)).toBeNull()
  })

  it('totals the header hours through the shared helper, so a parent and its child never double-count', async () => {
    taskRows = [
      baseTask({ loggedMinutes: 100, ownMinutes: 60, childCount: 1 }),
      baseTask({
        id: CHILD_TASK_ID,
        parent_task_id: PARENT_TASK_ID,
        loggedMinutes: 40,
        ownMinutes: 40,
        position: 1500,
      }),
    ]

    renderScreen()

    // 100 — the parent's inclusive rollup. An inline sum would print 2:20.
    await waitFor(() => expect(screen.getByText(/1:40 logged/)).toBeTruthy())
    expect(screen.queryByText(/2:20 logged/)).toBeNull()
  })

  it('hides "New task" from a member without tasks.manage instead of disabling it', async () => {
    mockUseBackendChrome.mockReturnValue({
      payload: { grantedFeatures: ['staff.timesheets.tasks.view'] },
      isLoading: false,
      isReady: true,
      refresh: async () => {},
    } as never)

    const { container } = renderScreen()
    await waitFor(() =>
      expect(container.querySelector(`[data-task-card="${PARENT_TASK_ID}"]`)).not.toBeNull(),
    )

    expect(screen.queryByTestId('board-new-task')).toBeNull()
    expect(container.querySelector('[data-testid="board-new-task"][disabled]')).toBeNull()
  })

  it('switches to a real Lista view rather than a control that does nothing', async () => {
    const { container } = renderScreen()
    await waitFor(() =>
      expect(container.querySelector(`[data-task-card="${PARENT_TASK_ID}"]`)).not.toBeNull(),
    )

    await act(async () => {
      fireEvent.click(screen.getByTestId('board-view-list'))
    })

    const table = await screen.findByTestId('board-task-list')
    expect(table.querySelector(`[data-task-row="${PARENT_TASK_ID}"]`)).not.toBeNull()
    expect(table.querySelector(`[data-task-row="${OTHER_TASK_ID}"]`)).not.toBeNull()
    expect(container.querySelector(`[data-task-card="${PARENT_TASK_ID}"]`)).toBeNull()
  })
})
