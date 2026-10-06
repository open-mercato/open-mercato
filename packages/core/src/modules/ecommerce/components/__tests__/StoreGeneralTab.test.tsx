/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StoreGeneralTab } from '../StoreGeneralTab'
import type { StoreAdminRecord } from '../storeAdmin'
import type { StoreAccess } from '../useStoreAccess'

type CapturedField = { id: string; type: string; disabled?: boolean; visibleWhen?: { field: string; equals: unknown } }
type CapturedForm = {
  fields: CapturedField[]
  schema: { safeParse: (value: unknown) => { success: boolean } }
  initialValues: Record<string, unknown>
  optimisticLockUpdatedAt?: string | null
  hideFooterActions?: boolean
  embedded?: boolean
  onSubmit: (values: never) => Promise<void>
}

const apiCallMock = jest.fn()
const updateCrudMock = jest.fn()
const createCrudMock = jest.fn()
const flashMock = jest.fn()
const forms: CapturedForm[] = []
let access: StoreAccess

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}))

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  updateCrud: (...args: unknown[]) => updateCrudMock(...args),
  createCrud: (...args: unknown[]) => createCrudMock(...args),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: (...args: unknown[]) => flashMock(...args) }))

jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: (props: CapturedForm) => {
    forms.push(props)
    return <div data-testid={props.fields.some((field) => field.id === 'name') ? 'store-form' : 'availability-form'} />
  },
}))

jest.mock('../useStoreAccess', () => ({
  useStoreAccess: () => access,
}))

const store: StoreAdminRecord = {
  id: 'store-1',
  organizationId: 'org-1',
  tenantId: 'tenant-1',
  code: 'main',
  name: 'Main store',
  slug: 'main-shop',
  status: 'draft',
  defaultLocale: 'en',
  supportedLocales: ['en', 'pl'],
  defaultCurrencyCode: 'EUR',
  isPrimary: true,
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-02T10:00:00.000Z',
}

const storeDefaultPolicy = {
  id: 'policy-1',
  storeId: 'store-1',
  productId: null,
  variantId: null,
  allowBackorder: false,
  backorderLeadTimeDays: null,
  hideWhenOutOfStock: true,
  updatedAt: '2026-10-03T10:00:00.000Z',
}

const productStorePolicy = { ...storeDefaultPolicy, id: 'policy-2', productId: 'product-1', hideWhenOutOfStock: false }

function formWithField(fieldId: string): CapturedForm {
  const match = [...forms].reverse().find((form) => form.fields.some((field) => field.id === fieldId))
  if (!match) throw new Error(`[internal] no form captured with field ${fieldId}`)
  return match
}

function renderTab(reload: () => Promise<void> = jest.fn().mockResolvedValue(undefined)) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <StoreGeneralTab store={store} reload={reload} />
    </QueryClientProvider>,
  )
  return reload
}

function mockPolicies(items: unknown[]) {
  apiCallMock.mockResolvedValue({ ok: true, status: 200, result: { items, total: items.length, totalPages: 1 } })
}

