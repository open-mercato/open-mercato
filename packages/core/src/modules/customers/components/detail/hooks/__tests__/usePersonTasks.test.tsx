/**
 * @jest-environment jsdom
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { usePersonTasks } from '../usePersonTasks'
import type { TodoLinkSummary } from '../../types'

const readApiResultOrThrowMock = jest.fn()
const apiCallOrThrowMock = jest.fn()
const withScopedApiRequestHeadersMock = jest.fn()
const buildOptimisticLockHeaderMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCallOrThrow: (...args: unknown[]) => apiCallOrThrowMock(...args),
  readApiResultOrThrow: (...args: unknown[]) => readApiResultOrThrowMock(...args),
  withScopedApiRequestHeaders: (...args: unknown[]) => withScopedApiRequestHeadersMock(...args),
}))

jest.mock('@open-mercato/ui/backend/utils/optimisticLock', () => ({
  buildOptimisticLockHeader: (...args: unknown[]) => buildOptimisticLockHeaderMock(...args),
}))

const PAGE_SIZE = 3
const INITIAL_TASKS: TodoLinkSummary[] = []

function makeRows(count: number, offset = 0) {
  return Array.from({ length: count }, (_, index) => ({
    id: `link-${offset + index + 1}`,
    todoId: `todo-${offset + index + 1}`,
    todoSource: 'customers:interaction',
    todoTitle: `Task ${offset + index + 1}`,
    todoIsDone: false,
    todoPriority: null,
    todoSeverity: null,
    todoDescription: null,
    todoDueAt: null,
    todoCustomValues: null,
    todoOrganizationId: 'org-1',
    organizationId: 'org-1',
    tenantId: 'tenant-1',
    createdAt: '2026-01-01T00:00:00.000Z',
  }))
}

async function renderTasks() {
  const rendered = renderHook(() =>
    usePersonTasks({ entityId: 'person-1', initialTasks: INITIAL_TASKS, pageSize: PAGE_SIZE }))
  await waitFor(() => {
    expect(rendered.result.current.isInitialLoading).toBe(false)
  })
  return rendered
}

// The load-more gate used to be `pageInfo.page >= pageInfo.totalPages`, mirrored
// by `hasMore = page < totalPages`. When the reported total under-reports the
// result set — tasks linked between two requests, or a capped list count — the
// affordance disappeared and the remaining tasks became unreachable. Both now
// terminate on the served page coming back short.
describe('usePersonTasks load-more termination', () => {
  beforeEach(() => {
    readApiResultOrThrowMock.mockReset()
  })

  it('offers more on a full page even when totalPages reports a single page', async () => {
    readApiResultOrThrowMock.mockResolvedValue({
      items: makeRows(PAGE_SIZE),
      total: 2,
      page: 1,
      pageSize: PAGE_SIZE,
      totalPages: 1,
    })

    const { result } = await renderTasks()

    expect(result.current.tasks).toHaveLength(PAGE_SIZE)
    expect(result.current.hasMore).toBe(true)
  })

  // `totalPages` was dropped from the hook's response type, `total` deliberately
  // kept: it feeds the section's count badge, where an under-report is cosmetic
  // rather than a way to strand rows. This pins that split explicitly.
  it('still reports the server total for the count badge', async () => {
    readApiResultOrThrowMock.mockResolvedValue({
      items: makeRows(PAGE_SIZE),
      total: 42,
      page: 1,
      pageSize: PAGE_SIZE,
      totalPages: 1,
    })

    const { result } = await renderTasks()

    expect(result.current.totalCount).toBe(42)
    expect(result.current.hasMore).toBe(true)
  })

  // The served page size wins over the requested one, so an endpoint that
  // narrows the page server-side cannot make a full page read as short and
  // silently end the sequence.
  it('measures the page against the size the server echoed', async () => {
    readApiResultOrThrowMock.mockResolvedValue({
      items: makeRows(PAGE_SIZE - 1),
      total: 99,
      page: 1,
      pageSize: PAGE_SIZE - 1,
      totalPages: 99,
    })

    const { result } = await renderTasks()

    expect(result.current.hasMore).toBe(true)
  })

  it('stops on a short page however many pages the payload promises', async () => {
    readApiResultOrThrowMock.mockResolvedValue({
      items: makeRows(PAGE_SIZE - 1),
      total: 999,
      page: 1,
      pageSize: PAGE_SIZE,
      totalPages: 99,
    })

    const { result } = await renderTasks()

    expect(result.current.hasMore).toBe(false)
  })

  // `/api/customers/todos` is query-engine backed and computes an unclamped
  // offset, so the page past the end comes back empty rather than re-serving
  // the last one. That empty page is what ends the sequence.
  it('stops on the empty page past the end and keeps the rows already loaded', async () => {
    readApiResultOrThrowMock
      .mockResolvedValueOnce({
        items: makeRows(PAGE_SIZE),
        total: PAGE_SIZE,
        page: 1,
        pageSize: PAGE_SIZE,
        totalPages: 1,
      })
      .mockResolvedValueOnce({
        items: [],
        total: PAGE_SIZE,
        page: 2,
        pageSize: PAGE_SIZE,
        totalPages: 1,
      })

    const { result } = await renderTasks()
    await act(async () => {
      await result.current.loadMore()
    })

    expect(readApiResultOrThrowMock).toHaveBeenCalledTimes(2)
    expect(result.current.hasMore).toBe(false)
    expect(result.current.tasks).toHaveLength(PAGE_SIZE)
  })

  // The guard reads what the server served, not what survived `mergeUnique`: a
  // full page of already-known links must still offer the next one.
  it('keeps offering more when a full page dedupes away entirely', async () => {
    readApiResultOrThrowMock.mockResolvedValue({
      items: makeRows(PAGE_SIZE),
      total: PAGE_SIZE,
      page: 1,
      pageSize: PAGE_SIZE,
      totalPages: 1,
    })

    const { result } = await renderTasks()
    await act(async () => {
      await result.current.loadMore()
    })

    expect(readApiResultOrThrowMock).toHaveBeenCalledTimes(2)
    expect(result.current.tasks).toHaveLength(PAGE_SIZE)
    expect(result.current.hasMore).toBe(true)
  })

  it('requests the next page when there is one', async () => {
    readApiResultOrThrowMock
      .mockResolvedValueOnce({
        items: makeRows(PAGE_SIZE),
        total: PAGE_SIZE,
        page: 1,
        pageSize: PAGE_SIZE,
        totalPages: 1,
      })
      .mockResolvedValueOnce({
        items: makeRows(1, PAGE_SIZE),
        total: PAGE_SIZE + 1,
        page: 2,
        pageSize: PAGE_SIZE,
        totalPages: 1,
      })

    const { result } = await renderTasks()
    await act(async () => {
      await result.current.loadMore()
    })

    expect(readApiResultOrThrowMock).toHaveBeenNthCalledWith(
      2,
      `/api/customers/interactions/tasks?page=2&pageSize=${PAGE_SIZE}&entityId=person-1`,
      undefined,
      { errorMessage: 'Failed to load tasks.' },
    )
    expect(result.current.tasks).toHaveLength(PAGE_SIZE + 1)
    expect(result.current.hasMore).toBe(false)
  })

  it('does not fetch again once the sequence has ended', async () => {
    readApiResultOrThrowMock.mockResolvedValue({
      items: makeRows(1),
      total: 1,
      page: 1,
      pageSize: PAGE_SIZE,
      totalPages: 5,
    })

    const { result } = await renderTasks()
    await act(async () => {
      await result.current.loadMore()
    })

    expect(readApiResultOrThrowMock).toHaveBeenCalledTimes(1)
  })
})

describe('usePersonTasks merged customer task reads', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    readApiResultOrThrowMock.mockReset()
    apiCallOrThrowMock.mockResolvedValue({ result: {} })
    buildOptimisticLockHeaderMock.mockImplementation((updatedAt: string) => ({
      'x-om-ext-optimistic-lock-expected-updated-at': updatedAt,
    }))
    withScopedApiRequestHeadersMock.mockImplementation(
      (_headers: Record<string, string>, operation: () => Promise<unknown>) => operation(),
    )
  })

  it('loads the same native tasks as the global list, scoped to the person', async () => {
    const updatedAt = '2026-10-16T10:00:00.000Z'
    const nativeRow = {
      ...makeRows(1)[0],
      id: 'native-task',
      todoId: 'native-task',
      todoTitle: 'Native completed task',
      todoIsDone: true,
      todoUpdatedAt: updatedAt,
    }
    readApiResultOrThrowMock.mockImplementation(async (path: string) => ({
      items: path.startsWith('/api/customers/interactions/tasks?') ? [nativeRow] : [],
      total: 1,
      page: 1,
      pageSize: PAGE_SIZE,
    }))

    const { result } = await renderTasks()

    expect(readApiResultOrThrowMock).toHaveBeenCalledWith(
      `/api/customers/interactions/tasks?page=1&pageSize=${PAGE_SIZE}&entityId=person-1`,
      undefined,
      { errorMessage: 'Failed to load tasks.' },
    )
    expect(result.current.tasks).toEqual([expect.objectContaining({
      id: 'native-task',
      todoId: 'native-task',
      todoSource: 'customers:interaction',
      title: 'Native completed task',
      isDone: true,
      status: 'done',
      updatedAt,
    })])
    expect(result.current.totalCount).toBe(1)
  })

  it.each([
    ['customers:interaction', '/api/customers/todos'],
    ['example:todo', '/api/example/todos'],
  ])('preserves versioned mutations for %s rows', async (todoSource, apiPath) => {
    const updatedAt = '2026-10-16T10:00:00.000Z'
    const row = { ...makeRows(1)[0], todoSource, todoUpdatedAt: updatedAt }
    readApiResultOrThrowMock.mockResolvedValue({
      items: [row], total: 1, page: 1, pageSize: PAGE_SIZE,
    })
    const { result } = await renderTasks()
    const task = result.current.tasks[0]

    await act(async () => {
      await result.current.toggleTask(task, true)
    })

    expect(apiCallOrThrowMock).toHaveBeenCalledWith(apiPath, expect.objectContaining({ method: 'PUT' }), expect.any(Object))
    expect(JSON.parse(apiCallOrThrowMock.mock.calls[0][1].body)).toMatchObject({
      id: task.todoId, linkId: task.id, is_done: true,
    })
    expect(result.current.tasks[0]).toMatchObject({ isDone: true, status: 'done' })

    await act(async () => {
      await result.current.unlinkTask(task)
    })

    expect(apiCallOrThrowMock).toHaveBeenLastCalledWith('/api/customers/todos', expect.objectContaining({
      method: 'DELETE', body: JSON.stringify({ id: task.id }),
    }), expect.any(Object))
    expect(buildOptimisticLockHeaderMock).toHaveBeenNthCalledWith(1, updatedAt)
    expect(buildOptimisticLockHeaderMock).toHaveBeenNthCalledWith(2, updatedAt)
    expect(withScopedApiRequestHeadersMock).toHaveBeenCalledWith({
      'x-om-ext-optimistic-lock-expected-updated-at': updatedAt,
    }, expect.any(Function))
    expect(result.current.tasks).toEqual([])
  })

  it('preserves legacy reads for roles without the interactions-view permission', async () => {
    const legacyRow = { ...makeRows(1)[0], todoSource: 'example:todo' }
    readApiResultOrThrowMock
      .mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { status: 403 }))
      .mockResolvedValueOnce({ items: [legacyRow], total: 1, page: 1, pageSize: PAGE_SIZE })

    const { result } = await renderTasks()

    expect(readApiResultOrThrowMock).toHaveBeenNthCalledWith(
      1,
      `/api/customers/interactions/tasks?page=1&pageSize=${PAGE_SIZE}&entityId=person-1`,
      undefined,
      expect.any(Object),
    )
    expect(readApiResultOrThrowMock).toHaveBeenNthCalledWith(
      2,
      `/api/customers/todos?page=1&pageSize=${PAGE_SIZE}&entityId=person-1`,
      undefined,
      expect.any(Object),
    )
    expect(result.current.tasks).toEqual([expect.objectContaining({ id: legacyRow.id, todoSource: 'example:todo' })])
    expect(result.current.error).toBeNull()
  })

  it('surfaces other read failures without falling back to an incomplete task set', async () => {
    readApiResultOrThrowMock.mockRejectedValue(Object.assign(new Error('Task service unavailable'), { status: 500 }))

    const { result } = await renderTasks()

    expect(readApiResultOrThrowMock).toHaveBeenCalledTimes(1)
    expect(result.current.error).toBe('Task service unavailable')
  })
})

describe('usePersonTasks metadata updates', () => {
  const metadata = {
    priority: 3,
    description: 'Discuss the renewal',
    due_at: '2026-10-30T14:00:00.000Z',
    external_reference: 'renewal-42',
  }

  beforeEach(() => {
    jest.clearAllMocks()
    apiCallOrThrowMock.mockResolvedValue({ result: {} })
    buildOptimisticLockHeaderMock.mockImplementation(() => ({}))
    withScopedApiRequestHeadersMock.mockImplementation(
      (_headers: Record<string, string>, operation: () => Promise<unknown>) => operation(),
    )
    readApiResultOrThrowMock.mockResolvedValue({
      items: [{
        ...makeRows(1)[0],
        todoPriority: metadata.priority,
        todoDescription: metadata.description,
        todoDueAt: metadata.due_at,
        todoCustomValues: metadata,
      }],
      total: 1,
      page: 1,
      pageSize: PAGE_SIZE,
    })
  })

  it('completes and reopens a task without sending or clearing its metadata', async () => {
    const { result } = await renderTasks()

    for (const isDone of [true, false]) {
      await act(async () => {
        await result.current.toggleTask(result.current.tasks[0], isDone)
      })

      const request = apiCallOrThrowMock.mock.calls.at(-1)?.[1]
      expect(JSON.parse(String(request?.body))).toEqual({
        id: 'todo-1',
        linkId: 'link-1',
        title: 'Task 1',
        is_done: isDone,
      })
      expect(result.current.tasks[0]).toMatchObject({
        title: 'Task 1',
        isDone,
        priority: metadata.priority,
        description: metadata.description,
        dueAt: metadata.due_at,
        customValues: metadata,
      })
    }
  })

  it('sends only an edited metadata field and preserves the others', async () => {
    const { result } = await renderTasks()

    await act(async () => {
      await result.current.updateTask(result.current.tasks[0], {
        base: { title: 'Task 1', priority: 1 },
        custom: {},
      })
    })

    const request = apiCallOrThrowMock.mock.calls[0][1]
    expect(JSON.parse(String(request?.body))).toEqual({
      id: 'todo-1',
      linkId: 'link-1',
      title: 'Task 1',
      customFields: { priority: 1 },
    })
    expect(result.current.tasks[0]).toMatchObject({
      priority: 1,
      description: metadata.description,
      dueAt: metadata.due_at,
      customValues: { ...metadata, priority: 1 },
    })
  })

  it('keeps explicit null metadata fields as intentional clears', async () => {
    const { result } = await renderTasks()

    await act(async () => {
      await result.current.updateTask(result.current.tasks[0], {
        base: { title: 'Task 1', priority: null, description: null, scheduledAt: null },
        custom: {},
      })
    })

    const request = apiCallOrThrowMock.mock.calls[0][1]
    expect(JSON.parse(String(request?.body))).toMatchObject({
      customFields: { priority: null, description: null, due_at: null },
    })
    expect(result.current.tasks[0]).toMatchObject({
      priority: null,
      description: null,
      dueAt: null,
      customValues: { ...metadata, priority: null, description: null, due_at: null },
    })
  })
})
