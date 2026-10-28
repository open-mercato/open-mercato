/**
 * @jest-environment jsdom
 */
import { act, renderHook } from '@testing-library/react'
import type { NotificationDto } from '@open-mercato/shared/modules/notifications/types'

const apiCallMock = jest.fn()
const apiCallOrThrowMock = jest.fn()
const runMutationMock = jest.fn()
const retryLastMutation = jest.fn(async () => true)

jest.mock('../../utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
  apiCallOrThrow: (...args: unknown[]) => apiCallOrThrowMock(...args),
}))

jest.mock('../../injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: (...args: unknown[]) => runMutationMock(...args),
    retryLastMutation,
  }),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}))

import { useNotificationActions } from '../useNotificationActions'

type RunMutationInput = {
  context: { resourceKind: string; retryLastMutation: () => Promise<boolean> }
  mutationPayload: Record<string, unknown>
}

function makeNotification(id: string, status: NotificationDto['status'] = 'unread'): NotificationDto {
  return {
    id,
    type: 'example',
    title: `title-${id}`,
    severity: 'info',
    status,
    actions: [],
    createdAt: new Date().toISOString(),
  }
}

function renderActions(initial: NotificationDto[] = []) {
  const setNotifications = jest.fn()
  const setUnreadCount = jest.fn()
  const { result } = renderHook(() =>
    useNotificationActions(initial, setNotifications, setUnreadCount),
  )
  return { result }
}

function lastRunMutationInput(): RunMutationInput {
  return runMutationMock.mock.calls[runMutationMock.mock.calls.length - 1][0] as RunMutationInput
}

