/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, waitFor, fireEvent, act } from '@testing-library/react'

const mockApiCall = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: any[]) => mockApiCall(...args),
  withScopedApiRequestHeaders: (_headers: unknown, operation: () => unknown) => operation(),
}))

const mockCreateCrud = jest.fn()
const mockUpdateCrud = jest.fn()
const mockDeleteCrud = jest.fn()
jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  createCrud: (...args: any[]) => mockCreateCrud(...args),
  updateCrud: (...args: any[]) => mockUpdateCrud(...args),
  deleteCrud: (...args: any[]) => mockDeleteCrud(...args),
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
  DataTable: ({ data, rowActions }: { data: any[]; rowActions?: (row: any) => React.ReactNode }) => (
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
  Badge: ({ children }: any) => <span>{children}</span>,
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
  AdjustmentDialog: (props: any) => {
    dialogProps.push(props)
    return props.open ? <div data-testid="adjustment-dialog-open" /> : null
  },
}))

// Use the REAL event bus (not mocked) so the self-emitted totals-refresh event
// actually round-trips through this component's own subscription — the
// regression this test guards against only reproduces with real dispatch/subscribe.
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
    // Keyed by URL (not call order) since `loadKindOptions` and `loadAdjustments`
    // both fire on mount and their relative order is an implementation detail.
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
    // One GET on mount + one direct reload after the create succeeds. Before the
    // fix, the component's own `emitSalesDocumentTotalsRefresh` call bounced back
    // through its own `subscribeSalesDocumentTotalsRefresh` listener and fired a
    // third, redundant GET.
    expect(countQuoteAdjustmentsGetCalls()).toBe(2)
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
    // One GET on mount + one direct reload after the delete succeeds. Before the
    // fix, the component's own `emitSalesDocumentTotalsRefresh` call bounced back
    // through its own `subscribeSalesDocumentTotalsRefresh` listener and fired a
    // third, redundant GET.
    await waitFor(() => expect(countQuoteAdjustmentsGetCalls()).toBe(2))
  })
})
