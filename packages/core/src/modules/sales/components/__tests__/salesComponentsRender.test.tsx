/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PriceWithCurrency, formatPriceWithCurrency } from '../PriceWithCurrency'
import { DocumentCustomerCard } from '../DocumentCustomerCard'
import { DocumentTotals } from '../documents/DocumentTotals'
import { DocumentNumberSettings } from '../DocumentNumberSettings'
import { OrderEditingSettings } from '../OrderEditingSettings'
import { AdjustmentKindSettings } from '../AdjustmentKindSettings'
import { PaymentMethodsSettings } from '../PaymentMethodsSettings'
import { ShippingMethodsSettings } from '../ShippingMethodsSettings'
import { StatusSettings } from '../StatusSettings'
import { TaxRatesSettings } from '../TaxRatesSettings'
import { SalesChannelOffersPanel } from '../channels/SalesChannelOffersPanel'
import { ChannelOfferForm } from '../channels/ChannelOfferForm'

const mockApiCall = jest.fn()
const mockReadApiResultOrThrow = jest.fn()
const mockCreateCrud = jest.fn()
const mockUpdateCrud = jest.fn()
const mockDeleteCrud = jest.fn()
const mockFlash = jest.fn()
const mockCollectCustomFieldValues = jest.fn().mockReturnValue({})

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: any[]) => mockApiCall(...args),
  apiCallOrThrow: (...args: any[]) => mockReadApiResultOrThrow(...args),
  readApiResultOrThrow: (...args: any[]) => mockReadApiResultOrThrow(...args),
}))

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  createCrud: (...args: any[]) => mockCreateCrud(...args),
  updateCrud: (...args: any[]) => mockUpdateCrud(...args),
  deleteCrud: (...args: any[]) => mockDeleteCrud(...args),
  buildCrudExportUrl: () => '/export.csv',
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: (...args: any[]) => mockFlash(...args),
}))

jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: ({
    children,
    fields = [],
    onSubmit,
    submitLabel = 'Submit',
    renderGroups,
    groups = [],
  }: any) => {
    const renderedFields = renderGroups
      ? renderGroups({
          groups,
          fields,
          renderField: (field: any) => (
            <div key={field.id ?? field.name} data-testid={`crud-field-${field.name ?? field.id}`}>
              {field.label ?? field.name}
            </div>
          ),
        })
      : fields.map((field: any) => (
          <div key={field.id ?? field.name} data-testid={`crud-field-${field.name ?? field.id}`}>
            {field.label ?? field.name}
          </div>
        ))
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit?.({})
        }}
      >
        {renderedFields}
        {children}
        <button type="submit">{submitLabel}</button>
      </form>
    )
  },
}))

jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: ({ title, data = [], children }: any) => {
    const key = typeof title === 'string' ? title.replace(/\\s+/g, '-').toLowerCase() : 'table'
    return (
      <div>
        {title ? <h2>{title}</h2> : null}
        <div data-testid={`data-table-count-${key}`}>{Array.isArray(data) ? data.length : 0}</div>
        <div>{children}</div>
        {Array.isArray(data)
          ? data.map((row, idx) => (
              <div key={idx} data-testid="data-row">
                {row.title ?? row.label ?? row.name ?? row.code ?? row.value ?? row.id}
              </div>
            ))
          : null}
      </div>
    )
  },
}))

jest.mock('@open-mercato/ui/backend/RowActions', () => ({
  RowActions: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/backend/ValueIcons', () => ({
  BooleanIcon: ({ value }: { value?: boolean }) => <span>{value ? 'Yes' : 'No'}</span>,
}))

jest.mock('@open-mercato/ui/backend/detail', () => ({
  LoadingMessage: ({ label }: { label: string }) => <div>{label}</div>,
  ErrorMessage: ({ label }: { label: string }) => <div>{label}</div>,
  TabEmptyState: ({ title, action }: any) => (
    <div>
      <div>{title}</div>
      {action ? <button onClick={action.onClick}>{action.label}</button> : null}
    </div>
  ),
}))

