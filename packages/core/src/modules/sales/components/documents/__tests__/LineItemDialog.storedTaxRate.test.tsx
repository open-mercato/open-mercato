/**
 * @jest-environment jsdom
 *
 * UI-level regression test for issue #6461.
 *
 * A line created through the API carries `tax_rate = 23` but no tax-rate id in its
 * metadata. Opening it in the line editor used to preselect the 0 % class, and saving a
 * quantity-only edit sent `taxRate: 0` with `unitPriceNet = unitPriceGross`, so the line
 * silently lost its tax and its net price jumped to the gross value.
 *
 * The trigger is Radix Select emitting `onValueChange("")` while the dialog mounts — no
 * user ever picks an empty class, since a Radix item cannot carry an empty value. The tax
 * class handler read that as a selection and coerced the missing rate to 0. The select
 * mock below forwards a native `change` to `onValueChange`, which is how the suite
 * reproduces that emission.
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
const mockUpdateCrud = jest.fn()
const mockCreateCrud = jest.fn()

let capturedSubmit: SubmitHandler | null = null
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

// Radix keeps a hidden native <select> in sync with `value` and forwards its `change`
// events to `onValueChange`; this mock exposes the same path so a test can replay the
// empty emission Radix produces on mount.
jest.mock('@open-mercato/ui/primitives/select', () => {
  type SelectProps = ChildrenProps & {
    value?: string
    onValueChange?: (value: string) => void
  }
  return {
    __esModule: true,
    Select: ({ children, value, onValueChange }: SelectProps) => (
      <div>
        <select
          data-testid="native-select"
          value={value ?? ''}
          onChange={(event) => onValueChange?.(event.target.value)}
        >
          <option value="" />
          {value ? <option value={value}>{value}</option> : null}
        </select>
        {children}
      </div>
    ),
    SelectTrigger: ({ children }: ChildrenProps) => (
      <div data-testid="select-trigger">{children}</div>
    ),
    SelectValue: ({
      children,
      placeholder,
    }: ChildrenProps & { placeholder?: React.ReactNode }) => (
      <span>{children ?? placeholder ?? ''}</span>
    ),
    SelectContent: () => null,
    SelectItem: () => null,
  }
})

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

const translate = (key: string, fallback?: unknown) =>
  typeof fallback === 'string' ? fallback : key
const organizationScope = { organizationId: 'org-1', tenantId: 'tenant-1' }

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => translate,
  useLocale: () => 'pl-PL',
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
import type { SalesLineRecord } from '../lineItemTypes'

const buildApiLine = (overrides: Partial<SalesLineRecord> = {}): SalesLineRecord => ({
  id: 'line-1',
  name: 'chair',
  productId: null,
  productVariantId: null,
  quantity: 4,
  quantityUnit: null,
  normalizedQuantity: 4,
  normalizedUnit: null,
  currencyCode: 'PLN',
  unitPriceNet: 50,
  unitPriceGross: 61.5,
  taxRate: 23,
  totalNet: 200,
  totalGross: 246,
  priceMode: 'gross',
  uomSnapshot: null,
  metadata: null,
  catalogSnapshot: null,
  ...overrides,
})

const TAX_RATES = [
  { id: 'rate-23', name: '23% VAT', code: 'vat-23', rate: '23.0000', is_default: true },
  { id: 'rate-0', name: '0% VAT', code: 'vat-0', rate: '0.0000', is_default: false },
]

const STANDARD_LABEL = '23% VAT • VAT-23 • 23%'
const ZERO_LABEL = '0% VAT • VAT-0 • 0%'

const renderDialog = (initialLine: SalesLineRecord | null) => (
  <LineItemDialog
    open
    kind="order"
    documentId="order-1"
    currencyCode="PLN"
    organizationId="org-1"
    tenantId="tenant-1"
    initialLine={initialLine}
    shippedQuantity={0}
    shippedQuantityResolved
    onOpenChange={() => {}}
    onSaved={async () => {}}
  />
)

const taxField = () => screen.getByTestId('field-taxRateId')

const replayEmptyRadixEmission = () => {
  const nativeSelect = taxField().querySelector('select')
  if (!nativeSelect) throw new Error('[internal] tax class select not rendered')
  fireEvent.change(nativeSelect, { target: { value: '' } })
}

const submitWithQuantity = async (quantity: string) => {
  await act(async () => {
    await capturedSubmit?.({ ...formValues, quantity })
  })
  expect(mockUpdateCrud).toHaveBeenCalledTimes(1)
  const [resourcePath, payload] = mockUpdateCrud.mock.calls[0] as [string, FormValues]
  expect(resourcePath).toBe('sales/order-lines')
  return payload
}

describe('LineItemDialog keeps the stored tax rate of an API-created line (issue #6461)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    capturedSubmit = null
    formValues = {}
    mockApiCall.mockImplementation(async (url: string) => ({
      ok: true,
      result: { items: url.startsWith('/api/sales/tax-rates') ? TAX_RATES : [] },
    }))
    mockUpdateCrud.mockResolvedValue({ ok: true })
    mockCreateCrud.mockResolvedValue({ ok: true })
  })

  it('shows the class matching the stored rate even after an empty select emission', async () => {
    render(renderDialog(buildApiLine()))
    await waitFor(() => expect(taxField().textContent).toContain(STANDARD_LABEL))

    act(() => replayEmptyRadixEmission())

    expect(taxField().textContent).toContain(STANDARD_LABEL)
    expect(taxField().textContent).not.toContain(ZERO_LABEL)
    expect(formValues.taxRate).toBe(23)
  })

  it('saves a quantity-only edit with the stored rate and net price', async () => {
    render(renderDialog(buildApiLine()))
    await waitFor(() => expect(taxField().textContent).toContain(STANDARD_LABEL))
    act(() => replayEmptyRadixEmission())

    const payload = await submitWithQuantity('5')

    expect(payload).toMatchObject({
      quantity: 5,
      priceMode: 'gross',
      taxRate: 23,
      unitPriceGross: 61.5,
      totalGrossAmount: 307.5,
    })
    expect(payload.unitPriceNet).toBeCloseTo(50, 6)
    expect(payload.totalNetAmount).toBeCloseTo(250, 6)
  })

  it('does not preselect the default class for a stored rate that matches no class', async () => {
    const view = render(renderDialog(null))
    await waitFor(() => expect(taxField().textContent).toContain('No tax class selected'))

    view.rerender(
      renderDialog(
        buildApiLine({ id: 'line-2', taxRate: 7, unitPriceNet: 100, unitPriceGross: 107 }),
      ),
    )
    await waitFor(() => expect(formValues.taxRate).toBe(7))

    expect(formValues.taxRateId).toBeNull()
    expect(taxField().textContent).not.toContain(STANDARD_LABEL)

    const payload = await submitWithQuantity('2')
    expect(payload.taxRate).toBe(7)
    expect(payload.metadata).not.toHaveProperty('taxRateId')
    expect(payload.unitPriceNet).toBeCloseTo(100, 6)
  })
})