describe('useNotificationActions guarded mutations', () => {
  beforeEach(() => {
    apiCallMock.mockReset()
    apiCallMock.mockResolvedValue({ ok: true, result: {} })
    apiCallOrThrowMock.mockReset()
    apiCallOrThrowMock.mockResolvedValue({ ok: true, result: {} })
    runMutationMock.mockReset()
    runMutationMock.mockImplementation(
      async ({ operation }: { operation: () => Promise<unknown> }) => operation(),
    )
    retryLastMutation.mockClear()
  })

  it('routes markAsRead through the guarded mutation path', async () => {
    const { result } = renderActions([makeNotification('n1')])
    await act(async () => {
      await result.current.markAsRead('n1')
    })
    expect(runMutationMock).toHaveBeenCalledTimes(1)
    const input = lastRunMutationInput()
    expect(input.context.resourceKind).toBe('notification')
    expect(input.context.retryLastMutation).toBe(retryLastMutation)
    expect(input.mutationPayload).toEqual({ id: 'n1' })
    expect(apiCallOrThrowMock).toHaveBeenCalledWith('/api/notifications/n1/read', { method: 'PUT' })
  })

  it('routes executeAction through the guarded mutation path and returns the href', async () => {
    apiCallMock.mockResolvedValue({ ok: true, result: { href: '/go' } })
    const { result } = renderActions([makeNotification('n1')])
    let returned: { href?: string } = {}
    await act(async () => {
      returned = await result.current.executeAction('n1', 'approve')
    })
    expect(runMutationMock).toHaveBeenCalledTimes(1)
    const input = lastRunMutationInput()
    expect(input.context.resourceKind).toBe('notification')
    expect(input.mutationPayload).toEqual({ id: 'n1', actionId: 'approve' })
    expect(apiCallMock).toHaveBeenCalledWith(
      '/api/notifications/n1/action',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(returned.href).toBe('/go')
  })

  it('routes dismiss through the guarded mutation path', async () => {
    const { result } = renderActions([makeNotification('n1')])
    await act(async () => {
      await result.current.dismiss('n1')
    })
    expect(runMutationMock).toHaveBeenCalledTimes(1)
    const input = lastRunMutationInput()
    expect(input.context.resourceKind).toBe('notification')
    expect(input.mutationPayload).toEqual({ id: 'n1' })
    expect(apiCallOrThrowMock).toHaveBeenCalledWith('/api/notifications/n1/dismiss', { method: 'PUT' })
  })

  it('routes undoDismiss through the guarded mutation path', async () => {
    const { result } = renderActions([makeNotification('n1')])
    await act(async () => {
      await result.current.dismiss('n1')
    })
    runMutationMock.mockClear()
    apiCallMock.mockClear()
    apiCallOrThrowMock.mockClear()
    await act(async () => {
      await result.current.undoDismiss()
    })
    expect(runMutationMock).toHaveBeenCalledTimes(1)
    const input = lastRunMutationInput()
    expect(input.context.resourceKind).toBe('notification')
    expect(input.mutationPayload).toEqual({ id: 'n1', status: 'unread' })
    expect(apiCallOrThrowMock).toHaveBeenCalledWith(
      '/api/notifications/n1/restore',
      expect.objectContaining({ method: 'PUT' }),
    )
  })

  it.each([
    ['actioned', 'actioned'],
    ['read', 'read'],
    ['unread', 'unread'],
  ] as const)('puts an undone %s notification back as %s', async (status, restoredStatus) => {
    const setNotifications = jest.fn()
    const setUnreadCount = jest.fn()
    const notification = { ...makeNotification('n1', status), readAt: status === 'unread' ? null : '2026-01-01T10:00:00.000Z' }
    const { result } = renderHook(() =>
      useNotificationActions([notification], setNotifications, setUnreadCount),
    )
    await act(async () => {
      await result.current.dismiss('n1')
    })
    setNotifications.mockClear()
    await act(async () => {
      await result.current.undoDismiss()
    })

    expect(setNotifications).toHaveBeenCalledTimes(1)
    const restore = setNotifications.mock.calls[0][0] as (prev: NotificationDto[]) => NotificationDto[]
    const [restored] = restore([])
    expect(restored.id).toBe('n1')
    expect(restored.status).toBe(restoredStatus)
    expect(restored.readAt ?? null).toBe(notification.readAt)
  })

  it('marks the local notification actioned when the server reports the action already ran', async () => {
    apiCallMock.mockResolvedValue({
      ok: false,
      status: 409,
      result: { error: 'Notification action already executed', code: 'notification_action_already_executed' },
    })
    const setNotifications = jest.fn()
    const setUnreadCount = jest.fn()
    const notification = makeNotification('n1', 'read')
    const { result } = renderHook(() =>
      useNotificationActions([notification], setNotifications, setUnreadCount),
    )
    await act(async () => {
      await result.current.executeAction('n1', 'approve')
    })

    expect(setNotifications).toHaveBeenCalledTimes(1)
    const update = setNotifications.mock.calls[0][0] as (prev: NotificationDto[]) => NotificationDto[]
    expect(update([notification, makeNotification('n2', 'read')]).map((n) => n.status)).toEqual(['actioned', 'read'])
    expect(setUnreadCount).not.toHaveBeenCalled()
  })

  it('decrements the unread count when the server reports an unread notification\'s action already ran', async () => {
    apiCallMock.mockResolvedValue({
      ok: false,
      status: 409,
      result: { error: 'Notification action already executed', code: 'notification_action_already_executed' },
    })
    const setNotifications = jest.fn()
    const setUnreadCount = jest.fn()
    const { result } = renderHook(() =>
      useNotificationActions([makeNotification('n1', 'unread')], setNotifications, setUnreadCount),
    )
    await act(async () => {
      await result.current.executeAction('n1', 'approve')
    })

    expect(setUnreadCount).toHaveBeenCalledTimes(1)
    const decrement = setUnreadCount.mock.calls[0][0] as (prev: number) => number
    expect(decrement(3)).toBe(2)
    expect(decrement(0)).toBe(0)
  })

  it('leaves the local notification alone when the action command itself answers 409', async () => {
    apiCallMock.mockResolvedValue({ ok: false, status: 409, result: { error: 'Order was changed by someone else' } })
    const setNotifications = jest.fn()
    const setUnreadCount = jest.fn()
    const { result } = renderHook(() =>
      useNotificationActions([makeNotification('n1', 'read')], setNotifications, setUnreadCount),
    )
    await act(async () => {
      await result.current.executeAction('n1', 'approve')
    })

    expect(setNotifications).not.toHaveBeenCalled()
    expect(setUnreadCount).not.toHaveBeenCalled()
  })

  it('routes markAllRead through the guarded mutation path', async () => {
    const { result } = renderActions([makeNotification('n1')])
    await act(async () => {
      await result.current.markAllRead()
    })
    expect(runMutationMock).toHaveBeenCalledTimes(1)
    const input = lastRunMutationInput()
    expect(input.context.resourceKind).toBe('notification')
    expect(apiCallOrThrowMock).toHaveBeenCalledWith('/api/notifications/mark-all-read', { method: 'PUT' })
  })
})
