/**
 * @jest-environment jsdom
 *
 * UI-level regression test for issue #5552.
 *
 * The dialog displays money in the application locale, so under Polish a line reads
 * `110,70 USD`. Typing that same `110,70` back into the price field used to be rejected:
 * the submit handler parsed the raw string with `Number()`, which only accepts `.`, and
 * the resulting `NaN` fell into the "must be greater than 0" guard — an error message that
 * described neither what the user did nor what the field wanted.
 *
 * The locale is pinned to `pl-PL` rather than left to the runner: CI resolves `C.UTF-8` to
 * an en-US ICU default, so an `en-US` pin passes on the buggy implementation too and a
 * revert of the locale-aware parse would stay green.
 */
import * as React from 'react'
import { act, render } from '@testing-library/react'
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

// `jest.mock` is hoisted above these declarations and rejects out-of-scope references that
// are not `mock`-prefixed, so the literal is repeated rather than read from TEST_LOCALE.
const TEST_LOCALE = 'pl-PL'

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

const renderDialog = () =>
  render(
    <LineItemDialog
      open
      kind="order"
      documentId="order-1"
      currencyCode="USD"
      organizationId="org-1"
      tenantId="tenant-1"
      onOpenChange={() => {}}
      onSaved={async () => {}}
    />,
  )

// A custom line keeps the fixture free of catalog lookups, so the assertions isolate the
// number-parsing path the issue is about.
const customLineValues = (quantity: string, unitPrice: string): FormValues => ({
  lineMode: 'custom',
  name: 'Custom line',
  quantity,
  quantityUnit: 'pcs',
  priceMode: 'gross',
  unitPrice,
  taxRate: 0,
  currencyCode: 'USD',
})

const submit = async (quantity: string, unitPrice: string) => {
  await act(async () => {
    await capturedSubmit?.(customLineValues(quantity, unitPrice))
  })
  expect(mockCreateCrud).toHaveBeenCalledTimes(1)
  return mockCreateCrud.mock.calls[0][1] as FormValues
}

const expectRejection = async (quantity: string, unitPrice: string, message: string) => {
  await act(async () => {
    await expect(capturedSubmit?.(customLineValues(quantity, unitPrice))).rejects.toThrow(
      message,
    )
  })
  expect(mockCreateCrud).not.toHaveBeenCalled()
}

describe('LineItemDialog locale decimal separator (issue #5552)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    capturedSubmit = null
    mockApiCall.mockImplementation(async () => ({ ok: true, result: { items: [] } }))
    mockCreateCrud.mockResolvedValue({ ok: true })
    mockUpdateCrud.mockResolvedValue({ ok: true })
  })

  it('accepts the separator the same screen uses to display the value', async () => {
    renderDialog()
    const payload = await submit('2,5', '110,70')
    expect(payload.quantity).toBe(2.5)
    expect(payload.unitPriceGross).toBe(110.7)
  })

  it('still accepts a dot, so the workaround users learned keeps working', async () => {
    renderDialog()
    const payload = await submit('2.5', '110.70')
    expect(payload.quantity).toBe(2.5)
    expect(payload.unitPriceGross).toBe(110.7)
  })

  it('reports an unparseable price as unparseable rather than as "greater than 0"', async () => {
    renderDialog()
    const example = new Intl.NumberFormat(TEST_LOCALE, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(110.7)
    await expectRejection(
      '2',
      'abc',
      `Enter the unit price as a number, for example ${example}.`,
    )
  })

  it('reports an unparseable quantity as unparseable rather than as "greater than 0"', async () => {
    renderDialog()
    const example = new Intl.NumberFormat(TEST_LOCALE, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(110.7)
    await expectRejection(
      '1,2,3',
      '110,70',
      `Enter the quantity as a number, for example ${example}.`,
    )
  })

  it('keeps the "greater than 0" message for a genuinely zero or blank value', async () => {
    renderDialog()
    await expectRejection('0', '110,70', 'Quantity must be greater than 0.')
  })
})
