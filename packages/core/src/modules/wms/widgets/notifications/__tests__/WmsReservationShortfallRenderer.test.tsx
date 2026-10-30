/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { WmsReservationShortfallRenderer } from '../WmsReservationShortfallRenderer'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback: string) => fallback ?? _key,
  useLocale: () => 'en',
}))

const mockPush = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

jest.mock('@open-mercato/shared/lib/time', () => ({
  formatRelativeTime: () => '2 minutes ago',
}))

jest.mock('@open-mercato/shared/lib/utils', () => ({
  cn: (...args: string[]) => args.filter(Boolean).join(' '),
}))

const baseNotification = {
  id: 'notif-1',
  type: 'wms.reservation.shortfall',
  title: 'Reservation shortfall',
  body: null,
  severity: 'warning',
  status: 'unread',
  createdAt: new Date().toISOString(),
  bodyVariables: {
    orderNumber: 'SO-1001',
    shortfallCount: '1',
    shortfallSku: 'SKU-1',
    shortfallQuantity: '2',
    shortfallVariantId: 'variant-1',
  },
  linkHref: '/backend/sales/orders/order-1',
}

const defaultProps = {
  notification: baseNotification,
  onAction: jest.fn(async () => {}),
  onDismiss: jest.fn(async () => {}),
  actions: [
    { id: 'view-order', labelKey: 'wms.notifications.reservationShortfall.renderer.viewOrder', label: 'View order' },
    { id: 'view-inventory', labelKey: 'wms.notifications.reservationShortfall.renderer.viewInventory', label: 'View inventory' },
  ],
}

describe('WmsReservationShortfallRenderer', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockPush.mockClear()
  })

  it('calls onAction for view-order on the first click, before the notification is actioned', () => {
    render(<WmsReservationShortfallRenderer {...defaultProps} notification={{ ...baseNotification, status: 'unread' }} />)
    fireEvent.click(screen.getByText('View order'))
    expect(defaultProps.onAction).toHaveBeenCalledWith('view-order')
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('navigates via linkHref instead of re-calling onAction for view-order once actioned (#6436)', () => {
    render(<WmsReservationShortfallRenderer {...defaultProps} notification={{ ...baseNotification, status: 'actioned' }} />)
    fireEvent.click(screen.getByText('View order'))
    expect(defaultProps.onAction).not.toHaveBeenCalled()
    expect(mockPush).toHaveBeenCalledWith(baseNotification.linkHref)
  })

  it('navigates via the computed inventory href instead of re-calling onAction for view-inventory once actioned', () => {
    render(<WmsReservationShortfallRenderer {...defaultProps} notification={{ ...baseNotification, status: 'actioned' }} />)
    fireEvent.click(screen.getByText('View inventory'))
    expect(defaultProps.onAction).not.toHaveBeenCalled()
    expect(mockPush).toHaveBeenCalledWith('/backend/wms/inventory?catalogVariantId=variant-1')
  })

  it('disables the view-order button once actioned when there is no linkHref to fall back to', () => {
    render(
      <WmsReservationShortfallRenderer
        {...defaultProps}
        notification={{ ...baseNotification, status: 'actioned', linkHref: null }}
      />,
    )
    expect(screen.getByText('View order').closest('button')).toBeDisabled()
  })
})
