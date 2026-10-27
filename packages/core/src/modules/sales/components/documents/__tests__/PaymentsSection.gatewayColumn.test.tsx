/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import type { LoadedInjectionDataWidget } from '@open-mercato/shared/modules/widgets/injection'
import { injectionTable } from '../../../widgets/injection-table'
import gatewayStatusColumnWidget from '../../../widgets/injection/payment-gateway-status-column/widget'
import englishDictionary from '../../../../payment_gateways/i18n/en.json'
import { SalesDocumentPaymentsSection } from '../PaymentsSection'

const mockApiCall = jest.fn()
const useInjectionDataWidgetsMock = jest.fn()

jest.mock('@open-mercato/ui/backend/injection/useInjectionDataWidgets', () => ({
  useInjectionDataWidgets: (spotId: string) => useInjectionDataWidgetsMock(spotId),
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

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: any[]) => mockApiCall(...args),
  withScopedApiRequestHeaders: (_header: unknown, callback: any) => callback?.(),
}))

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  deleteCrud: jest.fn(),
  buildCrudExportUrl: () => '/export.csv',
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: jest.fn(), ConfirmDialogElement: null }),
}))

jest.mock('../PaymentDialog', () => ({
  PaymentDialog: () => null,
}))

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeDetail: () => ({ organizationId: 'org-1', tenantId: 'tenant-1' }),
  useOrganizationScopeVersion: () => 1,
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn(), refresh: jest.fn() }),
}))

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const GATEWAY_COLUMNS_SPOT_ID = 'data-table:sales.payments:columns'
const GATEWAY_HEADER = englishDictionary['payment_gateways.column.gatewayStatus']

function readHeaderTexts(): string[] {
  return Array.from(document.querySelectorAll('thead th')).map((cell) => cell.textContent?.trim() ?? '')
}

function readFirstRowTexts(): string[] {
  const firstRow = document.querySelector('tbody tr')
  return Array.from(firstRow?.querySelectorAll('td') ?? []).map((cell) => cell.textContent?.trim() ?? '')
}

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: 0, retry: false } } })
  const view = render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider locale="en" dict={englishDictionary as Record<string, string>}>
        <SalesDocumentPaymentsSection orderId="order-1" currencyCode="EUR" />
      </I18nProvider>
    </QueryClientProvider>,
  )
  return { ...view, cleanupQueryClient: () => queryClient.clear() }
}

describe('sales payments table gateway status column (issue #5142)', () => {
  beforeEach(() => {
    ;(globalThis as typeof globalThis & { ResizeObserver?: typeof ResizeObserverMock }).ResizeObserver =
      ResizeObserverMock
    jest.clearAllMocks()
    mockApiCall.mockResolvedValue({
      ok: true,
      result: {
        items: [
          {
            id: 'payment-1',
            amount: 100,
            currency_code: 'EUR',
            status: 'paid',
            payment_reference: 'REF-1',
          },
        ],
      },
    })
    useInjectionDataWidgetsMock.mockImplementation((spotId: string) => {
      const bound = injectionTable[GATEWAY_COLUMNS_SPOT_ID]
      const widgetId = Array.isArray(bound) ? bound[0]?.widgetId : bound?.widgetId
      if (spotId === GATEWAY_COLUMNS_SPOT_ID && widgetId === gatewayStatusColumnWidget.metadata.id) {
        return {
          widgets: [gatewayStatusColumnWidget as LoadedInjectionDataWidget],
          isLoading: false,
          error: null,
        }
      }
      return { widgets: [], isLoading: false, error: null }
    })
  })

  it('renders the injected gateway status column in the payments table', async () => {
    const { cleanupQueryClient } = renderSection()

    await waitFor(() => {
      expect(screen.getByText(GATEWAY_HEADER)).toBeTruthy()
    })

    // Asserting the body cell, not just the header, is what proves the column
    // actually renders. It is read by position rather than by text so the
    // assertion does not freeze whatever placeholder the widget shows while no
    // module enriches `sales.payment` with `_gateway`.
    const headers = readHeaderTexts()
    const rowTexts = readFirstRowTexts()
    const gatewayIndex = headers.indexOf(GATEWAY_HEADER)

    expect(gatewayIndex).toBeGreaterThanOrEqual(0)
    expect(rowTexts).toHaveLength(headers.length)
    expect(rowTexts[gatewayIndex]).not.toBe('')

    cleanupQueryClient()
  })

  it('shows the missing-value placeholder instead of inventing a gateway status', async () => {
    const { cleanupQueryClient } = renderSection()

    await waitFor(() => {
      expect(screen.getByText(GATEWAY_HEADER)).toBeTruthy()
    })

    // The fixture payment carries neither gateway data nor a payment method, so
    // both cells have nothing to show. The gateway column must say so the same
    // way its siblings do — reporting a status the system cannot know is worse
    // than an empty column, especially next to a settled payment.
    const headers = readHeaderTexts()
    const rowTexts = readFirstRowTexts()
    const gatewayIndex = headers.indexOf(GATEWAY_HEADER)
    const methodIndex = headers.indexOf('Method')

    expect(methodIndex).toBeGreaterThanOrEqual(0)
    expect(rowTexts[gatewayIndex]).toBe(rowTexts[methodIndex])
    expect(rowTexts[gatewayIndex]).not.toBe('pending')

    cleanupQueryClient()
  })

  it('places the gateway status column next to the payment status, not past the row actions', async () => {
    const { cleanupQueryClient } = renderSection()

    await waitFor(() => {
      expect(screen.getByText(GATEWAY_HEADER)).toBeTruthy()
    })

    // Without a `placement` the widget lands after the row-actions column, which
    // is where the pre-fix UI QA pass found it. `relativeTo: 'status'` only
    // resolves while the payments status column keeps its explicit `id`.
    const headers = readHeaderTexts()
    const statusIndex = headers.indexOf('Status')
    const gatewayIndex = headers.indexOf(GATEWAY_HEADER)

    expect(statusIndex).toBeGreaterThanOrEqual(0)
    expect(gatewayIndex).toBe(statusIndex + 1)
    expect(gatewayIndex).toBeLessThan(headers.length - 1)

    cleanupQueryClient()
  })

  it('asks for the columns spot the restored binding targets', async () => {
    const { cleanupQueryClient } = renderSection()

    await waitFor(() => {
      expect(useInjectionDataWidgetsMock).toHaveBeenCalledWith(GATEWAY_COLUMNS_SPOT_ID)
    })

    cleanupQueryClient()
  })
})
