/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, waitFor, fireEvent, act } from '@testing-library/react'
import { emitSalesDocumentTotalsRefresh } from '@open-mercato/core/modules/sales/lib/frontend/documentTotalsEvents'

const mockApiCall = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => mockApiCall(...args),
  withScopedApiRequestHeaders: (_headers: unknown, operation: () => unknown) => operation(),
}))

const mockCreateCrud = jest.fn()
const mockUpdateCrud = jest.fn()
const mockDeleteCrud = jest.fn()
jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  createCrud: (...args: unknown[]) => mockCreateCrud(...args),
  updateCrud: (...args: unknown[]) => mockUpdateCrud(...args),
  deleteCrud: (...args: unknown[]) => mockDeleteCrud(...args),
}))

jest.mock('@open-mercato/ui/backend/utils/optimisticLock', () => ({
  buildOptimisticLockHeader: () => ({}),
}))

jest.mock('@open-mercato/ui/backend/utils/serverErrors', () => ({
  createCrudFormError: (message: string) => new Error(message),
}))

jest.mock('@open-mercato/ui/backend/conflicts', () => ({
  surfaceRecordConflict: () => false,
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/detail', () => ({
  LoadingMessage: ({ label }: { label: string }) => <div data-testid="loading-message">{label}</div>,
  ErrorMessage: ({ title }: { title: string }) => <div>{title}</div>,
  TabEmptyState: ({ title }: { title: string }) => <div data-testid="empty-state">{title}</div>,
}))

jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: ({ data, rowActions }: { data: Array<{ id: string }>; rowActions?: (row: { id: string }) => React.ReactNode }) => (
    <div data-testid="data-table">
      {data.map((row) => (
        <div key={row.id} data-testid={`row-${row.id}`}>
          {rowActions ? rowActions(row) : null}
        </div>
      ))}
    </div>
  ),
}))

jest.mock('@open-mercato/ui/backend/RowActions', () => ({
  RowActions: ({ items }: { items: Array<{ id: string; label: string; onSelect: () => void }> }) => (
    <>
      {items.map((item) => (
        <button key={item.id} type="button" data-testid={`row-action-${item.id}`} onClick={item.onSelect}>
          {item.label}
        </button>
      ))}
    </>
  ),
}))

jest.mock('@open-mercato/ui/primitives/badge', () => ({
  Badge: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}))

jest.mock('../../PriceWithCurrency', () => ({
  PriceWithCurrency: ({ amount }: { amount: number | null }) => <span>{amount}</span>,
}))

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeDetail: () => ({ organizationId: 'org-1', tenantId: 'tenant-1' }),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => {
  const translate = (_key: string, fallback?: string) => fallback ?? _key
  return { useT: () => translate, useLocale: () => 'en-US' }
})

const dialogProps: Array<Record<string, unknown>> = []
jest.mock('../AdjustmentDialog', () => ({
  AdjustmentDialog: (props: Record<string, unknown>) => {
    dialogProps.push(props)
    return props.open ? <div data-testid="adjustment-dialog-open" /> : null
  },
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { SalesDocumentAdjustmentsSection } = require('../AdjustmentsSection')

const QUOTE_ADJUSTMENTS_PREFIX = '/api/sales/quote-adjustments?'

function countQuoteAdjustmentsGetCalls(): number {
  return mockApiCall.mock.calls.filter(([url]) => typeof url === 'string' && url.startsWith(QUOTE_ADJUSTMENTS_PREFIX)).length
}

describe('SalesDocumentAdjustmentsSection totals-refresh self-reload (#8263)', () => {
  let quoteAdjustmentsItems: Array<Record<string, unknown>> = []

  beforeEach(() => {
    jest.clearAllMocks()
    dialogProps.length = 0
    quoteAdjustmentsItems = []
    mockApiCall.mockImplementation((url: string) => {
      if (typeof url === 'string' && url.startsWith(QUOTE_ADJUSTMENTS_PREFIX)) {
        return Promise.resolve({ ok: true, result: { items: quoteAdjustmentsItems } })
      }
      return Promise.resolve({ ok: true, result: { items: [] } })
    })
    mockCreateCrud.mockResolvedValue({ ok: true, result: { id: 'adj-1' } })
    mockDeleteCrud.mockResolvedValue({ ok: true, result: {} })
  })

  it('reloads its own adjustments list exactly once per create, not twice via its own totals-refresh event', async () => {
    render(
      <SalesDocumentAdjustmentsSection
        documentId="quote-1"
        kind="quote"
        currencyCode="USD"
        documentUpdatedAt={null}
      />,
    )

    await waitFor(() => expect(countQuoteAdjustmentsGetCalls()).toBe(1))
    await waitFor(() => expect(dialogProps.length).toBeGreaterThan(0))

    const onSubmit = dialogProps[dialogProps.length - 1].onSubmit as (payload: unknown) => Promise<void>
    await act(async () => {
      await onSubmit({
        label: 'QA surcharge',
        code: null,
        kind: 'surcharge',
        calculatorKey: null,
        amountNet: 5,
        amountGross: 5,
        currencyCode: 'USD',
      })
    })

    expect(mockCreateCrud).toHaveBeenCalledTimes(1)
    expect(countQuoteAdjustmentsGetCalls()).toBe(2)
  })

  it('still reloads for an external event after consuming its self refresh', async () => {
    render(
      <SalesDocumentAdjustmentsSection documentId="quote-1" kind="quote" currencyCode="USD" documentUpdatedAt={null} />,
    )
    await waitFor(() => expect(countQuoteAdjustmentsGetCalls()).toBe(1))
    await waitFor(() => expect(dialogProps.length).toBeGreaterThan(0))
    const onSubmit = dialogProps[dialogProps.length - 1].onSubmit as (payload: unknown) => Promise<void>
    await act(async () => onSubmit({ label: 'QA surcharge', amountNet: 5, amountGross: 5, currencyCode: 'USD' }))
    expect(countQuoteAdjustmentsGetCalls()).toBe(2)
    await act(async () => emitSalesDocumentTotalsRefresh({ documentId: 'other-quote', kind: 'quote' }))
    await act(async () => emitSalesDocumentTotalsRefresh({ documentId: 'quote-1', kind: 'order' }))
    expect(countQuoteAdjustmentsGetCalls()).toBe(2)
    await act(async () => emitSalesDocumentTotalsRefresh({ documentId: 'quote-1', kind: 'quote' }))
    expect(countQuoteAdjustmentsGetCalls()).toBe(3)
  })

  it('reloads its own adjustments list exactly once per delete, not twice via its own totals-refresh event', async () => {
    quoteAdjustmentsItems = [
      { id: 'adj-1', label: 'QA shipping', kind: 'shipping', amount_net: 15, amount_gross: 18.45, position: 0 },
    ]

    const { getByTestId } = render(
      <SalesDocumentAdjustmentsSection
        documentId="quote-1"
        kind="quote"
        currencyCode="USD"
        documentUpdatedAt={null}
      />,
    )

    await waitFor(() => expect(countQuoteAdjustmentsGetCalls()).toBe(1))
    await waitFor(() => expect(getByTestId('row-adj-1')).toBeTruthy())

    fireEvent.click(getByTestId('row-action-delete'))

    await waitFor(() => expect(mockDeleteCrud).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(countQuoteAdjustmentsGetCalls()).toBe(2))
  })
})
