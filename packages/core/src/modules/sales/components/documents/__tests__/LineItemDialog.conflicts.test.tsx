/** @jest-environment jsdom */
import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

type FormValues = Record<string, unknown>
type SubmitHandler = (values: FormValues) => Promise<void>
const mockApiCall = jest.fn()
const mockCreateCrud = jest.fn()
const mockUpdateCrud = jest.fn()
const mockHandleConflict = jest.fn()
let capturedSubmit: SubmitHandler | null = null

jest.mock('@open-mercato/ui/backend/injection/InjectionSpot', () => ({
  useInjectionSpotEvents: () => ({ triggerEvent: async () => ({ ok: true }) }),
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
  handleSectionMutationError: (...args: unknown[]) => mockHandleConflict(...args),
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

jest.mock('@open-mercato/ui/backend/CrudForm', () => {
  const ReactLib = require('react') as typeof import('react')
  return {
    CrudForm: ({ formId, onSubmit }: { formId?: string; onSubmit: SubmitHandler }) => {
      const [name, setName] = ReactLib.useState('')
      capturedSubmit = onSubmit
      return (
        <form id={formId} onSubmit={(event) => {
          event.preventDefault()
          void onSubmit(customLineValues(name)).catch(() => {})
        }}>
          <input aria-label="Line name" value={name} onChange={(event) => setName(event.target.value)} />
        </form>
      )
    },
  }
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


const customLineValues = (name: string): FormValues => ({
  lineMode: 'custom', name, quantity: '1', quantityUnit: 'pcs',
  priceMode: 'gross', unitPrice: '70', taxRate: 23, currencyCode: 'PLN',
})

describe('LineItemDialog conflict recovery', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockApiCall.mockResolvedValue({ ok: true, result: { items: [] } })
    mockHandleConflict.mockReturnValue(true)
  })

  it.each(['order', 'quote'] as const)('keeps the %s draft through repeated conflicts and closes only on success', async (kind) => {
    const conflict = Object.assign(new Error('record_modified'), { status: 409 })
    mockCreateCrud.mockRejectedValueOnce(conflict).mockRejectedValueOnce(conflict).mockResolvedValue({ ok: true })
    const onOpenChange = jest.fn()
    const onSaved = jest.fn(async () => {})
    render(<LineItemDialog open kind={kind} documentId="doc-1" currencyCode="PLN"
      organizationId="org-1" tenantId="tenant-1" onOpenChange={onOpenChange} onSaved={onSaved} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Line name' }), { target: { value: 'Karta B' } })
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await act(async () => {
        await expect(capturedSubmit?.(customLineValues('Karta B'))).rejects.toBe(conflict)
      })
      expect(onOpenChange).not.toHaveBeenCalled()
      expect(screen.getByRole('textbox', { name: 'Line name' })).toHaveValue('Karta B')
    }
    const form = document.getElementById(`record-lock:sales.${kind}:doc-1`)
    expect(form).toBeInstanceOf(HTMLFormElement)
    await act(async () => { (form as HTMLFormElement).requestSubmit() })
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(mockCreateCrud).toHaveBeenCalledTimes(3)
    const payloads = mockCreateCrud.mock.calls.map((call: unknown[]) => call[1])
    expect(payloads[1]).toEqual(payloads[0])
    expect(payloads[2]).toEqual(payloads[0])
  })
})
