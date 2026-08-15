/**
 * @jest-environment jsdom
 *
 * UI-level regression test for issue #5248.
 *
 * A sales order line that already has shipped quantities must present its
 * pricing controls as genuinely read-only: the effective price is visible, no
 * control accepts input, and a name-only edit submits without any of the fields
 * the server guard rejects. Only the pure payload helper was covered before, so
 * none of the ways this can regress in the dialog itself was pinned:
 *
 *  1. the price control rendering as an interactive `LookupSelect` whose
 *     `disabled` prop only disabled the search box while the option cards and
 *     the "Clear selection" button stayed live,
 *  2. an unshipped line receiving an injected single-entry `options` array,
 *     which resets `LookupSelect`'s item list on every parent render and
 *     collapses the price list to the current selection, and
 *  3. a pending or failed shipments load reading as "nothing shipped", which
 *     silently unlocks a line that the server will still reject.
 *
 * The real `LookupSelect` is used throughout — mocking it away would leave the
 * product and variant rows, their clear actions and their keyboard paths
 * untested, which is exactly where a shipped line could still be mutated. The
 * form host is a harness rather than the real `CrudForm`, but a stateful one:
 * it holds the form values in React state so an interaction that manages to
 * mutate the line is observable through `formValues`.
 */
import * as React from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type {
  CrudCustomField,
  CrudCustomFieldRenderProps,
  CrudField,
} from '@open-mercato/ui/backend/CrudForm'

type FormValues = Record<string, unknown>
type SubmitHandler = (values: FormValues) => Promise<void>

const mockApiCall = jest.fn()
const mockUpdateCrud = jest.fn()
const mockCreateCrud = jest.fn()

let capturedFields: CrudField[] = []
let capturedSubmit: SubmitHandler | null = null
// Mirror of the harness form state, so a test can assert that an interaction
// with a locked control changed nothing.
let formValues: FormValues = {}

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => mockApiCall(...args),
  withScopedApiRequestHeaders: async (
    _headers: unknown,
    operation: () => Promise<unknown>,
  ) => operation(),
}))

jest.mock('@open-mercato/ui/backend/utils/optimisticLock', () => ({
  buildOptimisticLockHeader: () => ({}),
}))

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  createCrud: (...args: unknown[]) => mockCreateCrud(...args),
  updateCrud: (...args: unknown[]) => mockUpdateCrud(...args),
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

type ChildrenProps = { children?: React.ReactNode }

jest.mock('@open-mercato/ui/primitives/dialog', () => ({
  Dialog: ({ children }: ChildrenProps) => <div>{children}</div>,
  DialogContent: ({ children }: ChildrenProps) => <div>{children}</div>,
  DialogHeader: ({ children }: ChildrenProps) => <div>{children}</div>,
  DialogTitle: ({ children }: ChildrenProps) => <h3>{children}</h3>,
}))

jest.mock('@open-mercato/ui/primitives/alert', () => ({
  Alert: ({ children }: ChildrenProps) => <div role="status">{children}</div>,
  AlertDescription: ({ children }: ChildrenProps) => <div>{children}</div>,
  AlertTitle: ({ children }: ChildrenProps) => <strong>{children}</strong>,
}))

