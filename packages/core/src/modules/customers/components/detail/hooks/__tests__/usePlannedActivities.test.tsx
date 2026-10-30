/** @jest-environment jsdom */

import { act, renderHook, waitFor } from '@testing-library/react'

const readApiResultOrThrowMock = jest.fn()
const apiCallOrThrowMock = jest.fn()
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: (...args: unknown[]) => readApiResultOrThrowMock(...args),
  apiCallOrThrow: (...args: unknown[]) => apiCallOrThrowMock(...args),
  withScopedApiRequestHeaders: async (_headers: unknown, operation: () => Promise<unknown>) => operation(),
}))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}))

import { plannedActivitiesUrl, usePlannedActivities } from '../usePlannedActivities'

const runMutationWithContext = jest.fn(async <T,>(operation: () => Promise<T>) => operation())

describe('usePlannedActivities', () => {
  beforeEach(() => {
    readApiResultOrThrowMock.mockReset()
    apiCallOrThrowMock.mockReset()
    runMutationWithContext.mockClear()
  })

  it('scopes the planned list to the owning record without a deal filter', () => {
    expect(plannedActivitiesUrl({ entityId: 'person-1' })).toBe(
      '/api/customers/interactions?entityId=person-1&status=planned&excludeInteractionType=task&limit=100&sortField=scheduledAt&sortDir=asc',
    )
    expect(plannedActivitiesUrl({ dealId: 'deal-1' })).toBe(
      '/api/customers/interactions?dealId=deal-1&status=planned&excludeInteractionType=task&limit=100&sortField=scheduledAt&sortDir=asc',
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
    expect(readApiResultOrThrowMock).toHaveBeenCalledWith(expect.stringContaining('entityId=person-1&status=planned'))
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