jest.mock('@open-mercato/ui/backend/inputs', () => ({
  LookupSelect: ({ value, onChange, options = [] }: any) => (
    <select value={value ?? ''} onChange={(event) => onChange?.(event.target.value || null)}>
      <option value="">Select</option>
      {options.map((opt: any) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  ),
}))

jest.mock('@open-mercato/ui/backend/utils/customFieldValues', () => ({
  collectCustomFieldValues: (...args: any[]) => mockCollectCustomFieldValues(...args),
}))

jest.mock('@open-mercato/ui/backend/utils/serverErrors', () => ({
  raiseCrudError: jest.fn(),
  createCrudFormError: (message: string) => new Error(message),
  normalizeCrudServerError: (err: any) => ({ message: err?.message ?? 'error' }),
}))

jest.mock('@open-mercato/ui/primitives/button', () => ({
  Button: ({ children, ...props }: any) => (
    <button {...props} type={props.type || 'button'}>
      {children}
    </button>
  ),
}))

jest.mock('@open-mercato/ui/primitives/input', () => ({
  Input: ({ children, ...props }: any) => <input {...props}>{children}</input>,
}))

jest.mock('@open-mercato/ui/primitives/label', () => ({
  Label: ({ children, ...props }: any) => <label {...props}>{children}</label>,
}))

jest.mock('@open-mercato/ui/primitives/switch', () => ({
  Switch: ({ checked, onCheckedChange, ...props }: any) => (
    <input
      type="checkbox"
      role="switch"
      checked={!!checked}
      onChange={(event) => onCheckedChange?.(event.target.checked)}
      {...props}
    />
  ),
}))

jest.mock('@open-mercato/ui/primitives/textarea', () => ({
  Textarea: ({ children, ...props }: any) => <textarea {...props}>{children}</textarea>,
}))

jest.mock('@open-mercato/ui/primitives/dialog', () => ({
  Dialog: ({ children }: any) => <div>{children}</div>,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h3>{children}</h3>,
  DialogTrigger: ({ children }: any) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/primitives/badge', () => ({
  Badge: ({ children }: any) => <span>{children}</span>,
}))

jest.mock('@open-mercato/core/modules/dictionaries/components/AppearanceSelector', () => ({
  AppearanceSelector: () => <div>appearance</div>,
}))

jest.mock('@open-mercato/core/modules/dictionaries/components/dictionaryAppearance', () => ({
  renderDictionaryColor: () => <span>color</span>,
  renderDictionaryIcon: () => <span>icon</span>,
  ICON_SUGGESTIONS: [],
}))

jest.mock('@open-mercato/core/modules/dictionaries/components/DictionaryForm', () => ({
  DictionaryForm: ({ onSubmit, initialValues }: any) => (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit?.(initialValues ?? {})
      }}
    >
      <button type="submit">save</button>
    </form>
  ),
}))

jest.mock('@open-mercato/core/modules/dictionaries/components/DictionaryTable', () => ({
  DictionaryTable: ({ entries = [] }: any) => (
    <div data-testid="dictionary-table-count">{entries.length}</div>
  ),
}))

jest.mock('@open-mercato/core/modules/dictionaries/components/DictionaryEntrySelect', () => ({
  DictionaryEntrySelect: ({ value, onChange }: any) => (
    <select value={value ?? ''} onChange={(event) => onChange?.(event.target.value || null)}>
      <option value="">Select</option>
    </select>
  ),
}))

jest.mock('../../lib/providers', () => ({
  listPaymentProviders: () => [
    {
      key: 'stripe',
      label: 'Stripe',
      settings: { fields: [{ key: 'secret', label: 'Secret', type: 'secret' }], defaults: { secret: 'demo' } },
    },
  ],
  listShippingProviders: () => [
    { key: 'flat', label: 'Flat rate', settings: { fields: [], defaults: {} } },
  ],
}))

jest.mock('@open-mercato/shared/lib/custom-fields/normalize', () => ({
  normalizeCustomFieldResponse: (input: any) => input,
}))

jest.mock('@open-mercato/core/modules/sales/lib/frontend/documentTotalsEvents', () => ({
  emitSalesDocumentTotalsRefresh: jest.fn(),
}))

jest.mock('@open-mercato/core/modules/customers/components/detail/hooks/useCurrencyDictionary', () => ({
  useCurrencyDictionary: () => ({ data: { entries: [] }, refetch: jest.fn() }),
}))

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeDetail: () => ({ organizationId: 'org', tenantId: 'tenant' }),
}))

jest.mock('@/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => 1,
  useOrganizationScopeDetail: () => ({ organizationId: 'org', tenantId: 'tenant' }),
}))

jest.mock('@/lib/i18n/context', () => {
  const translate = (key: string, fallback?: string, vars?: Record<string, unknown>) => {
    const base = (fallback ?? key) as string
    if (vars) {
      return base.replace(/\{\{(\w+)\}\}/g, (_, token) => String(vars[token] ?? ''))
    }
    return base
  }
  return {
    useT: () => translate,
  }
})

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn(), replace: jest.fn() }),
}))

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, ...props }: any) => <a {...props}>{children}</a>,
}))

