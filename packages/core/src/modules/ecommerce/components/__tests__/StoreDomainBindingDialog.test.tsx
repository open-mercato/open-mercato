/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { StoreDomainBindingDialog } from '../StoreDomainBindingDialog'
import type { DomainMappingSummary } from '../../lib/domainMappingSummaries'
import type { DomainBindingRecord } from '../storeDomains'

type CapturedField = { id: string; type: string; options?: Array<{ value: string; label: string }>; description?: string }
type CapturedGroup = { id: string; component?: (ctx: { values: Record<string, unknown> }) => React.ReactNode }
type CapturedForm = {
  fields: CapturedField[]
  groups: CapturedGroup[]
  schema: { safeParse: (value: unknown) => { success: boolean } }
  initialValues: Record<string, unknown>
  optimisticLockUpdatedAt?: string | null
  embedded?: boolean
  onSubmit: (values: { domainMappingId: string; pathPrefix: string; isPrimary: boolean }) => Promise<void>
}

const createCrudMock = jest.fn()
const updateCrudMock = jest.fn()
const flashMock = jest.fn()
const forms: CapturedForm[] = []

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string, params?: Record<string, string>) => {
    const text = fallback ?? key
    return params ? text.replace(/\{(\w+)\}/g, (_match, name: string) => params[name] ?? '') : text
  },
}))

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}))

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  createCrud: (...args: unknown[]) => createCrudMock(...args),
  updateCrud: (...args: unknown[]) => updateCrudMock(...args),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: (...args: unknown[]) => flashMock(...args) }))

jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: (props: CapturedForm) => {
    forms.push(props)
    return <div data-testid="binding-form">{props.groups.map((group) => group.component?.({ values: props.initialValues }))}</div>
  },
}))

const mappings: DomainMappingSummary[] = [
  { id: 'm-active', hostname: 'shop.example.com', status: 'active', lastDnsCheckAt: null, dnsFailureReason: null, tlsFailureReason: null },
  { id: 'm-tls', hostname: 'new.example.com', status: 'tls_failed', lastDnsCheckAt: null, dnsFailureReason: null, tlsFailureReason: 'x' },
]

function existing(overrides: Partial<DomainBindingRecord> = {}): DomainBindingRecord {
  return {
    id: 'b-1',
    storeId: 'store-1',
    domainMappingId: 'm-active',
    pathPrefix: '/de',
    isPrimary: false,
    createdAt: null,
    updatedAt: '2026-10-02T10:00:00.000Z',
    ...overrides,
  }
}

function renderDialog(props: {
  binding?: DomainBindingRecord | null
  bindings?: DomainBindingRecord[]
  mappings?: DomainMappingSummary[]
}) {
  const onSaved = jest.fn().mockResolvedValue(undefined)
  const onOpenChange = jest.fn()
  render(
    <StoreDomainBindingDialog
      open
      onOpenChange={onOpenChange}
      storeId="store-1"
      binding={props.binding ?? null}
      bindings={props.bindings ?? []}
      mappings={props.mappings ?? mappings}
      onSaved={onSaved}
    />,
  )
  const form = forms[forms.length - 1]
  return { form, onSaved, onOpenChange }
}

