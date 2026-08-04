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

function lineResponse(description: unknown) {
  return {
    ok: true,
    result: {
      items: [
        {
          id: '11111111-1111-1111-1111-111111111111',
          order_id: '22222222-2222-2222-2222-222222222222',
          name: 'Widget',
          description,
          quantity: 2,
          unit_price_net: 10,
          unit_price_gross: 12.3,
          tax_rate: 23,
          total_net_amount: 20,
          total_gross_amount: 24.6,
          currency_code: 'PLN',
        },
      ],
    },
  }
}

function renderSection() {
  return render(
    <SalesDocumentItemsSection
      documentId="22222222-2222-2222-2222-222222222222"
      kind="order"
      currencyCode="PLN"
    />,
  )
}

describe('SalesDocumentItemsSection line description', () => {
  beforeEach(() => {
    mockApiCall.mockReset()
  })

  it('renders the line description under the product name', async () => {
    mockApiCall.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/sales/order-lines')) return lineResponse('Cut to 120 cm, drilled')
      return { ok: true, result: { items: [] } }
    })

    renderSection()

    await waitFor(() => expect(screen.getByText('Widget')).toBeInTheDocument())
    expect(screen.getByText('Cut to 120 cm, drilled')).toBeInTheDocument()
  })

  it('renders no sub-line when the line has no description', async () => {
    mockApiCall.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/sales/order-lines')) return lineResponse(null)
      return { ok: true, result: { items: [] } }
    })

    const { container } = renderSection()

    await waitFor(() => expect(screen.getByText('Widget')).toBeInTheDocument())
    expect(container.querySelector('tbody .min-w-0')?.childElementCount).toBe(1)
  })

  it('ignores a whitespace-only description', async () => {
    mockApiCall.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/sales/order-lines')) return lineResponse('   ')
      return { ok: true, result: { items: [] } }
    })

    const { container } = renderSection()

    await waitFor(() => expect(screen.getByText('Widget')).toBeInTheDocument())
    expect(container.querySelector('tbody .min-w-0')?.childElementCount).toBe(1)
  })
})
