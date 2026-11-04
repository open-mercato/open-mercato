/** @jest-environment jsdom */

import { act, renderHook, waitFor } from '@testing-library/react'

const readApiResultOrThrowMock = jest.fn()
const apiCallOrThrowMock = jest.fn()
const scopedHeadersMock = jest.fn()
const surfaceRecordConflictMock = jest.fn()
const flashMock = jest.fn()
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: (...args: unknown[]) => readApiResultOrThrowMock(...args),
  apiCallOrThrow: (...args: unknown[]) => apiCallOrThrowMock(...args),
  withScopedApiRequestHeaders: async (headers: unknown, operation: () => Promise<unknown>) => {
    scopedHeadersMock(headers)
    return operation()
  },
}))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: (...args: unknown[]) => flashMock(...args),
}))
jest.mock('@open-mercato/ui/backend/conflicts', () => ({
  surfaceRecordConflict: (...args: unknown[]) => surfaceRecordConflictMock(...args),
}))
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}))

import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { plannedActivitiesUrl, usePlannedActivities } from '../usePlannedActivities'

const runMutationWithContext = jest.fn(async <T,>(operation: () => Promise<T>) => operation())

describe('usePlannedActivities', () => {
  beforeEach(() => {
    readApiResultOrThrowMock.mockReset()
    apiCallOrThrowMock.mockReset()
    runMutationWithContext.mockClear()
    scopedHeadersMock.mockClear()
    flashMock.mockClear()
    surfaceRecordConflictMock.mockReset()
    surfaceRecordConflictMock.mockReturnValue(false)
  })

  it('scopes the open list to the owning record and excludes terminal statuses, not custom open ones', () => {
    expect(plannedActivitiesUrl({ entityId: 'person-1' })).toBe(
      '/api/customers/interactions?entityId=person-1&excludeStatus=done,canceled,completed&excludeInteractionType=task&limit=100&sortField=scheduledAt&sortDir=asc',
    )
    expect(plannedActivitiesUrl({ dealId: 'deal-1' })).toBe(
      '/api/customers/interactions?dealId=deal-1&excludeStatus=done,canceled,completed&excludeInteractionType=task&limit=100&sortField=scheduledAt&sortDir=asc',
    )
  })

  it('loads planned activities for a person and refreshes them after a change', async () => {
    readApiResultOrThrowMock.mockResolvedValue({ items: [{ id: 'int-1', interactionType: 'call', status: 'planned' }] })
    const onAfterChange = jest.fn()
    const { result } = renderHook(() => usePlannedActivities({
      scope: { entityId: 'person-1' },
      runMutationWithContext,
      logContext: 'test',
      onAfterChange,
    }))
    await act(async () => { await result.current.loadPlannedActivities() })
    expect(readApiResultOrThrowMock).toHaveBeenCalledWith(expect.stringContaining('entityId=person-1&excludeStatus='))
    expect(readApiResultOrThrowMock).not.toHaveBeenCalledWith(expect.stringContaining('dealId='))
    expect(result.current.plannedActivities).toHaveLength(1)
    expect(result.current.activityRefreshKey).toBe(0)

    readApiResultOrThrowMock.mockResolvedValue({ items: [] })
    await act(async () => { await result.current.handleActivityCreated() })
    expect(result.current.activityRefreshKey).toBe(1)
    expect(result.current.plannedActivities).toEqual([])
    expect(onAfterChange).toHaveBeenCalledTimes(1)
  })

  it('routes mark done through the guarded runner and reloads the planned list', async () => {
    readApiResultOrThrowMock.mockResolvedValue({ items: [] })
    apiCallOrThrowMock.mockResolvedValue({})
    const { result } = renderHook(() => usePlannedActivities({
      scope: { entityId: 'company-1' },
      runMutationWithContext,
      logContext: 'test',
    }))
    await act(async () => { await result.current.handleMarkDone('int-1') })
    expect(runMutationWithContext).toHaveBeenCalledTimes(1)
    expect(apiCallOrThrowMock).toHaveBeenCalledWith('/api/customers/interactions/complete', expect.objectContaining({ method: 'POST' }))
    await waitFor(() => expect(result.current.activityRefreshKey).toBe(1))
    expect(readApiResultOrThrowMock).toHaveBeenCalledWith(expect.stringContaining('entityId=company-1'))
  })

  describe.each([
    {
      action: 'complete',
      run: (hook: ReturnType<typeof usePlannedActivities>) => hook.handleMarkDone('int-1'),
      endpoint: '/api/customers/interactions/complete',
    },
    {
      action: 'cancel',
      run: (hook: ReturnType<typeof usePlannedActivities>) => hook.handleCancelActivity('int-1'),
      endpoint: '/api/customers/interactions',
    },
  ])('$action with a stale version', ({ run, endpoint }) => {
    const version = '2026-11-04T10:00:00.000Z'

    async function renderLoaded() {
      readApiResultOrThrowMock.mockResolvedValue({
        items: [
          { id: 'int-1', interactionType: 'call', status: 'in_progress', updatedAt: version },
          { id: 'int-2', interactionType: 'call', status: 'planned', updatedAt: '2026-01-01T00:00:00.000Z' },
        ],
      })
      const hook = renderHook(() => usePlannedActivities({
        scope: { entityId: 'person-1' },
        runMutationWithContext,
        logContext: 'test',
      }))
      await act(async () => { await hook.result.current.loadPlannedActivities() })
      return hook
    }

    it('sends the displayed activity version in the lock header', async () => {
      apiCallOrThrowMock.mockResolvedValue({})
      const { result } = await renderLoaded()
      await act(async () => { await run(result.current) })
      expect(scopedHeadersMock).toHaveBeenCalledWith({ [OPTIMISTIC_LOCK_HEADER_NAME]: version })
      expect(apiCallOrThrowMock).toHaveBeenCalledWith(endpoint, expect.anything())
    })

    it('surfaces a 409 as a conflict and reloads the list instead of flashing an error', async () => {
      const conflict = Object.assign(new Error('conflict'), { status: 409 })
      apiCallOrThrowMock.mockRejectedValue(conflict)
      surfaceRecordConflictMock.mockReturnValue(true)
      const { result } = await renderLoaded()
      readApiResultOrThrowMock.mockClear()
      await act(async () => { await run(result.current) })
      expect(surfaceRecordConflictMock).toHaveBeenCalledWith(conflict, expect.any(Function))
      expect(readApiResultOrThrowMock).toHaveBeenCalledTimes(1)
      expect(flashMock).not.toHaveBeenCalled()
    })
  })

  it('falls back to an empty list when the load fails', async () => {
    readApiResultOrThrowMock.mockRejectedValue(new Error('offline'))
    const { result } = renderHook(() => usePlannedActivities({
      scope: { entityId: 'person-1' },
      runMutationWithContext,
      logContext: 'test',
    }))
    await act(async () => { await result.current.loadPlannedActivities() })
    expect(result.current.plannedActivities).toEqual([])
  })
})