describe('sales components', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockApiCall.mockResolvedValue({ ok: true, result: {} })
    mockReadApiResultOrThrow.mockResolvedValue({ items: [] })
    mockCreateCrud.mockResolvedValue({ ok: true })
    mockUpdateCrud.mockResolvedValue({ ok: true })
    mockDeleteCrud.mockResolvedValue({ ok: true })
  })

  it('formats prices with currency helper and component', () => {
    expect(formatPriceWithCurrency(10, 'USD')).toContain('$')
    expect(formatPriceWithCurrency(null, 'USD')).toBe('—')
    render(<PriceWithCurrency amount={15} currency="EUR" />)
    expect(screen.getByText(/€|EUR/)).toBeInTheDocument()
  })

  it('renders DocumentCustomerCard and triggers selection', () => {
    const onSelect = jest.fn()
    render(
      <DocumentCustomerCard
        label="Customer"
        name="ACME"
        email="test@example.com"
        kind="company"
        onSelectCustomer={onSelect}
      />,
    )
    expect(screen.getByText('Customer')).toBeInTheDocument()
    fireEvent.click(screen.getByText('ACME'))
    expect(onSelect).toHaveBeenCalled()
  })

  it('toggles DocumentTotals details', () => {
    const items = [
      { key: 'subtotal', label: 'Subtotal', amount: 100 },
      { key: 'tax', label: 'Tax', amount: 20 },
      { key: 'shipping', label: 'Shipping', amount: 5 },
      { key: 'total', label: 'Total', amount: 120, emphasize: true },
    ]
    render(<DocumentTotals currency="USD" items={items} title="Summary" />)
    const toggle = screen.getByRole('button', { name: /show details/i })
    fireEvent.click(toggle)
    expect(screen.getByText('Subtotal')).toBeInTheDocument()
    expect(screen.getByText('Total')).toBeInTheDocument()
  })

  it('loads adjustment kinds into table', async () => {
    mockReadApiResultOrThrow.mockResolvedValueOnce({
      items: [{ id: 'adj-1', value: 'discount', label: 'Discount', color: '#ff0000', icon: null }],
    })
    render(<AdjustmentKindSettings />)
    await waitFor(() => expect(screen.getByTestId('data-table-count-table')).toHaveTextContent('1'))
  })

  it('renders payment methods settings table', async () => {
    mockReadApiResultOrThrow.mockResolvedValueOnce({
      items: [{ id: 'pm-1', name: 'Credit card', code: 'card', provider_key: 'stripe', providerKey: 'stripe' }],
    })
    render(<PaymentMethodsSettings />)
    await waitFor(() => expect(screen.getByText(/Credit card/i)).toBeInTheDocument())
  })

  it('renders shipping methods settings table', async () => {
    mockReadApiResultOrThrow.mockResolvedValueOnce({
      items: [{ id: 'ship-1', name: 'Courier', code: 'courier', isActive: true }],
    })
    render(<ShippingMethodsSettings />)
    await waitFor(() => expect(screen.getByText(/Courier/i)).toBeInTheDocument())
  })

  it('renders status settings with entries', async () => {
    mockReadApiResultOrThrow
      .mockResolvedValueOnce({ items: [{ id: 'st-1', value: 'new', label: 'New' }] })
      .mockResolvedValueOnce({ items: [{ id: 'ln-1', value: 'processing', label: 'Processing' }] })
      .mockResolvedValueOnce({ items: [{ id: 'sh-1', value: 'shipped', label: 'Shipped' }] })
      .mockResolvedValueOnce({ items: [{ id: 'pay-1', value: 'paid', label: 'Paid' }] })
    render(<StatusSettings />)
    await waitFor(() => {
      const tables = screen.getAllByTestId('dictionary-table-count')
      expect(tables).toHaveLength(4)
      tables.forEach((table) => expect(table).toHaveTextContent('1'))
    })
  })

  it('renders tax rates settings rows', async () => {
    mockReadApiResultOrThrow.mockResolvedValueOnce({
      items: [{ id: 'tax-1', code: 'vat', label: 'VAT', rate: 23 }],
    })
    render(<TaxRatesSettings />)
    await waitFor(() => expect(screen.getByText(/VAT/)).toBeInTheDocument())
  })

  it('renders document number settings with server data', async () => {
    mockApiCall.mockResolvedValueOnce({
      ok: true,
      result: {
        orderNumberFormat: 'ORD-{seq}',
        quoteNumberFormat: 'QUO-{seq}',
        nextOrderNumber: 10,
        nextQuoteNumber: 5,
        tokens: [],
      },
    })
    render(<DocumentNumberSettings />)
    await waitFor(() => expect(screen.getByDisplayValue('ORD-{seq}')).toBeInTheDocument())
    expect(screen.getByDisplayValue('QUO-{seq}')).toBeInTheDocument()
  })

  it('renders order editing settings', async () => {
    mockApiCall.mockResolvedValueOnce({
      ok: true,
      result: {
        enabledStatuses: ['draft'],
        enabledLineStatuses: ['open'],
        allowPriceChanges: true,
        allowQuantityChanges: true,
      },
    })
    render(<OrderEditingSettings />)
    await waitFor(() => expect(mockApiCall).toHaveBeenCalled())
    expect(screen.getAllByRole('switch').length).toBeGreaterThan(0)
  })

  it('renders sales channel offers panel', async () => {
    mockReadApiResultOrThrow.mockResolvedValueOnce({
      items: [
        { id: 'offer-1', title: 'Offer A', isActive: true, productTitle: 'Product A', pricing: null, updatedAt: null },
      ],
      total: 1,
      totalPages: 1,
    })
    render(<SalesChannelOffersPanel channelId="channel-1" channelName="Online" />)
    await waitFor(() => expect(screen.getAllByTestId('data-row').length).toBeGreaterThan(0))
  })

  it('renders channel offer form in create mode', async () => {
    mockReadApiResultOrThrow.mockResolvedValue({
      items: [],
    })
    render(<ChannelOfferForm channelId="channel-1" mode="create" />)
    await waitFor(() => expect(mockReadApiResultOrThrow).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: /create|save|submit/i })).toBeInTheDocument()
  })
})
