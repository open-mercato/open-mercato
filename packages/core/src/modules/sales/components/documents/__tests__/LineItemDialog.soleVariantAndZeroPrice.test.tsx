/**
 * @jest-environment jsdom
 *
 * UI-level regression test for issue #6075.
 *
 * Picking a catalog product with exactly one variant used to leave `variantId` null while the
 * variant lookup already showed that variant, so submit failed on a field that looked filled
 * and the variant's tax rate was never applied. Catalog prices of zero were also offered as
 * selectable even though submit rejects a unit price that is not greater than zero.
 */
import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type {
  CrudCustomField,
  CrudCustomFieldRenderProps,
  CrudField,
} from '@open-mercato/ui/backend/CrudForm'

type FormValues = Record<string, unknown>
type SubmitHandler = (values: FormValues) => Promise<void>

const mockApiCall = jest.fn()
const mockCreateCrud = jest.fn()
const mockUpdateCrud = jest.fn()

let capturedSubmit: SubmitHandler | null = null
let mockLatestValues: FormValues = {}

type MockLookupProps = {
  searchPlaceholder?: string
  onChange: (next: string | null) => void
  fetchItems: (query: string) => Promise<Array<{ id: string; title: string }>>
}
const mockLookups = new Map<string, MockLookupProps>()

jest.mock('@open-mercato/ui/backend/inputs', () => ({
  LookupSelect: (props: MockLookupProps) => {
    if (props.searchPlaceholder) mockLookups.set(props.searchPlaceholder, props)
    return null
  },
}))

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

jest.mock('@open-mercato/ui/primitives/select', () => {
  type TriggerProps = ChildrenProps & React.ButtonHTMLAttributes<HTMLButtonElement>
  return {
    __esModule: true,
    Select: ({ children }: ChildrenProps) => <div>{children}</div>,
    SelectTrigger: ({ children, ...props }: TriggerProps) => (
      <button type="button" role="combobox" {...props}>
        {children}
      </button>
    ),
    SelectValue: ({ placeholder }: { placeholder?: React.ReactNode }) => (
      <span>{placeholder ?? ''}</span>
    ),
    SelectContent: ({ children }: ChildrenProps) => <div>{children}</div>,
    SelectItem: ({ children }: ChildrenProps) => <div>{children}</div>,
  }
})

// The dialog's own submit handler is what this test is about, so the form host is
// reduced to a harness that captures `onSubmit` and renders the custom fields.
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

    capturedSubmit = onSubmit
    mockLatestValues = values

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

const translate = (key: string, fallback?: unknown, params?: Record<string, unknown>) => {
  const base = typeof fallback === 'string' ? fallback : key
  if (!params) return base
  return Object.entries(params).reduce(
    (acc, [name, value]) => acc.split(`{{${name}}}`).join(String(value)),
    base,
  )
}
const organizationScope = { organizationId: 'org-1', tenantId: 'tenant-1' }

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => translate,
  useLocale: () => 'en-US',
}))

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeDetail: () => organizationScope,
}))

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

type PriceFixture = {
  id: string
  unit_price_net: number | null
  unit_price_gross: number | null
  display_mode: 'including-tax' | 'excluding-tax'
}

let variantFixtures: Array<Record<string, unknown>> = []
let priceFixtures: PriceFixture[] = []
let productFixture: Record<string, unknown> = {}
let variantsGate: Promise<void> | null = null

const routeApiCall = async (url: string) => {
  if (url.startsWith('/api/catalog/variants')) {
    if (variantsGate) await variantsGate
    return { ok: true, result: { items: variantFixtures } }
  }
  if (url.startsWith('/api/catalog/prices')) {
    const variantId = new URLSearchParams(url.split('?')[1]).get('variantId')
    const items = priceFixtures.map((price) => ({ ...price, currency_code: 'USD', variant_id: variantId }))
    return { ok: true, result: { items } }
  }
  if (url.startsWith('/api/catalog/products?')) {
    return {
      ok: true,
      result: { items: [{ id: 'prod-1', title: 'Hustawka Rybnik', sku: 'P-1', ...productFixture }] },
    }
  }
  return { ok: true, result: { items: [] } }
}

const priceRequestParams = () =>
  mockApiCall.mock.calls
    .map(([url]) => String(url))
    .filter((url) => url.startsWith('/api/catalog/prices'))
    .map((url) => new URLSearchParams(url.split('?')[1]))

const priceRequests = () => priceRequestParams().map((params) => params.get('variantId'))

const lookup = (placeholder: string) => {
  const props = mockLookups.get(placeholder)
  if (!props) throw new Error(`[internal] lookup "${placeholder}" not rendered`)
  return props
}

const renderDialog = () =>
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

