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

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
}

function createDeferred<T>(): Deferred<T> {
  let resolve: Deferred<T>['resolve'] = () => undefined
  let reject: Deferred<T>['reject'] = () => undefined
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

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

  it('hydrates the selected label for an initial value', async () => {
    mockApiCall.mockResolvedValue(successfulResult({
      id: 'person-1',
      displayName: 'Ada Lovelace',
    }))

    render(
      <RecordSelect
        targetType="customer_person"
        value="person-1"
        onChange={jest.fn()}
      />,
    )

    await waitFor(() => expect(mockApiCall).toHaveBeenCalled())
    const url = mockApiCall.mock.calls[0]?.[0]
    expect(typeof url).toBe('string')
    expect(url).toContain('/api/customers/people')
    expect(url).toContain('ids=person-1')
    expect(url).toContain('pageSize=1')

    await waitFor(() => {
      const input = screen.getByRole('combobox') as HTMLInputElement
      expect(input.value).toBe('Ada Lovelace')
    })
  })

  it('does not let stale hydration responses overwrite newer values', async () => {
    const first = createDeferred<ApiCallResult>()
    const second = createDeferred<ApiCallResult>()
    const onChange = jest.fn()
    mockApiCall
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)

    const { rerender } = render(
      <RecordSelect
        targetType="customer_person"
        value="person-1"
        onChange={onChange}
      />,
    )

    await waitFor(() => expect(mockApiCall).toHaveBeenCalledTimes(1))

    rerender(
      <RecordSelect
        targetType="customer_person"
        value="person-2"
        onChange={onChange}
      />,
    )

    await waitFor(() => expect(mockApiCall).toHaveBeenCalledTimes(2))

    await act(async () => {
      second.resolve(successfulResult({
        id: 'person-2',
        displayName: 'Grace Hopper',
      }))
      await Promise.resolve()
    })

    await waitFor(() => {
      const input = screen.getByRole('combobox') as HTMLInputElement
      expect(input.value).toBe('Grace Hopper')
    })

    await act(async () => {
      first.resolve(successfulResult({
        id: 'person-1',
        displayName: 'Ada Lovelace',
      }))
      await Promise.resolve()
    })

    await waitFor(() => {
      const input = screen.getByRole('combobox') as HTMLInputElement
      expect(input.value).toBe('Grace Hopper')
    })
  })

  it('keeps the raw id without fallback mode when hydration fails', async () => {
    mockApiCall.mockResolvedValue({ ok: false, status: 500, result: null })

    render(
      <RecordSelect
        targetType="customer_person"
        value="person-1"
        onChange={jest.fn()}
      />,
    )

    await waitFor(() => expect(mockApiCall).toHaveBeenCalled())

    const input = screen.getByRole('combobox') as HTMLInputElement
    expect(input.value).toBe('person-1')
    expect(screen.queryByPlaceholderText('Record ID')).toBeNull()
  })

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
