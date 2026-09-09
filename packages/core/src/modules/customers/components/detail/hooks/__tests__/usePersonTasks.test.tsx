/**
 * @jest-environment jsdom
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { usePersonTasks } from '../usePersonTasks'
import type { TodoLinkSummary } from '../../types'

const readApiResultOrThrowMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCallOrThrow: jest.fn(),
  readApiResultOrThrow: (...args: unknown[]) => readApiResultOrThrowMock(...args),
  withScopedApiRequestHeaders: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/utils/optimisticLock', () => ({
  buildOptimisticLockHeader: jest.fn(() => ({})),
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
      `/api/customers/todos?page=2&pageSize=${PAGE_SIZE}&entityId=person-1`,
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