const pickProduct = async () => {
  await act(async () => {
    await lookup('Search product').fetchItems('Hus')
  })
  await act(async () => {
    lookup('Search product').onChange('prod-1')
  })
}

const selectProduct = async () => {
  await pickProduct()
  await waitFor(() => expect(priceRequests().length).toBeGreaterThan(0))
}

describe('LineItemDialog catalog selection (issue #6075)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockLookups.clear()
    capturedSubmit = null
    mockLatestValues = {}
    variantFixtures = []
    priceFixtures = []
    productFixture = {}
    variantsGate = null
    mockApiCall.mockImplementation((url: string) => routeApiCall(url))
    mockCreateCrud.mockResolvedValue({ ok: true })
    mockUpdateCrud.mockResolvedValue({ ok: true })
  })

  it('commits the sole variant of a product, with its tax rate, snapshot and variant-scoped prices', async () => {
    variantFixtures = [{ id: 'var-1', name: '4024001', sku: '4024001', tax_rate: 23 }]
    renderDialog()
    await selectProduct()

    await waitFor(() => expect(mockLatestValues.variantId).toBe('var-1'))
    expect(mockLatestValues.taxRate).toBe(23)
    expect(mockLatestValues.catalogSnapshot).toEqual(
      expect.objectContaining({
        product: expect.objectContaining({ id: 'prod-1' }),
        variant: expect.objectContaining({ id: 'var-1', sku: '4024001' }),
      }),
    )
    expect(priceRequests()).toEqual(['var-1'])
  })

  it('leaves the variant for the user to choose when the product has several', async () => {
    variantFixtures = [
      { id: 'var-1', name: 'Red', sku: 'R' },
      { id: 'var-2', name: 'Blue', sku: 'B' },
    ]
    renderDialog()
    await selectProduct()

    expect(mockLatestValues.variantId).toBeNull()
    expect(priceRequests()).toEqual([null])
  })

  it('offers only catalog prices with a positive amount', async () => {
    variantFixtures = [{ id: 'var-1', name: '4024001', sku: '4024001' }]
    priceFixtures = [
      { id: 'price-zero', unit_price_net: 0, unit_price_gross: 0, display_mode: 'including-tax' },
      { id: 'price-net', unit_price_net: 10, unit_price_gross: null, display_mode: 'excluding-tax' },
      { id: 'price-gross', unit_price_net: null, unit_price_gross: 12.3, display_mode: 'including-tax' },
      { id: 'price-gross-zero', unit_price_net: 10, unit_price_gross: 0, display_mode: 'including-tax' },
    ]
    renderDialog()
    await selectProduct()
    await waitFor(() => expect(mockLatestValues.variantId).toBe('var-1'))

    let offered: Array<{ id: string }> = []
    await act(async () => {
      offered = await lookup('Select price').fetchItems('')
    })
    expect(offered.map((item) => item.id)).toEqual(['price-net', 'price-gross'])

    await act(async () => {
      lookup('Select price').onChange('price-net')
    })
    expect(mockLatestValues.priceId).toBe('price-net')
    expect(mockLatestValues.priceMode).toBe('net')
    expect(mockLatestValues.unitPrice).toBe('10')
  })

  it('keeps a zero-only catalog price out of the options so the line stays in manual-price mode', async () => {
    variantFixtures = [{ id: 'var-1', name: '4024001', sku: '4024001' }]
    priceFixtures = [
      { id: 'price-zero', unit_price_net: 0, unit_price_gross: 0, display_mode: 'including-tax' },
    ]
    renderDialog()
    await selectProduct()
    await waitFor(() => expect(mockLatestValues.variantId).toBe('var-1'))

    let offered: Array<{ id: string }> = []
    await act(async () => {
      offered = await lookup('Select price').fetchItems('')
    })
    expect(offered).toEqual([])
  })

  it('refreshes variant prices with the default sales quantity the product just applied', async () => {
    productFixture = { default_sales_unit_quantity: 6 }
    variantFixtures = [{ id: 'var-1', name: '4024001', sku: '4024001' }]
    renderDialog()
    await selectProduct()
    await waitFor(() => expect(mockLatestValues.variantId).toBe('var-1'))

    expect(mockLatestValues.quantity).toBe('6')
    expect(priceRequestParams().map((params) => params.get('quantity'))).toEqual(['6'])
  })

  it('ignores a variant response that arrives after the user left the product', async () => {
    let releaseVariants: () => void = () => {}
    variantsGate = new Promise<void>((resolve) => {
      releaseVariants = resolve
    })
    variantFixtures = [{ id: 'var-1', name: '4024001', sku: '4024001' }]
    renderDialog()
    await pickProduct()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Custom line' }))
    })
    await act(async () => {
      releaseVariants()
      await variantsGate
    })

    expect(mockLatestValues.variantId).toBeNull()
    expect(priceRequests()).toEqual([])
  })
})
