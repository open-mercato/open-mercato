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

function makeNotification(id: string, status: 'unread' | 'read' = 'unread'): NotificationDto {
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
