/**
 * @jest-environment jsdom
 *
 * UI-level regression test for issue #5248.
 *
 * A sales order line that already has shipped quantities must present its
 * pricing controls as genuinely read-only: the effective price is visible, no
 * control accepts input, and a name-only edit submits without any of the fields
 * the server guard rejects. Only the pure payload helper was covered before, so
 * neither of the two ways this can regress in the dialog itself was pinned:
 *
 *  1. the price control rendering as an interactive `LookupSelect` whose
 *     `disabled` prop only disables the search box while the option cards and
 *     the "Clear selection" button stay live, and
 *  2. an unshipped line receiving an injected single-entry `options` array,
 *     which resets `LookupSelect`'s item list on every parent render and
 *     collapses the price list to the current selection.
 */
import * as React from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'

const mockApiCall = jest.fn()
const mockUpdateCrud = jest.fn()
const mockCreateCrud = jest.fn()

let capturedFields: any[] = []
let capturedSubmit: ((values: any) => Promise<void>) | null = null
let capturedLookupProps: any[] = []

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: any[]) => mockApiCall(...args),
  withScopedApiRequestHeaders: async (_headers: unknown, operation: () => Promise<unknown>) => operation(),
}))

jest.mock('@open-mercato/ui/backend/utils/optimisticLock', () => ({
  buildOptimisticLockHeader: () => ({}),
}))

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  createCrud: (...args: any[]) => mockCreateCrud(...args),
  updateCrud: (...args: any[]) => mockUpdateCrud(...args),
}))

jest.mock('@open-mercato/ui/backend/utils/serverErrors', () => ({
  createCrudFormError: (message: string) => new Error(message),
}))

jest.mock('@open-mercato/ui/backend/utils/customFieldValues', () => ({
  collectCustomFieldValues: () => ({}),
}))

jest.mock('../optimisticLock', () => ({
  handleSectionMutationError: () => false,
}))

jest.mock('@open-mercato/ui/hooks/useDialogKeyHandler', () => ({
  useDialogKeyHandler: () => () => {},
}))

jest.mock('@open-mercato/ui/primitives/dialog', () => ({
  Dialog: ({ children }: any) => <div>{children}</div>,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h3>{children}</h3>,
}))

jest.mock('@open-mercato/ui/primitives/alert', () => ({
  Alert: ({ children }: any) => <div role="status">{children}</div>,
  AlertDescription: ({ children }: any) => <div>{children}</div>,
  AlertTitle: ({ children }: any) => <strong>{children}</strong>,
}))

jest.mock('@open-mercato/ui/primitives/button', () => ({
  Button: ({ children, ...props }: any) => <button type="button" {...props}>{children}</button>,
}))

jest.mock('@open-mercato/ui/primitives/input', () => ({
  Input: (props: any) => <input {...props} />,
}))

// Mirrors the real primitive closely enough for the assertions that matter: the
// wrapper owns `disabled` and the trigger is what a user would click, so the
// trigger has to end up disabled for the control to be genuinely locked.
jest.mock('@open-mercato/ui/primitives/select', () => {
  const ReactLib = require('react')
  const DisabledContext = ReactLib.createContext(false)
  return {
    __esModule: true,
    Select: ({ children, disabled }: any) => (
      <DisabledContext.Provider value={!!disabled}>
        <div>{children}</div>
      </DisabledContext.Provider>
    ),
    SelectTrigger: ({ children, ...props }: any) => {
      const disabled = ReactLib.useContext(DisabledContext)
      return (
        <button
          type="button"
          role="combobox"
          aria-controls="select-content"
          aria-expanded={false}
          disabled={disabled}
          {...props}
        >
          {children}
        </button>
      )
    },
    SelectValue: ({ placeholder }: any) => <span>{placeholder ?? ''}</span>,
    SelectContent: ({ children }: any) => <div>{children}</div>,
    SelectItem: ({ children }: any) => <div>{children}</div>,
  }
})

jest.mock('@open-mercato/ui/backend/inputs', () => ({
  LookupSelect: (props: any) => {
    capturedLookupProps.push(props)
    return <div data-testid="lookup-select" />
  },
}))

