/**
 * @jest-environment jsdom
 *
 * UI-level regression test for issue #5828.
 *
 * The payment amount field is a hand-rolled text input, so the submit handler parsed the raw
 * string with `Number()`, which only accepts `.` as a decimal separator. Under a comma-decimal
 * application locale (Polish here), typing `110,70` produced `NaN`, which the `<= 0` guard
 * misreported as "Enter a positive amount." — the same defect class #5827 fixed for
 * `CrudForm`/`InjectedField`/`LineItemDialog` while deliberately leaving this dialog alone.
 *
 * The locale is pinned to `pl-PL` rather than left to the runner: CI resolves `C.UTF-8` to an
 * en-US ICU default, so an `en-US` pin passes on the buggy implementation too and a revert of
 * the locale-aware parse would stay green.
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

jest.mock('@open-mercato/ui/primitives/input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}))

jest.mock('@open-mercato/ui/primitives/spinner', () => ({
  Spinner: () => null,
}))

jest.mock('@open-mercato/ui/backend/inputs', () => ({
  LookupSelect: () => null,
}))

jest.mock('#generated/entities.ids.generated', () => ({
  E: { sales: { sales_payment: 'sales:sales_payment' } },
}))

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

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => translate,
  useLocale: () => 'pl-PL',
}))

jest.mock('lucide-react', () => {
  const IconStub = () => null
  return {
    __esModule: true,
    CreditCard: IconStub,
  }
})

import { PaymentDialog } from '../PaymentDialog'

const renderDialog = () =>
  render(
    <PaymentDialog
      open
      mode="create"
      currencyCode="USD"
      orderId="order-1"
      organizationId="org-1"
      tenantId="tenant-1"
      onOpenChange={() => {}}
    />,
  )

const submitValues = (amount: string): FormValues => ({
  amount,
  paymentMethodId: '',
  paymentReference: '',
  receivedAt: '',
  statusEntryId: '',
  documentStatusEntryId: '',
})

const expectRejection = async (amount: string, message: string) => {
  await act(async () => {
    await expect(capturedSubmit?.(submitValues(amount))).rejects.toThrow(message)
  })
  expect(mockCreateCrud).not.toHaveBeenCalled()
}

describe('PaymentDialog locale decimal separator (issue #5828)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    capturedSubmit = null
    mockApiCall.mockImplementation(async () => ({ ok: true, result: { items: [] } }))
    mockCreateCrud.mockResolvedValue({ ok: true })
    mockUpdateCrud.mockResolvedValue({ ok: true })
  })

  it('accepts the separator the same screen uses to display the value', async () => {
    renderDialog()
    await act(async () => {
      await capturedSubmit?.(submitValues('110,70'))
    })
    expect(mockCreateCrud).toHaveBeenCalledTimes(1)
    const payload = mockCreateCrud.mock.calls[0][1] as FormValues
    expect(payload.amount).toBe(110.7)
  })

  it('still accepts a dot, so the workaround users learned keeps working', async () => {
    renderDialog()
    await act(async () => {
      await capturedSubmit?.(submitValues('110.70'))
    })
    expect(mockCreateCrud).toHaveBeenCalledTimes(1)
    const payload = mockCreateCrud.mock.calls[0][1] as FormValues
    expect(payload.amount).toBe(110.7)
  })

  it('reports an unparseable amount as unparseable rather than as "greater than 0"', async () => {
    renderDialog()
    await expectRejection('abc', 'Enter the amount as a number.')
  })

  it('keeps the "greater than 0" message for a genuinely zero value', async () => {
    renderDialog()
    await expectRejection('0', 'Enter a positive amount.')
  })
})