describe('StoreDomainBindingDialog', () => {
  beforeEach(() => {
    createCrudMock.mockReset().mockResolvedValue({ ok: true })
    updateCrudMock.mockReset().mockResolvedValue({ ok: true })
    flashMock.mockReset()
    forms.length = 0
  })

  it('offers the organization domains with their status and states the limit and the path prefix alternative', () => {
    const { form } = renderDialog({})
    const picker = form.fields.find((field) => field.id === 'domainMappingId')
    expect(picker?.options).toEqual([
      { value: 'm-active', label: 'shop.example.com (Active)' },
      { value: 'm-tls', label: 'new.example.com (TLS failed)' },
    ])
    expect(picker?.description).toMatch(/at most two domains/)
    expect(picker?.description).toMatch(/path prefix such as \/de/)
    expect(form.embedded).toBe(true)
    expect(form.optimisticLockUpdatedAt).toBeNull()
  })

  it('creates a binding for the store with a normalized prefix and is never primary unless asked', async () => {
    const { form, onSaved, onOpenChange } = renderDialog({})
    await form.onSubmit({ domainMappingId: 'm-active', pathPrefix: ' /DE/ ', isPrimary: false })
    expect(createCrudMock).toHaveBeenCalledWith(
      'ecommerce/store-domain-bindings',
      { storeId: 'store-1', domainMappingId: 'm-active', pathPrefix: '/de', isPrimary: false },
      expect.objectContaining({ errorMessage: expect.any(String) }),
    )
    expect(flashMock).toHaveBeenCalledWith('Domain binding added', 'success')
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onSaved).toHaveBeenCalled()
  })

  it('sends an empty prefix as null and passes the primary choice through', async () => {
    const { form } = renderDialog({})
    await form.onSubmit({ domainMappingId: 'm-active', pathPrefix: '', isPrimary: true })
    expect(createCrudMock.mock.calls[0][1]).toEqual({
      storeId: 'store-1',
      domainMappingId: 'm-active',
      pathPrefix: null,
      isPrimary: true,
    })
  })

  it('updates the binding with its own version as the optimistic lock', async () => {
    const binding = existing()
    const { form } = renderDialog({ binding, bindings: [binding] })
    expect(form.optimisticLockUpdatedAt).toBe('2026-10-02T10:00:00.000Z')
    expect(form.initialValues).toEqual({ domainMappingId: 'm-active', pathPrefix: '/de', isPrimary: false })
    await form.onSubmit({ domainMappingId: 'm-active', pathPrefix: '/fr', isPrimary: true })
    expect(updateCrudMock.mock.calls[0][1]).toEqual({ id: 'b-1', domainMappingId: 'm-active', pathPrefix: '/fr', isPrimary: true })
    expect(createCrudMock).not.toHaveBeenCalled()
  })

  it('rejects a duplicate domain and path prefix pair as a field error on the prefix before calling the API', async () => {
    const { form } = renderDialog({ bindings: [existing()] })
    await expect(form.onSubmit({ domainMappingId: 'm-active', pathPrefix: '/de', isPrimary: false })).rejects.toMatchObject({
      message: 'This domain and path prefix already serve a store.',
      fieldErrors: { pathPrefix: 'This domain and path prefix already serve a store.' },
    })
    expect(createCrudMock).not.toHaveBeenCalled()
  })

  it('treats a duplicate without a prefix as a duplicate and ignores the binding being edited', async () => {
    const whole = existing({ id: 'b-2', pathPrefix: null })
    const { form } = renderDialog({ bindings: [whole] })
    await expect(form.onSubmit({ domainMappingId: 'm-active', pathPrefix: '', isPrimary: false })).rejects.toMatchObject({
      fieldErrors: { pathPrefix: expect.any(String) },
    })

    forms.length = 0
    const edited = renderDialog({ binding: whole, bindings: [whole] })
    await edited.form.onSubmit({ domainMappingId: 'm-active', pathPrefix: '', isPrimary: false })
    expect(updateCrudMock).toHaveBeenCalledTimes(1)
  })

  it('allows nested prefixes on the same domain, which resolve by longest prefix', async () => {
    const { form } = renderDialog({ bindings: [existing({ pathPrefix: '/shop' })] })
    await form.onSubmit({ domainMappingId: 'm-active', pathPrefix: '/shop/eu', isPrimary: false })
    expect(createCrudMock).toHaveBeenCalledTimes(1)
  })

  it('lets a server-side duplicate rejection reach the form unchanged', async () => {
    const serverError = Object.assign(new Error('This domain and path prefix already serve a store.'), {
      fieldErrors: { pathPrefix: 'This domain and path prefix already serve a store.' },
    })
    createCrudMock.mockRejectedValueOnce(serverError)
    const { form } = renderDialog({})
    await expect(form.onSubmit({ domainMappingId: 'm-active', pathPrefix: '/x', isPrimary: false })).rejects.toBe(serverError)
  })

  it('validates the domain choice and the prefix shape', () => {
    const { form } = renderDialog({})
    expect(form.schema.safeParse({ domainMappingId: '', pathPrefix: '', isPrimary: false }).success).toBe(false)
    expect(form.schema.safeParse({ domainMappingId: 'm-active', pathPrefix: 'Not A Path!', isPrimary: false }).success).toBe(false)
    expect(form.schema.safeParse({ domainMappingId: 'm-active', pathPrefix: '/de', isPrimary: false }).success).toBe(true)
    expect(form.schema.safeParse({ domainMappingId: 'm-active', pathPrefix: '', isPrimary: false }).success).toBe(true)
  })

  it('warns, naming the status, when a domain that does not serve is picked', () => {
    const { form } = renderDialog({})
    const statusGroup = form.groups.find((group) => group.id === 'status')
    render(<div data-testid="warning">{statusGroup?.component?.({ values: { domainMappingId: 'm-tls' } })}</div>)
    expect(screen.getByTestId('warning').textContent).toContain(
      'This domain is TLS failed. Only an active domain serves, so the store does not answer at new.example.com yet.',
    )
  })

  it('shows no warning for an active domain', () => {
    const { form } = renderDialog({})
    const statusGroup = form.groups.find((group) => group.id === 'status')
    render(<div data-testid="warning">{statusGroup?.component?.({ values: { domainMappingId: 'm-active' } })}</div>)
    expect(screen.getByTestId('warning').textContent).toBe('')
  })

  it('points to domain management when the organization has no domain to bind', () => {
    renderDialog({ mappings: [] })
    expect(screen.getByText(/This organization has no domains yet/)).toBeTruthy()
    expect(screen.getByText('Open domain management').closest('a')?.getAttribute('href')).toBe(
      '/backend/customer_accounts/settings/domain',
    )
  })
})