// The dialog's own field components are what this test is about, so the form is
// reduced to a harness that renders them with the current form values and hands
// the submit callback back to the test.
jest.mock('@open-mercato/ui/backend/CrudForm', () => {
  const ReactLib = require('react')
  return {
    __esModule: true,
    CrudForm: ({ fields = [], initialValues = {}, onSubmit }: any) => {
      capturedFields = fields
      capturedSubmit = onSubmit
      return (
        <form>
          {fields
            .filter((field: any) => field.type === 'custom' && field.component)
            .map((field: any) => {
              const FieldComponent = field.component
              return (
                <div key={field.id} data-testid={`field-${field.id}`}>
                  <FieldComponent
                    value={(initialValues as Record<string, unknown>)[field.id]}
                    values={initialValues}
                    setValue={() => {}}
                    setFormValue={() => {}}
                  />
                </div>
              )
            })}
        </form>
      )
    },
  }
})

// Stable translator and scope references, mirroring the production providers
// (the I18nProvider memoizes `t`). The dialog's data-loading callbacks depend on
// `t`, so a fresh function per render would re-fire its bootstrap effect
// endlessly and the test would hang rather than fail.
const translate = (key: string, fallback?: unknown) =>
  typeof fallback === 'string' ? fallback : key
const organizationScope = { organizationId: 'org-1', tenantId: 'tenant-1' }

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => translate,
}))

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeDetail: () => organizationScope,
}))

jest.mock('lucide-react', () => ({
  DollarSign: () => null,
  Settings: () => null,
}))

jest.mock('@open-mercato/core/modules/dictionaries/components/dictionaryAppearance', () => ({
  DictionaryValue: () => null,
  renderDictionaryIcon: () => null,
  renderDictionaryColor: () => null,
}))

import { LineItemDialog } from '../LineItemDialog'
import type { SalesLineRecord } from '../lineItemTypes'

const shippedLine: SalesLineRecord = {
  id: 'line-1',
  name: 'Original name',
  productId: 'product-1',
  productVariantId: 'variant-1',
  quantity: 4,
  quantityUnit: 'pcs',
  normalizedQuantity: 4,
  normalizedUnit: 'pcs',
  currencyCode: 'USD',
  unitPriceNet: 90,
  unitPriceGross: 110.7,
  taxRate: 23,
  totalNet: 360,
  totalGross: 442.8,
  priceMode: 'gross',
  uomSnapshot: null,
  metadata: { priceId: 'price-1', priceMode: 'gross' },
  catalogSnapshot: null,
}

const renderDialog = (props: Record<string, unknown> = {}) =>
  render(
    <LineItemDialog
      open
      kind="order"
      documentId="order-1"
      currencyCode="USD"
      organizationId="org-1"
      tenantId="tenant-1"
      initialLine={shippedLine}
      shippedQuantity={4}
      onOpenChange={() => {}}
      onSaved={async () => {}}
      {...props}
    />,
  )

// The dialog re-verifies the catalog reference on open and falls back to a
// custom line when the product or variant cannot be resolved, so the fixtures
// have to answer those lookups for the catalog-line fields to render at all.
const catalogResponses = (url: string) => {
  if (url.startsWith('/api/catalog/products')) {
    return { items: [{ id: 'product-1', title: 'Product One', sku: 'SKU-1' }] }
  }
  if (url.startsWith('/api/catalog/variants')) {
    return { items: [{ id: 'variant-1', name: 'Variant One', sku: 'SKU-1-A' }] }
  }
  // The line's stored price must be resolvable, otherwise the unshipped case
  // below could not tell a missing `options` prop from a missing selection.
  if (url.startsWith('/api/catalog/prices')) {
    return {
      items: [
        {
          id: 'price-1',
          unit_price_net: 90,
          unit_price_gross: 110.7,
          currency_code: 'USD',
          tax_rate: 23,
          price_kind_title: 'Retail',
        },
      ],
    }
  }
  if (url.startsWith('/api/sales/tax-rates')) {
    return {
      items: [
        { id: 'tax-rate-1', name: 'Standard', code: 'STD', rate: 23, is_default: true },
      ],
    }
  }
  return { items: [] }
}

