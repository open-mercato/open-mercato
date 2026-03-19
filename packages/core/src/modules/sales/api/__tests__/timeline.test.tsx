/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { DocumentHistoryWidget as TimelineWidget } from '../../widgets/injection/document-history/widget.client'
import type { TimelineEntry } from '../../widgets/injection/document-history/widget.client'

const mockApiCall = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: any[]) => mockApiCall(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => {
  const t = (key: string, fallback?: string) => fallback ?? key
  return { useT: () => t }
})

jest.mock('@open-mercato/shared/lib/time', () => ({
  formatRelativeTime: () => 'just now',
  formatDateTime: (iso: string) => iso,
}))

jest.mock('@open-mercato/shared/lib/utils', () => ({
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
}))

jest.mock('@open-mercato/ui/primitives/spinner', () => ({
  Spinner: () => React.createElement('div', { 'data-testid': 'spinner' }),
}))

jest.mock('lucide-react', () => ({
  ArrowRightLeft: () => null,
  Zap: () => null,
  MessageSquare: () => null,
  User: () => null,
  Filter: () => null,
  ChevronDown: () => null,
  Check: () => null,
}))

const baseContext = { kind: 'order' as const, record: { id: 'order-1' } }

const entries: TimelineEntry[] = [
  {
    id: '1',
    occurredAt: new Date().toISOString(),
    kind: 'status',
    action: 'Order created',
    actor: { id: 'u1', label: 'User 1' },
    source: 'action_log',
  },
  {
    id: '2',
    occurredAt: new Date().toISOString(),
    kind: 'action',
    action: 'Order sent',
    actor: { id: 'u2', label: 'User 2' },
    source: 'action_log',
  },
  {
    id: '3',
    occurredAt: new Date().toISOString(),
    kind: 'comment',
    action: 'Note added',
    actor: { id: 'u3', label: 'User 3' },
    source: 'note',
  },
]

beforeEach(() => {
  jest.clearAllMocks()
  mockApiCall.mockImplementation((url: string) => {
    if (typeof url === 'string' && url.includes('/api/sales/order-statuses')) {
      return Promise.resolve({ ok: true, result: { items: [] } })
    }
    if (typeof url === 'string' && url.includes('/api/sales/document-history')) {
      return Promise.resolve({ ok: true, result: { items: entries } })
    }
    return Promise.resolve({ ok: false, result: null })
  })
})

describe('TimelineWidget', () => {
  it('renders all entries by default', async () => {
    render(<TimelineWidget context={baseContext} />)
    expect(await screen.findByText('Order created')).toBeInTheDocument()
    expect(screen.getByText('Order sent')).toBeInTheDocument()
    expect(screen.getByText('Note added')).toBeInTheDocument()
  })

  it('shows only status entries when Status changes filter is selected', async () => {
    render(<TimelineWidget context={baseContext} />)
    expect(await screen.findByText('Order created')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Filters/i }))
    fireEvent.click(screen.getByRole('option', { name: /Status changes/i }))
    expect(screen.getByText('Order created')).toBeInTheDocument()
    expect(screen.queryByText('Order sent')).not.toBeInTheDocument()
    expect(screen.queryByText('Note added')).not.toBeInTheDocument()
  })

  it('shows only action entries when Actions filter is selected', async () => {
    render(<TimelineWidget context={baseContext} />)
    expect(await screen.findByText('Order sent')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Filters/i }))
    fireEvent.click(screen.getByRole('option', { name: /^Actions$/i }))
    expect(screen.getByText('Order sent')).toBeInTheDocument()
    expect(screen.queryByText('Order created')).not.toBeInTheDocument()
    expect(screen.queryByText('Note added')).not.toBeInTheDocument()
  })

  it('shows only comment entries when Comments filter is selected', async () => {
    render(<TimelineWidget context={baseContext} />)
    expect(await screen.findByText('Note added')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Filters/i }))
    fireEvent.click(screen.getByRole('option', { name: /^Comments$/i }))
    expect(screen.getByText('Note added')).toBeInTheDocument()
    expect(screen.queryByText('Order created')).not.toBeInTheDocument()
    expect(screen.queryByText('Order sent')).not.toBeInTheDocument()
  })

  it('shows empty state when no entries returned', async () => {
    mockApiCall.mockImplementation(() =>
      Promise.resolve({ ok: true, result: { items: [] } })
    )
    render(<TimelineWidget context={baseContext} />)
    expect(await screen.findByText(/No history entries yet/i)).toBeInTheDocument()
  })

  it('shows loading spinner before data loads', () => {
    mockApiCall.mockImplementation(() => new Promise(() => {}))
    render(<TimelineWidget context={baseContext} />)
    expect(screen.getByTestId('spinner')).toBeInTheDocument()
  })

  it('shows actor name from entry', async () => {
    render(<TimelineWidget context={baseContext} />)
    expect(await screen.findByText('User 1')).toBeInTheDocument()
    expect(screen.getByText('User 2')).toBeInTheDocument()
  })

  it('shows status transition for status entries with metadata', async () => {
    const entriesWithMeta: TimelineEntry[] = [
      {
        id: '1',
        occurredAt: new Date().toISOString(),
        kind: 'status',
        action: 'confirmed',
        actor: { id: 'u1', label: 'User 1' },
        source: 'action_log',
        metadata: { statusFrom: 'draft', statusTo: 'confirmed' },
      },
    ]
    mockApiCall.mockImplementation((url: string) => {
      if (url.includes('/api/sales/document-history')) {
        return Promise.resolve({ ok: true, result: { items: entriesWithMeta } })
      }
      return Promise.resolve({ ok: true, result: { items: [] } })
    })
    render(<TimelineWidget context={baseContext} />)
    expect(await screen.findByText('draft')).toBeInTheDocument()
    expect(screen.getByText('confirmed')).toBeInTheDocument()
  })
})
