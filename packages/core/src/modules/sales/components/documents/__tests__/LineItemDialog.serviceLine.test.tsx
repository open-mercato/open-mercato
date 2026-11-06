/**
 * @jest-environment jsdom
 *
 * The line dialog's service mode: switching an existing line between Product,
 * Service and Custom sends explicit `null` for the reference it leaves behind
 * (an omitted key would let the server keep the stale product or service), and a
 * new first line never issues a second, client-side write to the document
 * currency — the line upsert already aligns it in the same transaction.
 *
 * Custom mode never sends `kind`, and only clears references when the user
 * switched into it: the server keeps stored values for omitted keys, so a
 * shipping/adjustment line keeps its kind and a line whose catalog product was
 * deleted keeps its stored product and variant ids.
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

// LineItemDialog formats money in the app locale, so the mock pins it rather than letting the
// component fall back to the runner's default (#5105). Without `useLocale` the partial mock returns
// `undefined` for the hook and the dialog throws on render; without pinning it here *and* in the
// expectations below, the assertions would compare a pinned render against a runner-dependent
// expectation and fail outside the runner's locale.
//
// The pin is deliberately a locale CI does *not* default to: CI resolves `C.UTF-8` to an en-US ICU
// default, so an `en-US` pin makes both sides of the comparison identical whether or not the dialog
// threads the locale at all, and a revert of that threading stays green. `pl-PL` formats money
// differently enough (`110,70 USD` vs `$110.70`) that dropping the locale argument fails loudly.
//
// The factory repeats the literal rather than reading `TEST_LOCALE`: `jest.mock` is hoisted above
// these declarations and rejects out-of-scope references that are not `mock`-prefixed, so the two
// must be kept in sync by hand.
const TEST_LOCALE = 'pl-PL'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => translate,
  useLocale: () => 'pl-PL',
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

const productLine: SalesLineRecord = {
  id: 'line-1',
  name: 'Original name',
  productId: 'product-1',
  productVariantId: 'variant-1',
  serviceId: null,
  quantity: 2,
  quantityUnit: null,
  normalizedQuantity: 2,
  normalizedUnit: null,
  currencyCode: 'USD',
  unitPriceNet: 50,
  unitPriceGross: 50,
  taxRate: 0,
  totalNet: 100,
  totalGross: 100,
  priceMode: 'gross',
  uomSnapshot: null,
  metadata: { lineMode: 'product', priceMode: 'gross' },
  catalogSnapshot: null,
}

const serviceValues = (overrides: FormValues = {}): FormValues => ({
  lineMode: 'service',
  productId: null,
  variantId: null,
  serviceId: 'service-1',
  quantity: '2',
  quantityUnit: 'h',
  priceId: null,
  priceMode: 'gross',
  unitPrice: '80',
  taxRate: 0,
  name: 'Implementation workshop',
  currencyCode: 'USD',
  catalogSnapshot: { service: { id: 'service-1', title: 'Implementation workshop' } },
  ...overrides,
})

const customValues = (overrides: FormValues = {}): FormValues =>
  serviceValues({
    lineMode: 'custom',
    serviceId: null,
    quantityUnit: null,
    name: 'Freeform',
    catalogSnapshot: null,
    ...overrides,
  })

const definedKeys = (payload: FormValues): string[] =>
  Object.keys(payload).filter((key) => payload[key] !== undefined)

describe('LineItemDialog service lines', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    capturedFields = []
    capturedSubmit = null
    formValues = {}
    mockApiCall.mockResolvedValue({ ok: true, result: { items: [] } })
    mockUpdateCrud.mockResolvedValue({ ok: true })
    mockCreateCrud.mockResolvedValue({ ok: true })
  })

  it('clears the product and variant when an existing line becomes a service line', async () => {
    render(
      <LineItemDialog
        open
        kind="order"
        documentId="order-1"
        currencyCode="USD"
        organizationId="org-1"
        tenantId="tenant-1"
        initialLine={productLine}
        shippedQuantity={0}
        onOpenChange={() => {}}
        onSaved={async () => {}}
      />,
    )
    await waitFor(() => expect(capturedSubmit).toBeTruthy())

    await act(async () => {
      await capturedSubmit?.(serviceValues())
    })

    expect(mockUpdateCrud).toHaveBeenCalledTimes(1)
    const [resourcePath, payload] = mockUpdateCrud.mock.calls[0] as [string, FormValues]
    expect(resourcePath).toBe('sales/order-lines')
    expect(payload).toMatchObject({
      id: 'line-1',
      kind: 'service',
      serviceId: 'service-1',
      productId: null,
      productVariantId: null,
      quantityUnit: 'h',
      catalogSnapshot: { service: { id: 'service-1', title: 'Implementation workshop' } },
    })
  })

  it('clears the service when a service line becomes a custom line', async () => {
    render(
      <LineItemDialog
        open
        kind="quote"
        documentId="quote-1"
        currencyCode="USD"
        organizationId="org-1"
        tenantId="tenant-1"
        initialLine={{
          ...productLine,
          productId: null,
          productVariantId: null,
          serviceId: 'service-1',
          metadata: { lineMode: 'service', priceMode: 'gross' },
        }}
        onOpenChange={() => {}}
        onSaved={async () => {}}
      />,
    )
    await waitFor(() => expect(capturedSubmit).toBeTruthy())

    await act(async () => {
      await capturedSubmit?.(customValues())
    })

    const [, payload] = mockUpdateCrud.mock.calls[0] as [string, FormValues]
    expect(payload).toMatchObject({ serviceId: null, productId: null, productVariantId: null })
    expect(definedKeys(payload)).not.toContain('kind')
  })

  it('keeps the kind and references of a line that was already custom', async () => {
    render(
      <LineItemDialog
        open
        kind="order"
        documentId="order-1"
        currencyCode="USD"
        organizationId="org-1"
        tenantId="tenant-1"
        initialLine={{
          ...productLine,
          name: 'Express shipping',
          productId: null,
          productVariantId: null,
          metadata: { lineMode: 'custom', customLine: true, priceMode: 'gross' },
        }}
        shippedQuantity={0}
        onOpenChange={() => {}}
        onSaved={async () => {}}
      />,
    )
    await waitFor(() => expect(capturedSubmit).toBeTruthy())

    await act(async () => {
      await capturedSubmit?.(customValues({ name: 'Express shipping' }))
    })

    expect(mockUpdateCrud).toHaveBeenCalledTimes(1)
    const [, payload] = mockUpdateCrud.mock.calls[0] as [string, FormValues]
    const keys = definedKeys(payload)
    expect(keys).not.toContain('kind')
    expect(keys).not.toContain('productId')
    expect(keys).not.toContain('productVariantId')
    expect(keys).not.toContain('serviceId')
  })

  it('keeps the stored product of a line opened as custom because its product was deleted', async () => {
    render(
      <LineItemDialog
        open
        kind="order"
        documentId="order-1"
        currencyCode="USD"
        organizationId="org-1"
        tenantId="tenant-1"
        initialLine={productLine}
        shippedQuantity={0}
        onOpenChange={() => {}}
        onSaved={async () => {}}
      />,
    )
    await waitFor(() =>
      expect(capturedFields.some((field) => field.id === 'deletedCatalogReference')).toBe(true),
    )
    expect(formValues.lineMode).toBe('custom')

    await act(async () => {
      await capturedSubmit?.(
        customValues({ productId: 'product-1', variantId: 'variant-1', name: 'Original name' }),
      )
    })

    expect(mockUpdateCrud).toHaveBeenCalledTimes(1)
    const [, payload] = mockUpdateCrud.mock.calls[0] as [string, FormValues]
    const keys = definedKeys(payload)
    expect(keys).not.toContain('kind')
    expect(keys).not.toContain('productId')
    expect(keys).not.toContain('productVariantId')
    expect(keys).not.toContain('serviceId')
  })

  it('clears the product and variant when a product line is switched to custom', async () => {
    mockApiCall.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/catalog/products?id=')) {
        return { ok: true, result: { items: [{ id: 'product-1', title: 'Widget' }] } }
      }
      if (url.startsWith('/api/catalog/variants?')) {
        return { ok: true, result: { items: [{ id: 'variant-1', name: 'Default' }] } }
      }
      return { ok: true, result: { items: [] } }
    })
    render(
      <LineItemDialog
        open
        kind="order"
        documentId="order-1"
        currencyCode="USD"
        organizationId="org-1"
        tenantId="tenant-1"
        initialLine={productLine}
        shippedQuantity={0}
        onOpenChange={() => {}}
        onSaved={async () => {}}
      />,
    )
    await waitFor(() => expect(capturedSubmit).toBeTruthy())
    await waitFor(() =>
      expect(mockApiCall.mock.calls.some(([url]) => String(url).startsWith('/api/catalog/variants?'))).toBe(true),
    )
    await act(async () => {
      await Promise.resolve()
    })
    expect(capturedFields.some((field) => field.id === 'deletedCatalogReference')).toBe(false)
    expect(formValues.lineMode).toBe('product')

    await act(async () => {
      await capturedSubmit?.(customValues())
    })

    expect(mockUpdateCrud).toHaveBeenCalledTimes(1)
    const [, payload] = mockUpdateCrud.mock.calls[0] as [string, FormValues]
    expect(payload).toMatchObject({ productId: null, productVariantId: null, serviceId: null })
    expect(definedKeys(payload)).not.toContain('kind')
  })

  it('creates the first line without a separate document currency write', async () => {
    render(
      <LineItemDialog
        open
        kind="quote"
        documentId="quote-1"
        currencyCode="USD"
        organizationId="org-1"
        tenantId="tenant-1"
        onOpenChange={() => {}}
        onSaved={async () => {}}
      />,
    )
    await waitFor(() => expect(capturedSubmit).toBeTruthy())

    await act(async () => {
      await capturedSubmit?.(serviceValues({ currencyCode: 'EUR' }))
    })

    expect(mockCreateCrud).toHaveBeenCalledTimes(1)
    const [resourcePath, payload] = mockCreateCrud.mock.calls[0] as [string, FormValues]
    expect(resourcePath).toBe('sales/quote-lines')
    expect(payload).toMatchObject({ kind: 'service', serviceId: 'service-1', currencyCode: 'EUR' })
    expect(mockUpdateCrud).not.toHaveBeenCalled()
  })
})
