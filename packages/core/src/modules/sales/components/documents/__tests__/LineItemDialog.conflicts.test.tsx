/** @jest-environment jsdom */
import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

type FormValues = Record<string, unknown>
type SubmitHandler = (values: FormValues) => Promise<void>
const mockApiCall = jest.fn()
const mockCreateCrud = jest.fn()
const mockUpdateCrud = jest.fn()
const mockHandleConflict = jest.fn()
const mockTriggerEvent = jest.fn()
let mockRequestHeaders: Record<string, string> = {}
const mockWithHeaders = async (headers: Record<string, string>, operation: () => Promise<unknown>) => {
  const previous = mockRequestHeaders
  mockRequestHeaders = { ...previous, ...headers }
  try { return await operation() } finally { mockRequestHeaders = previous }
}
let capturedSubmit: SubmitHandler | null = null

jest.mock('@open-mercato/ui/backend/injection/InjectionSpot', () => ({
  useInjectionSpotEvents: () => ({ triggerEvent: mockTriggerEvent }),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => mockApiCall(...args),
  readScopedApiRequestHeaders: () => ({ ...mockRequestHeaders }),
  withScopedApiRequestHeaders: (headers: Record<string, string>, operation: () => Promise<unknown>) =>
    mockWithHeaders(headers, operation),
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
    CrudForm: ({ formId, resourceKind, resourceId, onSubmit }: {
      formId?: string; resourceKind?: string; resourceId?: string; onSubmit: SubmitHandler
    }) => {
      const [name, setName] = ReactLib.useState('')
      capturedSubmit = onSubmit
      return (
        <form id={formId} onSubmit={(event) => {
          event.preventDefault()
          const submit = async () => {
            const values = customLineValues(name)
            const guard = await mockTriggerEvent('onBeforeSave', values, { formId, resourceKind, resourceId })
            if (!guard.ok) return
            await mockWithHeaders(guard.requestHeaders ?? {}, () => onSubmit(values))
          }
          void submit().catch(() => {})
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
    mockTriggerEvent.mockResolvedValue({ ok: true })
    mockRequestHeaders = {}
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

  it.each(['order', 'quote'] as const)('retries one rejected %s write with the authoritative parent version after Keep Mine', async (kind) => {
    const staleVersion = '2026-11-04T06:00:00.000Z'
    const currentVersion = '2026-11-04T06:01:00.000Z'
    let resolutionArmed = true
    mockTriggerEvent.mockImplementation(async (event: string) => {
      if (event !== 'onBeforeSave') return { ok: true }
      if (!resolutionArmed) return { ok: false, message: 'Record conflict detected' }
      resolutionArmed = false
      return { ok: true, requestHeaders: { 'x-om-record-lock-resolution': 'accept_mine',
        'x-om-record-lock-kind': `sales.${kind}`, 'x-om-record-lock-resource-id': 'doc-1' } }
    })
    const observedHeaders: Record<string, string>[] = []
    mockCreateCrud.mockImplementation(async () => {
      observedHeaders.push({ ...mockRequestHeaders })
      if (mockRequestHeaders['x-om-ext-optimistic-lock-expected-updated-at'] === staleVersion) {
        throw Object.assign(new Error('record_modified'), {
          status: 409,
          body: {
            error: 'record_modified', code: 'optimistic_lock_conflict',
            currentUpdatedAt: currentVersion, expectedUpdatedAt: staleVersion,
          },
        })
      }
      return { ok: true }
    })
    const onOpenChange = jest.fn()
    render(<LineItemDialog open kind={kind} documentId="doc-1" currencyCode="PLN"
      documentUpdatedAt={staleVersion}
      organizationId="org-1" tenantId="tenant-1" onOpenChange={onOpenChange} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Line name' }), { target: { value: 'Karta B' } })
    const form = document.getElementById(`record-lock:sales.${kind}:doc-1`) as HTMLFormElement
    await act(async () => { form.requestSubmit() })
    await waitFor(() => expect(mockCreateCrud).toHaveBeenCalledTimes(2))
    expect(mockTriggerEvent).toHaveBeenCalledTimes(1)
    expect(mockTriggerEvent).toHaveBeenCalledWith('onBeforeSave', expect.any(Object), {
      formId: `record-lock:sales.${kind}:doc-1`, resourceKind: `sales.${kind}`, resourceId: 'doc-1',
    })
    const resolutionHeaders = {
      'x-om-record-lock-resolution': 'accept_mine',
      'x-om-record-lock-kind': `sales.${kind}`,
      'x-om-record-lock-resource-id': 'doc-1',
    }
    expect(observedHeaders).toEqual([staleVersion, currentVersion].map((version) => ({
      ...resolutionHeaders,
      'x-om-ext-optimistic-lock-expected-updated-at': version,
    })))
    expect(mockCreateCrud.mock.calls[1]?.[1]).toEqual(mockCreateCrud.mock.calls[0]?.[1])
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

})
