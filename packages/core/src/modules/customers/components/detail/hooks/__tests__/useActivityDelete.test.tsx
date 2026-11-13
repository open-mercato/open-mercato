/**
 * @jest-environment jsdom
 */
import { act, renderHook } from '@testing-library/react'
import { useActivityDelete } from '../useActivityDelete'
import type { InteractionSummary } from '../../types'

const apiCallOrThrowMock = jest.fn()
const scopedHeadersMock = jest.fn()
const confirmMock = jest.fn<Promise<boolean>, unknown[]>(async () => true)
const flashMock = jest.fn()
const surfaceRecordConflictMock = jest.fn<boolean, unknown[]>(() => false)
const reportErrorMock = jest.fn()

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback?: string) => fallback ?? _key,
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCallOrThrow: (...args: unknown[]) => apiCallOrThrowMock(...args),
  withScopedApiRequestHeaders: (headers: Record<string, string>, operation: () => unknown) => {
    scopedHeadersMock(headers)
    return operation()
  },
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({
    confirm: (...args: unknown[]) => confirmMock(...args),
    ConfirmDialogElement: null,
  }),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: (...args: unknown[]) => flashMock(...args),
}))

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: (...args: unknown[]) => reportErrorMock(...args) }),
}))

jest.mock('@open-mercato/ui/backend/conflicts', () => ({
  surfaceRecordConflict: (...args: unknown[]) => surfaceRecordConflictMock(...args),
}))

const activity = {
  id: 'interaction-1',
  interactionType: 'call',
  updatedAt: '2026-07-10T08:30:00.000Z',
} as InteractionSummary

const legacyOnlyActivity = {
  id: 'legacy-activity-1',
  interactionType: 'call',
  source: 'legacy-activity',
  createdAt: '2025-01-15T09:00:00.000Z',
  updatedAt: '2025-01-15T09:00:00.000Z',
} as InteractionSummary

