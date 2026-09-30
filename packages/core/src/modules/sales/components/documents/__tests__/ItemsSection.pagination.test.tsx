/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { SalesDocumentItemsSection } from '../ItemsSection'

const mockApiCall = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: any[]) => mockApiCall(...args),
  withScopedApiRequestHeaders: async (_headers: unknown, operation: () => Promise<unknown>) => operation(),
}))

jest.mock('@open-mercato/ui/backend/utils/optimisticLock', () => ({
  buildOptimisticLockHeader: () => ({}),
}))

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  deleteCrud: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/utils/serverErrors', () => ({
  normalizeCrudServerError: (err: unknown) => err,
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/detail', () => ({
  LoadingMessage: () => null,
  TabEmptyState: () => null,
}))

jest.mock('@open-mercato/ui/primitives/button', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({
    confirm: jest.fn().mockResolvedValue(true),
    ConfirmDialogElement: null,
  }),
}))

jest.mock('@open-mercato/ui/backend/injection/useInjectionDataWidgets', () => ({
  useInjectionDataWidgets: () => ({ widgets: [] }),
}))

jest.mock('../LineItemDialog', () => ({
  LineItemDialog: () => null,
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback?: string) => fallback ?? _key,
  // ItemsSection formats money in the app locale, so the mock pins it rather than letting the
  // component fall back to the runner's default (#5105).
  useLocale: () => 'en-US',
}))

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeDetail: () => ({ organizationId: 'org-1', tenantId: 'tenant-1' }),
}))

jest.mock(
  '@open-mercato/core/modules/dictionaries/components/dictionaryAppearance',
  () => ({
    DictionaryValue: () => null,
    createDictionaryMap: () => ({}),
    normalizeDictionaryEntries: () => [],
  }),
)

const DOCUMENT_ID = '22222222-2222-2222-2222-222222222222'

function buildLine(index: number) {
  return {
    id: `line-${index}`,
    name: `Line ${index}`,
    quantity: 1,
    unit_price_net: 1,
    unit_price_gross: 1,
    tax_rate: 0,
    total_net_amount: 1,
    total_gross_amount: 1,
    currency_code: 'USD',
  }
}

function mockPagedLines(resourcePath: string, totalLines: number) {
  mockApiCall.mockImplementation(async (url: string) => {
    if (!url.startsWith(`/api/${resourcePath}?`)) return { ok: true, result: { items: [] } }
    const params = new URLSearchParams(url.split('?')[1])
    const page = Number(params.get('page'))
    const pageSize = Number(params.get('pageSize'))
    const start = (page - 1) * pageSize
    const end = Math.min(start + pageSize, totalLines)
    const items = []
    for (let index = start + 1; index <= end; index += 1) items.push(buildLine(index))
    return { ok: true, result: { items, total: totalLines, page, pageSize } }
  })
}

function lineRequests(resourcePath: string) {
  return mockApiCall.mock.calls
    .map(([url]) => String(url))
    .filter((url) => url.startsWith(`/api/${resourcePath}?`))
    .map((url) => new URLSearchParams(url.split('?')[1]))
}

describe('SalesDocumentItemsSection line pagination (#6460)', () => {
  beforeEach(() => {
    mockApiCall.mockReset()
  })

  it.each([
    ['order', 'sales/order-lines', 'orderId'],
    ['quote', 'sales/quote-lines', 'quoteId'],
  ] as const)('renders every line of a %s with more than 100 lines', async (kind, resourcePath, documentKey) => {
    mockPagedLines(resourcePath, 250)
    const onItemsChange = jest.fn()

    render(
      <SalesDocumentItemsSection
        documentId={DOCUMENT_ID}
        kind={kind}
        currencyCode="USD"
        onItemsChange={onItemsChange}
      />,
    )

    await waitFor(() => expect(screen.getByText('Line 250')).toBeInTheDocument())
    expect(screen.getByText('Line 1')).toBeInTheDocument()
    expect(screen.getByText('Line 101')).toBeInTheDocument()
    expect(screen.getByText('Line 201')).toBeInTheDocument()
    expect(onItemsChange).toHaveBeenLastCalledWith(expect.arrayContaining([expect.objectContaining({ id: 'line-250' })]))
    expect(onItemsChange.mock.calls.at(-1)?.[0]).toHaveLength(250)

    const requests = lineRequests(resourcePath)
    expect(requests.map((params) => params.get('page'))).toEqual(['1', '2', '3'])
    requests.forEach((params) => {
      expect(Number(params.get('pageSize'))).toBeLessThanOrEqual(100)
      expect(params.get(documentKey)).toBe(DOCUMENT_ID)
    })
  })

  it('requests a single page when the document fits in one page', async () => {
    mockPagedLines('sales/order-lines', 100)

    render(<SalesDocumentItemsSection documentId={DOCUMENT_ID} kind="order" currencyCode="USD" />)

    await waitFor(() => expect(screen.getByText('Line 100')).toBeInTheDocument())
    expect(lineRequests('sales/order-lines')).toHaveLength(1)
  })

  it('stops paging when the API keeps returning the same page', async () => {
    mockApiCall.mockImplementation(async (url: string) => {
      if (!url.startsWith('/api/sales/order-lines?')) return { ok: true, result: { items: [] } }
      const items = []
      for (let index = 1; index <= 100; index += 1) items.push(buildLine(index))
      return { ok: true, result: { items } }
    })

    render(<SalesDocumentItemsSection documentId={DOCUMENT_ID} kind="order" currencyCode="USD" />)

    await waitFor(() => expect(screen.getByText('Line 100')).toBeInTheDocument())
    expect(lineRequests('sales/order-lines')).toHaveLength(2)
  })

  it('shows the load error instead of a silently partial list when a later page fails', async () => {
    mockApiCall.mockImplementation(async (url: string) => {
      if (!url.startsWith('/api/sales/order-lines?')) return { ok: true, result: { items: [] } }
      const page = Number(new URLSearchParams(url.split('?')[1]).get('page'))
      if (page > 1) return { ok: false, result: null }
      const items = []
      for (let index = 1; index <= 100; index += 1) items.push(buildLine(index))
      return { ok: true, result: { items, total: 150 } }
    })

    render(<SalesDocumentItemsSection documentId={DOCUMENT_ID} kind="order" currencyCode="USD" />)

    await waitFor(() => expect(screen.getByText('Failed to load items.')).toBeInTheDocument())
    expect(screen.queryByText('Line 1')).not.toBeInTheDocument()
  })
})
