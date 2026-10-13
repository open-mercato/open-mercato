/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { NotificationItem } from '../NotificationItem'
import type {
  NotificationDto,
  NotificationRendererProps,
} from '@open-mercato/shared/modules/notifications/types'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'

const push = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push,
    replace: jest.fn(),
    prefetch: jest.fn(),
    refresh: jest.fn(),
    back: jest.fn(),
    forward: jest.fn(),
  }),
}))

const t = ((key: string, fallback?: unknown) =>
  typeof fallback === 'string' ? fallback : key) as TranslateFn

function ViewRenderer({ onAction, actions = [] }: NotificationRendererProps) {
  return (
    <button type="button" onClick={() => void onAction(actions[0]?.id ?? 'view')}>
      View Quote
    </button>
  )
}

function TwoActionRenderer({ onAction }: NotificationRendererProps) {
  return (
    <>
      <button type="button" onClick={() => void onAction('view-order')}>
        View order
      </button>
      <button type="button" onClick={() => void onAction('view-inventory')}>
        View inventory
      </button>
    </>
  )
}

function buildNotification(overrides: Partial<NotificationDto>): NotificationDto {
  return {
    id: 'n-1',
    type: 'sales.quote.created',
    title: 'Quote created',
    severity: 'info',
    status: 'read',
    actions: [{ id: 'view', label: 'View' }],
    linkHref: '/backend/sales/quotes/q-1',
    createdAt: '2026-09-25T00:00:00.000Z',
    ...overrides,
  }
}

function renderItem(
  notification: NotificationDto,
  onExecuteAction: jest.Mock,
  customRenderer: React.ComponentType<NotificationRendererProps> = ViewRenderer,
) {
  render(
    <NotificationItem
      notification={notification}
      onMarkAsRead={jest.fn().mockResolvedValue(undefined)}
      onExecuteAction={onExecuteAction}
      onDismiss={jest.fn().mockResolvedValue(undefined)}
      t={t}
      customRenderer={customRenderer}
    />,
  )
}

describe('NotificationItem custom renderer actions', () => {
  beforeEach(() => {
    push.mockReset()
  })

  it('executes the action and follows the returned href for a pending notification', async () => {
    const onExecuteAction = jest.fn().mockResolvedValue({ href: '/backend/sales/quotes/q-1' })
    renderItem(buildNotification({ status: 'read' }), onExecuteAction)

    fireEvent.click(screen.getByRole('button', { name: 'View Quote' }))

    await waitFor(() => expect(push).toHaveBeenCalledWith('/backend/sales/quotes/q-1'))
    expect(onExecuteAction).toHaveBeenCalledWith('view')
  })

  it('navigates to linkHref without re-executing an already actioned notification', async () => {
    const onExecuteAction = jest.fn().mockResolvedValue({})
    renderItem(buildNotification({ status: 'actioned', actionTaken: 'view' }), onExecuteAction)

    fireEvent.click(screen.getByRole('button', { name: 'View Quote' }))

    await waitFor(() => expect(push).toHaveBeenCalledWith('/backend/sales/quotes/q-1'))
    expect(onExecuteAction).not.toHaveBeenCalled()
  })

  it('does nothing for an actioned notification without a link', async () => {
    const onExecuteAction = jest.fn().mockResolvedValue({})
    renderItem(buildNotification({ status: 'actioned', linkHref: null }), onExecuteAction)

    fireEvent.click(screen.getByRole('button', { name: 'View Quote' }))

    await waitFor(() => expect(onExecuteAction).not.toHaveBeenCalled())
    expect(push).not.toHaveBeenCalled()
  })

  it('navigates to the clicked action href, not linkHref, on a multi-action actioned notification', async () => {
    const onExecuteAction = jest.fn().mockResolvedValue({})
    renderItem(
      buildNotification({
        status: 'actioned',
        actionTaken: 'view-order',
        actions: [
          { id: 'view-order', label: 'View order', href: '/backend/sales/orders/o-1' },
          { id: 'view-inventory', label: 'View inventory', href: '/backend/wms/inventory' },
        ],
        linkHref: '/backend/sales/orders/o-1',
      }),
      onExecuteAction,
      TwoActionRenderer,
    )

    fireEvent.click(screen.getByRole('button', { name: 'View inventory' }))

    await waitFor(() => expect(push).toHaveBeenCalledWith('/backend/wms/inventory'))
    expect(push).not.toHaveBeenCalledWith('/backend/sales/orders/o-1')
    expect(onExecuteAction).not.toHaveBeenCalled()
  })
})
