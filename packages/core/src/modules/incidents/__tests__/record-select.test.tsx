/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  RecordSelect,
  type RecordSelectPickedRecord,
  type RecordSelectTargetType,
} from '../backend/incidents/components/RecordSelect'

const mockApiCall = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => mockApiCall(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (
    _key: string,
    fallback?: string,
    values?: Readonly<Record<string, string | number>>,
  ) => {
    if (!fallback) return _key
    if (!values) return fallback
    return Object.entries(values).reduce(
      (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
      fallback,
    )
  },
}))

type ApiCallResult = {
  ok: boolean
  status: number
  result: {
    items: Array<Record<string, unknown>>
  } | null
}

const successfulResult = (item: Record<string, unknown>): ApiCallResult => ({
  ok: true,
  status: 200,
  result: { items: [item] },
})

describe('RecordSelect', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    mockApiCall.mockReset()
  })

  afterEach(() => {
    jest.runOnlyPendingTimers()
    jest.useRealTimers()
  })

  it.each([
    ['customer_person', '/api/customers/people', { id: 'person-1', displayName: 'Ada Lovelace' }],
    ['customer_company', '/api/customers/companies', { id: 'company-1', businessName: 'Acme Corp' }],
    ['sales_order', '/api/sales/orders', { id: 'order-1', orderNumber: 'SO-100' }],
    ['sales_quote', '/api/sales/quotes', { id: 'quote-1', quoteNumber: 'SQ-100' }],
    ['sales_invoice', '/api/sales/invoices', { id: 'invoice-1', invoiceNumber: 'INV-100' }],
    ['sales_credit_memo', '/api/sales/credit-memos', { id: 'credit-1', creditMemoNumber: 'CM-100' }],
  ] satisfies Array<[RecordSelectTargetType, string, Record<string, unknown>]>)(
    'searches %s records through %s',
    async (targetType, expectedPath, item) => {
      mockApiCall.mockResolvedValue(successfulResult(item))
      render(
        <RecordSelect
          targetType={targetType}
          value={null}
          onChange={jest.fn()}
        />,
      )

      const input = screen.getByPlaceholderText('Search records')
      fireEvent.focus(input)
      fireEvent.change(input, { target: { value: 'needle' } })
      await act(async () => {
        jest.advanceTimersByTime(350)
      })

      await waitFor(() => expect(mockApiCall).toHaveBeenCalled())
      const url = mockApiCall.mock.calls.at(-1)?.[0]
      expect(typeof url).toBe('string')
      expect(url).toContain(expectedPath)
      expect(url).toContain('page=1')
      expect(url).toContain('pageSize=10')
      expect(url).toContain('search=needle')
    },
  )

  it('degrades to a plain id input when search is unavailable', async () => {
    const onChange = jest.fn()
    mockApiCall.mockResolvedValue({ ok: false, status: 403, result: null })

    render(
      <RecordSelect
        targetType="customer_person"
        value={null}
        onChange={onChange}
      />,
    )

    const input = screen.getByPlaceholderText('Search records')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'needle' } })
    await act(async () => {
      jest.advanceTimersByTime(350)
    })

    const fallback = await screen.findByPlaceholderText('Record ID')
    fireEvent.change(fallback, { target: { value: 'manual-record-id' } })

    expect(onChange).toHaveBeenCalledWith('manual-record-id')
  })

  it('returns the picked label and amount metadata', async () => {
    const onChange = jest.fn()
    const onPicked = jest.fn<void, [RecordSelectPickedRecord]>()
    mockApiCall.mockResolvedValue(successfulResult({
      id: 'order-1',
      orderNumber: 'SO-100',
      grandTotalGrossAmount: '42.35',
      currencyCode: 'USD',
    }))

    render(
      <RecordSelect
        targetType="sales_order"
        value={null}
        onChange={onChange}
        onPicked={onPicked}
      />,
    )

    const input = screen.getByPlaceholderText('Search records')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'SO' } })
    await act(async () => {
      jest.advanceTimersByTime(350)
    })

    fireEvent.click(await screen.findByText('SO-100'))

    expect(onChange).toHaveBeenCalledWith('order-1')
    expect(onPicked).toHaveBeenCalledWith({
      id: 'order-1',
      label: 'SO-100',
      amountMinor: '4235',
      currency: 'USD',
    })
  })
})
