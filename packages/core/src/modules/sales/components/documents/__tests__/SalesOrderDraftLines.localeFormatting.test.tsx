/**
 * @jest-environment jsdom
 *
 * The order form's draft line table and the `LineItemDialog` opened from its rows
 * sit on the same screen — the dialog overlays the row being edited — so they must
 * agree on which locale money is formatted in (#5105).
 *
 * The dialog formats in the application locale. This suite pins the table to the
 * same contract by rendering the real `DataTable`: the existing
 * `salesDocumentFormHoistedRenderers` suite stubs `DataTable` away, so its cell
 * renderers never execute and it structurally cannot see this defect.
 *
 * The pinned locale is deliberately one CI does not default to. CI resolves
 * `C.UTF-8` to an en-US ICU default, so an `en-US` pin would be satisfied by a
 * component that ignores the locale entirely; `pl-PL` renders `110,70 USD` where
 * the runtime default renders `$110.70`, so dropping the locale argument fails.
 */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { SalesOrderDraftLines, createSalesOrderLineDraft } from '../SalesOrderDraftLines'
import { formatMoney } from '../lineItemUtils'

const TEST_LOCALE = 'pl-PL'
const RUNTIME_DEFAULT_LOCALE = 'en-US'

// The dialog is a sibling of the table in the same return; this suite is about the
// table's own cells, and mounting the real dialog would pull in its data loading.
jest.mock('../LineItemDialog', () => ({
  LineItemDialog: () => null,
}))

// DataTable renders InjectionSpot children whenever a spot id resolves; unmocked
// the async registry loader settles at an arbitrary point and fires setState
// outside act().
jest.mock('@open-mercato/shared/modules/widgets/injection-loader', () => ({
  getInjectionRegistryVersion: () => 0,
  subscribeToInjectionRegistryChanges: () => () => {},
  loadInjectionWidgetsForSpot: jest.fn(async () => []),
  loadInjectionDataWidgetsForSpot: jest.fn(async () => []),
}))

jest.mock('@open-mercato/ui/backend/injection/useInjectionDataWidgets', () => ({
  useInjectionDataWidgets: () => ({ widgets: [], isLoading: false, error: null }),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(async () => ({ ok: true, result: { items: [] } })),
  withScopedApiRequestHeaders: async (_headers: unknown, operation: () => Promise<unknown>) => operation(),
}))

jest.mock('@open-mercato/ui/backend/utils/optimisticLock', () => ({
  buildOptimisticLockHeader: () => ({}),
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn(), refresh: jest.fn() }),
}))

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function renderDraftLines() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: 0, retry: false } } })
  const line = createSalesOrderLineDraft({
    name: 'Widget',
    quantity: 2,
    currencyCode: 'USD',
    unitPriceNet: 110.7,
    unitPriceGross: 110.7,
    totalGrossAmount: 221.4,
  }, 'line-1')

  const view = render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider locale={TEST_LOCALE} dict={{}}>
        <SalesOrderDraftLines
          currencyCode="USD"
          organizationId="org-1"
          tenantId="tenant-1"
          lines={[line]}
          onChange={jest.fn()}
        />
      </I18nProvider>
    </QueryClientProvider>,
  )
  return { ...view, cleanupQueryClient: () => queryClient.clear() }
}

function readRowText(): string {
  return Array.from(document.querySelectorAll('tbody td'))
    .map((cell) => cell.textContent ?? '')
    .join(' ')
}

describe('SalesOrderDraftLines money formatting (issue #5105)', () => {
  beforeEach(() => {
    ;(globalThis as typeof globalThis & { ResizeObserver?: typeof ResizeObserverMock }).ResizeObserver =
      ResizeObserverMock
  })

  it('formats the unit price and total in the application locale, not the runtime default', async () => {
    const { cleanupQueryClient } = renderDraftLines()
    try {
      await screen.findByText('Widget')
      const rowText = readRowText()

      expect(rowText).toContain(formatMoney(110.7, 'USD', TEST_LOCALE))
      expect(rowText).toContain(formatMoney(221.4, 'USD', TEST_LOCALE))
      expect(rowText).not.toContain(formatMoney(110.7, 'USD', RUNTIME_DEFAULT_LOCALE))
      expect(rowText).not.toContain(formatMoney(221.4, 'USD', RUNTIME_DEFAULT_LOCALE))
    } finally {
      cleanupQueryClient()
    }
  })
})