describe('useActivityDelete', () => {
  beforeEach(() => {
    apiCallOrThrowMock.mockReset()
    apiCallOrThrowMock.mockResolvedValue({ ok: true })
    scopedHeadersMock.mockClear()
    confirmMock.mockClear()
    confirmMock.mockResolvedValue(true)
    flashMock.mockClear()
    surfaceRecordConflictMock.mockReset()
    surfaceRecordConflictMock.mockReturnValue(false)
    reportErrorMock.mockReset()
  })

  it('deletes a legacy-only row through the activities adapter without a placeholder version', async () => {
    const runMutation = jest.fn(async (operation: () => Promise<unknown>) => operation())
    const onAfterDelete = jest.fn()
    const { result } = renderHook(() => useActivityDelete({ runMutation, onAfterDelete }))

    await act(async () => {
      await result.current.deleteActivity(legacyOnlyActivity)
    })

    expect(apiCallOrThrowMock).toHaveBeenCalledTimes(1)
    expect(apiCallOrThrowMock).toHaveBeenCalledWith(
      '/api/customers/activities',
      expect.objectContaining({ method: 'DELETE', body: JSON.stringify({ id: 'legacy-activity-1' }) }),
    )
    expect(scopedHeadersMock).toHaveBeenCalledWith({})
    expect(flashMock).toHaveBeenCalledWith('Activity deleted', 'success')
    expect(onAfterDelete).toHaveBeenCalledTimes(1)
  })

  it('sends the record version, routes through the guarded mutation and refreshes', async () => {
    const runMutation = jest.fn(async (operation: () => Promise<unknown>) => operation())
    const onAfterDelete = jest.fn()
    const { result } = renderHook(() => useActivityDelete({ runMutation, onAfterDelete }))

    await act(async () => {
      await result.current.deleteActivity(activity)
    })

    expect(runMutation).toHaveBeenCalledWith(expect.any(Function), { id: 'interaction-1', operation: 'deleteActivity' })
    expect(scopedHeadersMock).toHaveBeenCalledWith(
      expect.objectContaining({ 'x-om-ext-optimistic-lock-expected-updated-at': '2026-07-10T08:30:00.000Z' }),
    )
    expect(apiCallOrThrowMock).toHaveBeenCalledWith(
      '/api/customers/interactions',
      expect.objectContaining({ method: 'DELETE', body: JSON.stringify({ id: 'interaction-1' }) }),
    )
    expect(flashMock).toHaveBeenCalledWith('Activity deleted', 'success')
    expect(onAfterDelete).toHaveBeenCalledTimes(1)
  })

  it('deletes directly when the page provides no guarded mutation', async () => {
    const { result } = renderHook(() => useActivityDelete({}))

    await act(async () => {
      await result.current.deleteActivity(activity)
    })

    expect(apiCallOrThrowMock).toHaveBeenCalledTimes(1)
    expect(flashMock).toHaveBeenCalledWith('Activity deleted', 'success')
  })

  it('does nothing when the confirmation is dismissed', async () => {
    confirmMock.mockResolvedValue(false)
    const onAfterDelete = jest.fn()
    const { result } = renderHook(() => useActivityDelete({ onAfterDelete }))

    await act(async () => {
      await result.current.deleteActivity(activity)
    })

    expect(apiCallOrThrowMock).not.toHaveBeenCalled()
    expect(flashMock).not.toHaveBeenCalled()
    expect(onAfterDelete).not.toHaveBeenCalled()
  })

  it('surfaces a concurrent-edit conflict instead of a generic error and reloads', async () => {
    const conflict = new Error('[internal] conflict')
    apiCallOrThrowMock.mockRejectedValue(conflict)
    surfaceRecordConflictMock.mockReturnValue(true)
    const onAfterDelete = jest.fn()
    const { result } = renderHook(() => useActivityDelete({ onAfterDelete }))

    await act(async () => {
      await result.current.deleteActivity(activity)
    })

    expect(surfaceRecordConflictMock).toHaveBeenCalledWith(conflict, expect.any(Function))
    expect(flashMock).not.toHaveBeenCalled()
    expect(reportErrorMock).not.toHaveBeenCalled()
    expect(onAfterDelete).toHaveBeenCalledTimes(1)
  })

  it('reports a failed delete and keeps the list as it was', async () => {
    const failure = new Error('[internal] delete failed')
    apiCallOrThrowMock.mockRejectedValue(failure)
    const onAfterDelete = jest.fn()
    const { result } = renderHook(() => useActivityDelete({ onAfterDelete, logContext: 'ActivitiesSection' }))

    await act(async () => {
      await result.current.deleteActivity(activity)
    })

    expect(flashMock).toHaveBeenCalledWith('Could not delete activity', 'error')
    expect(onAfterDelete).not.toHaveBeenCalled()
    expect(reportErrorMock).toHaveBeenCalledWith(failure, {
      module: 'customers',
      code: 'customers.activity_delete_failed',
      attributes: { component: 'ActivitiesSection', activityId: 'interaction-1' },
    })
  })

  it('still tells the user when the failed delete cannot be reported', async () => {
    apiCallOrThrowMock.mockRejectedValue(new Error('[internal] delete failed'))
    reportErrorMock.mockImplementation(() => {
      throw new Error('[internal] telemetry sink unavailable')
    })
    const { result } = renderHook(() => useActivityDelete({}))

    await act(async () => {
      await result.current.deleteActivity(activity)
    })

    expect(flashMock).toHaveBeenCalledWith('Could not delete activity', 'error')
  })

  it('keeps the deleted state when the refresh callback throws', async () => {
    const onAfterDelete = jest.fn(async () => {
      throw new Error('[internal] reload failed')
    })
    const { result } = renderHook(() => useActivityDelete({ onAfterDelete }))

    await act(async () => {
      await result.current.deleteActivity(activity)
    })

    expect(flashMock).toHaveBeenCalledWith('Activity deleted', 'success')
    expect(flashMock).not.toHaveBeenCalledWith('Could not delete activity', 'error')
    expect(reportErrorMock).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ code: 'customers.activity_delete_refresh_failed' }),
    )
  })
})