jest.mock('@open-mercato/ui/primitives/input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}))

// Mirrors the real primitive closely enough for the assertions that matter: the
// wrapper owns `disabled` and the trigger is what a user would click, so the
// trigger has to end up disabled for the control to be genuinely locked.
jest.mock('@open-mercato/ui/primitives/select', () => {
  const ReactLib = require('react') as typeof import('react')
  const DisabledContext = ReactLib.createContext(false)
  type SelectProps = ChildrenProps & { disabled?: boolean }
  type TriggerProps = ChildrenProps & React.ButtonHTMLAttributes<HTMLButtonElement>
  return {
    __esModule: true,
    Select: ({ children, disabled }: SelectProps) => (
      <DisabledContext.Provider value={Boolean(disabled)}>
        <div>{children}</div>
      </DisabledContext.Provider>
    ),
    SelectTrigger: ({ children, ...props }: TriggerProps) => {
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
    SelectValue: ({ placeholder }: { placeholder?: React.ReactNode }) => (
      <span>{placeholder ?? ''}</span>
    ),
    SelectContent: ({ children }: ChildrenProps) => <div>{children}</div>,
    SelectItem: ({ children }: ChildrenProps) => <div>{children}</div>,
  }
})

// The dialog's own field components are what this test is about, so the form
// host is reduced to a harness. It keeps real state: `setValue`/`setFormValue`
// write through, which is what lets the locked-control tests below prove that
// nothing changed.
jest.mock('@open-mercato/ui/backend/CrudForm', () => {
  const ReactLib = require('react') as typeof import('react')
  type HarnessProps = {
    fields?: CrudField[]
    initialValues?: FormValues
    onSubmit: SubmitHandler
  }
  const isCustomField = (field: CrudField): field is CrudCustomField =>
    field.type === 'custom' && typeof field.component === 'function'

  const CrudFormHarness = ({ fields = [], initialValues = {}, onSubmit }: HarnessProps) => {
    const [values, setValues] = ReactLib.useState<FormValues>(initialValues)
    ReactLib.useEffect(() => {
      setValues(initialValues)
    }, [initialValues])

    capturedFields = fields
    capturedSubmit = onSubmit
    formValues = values

    const setFormValue = ReactLib.useCallback((id: string, next: unknown) => {
      setValues((current) => ({ ...current, [id]: next }))
    }, [])

    return (
      <form>
        {fields.filter(isCustomField).map((field) => {
          const renderProps: CrudCustomFieldRenderProps = {
            id: field.id,
            value: values[field.id],
            values,
            setValue: (next: unknown) => setFormValue(field.id, next),
            setFormValue,
          }
          return (
            <div key={field.id} data-testid={`field-${field.id}`}>
              {field.component(renderProps)}
            </div>
          )
        })}
      </form>
    )
  }

  return { __esModule: true, CrudForm: CrudFormHarness }
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

// Icons carry no behavior; the set covers both the dialog and the real
// LookupSelect this suite deliberately does not mock.
jest.mock('lucide-react', () => {
  const IconStub = () => null
  return {
    __esModule: true,
    Check: IconStub,
    DollarSign: IconStub,
    Loader2: IconStub,
    Search: IconStub,
    Settings: IconStub,
    X: IconStub,
  }
})

jest.mock('@open-mercato/core/modules/dictionaries/components/dictionaryAppearance', () => ({
  DictionaryValue: () => null,
  renderDictionaryIcon: () => null,
  renderDictionaryColor: () => null,
}))

import { LineItemDialog } from '../LineItemDialog'
import type { SalesLineRecord } from '../lineItemTypes'
import { formatMoney } from '../lineItemUtils'

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

type DialogOverrides = {
  shippedQuantity?: number
  shippedQuantityResolved?: boolean
}

const renderDialog = (props: DialogOverrides = {}) =>
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
  // below could not tell a missing price list from a missing selection.
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

const LOCKED_COPY =
  'Pricing is locked on this line because it already has shipped items. You can still edit the name and quantity.'
const PENDING_COPY =
  "Pricing is locked until this order's shipments have been read. Reopen the order to try again — you can still edit the name and quantity."

function getField(id: string): HTMLElement {
  return screen.getByTestId(`field-${id}`)
}

function getInputIn(id: string): HTMLInputElement {
  const input = getField(id).querySelector('input')
  if (!input) throw new Error(`[internal] no input rendered for field ${id}`)
  return input
}

function getComboboxIn(id: string): HTMLButtonElement {
  const trigger = getField(id).querySelector('button[role="combobox"]')
  if (!trigger) throw new Error(`[internal] no combobox rendered for field ${id}`)
  return trigger as HTMLButtonElement
}

const submitNameOnlyEdit = async () => {
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
  const [resourcePath, payload] = mockUpdateCrud.mock.calls[0] as [string, FormValues]
  expect(resourcePath).toBe('sales/order-lines')
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined),
  )
}

describe('LineItemDialog shipped-line lock (issue #5248)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    capturedFields = []
    capturedSubmit = null
    formValues = {}
    mockApiCall.mockImplementation(async (url: string) => ({
      ok: true,
      result: catalogResponses(url),
    }))
    mockUpdateCrud.mockResolvedValue({ ok: true })
    mockCreateCrud.mockResolvedValue({ ok: true })
  })

  it('explains why the line is locked with its own informational copy', async () => {
    renderDialog()
    expect(await screen.findByText(LOCKED_COPY)).toBeTruthy()
  })

  it('renders the effective price as a read-only value instead of an interactive lookup', async () => {
    renderDialog()
    const priceInput = await waitFor(() => getInputIn('priceId'))

    expect(priceInput.readOnly).toBe(true)
    expect(priceInput.disabled).toBe(true)
    // Asserted through the same formatter the dialog renders with, so the
    // expectation follows the runtime locale instead of pinning one currency
    // presentation (symbol vs ISO code) that only holds under some locales.
    expect(priceInput.value).toBe(`${formatMoney(110.7, 'USD')} — Gross`)
    // The DS forbids a middot as a copy separator, so the amount and its price
    // mode are joined with an em dash.
    expect(priceInput.value).not.toContain('·')
    // The price kind stays visible as supporting detail.
    expect(within(getField('priceId')).getByText('Retail')).toBeTruthy()

    // No price search box is rendered at all, so its option cards and
    // "Clear selection" button cannot be reached.
    expect(
      getField('priceId').querySelector('input[placeholder="Select price"]'),
    ).toBeNull()
  })

  it('disables every pricing control the server rejects on a shipped line', async () => {
    renderDialog()
    await waitFor(() => getInputIn('priceId'))

    expect(getInputIn('unitPrice').disabled).toBe(true)
    expect(getComboboxIn('unitPrice').disabled).toBe(true)
    expect(getComboboxIn('taxRateId').disabled).toBe(true)
    expect(getComboboxIn('quantityUnit').disabled).toBe(true)
  })

  it.each(['productId', 'variantId'])(
    'keeps the shipped line unchanged when the %s row is clicked or activated by keyboard',
    async (fieldId) => {
      renderDialog()
      const field = await waitFor(() => {
        const candidate = getField(fieldId)
        if (!within(candidate).queryAllByRole('option').length) {
          throw new Error(`[internal] ${fieldId} options not rendered yet`)
        }
        return candidate
      })

      const before = { ...formValues }
      const options = within(field).getAllByRole('option')
      expect(options.length).toBeGreaterThan(0)

      for (const option of options) {
        // A locked row is out of the tab order and announces itself as disabled,
        // so neither pointer nor keyboard reaches its selection handler.
        expect(option).toHaveAttribute('tabindex', '-1')
        expect(option).toHaveAttribute('aria-disabled', 'true')
        fireEvent.click(option)
        fireEvent.keyDown(option, { key: 'Enter' })
        fireEvent.keyDown(option, { key: ' ' })
      }

      // The search box is inert too, including its ArrowDown + Enter path.
      const search = field.querySelector('input') as HTMLInputElement
      expect(search.disabled).toBe(true)
      fireEvent.keyDown(search, { key: 'ArrowDown' })
      fireEvent.keyDown(search, { key: 'Enter' })

      // And the escape hatch that used to survive `disabled` entirely.
      expect(within(field).queryByRole('button', { name: /clear selection/i })).toBeNull()

      expect(formValues).toEqual(before)
    },
  )

  it('submits a name-only edit without any field the shipped-line guard rejects', async () => {
    renderDialog()
    await waitFor(() => expect(capturedSubmit).toBeTruthy())

    expect(await submitNameOnlyEdit()).toEqual({
      id: 'line-1',
      orderId: 'order-1',
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      quantity: 4,
      currencyCode: 'USD',
      name: 'Renamed line',
    })
  })

  it('locks the line and strips pricing while the shipment state is still unknown', async () => {
    // Nothing shipped *as far as the caller knows* — the shipments load is
    // pending or failed, so the dialog must not infer that the line is free to
    // reprice.
    renderDialog({ shippedQuantity: 0, shippedQuantityResolved: false })

    expect(await screen.findByText(PENDING_COPY)).toBeTruthy()
    const priceInput = await waitFor(() => getInputIn('priceId'))
    expect(priceInput.disabled).toBe(true)
    expect(getInputIn('unitPrice').disabled).toBe(true)

    expect(await submitNameOnlyEdit()).toEqual({
      id: 'line-1',
      orderId: 'order-1',
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      quantity: 4,
      currencyCode: 'USD',
      name: 'Renamed line',
    })
  })

  it('leaves an unshipped line its full price list and its editable controls', async () => {
    renderDialog({ shippedQuantity: 0 })

    // The price list is fetched and rendered as selectable options rather than
    // collapsed to the current selection, and the controls stay live.
    const priceOption = await screen.findByRole('option', {
      name: new RegExp(formatMoney(110.7, 'USD').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    })
    expect(priceOption).not.toHaveAttribute('aria-disabled')
    expect(priceOption).toHaveAttribute('tabindex', '0')
    expect(getInputIn('unitPrice').disabled).toBe(false)
    expect(screen.queryByText(LOCKED_COPY)).toBeNull()
    expect(screen.queryByText(PENDING_COPY)).toBeNull()
  })

  it('exposes the pricing fields through the form contract the dialog declares', async () => {
    renderDialog()
    await waitFor(() => expect(capturedFields.length).toBeGreaterThan(0))

    const fieldIds = capturedFields.map((field) => field.id)
    expect(fieldIds).toEqual(expect.arrayContaining(['priceId', 'unitPrice', 'taxRateId']))
  })
})
