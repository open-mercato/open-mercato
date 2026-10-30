/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { SalesQuoteCreatedRenderer } from '../SalesQuoteCreatedRenderer'

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

jest.mock('../useSalesDocumentTotals', () => ({
  useSalesDocumentTotals: () => ({ totals: null }),
}))

const baseNotification = {
  id: 'notif-1',
  type: 'sales.quote.created',
  title: 'New quote awaiting review',
  body: null,
  severity: 'warning',
  status: 'unread',
  createdAt: new Date().toISOString(),
  bodyVariables: { quoteNumber: 'SQ-1001', totalAmount: '$100.00' },
  linkHref: '/backend/sales/quotes/quote-1',
  sourceEntityId: 'quote-1',
}

const defaultProps = {
  notification: baseNotification,
  onAction: jest.fn(async () => {}),
  onDismiss: jest.fn(async () => {}),
  actions: [{ id: 'view', labelKey: 'sales.notifications.renderer.viewQuote', label: 'View Quote' }],
}

describe('SalesQuoteCreatedRenderer', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockPush.mockClear()
  })

  it('calls onAction on the first click, before the notification is actioned', () => {
    render(<SalesQuoteCreatedRenderer {...defaultProps} notification={{ ...baseNotification, status: 'unread' }} />)
    fireEvent.click(screen.getByText('View Quote'))
    expect(defaultProps.onAction).toHaveBeenCalledWith('view')
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('navigates via linkHref instead of re-calling onAction once the notification is actioned (#6436)', () => {
    render(<SalesQuoteCreatedRenderer {...defaultProps} notification={{ ...baseNotification, status: 'actioned' }} />)
    fireEvent.click(screen.getByText('View Quote'))
    expect(defaultProps.onAction).not.toHaveBeenCalled()
    expect(mockPush).toHaveBeenCalledWith(baseNotification.linkHref)
  })

  it('does not throw and does nothing on a second click when the notification has no linkHref', () => {
    render(
      <SalesQuoteCreatedRenderer
        {...defaultProps}
        notification={{ ...baseNotification, status: 'actioned', linkHref: null }}
      />,
    )
    fireEvent.click(screen.getByText('View Quote'))
    expect(defaultProps.onAction).not.toHaveBeenCalled()
    expect(mockPush).not.toHaveBeenCalled()
  })
})