describe('StoreGeneralTab', () => {
  beforeEach(() => {
    apiCallMock.mockReset()
    updateCrudMock.mockReset().mockResolvedValue({ ok: true })
    createCrudMock.mockReset().mockResolvedValue({ ok: true })
    flashMock.mockReset()
    forms.length = 0
    access = { isResolved: true, canManage: true, canManageBranding: false, canManageDomains: false, canViewAvailability: true, canManageAvailability: true }
    mockPolicies([storeDefaultPolicy])
  })

  describe('store record form', () => {
    it('edits identity, status, locales and currency with the store version as the optimistic lock', async () => {
      renderTab()
      await screen.findByTestId('availability-form')
      const form = formWithField('name')
      expect(form.embedded).toBe(true)
      expect(form.fields.map((field) => field.id)).toEqual([
        'name',
        'code',
        'slug',
        'status',
        'defaultCurrencyCode',
        'defaultLocale',
        'supportedLocales',
      ])
      expect(form.optimisticLockUpdatedAt).toBe('2026-10-02T10:00:00.000Z')
      expect(form.fields.every((field) => !field.disabled)).toBe(true)
      expect(form.hideFooterActions).toBe(false)
    })

    it('rejects a default language that is not among the supported languages', async () => {
      renderTab()
      await screen.findByTestId('availability-form')
      const form = formWithField('name')
      expect(form.schema.safeParse({ ...form.initialValues, supportedLocales: ['pl'] }).success).toBe(false)
      expect(form.schema.safeParse(form.initialValues).success).toBe(true)
    })

    it('saves through the stores API without sending settings, flashes and reloads the store', async () => {
      const reload = renderTab()
      await screen.findByTestId('availability-form')
      const form = formWithField('name')
      await form.onSubmit({ ...form.initialValues, name: 'Renamed', status: 'active' } as never)
      expect(updateCrudMock).toHaveBeenCalledTimes(1)
      const [path, body] = updateCrudMock.mock.calls[0]
      expect(path).toBe('ecommerce/stores')
      expect(body).toEqual({
        id: 'store-1',
        name: 'Renamed',
        code: 'main',
        slug: 'main-shop',
        status: 'active',
        defaultLocale: 'en',
        supportedLocales: ['en', 'pl'],
        defaultCurrencyCode: 'EUR',
      })
      expect(flashMock).toHaveBeenCalledWith('Store saved', 'success')
      expect(reload).toHaveBeenCalledTimes(1)
    })

    it('is read-only with an explanation and no save controls without ecommerce.stores.manage', async () => {
      access = { isResolved: true, canManage: false, canManageBranding: false, canManageDomains: false, canViewAvailability: true, canManageAvailability: true }
      renderTab()
      await screen.findByTestId('availability-form')
      const form = formWithField('name')
      expect(form.fields.every((field) => field.disabled === true)).toBe(true)
      expect(form.hideFooterActions).toBe(true)
      expect(screen.getByText(/You can view this store but not change it/)).toBeInTheDocument()
    })

    it('does not offer unarchiving: an archived store keeps its status control disabled', async () => {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      render(
        <QueryClientProvider client={client}>
          <StoreGeneralTab store={{ ...store, status: 'archived' }} reload={jest.fn()} />
        </QueryClientProvider>,
      )
      await screen.findByTestId('availability-form')
      const status = formWithField('name').fields.find((field) => field.id === 'status')
      expect(status?.disabled).toBe(true)
    })
  })

  describe('availability defaults section', () => {
    it('loads the store-default row, ignoring product-level rows of the same store', async () => {
      mockPolicies([productStorePolicy, storeDefaultPolicy])
      renderTab()
      await screen.findByTestId('availability-form')
      const params = new URLSearchParams(String(apiCallMock.mock.calls[0][0]).split('?')[1])
      expect(String(apiCallMock.mock.calls[0][0])).toContain('/api/availability/policies?')
      expect(params.get('storeId')).toBe('store-1')
      expect(params.get('pageSize')).toBe('100')
      const form = formWithField('hideWhenOutOfStock')
      expect(form.initialValues).toEqual({ hideWhenOutOfStock: true, allowBackorder: false, backorderLeadTimeDays: null })
      expect(form.optimisticLockUpdatedAt).toBe('2026-10-03T10:00:00.000Z')
    })

    it('keeps paging until the store-default row is found', async () => {
      apiCallMock
        .mockResolvedValueOnce({ ok: true, status: 200, result: { items: [productStorePolicy], total: 101, totalPages: 2 } })
        .mockResolvedValueOnce({ ok: true, status: 200, result: { items: [storeDefaultPolicy], total: 101, totalPages: 2 } })
      renderTab()
      await screen.findByTestId('availability-form')
      expect(apiCallMock).toHaveBeenCalledTimes(2)
      expect(String(apiCallMock.mock.calls[1][0])).toContain('page=2')
      expect(formWithField('hideWhenOutOfStock').optimisticLockUpdatedAt).toBe('2026-10-03T10:00:00.000Z')
    })

    it('offers the two controls plus a lead time that only shows while backorders are allowed', async () => {
      renderTab()
      await screen.findByTestId('availability-form')
      const form = formWithField('hideWhenOutOfStock')
      expect(form.fields.map((field) => field.id)).toEqual(['hideWhenOutOfStock', 'allowBackorder', 'backorderLeadTimeDays'])
      expect(form.fields[2].visibleWhen).toEqual({ field: 'allowBackorder', equals: true })
      expect(form.fields.every((field) => !field.disabled)).toBe(true)
    })

    it('updates the existing row under its own version, sending only the policy fields it owns', async () => {
      const reload = renderTab()
      await screen.findByTestId('availability-form')
      const form = formWithField('hideWhenOutOfStock')
      await form.onSubmit({ hideWhenOutOfStock: false, allowBackorder: true, backorderLeadTimeDays: '6' } as never)
      expect(createCrudMock).not.toHaveBeenCalled()
      expect(updateCrudMock).toHaveBeenCalledTimes(1)
      expect(updateCrudMock.mock.calls[0][0]).toBe('availability/policies')
      expect(updateCrudMock.mock.calls[0][1]).toEqual({
        id: 'policy-1',
        hideWhenOutOfStock: false,
        allowBackorder: true,
        backorderLeadTimeDays: 6,
      })
      expect(flashMock).toHaveBeenCalledWith('Availability defaults saved', 'success')
      expect(reload).not.toHaveBeenCalled()
    })

    it('creates the store-default row when the store has none', async () => {
      mockPolicies([productStorePolicy])
      renderTab()
      await screen.findByTestId('availability-form')
      const form = formWithField('hideWhenOutOfStock')
      expect(form.optimisticLockUpdatedAt).toBeNull()
      await form.onSubmit({ hideWhenOutOfStock: true, allowBackorder: false, backorderLeadTimeDays: null } as never)
      expect(updateCrudMock).not.toHaveBeenCalled()
      expect(createCrudMock).toHaveBeenCalledTimes(1)
      expect(createCrudMock.mock.calls[0][0]).toBe('availability/policies')
      expect(createCrudMock.mock.calls[0][1]).toEqual({
        organizationId: 'org-1',
        tenantId: 'tenant-1',
        storeId: 'store-1',
        productId: null,
        variantId: null,
        hideWhenOutOfStock: true,
        allowBackorder: false,
      })
    })

    it('is read-only with its own explanation, and no save, without the availability manage feature', async () => {
      access = { isResolved: true, canManage: true, canManageBranding: false, canManageDomains: false, canViewAvailability: true, canManageAvailability: false }
      renderTab()
      await screen.findByTestId('availability-form')
      const form = formWithField('hideWhenOutOfStock')
      expect(form.fields.every((field) => field.disabled === true)).toBe(true)
      expect(form.hideFooterActions).toBe(true)
      expect(screen.getByText(/requires permission to manage availability policies/)).toBeInTheDocument()
      expect(formWithField('name').hideFooterActions).toBe(false)
    })

    it('is read-only with a store-permission explanation without ecommerce.stores.manage', async () => {
      access = { isResolved: true, canManage: false, canManageBranding: false, canManageDomains: false, canViewAvailability: true, canManageAvailability: true }
      renderTab()
      await screen.findByTestId('availability-form')
      expect(formWithField('hideWhenOutOfStock').hideFooterActions).toBe(true)
      expect(screen.getByText(/Changing them requires permission to manage stores/)).toBeInTheDocument()
    })

    it('does not request or show the policy when the user cannot view availability policies', async () => {
      access = { isResolved: true, canManage: true, canManageBranding: false, canManageDomains: false, canViewAvailability: false, canManageAvailability: false }
      renderTab()
      await screen.findByTestId('store-form')
      expect(apiCallMock).not.toHaveBeenCalled()
      expect(screen.queryByTestId('availability-form')).not.toBeInTheDocument()
      expect(screen.getByText(/do not have access to availability policies/)).toBeInTheDocument()
    })

    it('shows a retryable error when the policy cannot be loaded', async () => {
      apiCallMock.mockResolvedValue({ ok: false, status: 500, response: new Response('', { status: 500 }) })
      renderTab()
      expect(await screen.findByText('Failed to load the availability defaults.')).toBeInTheDocument()
      await waitFor(() => expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument())
      expect(screen.queryByTestId('availability-form')).not.toBeInTheDocument()
    })
  })
})
