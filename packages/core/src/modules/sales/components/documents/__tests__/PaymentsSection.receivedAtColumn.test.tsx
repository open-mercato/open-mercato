/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { SalesDocumentPaymentsSection } from '../PaymentsSection'

const mockApiCall = jest.fn()

jest.mock('@open-mercato/ui/backend/injection/useInjectionDataWidgets', () => ({
  useInjectionDataWidgets: () => ({ widgets: [], isLoading: false, error: null }),
}))

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

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: jest.fn(), ConfirmDialogElement: null }),
}))

jest.mock('../PaymentDialog', () => ({ PaymentDialog: () => null }))

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

// Run twice by `yarn test`: once in the runner's zone, once under `TZ=America/New_York` via the
// `test:tz` script. In UTC the local and UTC readings coincide, so this case can only fail west
// of UTC — without the second pass the guard is inert on CI.
//
// `received_at` is a `timestamptz` written from a date input: `PaymentDialog` sends
// `new Date('2026-07-01')`, `z.coerce.date()` stores UTC midnight, and the API returns it
// with a `Z`. The Edit dialog seeds itself from `receivedAt.slice(0, 10)` — the UTC day — so
// the cell must name that same day, or one row contradicts itself with no reload.
const STORED_RECEIVED_AT = '2026-07-01T00:00:00.000Z'
// `pl-PL` on purpose: it renders a day the en-US default never produces, so a component that
// stops threading the locale fails here instead of merely looking plausible — the rule in
// `.ai/lessons/tests-asserting-intl-output-must-pin-locale-and-date.md`.
const DIALOG_SEEDS_DAY = '1 lip 2026'
const LOCAL_READING_WOULD_SAY = '30 cze 2026'

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: 0, retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider locale="pl-PL" dict={{}}>
        <SalesDocumentPaymentsSection orderId="order-1" currencyCode="EUR" />
      </I18nProvider>
    </QueryClientProvider>,
  )
}

describe('sales payments table — the Received column', () => {
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
            received_at: STORED_RECEIVED_AT,
          },
        ],
      },
    })
  })

  // Reading the stored instant's LOCAL day names 30 June anywhere west of UTC, while the Edit
  // dialog on the same row still seeds 2026-07-01. The assertion is on the *day*, not on the
  // format: which convention renders it is a separate decision (locale by default here).
  it('names the day the Edit dialog seeds, not the viewer-local day', async () => {
    renderSection()

    await waitFor(() => {
      expect(screen.getByText('REF-1')).toBeInTheDocument()
    })
    expect(screen.getByText(DIALOG_SEEDS_DAY)).toBeInTheDocument()
    expect(screen.queryByText(LOCAL_READING_WOULD_SAY)).toBeNull()
  })
})
