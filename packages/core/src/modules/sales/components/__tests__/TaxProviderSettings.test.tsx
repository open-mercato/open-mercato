/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { TaxProviderSettings } from '../TaxProviderSettings'
import SalesConfigurationPage from '../../backend/config/sales/page'

/**
 * The tax section of the sales configuration page is a single decision: which
 * tax UI belongs on the page. The default provider means the tax rates table
 * and nothing else — no picker when it is the only provider registered, and no
 * ship from address or timeout, which only an external provider consumes.
 */

const apiCallMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
  withScopedApiRequestHeaders: (_headers: unknown, fn: () => unknown) => fn(),
  readApiResultOrThrow: (...args: unknown[]) => apiCallMock(...args),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: async ({ operation }: { operation: () => Promise<unknown> }) => operation(),
    retryLastMutation: jest.fn(),
  }),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => 1,
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (key: string, fallback?: string) => fallback ?? key }),
}))

jest.mock('../TaxRatesSettings', () => ({
  TaxRatesSettings: () => <div data-testid="sales-tax-rates-settings" />,
}))
jest.mock('../StatusSettings', () => ({ StatusSettings: () => <div data-testid="status-settings" /> }))
jest.mock('../AdjustmentKindSettings', () => ({ AdjustmentKindSettings: () => <div /> }))
jest.mock('../ShippingMethodsSettings', () => ({ ShippingMethodsSettings: () => <div /> }))
jest.mock('../PaymentMethodsSettings', () => ({ PaymentMethodsSettings: () => <div /> }))
jest.mock('../OrderEditingSettings', () => ({
  OrderEditingSettings: () => <div data-testid="order-editing-settings" />,
}))
jest.mock('../DocumentNumberSettings', () => ({ DocumentNumberSettings: () => <div /> }))

const DEFAULT_PROVIDER = {
  key: 'table-rates',
  label: 'Default (Tax rates)',
  description: 'Uses the tax rates configured in the Tax rates section.',
  integrationId: null,
  capabilities: null,
  fields: [],
}

const EXTERNAL_PROVIDER = {
  key: 'avalara',
  label: 'Avalara',
  description: 'Calculates tax through AvaTax.',
  integrationId: null,
  capabilities: null,
  fields: [{ key: 'companyCode', label: 'Company code', type: 'text' }],
}

function respondWith(settings: Record<string, unknown>) {
  apiCallMock.mockImplementation(async () => ({
    ok: true,
    result: {
      providerKey: 'table-rates',
      providerSettings: null,
      shipFromAddress: null,
      timeoutMs: 5000,
      providers: [DEFAULT_PROVIDER],
      ...settings,
    },
  }))
}

function renderSettings() {
  return render(<TaxProviderSettings taxRatesSlot={<div data-testid="sales-tax-rates-settings" />} />)
}

describe('TaxProviderSettings', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders no provider picker when the default is the only registered provider', async () => {
    respondWith({ providers: [DEFAULT_PROVIDER] })
    renderSettings()

    await waitFor(() => expect(apiCallMock).toHaveBeenCalledWith('/api/sales/settings/tax-provider'))
    await waitFor(() => expect(screen.getByTestId('sales-tax-rates-settings')).toBeInTheDocument())
    expect(screen.queryByTestId('sales-tax-provider-settings')).not.toBeInTheDocument()
  })

  it('shows the picker and the tax rates table, without ship from or timeout, on the default provider', async () => {
    respondWith({ providers: [DEFAULT_PROVIDER, EXTERNAL_PROVIDER], providerKey: 'table-rates' })
    renderSettings()

    await waitFor(() => expect(screen.getByTestId('sales-tax-provider-settings')).toBeInTheDocument())
    expect(screen.getByTestId('sales-tax-rates-settings')).toBeInTheDocument()
    expect(screen.queryByLabelText('Address line 1')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Timeout (ms)')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Company code')).not.toBeInTheDocument()
  })

  it('replaces the tax rates table with the provider section when an external provider is selected', async () => {
    respondWith({ providers: [DEFAULT_PROVIDER, EXTERNAL_PROVIDER], providerKey: 'avalara' })
    renderSettings()

    await waitFor(() => expect(screen.getByTestId('sales-tax-provider-settings')).toBeInTheDocument())
    expect(screen.queryByTestId('sales-tax-rates-settings')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Company code')).toBeInTheDocument()
    expect(screen.getByLabelText('Address line 1')).toBeInTheDocument()
    expect(screen.getByLabelText('Timeout (ms)')).toBeInTheDocument()
  })
})

describe('sales configuration page composition', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('shows the tax rates table alone, ahead of order editing, on a stock install', async () => {
    respondWith({ providers: [DEFAULT_PROVIDER] })
    render(await SalesConfigurationPage({}))

    await waitFor(() => expect(screen.getByTestId('sales-tax-rates-settings')).toBeInTheDocument())
    expect(screen.queryByTestId('sales-tax-provider-settings')).not.toBeInTheDocument()

    const taxRates = screen.getByTestId('sales-tax-rates-settings')
    const orderEditing = screen.getByTestId('order-editing-settings')
    expect(taxRates.compareDocumentPosition(orderEditing) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('drops the tax rates table from the page when an external provider is selected', async () => {
    respondWith({ providers: [DEFAULT_PROVIDER, EXTERNAL_PROVIDER], providerKey: 'avalara' })
    render(await SalesConfigurationPage({}))

    await waitFor(() => expect(screen.getByTestId('sales-tax-provider-settings')).toBeInTheDocument())
    expect(screen.queryByTestId('sales-tax-rates-settings')).not.toBeInTheDocument()

    const taxProvider = screen.getByTestId('sales-tax-provider-settings')
    const orderEditing = screen.getByTestId('order-editing-settings')
    expect(taxProvider.compareDocumentPosition(orderEditing) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
