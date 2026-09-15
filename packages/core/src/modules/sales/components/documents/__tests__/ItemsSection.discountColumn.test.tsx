/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { createTranslator } from '@open-mercato/shared/lib/i18n/translate'
import { SalesDocumentItemsSection } from '../ItemsSection'

const mockApiCall = jest.fn()
const mockTranslate = createTranslator({})

// The discount cells render Intl-formatted money, so the locale is pinned explicitly (#5105)
// instead of inheriting the runner's default — otherwise these assertions only hold in en-US.
const TEST_LOCALE = 'en-US'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => mockApiCall(...args),
  withScopedApiRequestHeaders: async (_headers: unknown, operation: () => Promise<unknown>) => operation(),
}))

jest.mock('@open-mercato/ui/backend/utils/optimisticLock', () => ({
  buildOptimisticLockHeader: () => ({}),
}))

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  deleteCrud: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/utils/serverErrors', () => ({
  normalizeCrudServerError: (err: unknown) => ({ message: String(err) }),
}))

jest.mock('@open-mercato/ui/backend/detail', () => ({
  LoadingMessage: () => null,
  TabEmptyState: () => null,
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({
    confirm: jest.fn().mockResolvedValue(true),
    ConfirmDialogElement: null,
  }),
}))

jest.mock('@open-mercato/ui/primitives/button', () => ({
  Button: ({ children, ...props }: { children?: React.ReactNode }) => <button {...props}>{children}</button>,
}))

jest.mock('@open-mercato/ui/backend/injection/useInjectionDataWidgets', () => ({
  useInjectionDataWidgets: () => ({ widgets: [] }),
}))

jest.mock('@open-mercato/core/modules/dictionaries/components/dictionaryAppearance', () => ({
  DictionaryValue: () => null,
  createDictionaryMap: () => ({}),
  normalizeDictionaryEntries: () => [],
}))

jest.mock('@open-mercato/core/modules/sales/lib/frontend/documentTotalsEvents', () => ({
  emitSalesDocumentTotalsRefresh: jest.fn(),
}))

jest.mock('../LineItemDialog', () => ({
  LineItemDialog: () => null,
}))

jest.mock('../optimisticLock', () => ({
  handleSectionMutationError: () => false,
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => mockTranslate,
  useLocale: () => TEST_LOCALE,
}))

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeDetail: () => ({ organizationId: 'org-1', tenantId: 'tenant-1' }),
}))

jest.mock('lucide-react', () => ({
  Pencil: () => null,
  Trash2: () => null,
}))

type LinePayload = Record<string, unknown>

async function discountColumnIndex(): Promise<number> {
  const headers = await screen.findAllByRole('columnheader')
  const index = headers.findIndex((header) => header.textContent === 'Discount')
  expect(index).toBeGreaterThanOrEqual(0)
  return index
}

function money(value: number): string {
  return new Intl.NumberFormat(TEST_LOCALE, { style: 'currency', currency: 'USD' }).format(value)
}

function lineFixture(overrides: LinePayload = {}): LinePayload {
  return {
    id: 'line-1',
    name: 'Widget A',
    quantity: 3,
    currency_code: 'USD',
    unit_price_net: 10,
    unit_price_gross: 10,
    tax_rate: 0,
    total_net_amount: 30,
    total_gross_amount: 30,
    discount_amount: 0,
    discount_percent: 0,
    ...overrides,
  }
}

function secondLineFixture(overrides: LinePayload = {}): LinePayload {
  return lineFixture({ id: 'line-2', name: 'Widget B', ...overrides })
}

function mockLines(...lines: LinePayload[]): void {
  mockApiCall.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/sales/order-lines?')) {
      return { ok: true, result: { items: lines } }
    }
    return { ok: true, result: { items: [] } }
  })
}

function renderSection(): void {
  render(
    <SalesDocumentItemsSection
      documentId="order-1"
      kind="order"
      currencyCode="USD"
      organizationId="org-1"
      tenantId="tenant-1"
    />,
  )
}

describe('SalesDocumentItemsSection discount column', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('hides the column when no line of the document carries a discount', async () => {
    mockLines(lineFixture(), secondLineFixture())
    renderSection()

    await screen.findByText('Widget A')
    expect(screen.queryByRole('columnheader', { name: 'Discount' })).toBeNull()
  })

  it('renders the resolved line discount and the percentage that accounts for it', async () => {
    mockLines(
      lineFixture({ discount_amount: 4.5, discount_percent: 15, total_net_amount: 25.5 }),
      secondLineFixture(),
    )
    renderSection()

    await screen.findByRole('columnheader', { name: 'Discount' })
    await waitFor(() => expect(screen.getByText(`−${money(4.5)}`)).toBeTruthy())
    expect(screen.getByText('15%')).toBeTruthy()
  })

  it('shows the amount alone when the recorded percentage does not account for it', async () => {
    // `discountAmount: 5` supplied per unit persists 15.00 on a 3 × 10.00 line while
    // `discount_percent` keeps the raw 15 — 15% of that line is 4.50, not 15.00, so
    // pairing them would assert a derivation the data does not support.
    mockLines(lineFixture({ discount_amount: 15, discount_percent: 15, total_net_amount: 15 }))
    renderSection()

    await screen.findByRole('columnheader', { name: 'Discount' })
    await waitFor(() => expect(screen.getByText(`−${money(15)}`)).toBeTruthy())
    expect(screen.queryByText('15%')).toBeNull()
  })

  it('falls back to the percentage when only a percentage is recorded', async () => {
    mockLines(lineFixture({ discount_percent: 10 }))
    renderSection()

    await screen.findByRole('columnheader', { name: 'Discount' })
    expect(screen.getByText('10%')).toBeTruthy()
    expect(screen.queryByText(/^−/)).toBeNull()
  })

  it('leaves the cell empty on lines that carry no discount', async () => {
    mockLines(lineFixture({ discount_amount: 4.5 }), secondLineFixture())
    renderSection()

    const columnIndex = await discountColumnIndex()
    const bodyRows = (await screen.findAllByRole('row')).slice(1)
    expect(bodyRows).toHaveLength(2)
    expect(bodyRows[0].querySelectorAll('td')[columnIndex]?.textContent).toBe(`−${money(4.5)}`)
    expect(bodyRows[1].querySelectorAll('td')[columnIndex]?.textContent).toBe('')
  })
})
