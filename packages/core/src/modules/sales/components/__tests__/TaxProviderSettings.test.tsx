/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TaxProviderSettings } from '../TaxProviderSettings'
import SalesConfigurationPage from '../../backend/config/sales/page'

if (typeof window !== 'undefined') {
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => undefined
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined
}

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

/**
 * The ship-from state is the field a tax provider keys on, so it gets the same picker as every other
 * address form: a dropdown when the ship-from country has a subdivision list, free text otherwise.
 */
describe('TaxProviderSettings - the ship-from region follows the ship-from country', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  const withShipFrom = (address: Record<string, string>) =>
    respondWith({
      providers: [DEFAULT_PROVIDER, EXTERNAL_PROVIDER],
      providerKey: 'avalara',
      shipFromAddress: { addressLine1: 'Main Street 1', city: 'Plano', postalCode: '75074', ...address },
    })

  async function renderWithShipFrom(address: Record<string, string>) {
    withShipFrom(address)
    renderSettings()
    await waitFor(() => expect(screen.getByTestId('sales-tax-provider-settings')).toBeInTheDocument())
  }

  it('offers the 50 states plus DC when the ship-from country is the United States', async () => {
    await renderWithShipFrom({ country: 'US', region: '' })

    const trigger = screen.getByRole('combobox', { name: 'Region' })
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false })
    fireEvent.click(trigger)

    expect(screen.getAllByRole('option')).toHaveLength(51)
    expect(screen.getByRole('option', { name: 'Texas' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Puerto Rico' })).toBeNull()
  })

  it('keeps the free-text input for a country with no subdivision list', async () => {
    await renderWithShipFrom({ country: 'PL', region: 'Mazowieckie' })

    expect(screen.queryByRole('combobox', { name: 'Region' })).toBeNull()
    expect(screen.getByLabelText('Region')).toHaveValue('Mazowieckie')
  })

  it('preselects the state a legacy full name denotes', async () => {
    await renderWithShipFrom({ country: 'US', region: 'Texas' })

    expect(screen.getByRole('combobox', { name: 'Region' })).toHaveTextContent('Texas')
  })

  it('saves the two-letter code the picker produced', async () => {
    await renderWithShipFrom({ country: 'US', region: '' })

    const trigger = screen.getByRole('combobox', { name: 'Region' })
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false })
    fireEvent.click(trigger)
    const option = screen.getByRole('option', { name: 'Texas' })
    fireEvent.pointerDown(option)
    fireEvent.click(option)

    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))

    await waitFor(() => {
      const put = apiCallMock.mock.calls.find(([, init]) => (init as { method?: string })?.method === 'PUT')
      expect(put).toBeDefined()
      const body = JSON.parse((put![1] as { body: string }).body)
      expect(body.shipFromAddress.region).toBe('TX')
    })
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
