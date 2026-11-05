/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { render, screen, fireEvent, within, act } from '@testing-library/react'
import { NotificationPanel } from '../NotificationPanel'
import type { NotificationDto } from '@open-mercato/shared/modules/notifications/types'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'

// NotificationItem (rendered per row) calls next/navigation's useRouter, which
// throws outside an App Router provider. Stub it so the panel can render rows.
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    prefetch: jest.fn(),
    refresh: jest.fn(),
    back: jest.fn(),
    forward: jest.fn(),
  }),
}))

const t = ((key: string, fallback?: unknown) =>
  typeof fallback === 'string' ? fallback : key) as TranslateFn

function buildNotification(overrides: Partial<NotificationDto>): NotificationDto {
  return {
    id: 'n',
    type: 'system.generic',
    title: 'Title',
    severity: 'info',
    status: 'unread',
    actions: [],
    createdAt: '2026-06-18T00:00:00.000Z',
    ...overrides,
  }
}

function buildProps(overrides: Partial<React.ComponentProps<typeof NotificationPanel>> = {}) {
  return {
    open: true,
    onOpenChange: jest.fn(),
    notifications: [] as NotificationDto[],
    unreadCount: 0,
    onMarkAsRead: jest.fn().mockResolvedValue(undefined),
    onExecuteAction: jest.fn().mockResolvedValue({}),
    onDismiss: jest.fn().mockResolvedValue(undefined),
    onMarkAllRead: jest.fn().mockResolvedValue(undefined),
    t,
    ...overrides,
  } satisfies React.ComponentProps<typeof NotificationPanel>
}

describe('NotificationPanel controls use shared primitives', () => {
  it('renders the filter tabs through the Tabs primitive, not raw buttons', () => {
    render(<NotificationPanel {...buildProps()} />)

    const tablist = screen.getByRole('tablist')
    const tabs = within(tablist).getAllByRole('tab')

    expect(tabs).toHaveLength(3)
    // The Tabs primitive stamps data-slot on every trigger; a raw <button>
    // would not, so this guards against regressing back to hand-rolled markup.
    tabs.forEach((tab) => expect(tab).toHaveAttribute('data-slot', 'tabs-trigger'))
  })

  it('marks the active filter with aria-selected and switches on click', () => {
    render(<NotificationPanel {...buildProps()} />)

    const allTab = screen.getByRole('tab', { name: /All/i })
    const unreadTab = screen.getByRole('tab', { name: /Unread/i })

    expect(allTab).toHaveAttribute('aria-selected', 'true')
    expect(unreadTab).toHaveAttribute('aria-selected', 'false')

    fireEvent.click(unreadTab)

    expect(unreadTab).toHaveAttribute('aria-selected', 'true')
    expect(allTab).toHaveAttribute('aria-selected', 'false')
  })

  it('shows the unread count badge on the Unread tab and caps it at 99+', () => {
    const { rerender } = render(<NotificationPanel {...buildProps({ unreadCount: 5 })} />)
    expect(within(screen.getByRole('tab', { name: /Unread/i })).getByText('5')).toBeInTheDocument()

    rerender(<NotificationPanel {...buildProps({ unreadCount: 150 })} />)
    expect(within(screen.getByRole('tab', { name: /Unread/i })).getByText('99+')).toBeInTheDocument()
  })

  it('renders Mark all read as a Button primitive and invokes the handler', async () => {
    const onMarkAllRead = jest.fn().mockResolvedValue(undefined)
    render(<NotificationPanel {...buildProps({ unreadCount: 3, onMarkAllRead })} />)

    const markAllButton = screen.getByRole('button', { name: /Mark all read/i })
    expect(markAllButton).toHaveAttribute('data-slot', 'button')

    await act(async () => {
      fireEvent.click(markAllButton)
    })
    expect(onMarkAllRead).toHaveBeenCalledTimes(1)
  })

  it('hides Mark all read when there are no unread notifications', () => {
    render(<NotificationPanel {...buildProps({ unreadCount: 0 })} />)
    expect(screen.queryByRole('button', { name: /Mark all read/i })).toBeNull()
  })

  it('keeps filtering behavior when switching tabs', () => {
    const notifications = [
      buildNotification({ id: 'a', title: 'Unread one', status: 'unread' }),
      buildNotification({ id: 'b', title: 'Read one', status: 'read' }),
    ]
    render(<NotificationPanel {...buildProps({ notifications, unreadCount: 1 })} />)

    expect(screen.getByText('Unread one')).toBeInTheDocument()
    expect(screen.getByText('Read one')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /Unread/i }))

    expect(screen.getByText('Unread one')).toBeInTheDocument()
    expect(screen.queryByText('Read one')).toBeNull()
  })
})
