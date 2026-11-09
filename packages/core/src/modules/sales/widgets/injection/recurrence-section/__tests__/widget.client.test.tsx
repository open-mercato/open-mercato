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
  recurrence: {
    frequency: 'monthly',
    startsOn: '2026-12-01',
    anchorDay: 1,
    periodCount: 6,
    endsOn: '2027-05-31',
    nextInvoiceOn: '2026-12-01',
    status: 'scheduled',
    locked: false,
  },
}

async function switchRecurringOff(kind: 'order' | 'quote') {
  renderWithProviders(<RecurrenceSectionWidget context={{ kind }} data={order as never} />, { dict: {} })
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
  beforeEach(() => jest.clearAllMocks())

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

  it('removes the schedule on Cmd+Enter while the Recurring switch still has focus', async () => {
    const toggle = await switchRecurringOff('order')
    toggle.focus()
    fireEvent.keyDown(toggle, { key: 'Enter', metaKey: true })

    await waitFor(() => expect(mockApiCallOrThrow).toHaveBeenCalledTimes(1))
    expect(toggle).toHaveAttribute('data-state', 'unchecked')
    expect(sentBody()).toEqual({ id: 'order-1', recurrence: null })
  })
})
