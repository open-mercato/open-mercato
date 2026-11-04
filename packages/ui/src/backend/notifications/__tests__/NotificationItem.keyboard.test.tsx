import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NotificationItem } from '../NotificationItem'
import type { NotificationDto } from '@open-mercato/shared/modules/notifications/types'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { flash } from '../../FlashMessages'

const push = jest.fn()
const mockReportError = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}))

jest.mock('../../FlashMessages', () => ({ flash: jest.fn() }))

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: mockReportError }),
}))

const t = ((key: string, fallback?: unknown) =>
  typeof fallback === 'string' ? fallback : key) as TranslateFn

function renderItem() {
  const notification: NotificationDto = {
    id: 'notification-1',
    type: 'staff.leave_request.pending',
    title: 'Leave request pending',
    severity: 'info',
    status: 'unread',
    actions: [
      { id: 'approve', label: 'Approve' },
      { id: 'reject', label: 'Reject' },
      { id: 'complete', label: 'Complete' },
      { id: 'view', label: 'View', href: '/backend/staff/leave-requests/request-1' },
    ],
    linkHref: '/backend/staff/leave-requests/request-1',
    createdAt: '2026-10-26T00:00:00.000Z',
  }
  const onMarkAsRead = jest.fn().mockResolvedValue(undefined)
  const onExecuteAction = jest.fn().mockResolvedValue({})
  const onDismiss = jest.fn().mockResolvedValue(undefined)
  const { container } = render(
    <NotificationItem
      notification={notification}
      onMarkAsRead={onMarkAsRead}
      onExecuteAction={onExecuteAction}
      onDismiss={onDismiss}
      t={t}
    />,
  )

  return {
    card: container.firstElementChild as HTMLElement,
    onMarkAsRead,
    onExecuteAction,
    onDismiss,
  }
}

describe('NotificationItem keyboard activation', () => {
  beforeEach(() => {
    push.mockReset()
    mockReportError.mockReset()
    jest.mocked(flash).mockClear()
  })

  describe.each(['Enter', ' '])('%j key', (key) => {
    it.each(['Approve', 'Reject', 'Complete', 'View', 'Dismiss'])(
      'preserves native keyboard activation on the %s button',
      async (label) => {
        const { onMarkAsRead, onExecuteAction, onDismiss } = renderItem()
        const button = screen.getByRole('button', { name: label, exact: true })
        button.focus()

        expect(fireEvent.keyDown(button, { key })).toBe(true)
        expect(fireEvent.keyUp(button, { key })).toBe(true)

        await waitFor(() => expect(push).not.toHaveBeenCalled())
        expect(onMarkAsRead).not.toHaveBeenCalled()
        expect(onExecuteAction).not.toHaveBeenCalled()
        expect(onDismiss).not.toHaveBeenCalled()
      },
    )

    it('opens and marks the notification as read when the card is focused', async () => {
      const { card, onMarkAsRead, onExecuteAction, onDismiss } = renderItem()
      card.focus()

      expect(fireEvent.keyDown(card, { key })).toBe(false)

      await waitFor(() => expect(push).toHaveBeenCalledWith('/backend/staff/leave-requests/request-1'))
      expect(onMarkAsRead).toHaveBeenCalledTimes(1)
      expect(onExecuteAction).not.toHaveBeenCalled()
      expect(onDismiss).not.toHaveBeenCalled()
    })
  })

  it('ignores other keys on the card', () => {
    const { card, onMarkAsRead } = renderItem()

    expect(fireEvent.keyDown(card, { key: 'ArrowDown' })).toBe(true)

    expect(onMarkAsRead).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
  })

  it('executes an action click without opening or marking the notification as read', async () => {
    const { onMarkAsRead, onExecuteAction } = renderItem()

    fireEvent.click(screen.getByRole('button', { name: 'Approve', exact: true }))

    await waitFor(() => expect(onExecuteAction).toHaveBeenCalledWith('approve'))
    expect(onMarkAsRead).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
  })

  it('dismisses the notification without opening or marking it as read', async () => {
    const { onMarkAsRead, onDismiss } = renderItem()

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss', exact: true }))

    await waitFor(() => expect(onDismiss).toHaveBeenCalledTimes(1))
    expect(onMarkAsRead).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
  })

  it('shows an action error after a transport rejection and permits a retry', async () => {
    const { onExecuteAction, onMarkAsRead, onDismiss } = renderItem()
    const failure = new TypeError('Failed to fetch')
    onExecuteAction.mockRejectedValueOnce(failure)
    const button = screen.getByRole('button', { name: 'Approve', exact: true })

    fireEvent.click(button)

    await waitFor(() => expect(flash).toHaveBeenCalledWith('Failed to execute action', 'error'))
    expect(mockReportError).toHaveBeenCalledWith(failure, {
      module: 'notifications',
      code: 'notifications.action_failed',
    })
    expect(button).not.toBeDisabled()
    expect(onMarkAsRead).not.toHaveBeenCalled()
    expect(onDismiss).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()

    fireEvent.click(button)

    await waitFor(() => expect(onExecuteAction).toHaveBeenCalledTimes(2))
    expect(flash).toHaveBeenCalledTimes(1)
  })

  it('preserves action feedback and retry when error reporting fails', async () => {
    const { onExecuteAction, onMarkAsRead } = renderItem()
    onExecuteAction.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    mockReportError.mockImplementationOnce(() => {
      throw new Error('Telemetry unavailable')
    })
    const button = screen.getByRole('button', { name: 'Approve', exact: true })

    fireEvent.click(button)

    await waitFor(() => expect(flash).toHaveBeenCalledWith('Failed to execute action', 'error'))
    expect(button).not.toBeDisabled()
    expect(onMarkAsRead).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()

    fireEvent.click(button)

    await waitFor(() => expect(onExecuteAction).toHaveBeenCalledTimes(2))
    expect(mockReportError).toHaveBeenCalledTimes(1)
  })

  it('opens and marks the notification as read on a card click', async () => {
    const { card, onMarkAsRead } = renderItem()

    fireEvent.click(card)

    await waitFor(() => expect(push).toHaveBeenCalledWith('/backend/staff/leave-requests/request-1'))
    expect(onMarkAsRead).toHaveBeenCalledTimes(1)
  })
})
