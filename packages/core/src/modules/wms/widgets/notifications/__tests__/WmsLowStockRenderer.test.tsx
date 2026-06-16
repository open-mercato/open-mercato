/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { WmsLowStockRenderer } from '../WmsLowStockRenderer'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback: string) => fallback ?? _key,
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}))

jest.mock('@open-mercato/shared/lib/time', () => ({
  formatRelativeTime: () => '2 minutes ago',
}))

jest.mock('@open-mercato/shared/lib/utils', () => ({
  cn: (...args: string[]) => args.filter(Boolean).join(' '),
}))

const baseNotification = {
  id: 'notif-1',
  type: 'wms.inventory.low_stock',
  title: 'Low Stock Alert',
  body: 'Low stock alert — available: 3, reorder point: 10, safety stock: 5',
  severity: 'warning',
  status: 'unread',
  createdAt: new Date().toISOString(),
  bodyVariables: {
    availableQuantity: '3',
    reorderPoint: '10',
    safetyStock: '5',
    state: 'below_safety_stock',
  },
  linkHref: '/backend/wms/inventory',
}

const defaultProps = {
  notification: baseNotification,
  onAction: jest.fn(async () => {}),
  onDismiss: jest.fn(async () => {}),
  actions: [],
}

describe('WmsLowStockRenderer', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders without crashing', () => {
    const { container } = render(<WmsLowStockRenderer {...defaultProps} />)
    expect(container).toBeTruthy()
  })

  it('displays the notification title', () => {
    render(<WmsLowStockRenderer {...defaultProps} />)
    expect(screen.getByText('Low Stock Alert')).toBeTruthy()
  })

  it('displays the below_safety_stock state label', () => {
    render(<WmsLowStockRenderer {...defaultProps} />)
    expect(screen.getByText('Below safety stock')).toBeTruthy()
  })

  it('displays the below_reorder_point state label', () => {
    render(
      <WmsLowStockRenderer
        {...defaultProps}
        notification={{ ...baseNotification, bodyVariables: { ...baseNotification.bodyVariables, state: 'below_reorder_point' } }}
      />,
    )
    expect(screen.getByText('Below reorder point')).toBeTruthy()
  })

  it('displays available quantity', () => {
    render(<WmsLowStockRenderer {...defaultProps} />)
    expect(screen.getByText(/Available/)).toBeTruthy()
    expect(screen.getByText(/3/)).toBeTruthy()
  })

  it('renders View SKU CTA button', () => {
    render(<WmsLowStockRenderer {...defaultProps} />)
    expect(screen.getByText('View SKU')).toBeTruthy()
  })

  it('renders Dismiss button', () => {
    render(<WmsLowStockRenderer {...defaultProps} />)
    expect(screen.getByText('Dismiss')).toBeTruthy()
  })

  it('calls onDismiss when Dismiss button is clicked', () => {
    render(<WmsLowStockRenderer {...defaultProps} />)
    const dismissBtn = screen.getByText('Dismiss')
    fireEvent.click(dismissBtn)
    expect(defaultProps.onDismiss).toHaveBeenCalledTimes(1)
  })

  it('renders a CTA button that does not use manual accent-indigo override class', () => {
    const { container } = render(<WmsLowStockRenderer {...defaultProps} />)
    const buttons = container.querySelectorAll('button')
    buttons.forEach((btn) => {
      expect(btn.className).not.toContain('bg-accent-indigo')
    })
  })

  it('does not use the deprecated bg-status-warning-icon token on the CTA button', () => {
    const { container } = render(<WmsLowStockRenderer {...defaultProps} />)
    const buttons = container.querySelectorAll('button')
    buttons.forEach((btn) => {
      expect(btn.className).not.toContain('bg-status-warning-icon')
    })
  })

  it('does not use hardcoded text-white on any element', () => {
    const { container } = render(<WmsLowStockRenderer {...defaultProps} />)
    expect(container.querySelector('.text-white')).toBeNull()
  })

  it('shows unread indicator when status is unread', () => {
    const { container } = render(<WmsLowStockRenderer {...defaultProps} />)
    const unreadDot = container.querySelector('.bg-status-warning-icon.ring-2')
    expect(unreadDot).toBeTruthy()
  })

  it('does not show unread indicator when status is read', () => {
    const { container } = render(
      <WmsLowStockRenderer {...defaultProps} notification={{ ...baseNotification, status: 'read' }} />,
    )
    const unreadDot = container.querySelector('.bg-status-warning-icon.ring-2')
    expect(unreadDot).toBeNull()
  })
})
