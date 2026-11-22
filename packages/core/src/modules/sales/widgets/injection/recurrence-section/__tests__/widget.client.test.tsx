/** @jest-environment jsdom */

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))
jest.mock('remark-gfm', () => ({ __esModule: true, default: {} }))

const mockApiCallOrThrow = jest.fn(async () => ({ ok: true }))
const mockRunDocumentMutation = jest.fn(async (operation: () => Promise<unknown>) => operation())
const mockUseSalesDocumentMutation = jest.fn((_kind: string, _documentId?: string | null) => mockRunDocumentMutation)

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  ...jest.requireActual('@open-mercato/ui/backend/utils/apiCall'),
  apiCallOrThrow: (...args: unknown[]) => mockApiCallOrThrow(...args),
}))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('../../../../components/documents/useSalesDocumentMutation', () => ({
  useSalesDocumentMutation: (kind: string, documentId?: string | null) => mockUseSalesDocumentMutation(kind, documentId),
}))

import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import RecurrenceSectionWidget from '../widget.client'

const order = {
  id: 'order-1',
  updatedAt: '2026-11-09T10:00:00.000Z',
  canManageRecurrence: true,
  recurrence: {
    frequency: 'monthly' as const,
    startsOn: '2026-12-01',
    anchorDay: 1,
    periodCount: 6,
    endsOn: '2027-05-31',
    nextInvoiceOn: '2026-12-01',
    status: 'scheduled' as const,
    locked: false,
  },
}

async function switchRecurringOff(kind: 'order' | 'quote') {
  renderWithProviders(<RecurrenceSectionWidget context={{ kind }} data={order} />, { dict: {} })
  fireEvent.click(screen.getByTestId('sales-recurrence-edit'))
  const toggle = await screen.findByTestId('sales-recurrence-toggle')
  fireEvent.click(toggle)
  await waitFor(() => expect(toggle).toHaveAttribute('data-state', 'unchecked'))
  return toggle
}

function sentBody(): unknown {
  const [, init] = mockApiCallOrThrow.mock.calls[0] as unknown as [string, { body: string }]
  return JSON.parse(init.body)
}

describe('recurring billing section', () => {
  const originalScrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView')
  beforeAll(() => {
    if (originalScrollIntoView) return
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: jest.fn() })
  })
  afterAll(() => {
    if (!originalScrollIntoView) Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
  })
  beforeEach(() => jest.clearAllMocks())

  it.each(['order', 'quote'] as const)('shows the %s schedule without editor controls for a viewer', (kind) => {
    renderWithProviders(
      <RecurrenceSectionWidget context={{ kind }} data={{ ...order, canManageRecurrence: false }} />,
      { dict: {} },
    )

    expect(screen.getByTestId('sales-recurrence-schedule')).toBeVisible()
    expect(screen.queryByTestId('sales-recurrence-edit')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it.each(['order', 'quote'] as const)('hides setup for a one-time %s the viewer cannot manage', (kind) => {
    renderWithProviders(
      <RecurrenceSectionWidget context={{ kind }} data={{ id: order.id, recurrence: null }} />,
      { dict: {} },
    )

    expect(screen.getByTestId('sales-recurrence-section')).toBeVisible()
    expect(screen.queryByTestId('sales-recurrence-edit')).not.toBeInTheDocument()
  })

  it.each(['order', 'quote'] as const)('saves the %s schedule through the document guarded mutation', async (kind) => {
    await switchRecurringOff(kind)
    fireEvent.click(screen.getByRole('button', { name: /Save schedule/ }))

    await waitFor(() => expect(mockApiCallOrThrow).toHaveBeenCalledTimes(1))
    expect(mockUseSalesDocumentMutation).toHaveBeenCalledWith(kind, 'order-1')
    expect(mockRunDocumentMutation).toHaveBeenCalledTimes(1)
    expect(mockRunDocumentMutation).toHaveBeenCalledWith(expect.any(Function), { id: 'order-1', recurrence: null })
    expect(mockApiCallOrThrow.mock.calls[0][0]).toBe(kind === 'order' ? '/api/sales/orders' : '/api/sales/quotes')
    expect(sentBody()).toEqual({ id: 'order-1', recurrence: null })
  })

  it('keeps the schedule draft while Escape closes the frequency list', async () => {
    renderWithProviders(<RecurrenceSectionWidget context={{ kind: 'order' }} data={order} />, { dict: {} })
    const trigger = screen.getByTestId('sales-recurrence-edit')
    trigger.focus()
    fireEvent.click(trigger)

    const heading = await screen.findByRole('heading', { name: 'Recurring schedule' })
    await waitFor(() => expect(heading).toHaveFocus())

    const periodCount = screen.getByTestId('sales-recurrence-period-count')
    fireEvent.change(periodCount, { target: { value: '7' } })
    const frequency = screen.getByTestId('sales-recurrence-frequency')
    fireEvent.keyDown(frequency, { key: 'ArrowDown' })
    const listbox = await screen.findByRole('listbox')
    fireEvent.keyDown(listbox, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(periodCount).toHaveValue(7)
    await waitFor(() => expect(frequency).toHaveFocus())

    fireEvent.keyDown(frequency, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())
    expect(mockApiCallOrThrow).not.toHaveBeenCalled()
  })

  it('removes the schedule on Cmd+Enter while the Recurring switch still has focus', async () => {
    const toggle = await switchRecurringOff('order')
    toggle.focus()
    fireEvent.keyDown(toggle, { key: 'Enter', metaKey: true })

    await waitFor(() => expect(mockApiCallOrThrow).toHaveBeenCalledTimes(1))
    expect(toggle).toHaveAttribute('data-state', 'unchecked')
    expect(sentBody()).toEqual({ id: 'order-1', recurrence: null })
  })
})