describe('LineItemDialog shipped-line lock (issue #5248)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    capturedFields = []
    capturedSubmit = null
    capturedLookupProps = []
    mockApiCall.mockImplementation(async (url: string) => ({
      ok: true,
      result: catalogResponses(url),
    }))
    mockUpdateCrud.mockResolvedValue({ ok: true })
    mockCreateCrud.mockResolvedValue({ ok: true })
  })

  it('explains why the line is locked with its own informational copy', async () => {
    renderDialog()
    expect(
      await screen.findByText(
        'Pricing is locked on this line because it already has shipped items. You can still edit the name and quantity.',
      ),
    ).toBeTruthy()
  })

  it('renders the effective price as a read-only value instead of an interactive lookup', async () => {
    renderDialog()
    const priceField = await screen.findByTestId('field-priceId')
    const priceInput = priceField.querySelector('input') as HTMLInputElement | null
    expect(priceInput).toBeTruthy()
    expect(priceInput?.readOnly).toBe(true)
    expect(priceInput?.disabled).toBe(true)
    // The gross unit price of the shipped line, labelled with its price mode so
    // the amount is self-describing rather than a bare number. The decimal
    // separator follows the runtime locale, so it is matched loosely.
    expect(priceInput?.value).toMatch(/110[.,]70/)
    expect(priceInput?.value).toContain('USD')
    expect(priceInput?.value).toContain('Gross')

    // No LookupSelect is rendered for the locked price at all, so its option
    // cards and "Clear selection" button cannot be reached.
    expect(
      capturedLookupProps.some((props) => props.searchPlaceholder === 'Select price'),
    ).toBe(false)
  })

  it('disables every pricing control the server rejects on a shipped line', async () => {
    renderDialog()
    await screen.findByTestId('field-priceId')

    const unitPriceInput = screen
      .getByTestId('field-unitPrice')
      .querySelector('input') as HTMLInputElement
    expect(unitPriceInput.disabled).toBe(true)

    const priceModeTrigger = screen
      .getByTestId('field-unitPrice')
      .querySelector('button[role="combobox"]') as HTMLButtonElement
    expect(priceModeTrigger.disabled).toBe(true)

    const taxRateTrigger = screen
      .getByTestId('field-taxRateId')
      .querySelector('button[role="combobox"]') as HTMLButtonElement
    expect(taxRateTrigger.disabled).toBe(true)

    const quantityUnitTrigger = screen
      .getByTestId('field-quantityUnit')
      .querySelector('button[role="combobox"]') as HTMLButtonElement
    expect(quantityUnitTrigger.disabled).toBe(true)
  })

  it('submits a name-only edit without any field the shipped-line guard rejects', async () => {
    renderDialog()
    await waitFor(() => expect(capturedSubmit).toBeTruthy())

    await act(async () => {
      await capturedSubmit?.({
        lineMode: 'catalog',
        productId: 'product-1',
        variantId: 'variant-1',
        quantity: '4',
        quantityUnit: 'pcs',
        priceId: 'price-1',
        priceMode: 'gross',
        unitPrice: '110.7',
        taxRate: 23,
        taxRateId: 'tax-rate-1',
        name: 'Renamed line',
        currencyCode: 'USD',
      })
    })

    expect(mockUpdateCrud).toHaveBeenCalledTimes(1)
    const [resourcePath, payload] = mockUpdateCrud.mock.calls[0]
    expect(resourcePath).toBe('sales/order-lines')

    const definedPayload = Object.fromEntries(
      Object.entries(payload as Record<string, unknown>).filter(
        ([, value]) => value !== undefined,
      ),
    )
    expect(definedPayload).toEqual({
      id: 'line-1',
      orderId: 'order-1',
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      quantity: 4,
      currencyCode: 'USD',
      name: 'Renamed line',
    })
  })

  it('leaves an unshipped line its full price list by never injecting lookup options', async () => {
    renderDialog({ shippedQuantity: 0 })
    await screen.findByTestId('field-priceId')

    // The most recent render, i.e. after the dialog has bootstrapped the line's
    // stored price — otherwise a still-empty selection would pass vacuously.
    const priceLookup = [...capturedLookupProps]
      .reverse()
      .find((props) => props.searchPlaceholder === 'Select price')
    expect(priceLookup).toBeTruthy()
    expect(priceLookup.value).toBe('price-1')
    // A non-undefined `options` array makes LookupSelect replace its fetched
    // items on every parent render, which collapsed the price list to the
    // current selection until the user typed in the price search box.
    expect(priceLookup.options).toBeUndefined()
  })
})
