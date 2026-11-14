/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StoreSeoTab } from '../StoreSeoTab'
import type { StoreAdminRecord } from '../storeAdmin'
import type { StoreAccess } from '../useStoreAccess'

type CapturedField = { id: string; type: string; disabled?: boolean }
type CapturedForm = {
  fields: CapturedField[]
  schema: { safeParse: (value: unknown) => { success: boolean } }
  initialValues: Record<string, unknown>
  optimisticLockUpdatedAt?: string | null
  hideFooterActions?: boolean
  embedded?: boolean
  extraActions?: unknown
  onSubmit: (values: never) => Promise<void>
}

const updateCrudMock = jest.fn()
const flashMock = jest.fn()
const forms: CapturedForm[] = []
let access: StoreAccess

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}))

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  updateCrud: (...args: unknown[]) => updateCrudMock(...args),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: (...args: unknown[]) => flashMock(...args) }))

jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: (props: CapturedForm) => {
    forms.push(props)
    return <div data-testid="seo-form" />
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
  status: 'active',
  defaultLocale: 'en',
  supportedLocales: ['en', 'pl'],
  defaultCurrencyCode: 'EUR',
  isPrimary: true,
  settings: {
    seo: {
      siteName: 'My Store',
      defaultMetaDescription: 'Shop the best products',
      googleSiteVerification: 'abc123',
      robotsTxt: 'User-agent: *\nDisallow: /admin',
    },
    branding: {},
    contact: {},
    display: { priceDisplayModeDefault: 'gross', enableSearch: true },
  },
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-02T10:00:00.000Z',
}

function renderTab(reload: () => Promise<void> = jest.fn().mockResolvedValue(undefined)) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <StoreSeoTab store={store} reload={reload} />
    </QueryClientProvider>,
  )
  return reload
}

describe('StoreSeoTab', () => {
  beforeEach(() => {
    updateCrudMock.mockReset().mockResolvedValue({ ok: true })
    flashMock.mockReset()
    forms.length = 0
    access = { isResolved: true, canManage: true, canManageBranding: false, canManageDomains: false, canManageChannels: false, canViewAvailability: true, canManageAvailability: true }
  })

  it('renders the form with seo fields', async () => {
    renderTab()
    await screen.findByTestId('seo-form')
    const form = forms[0]
    expect(form.fields.map((f) => f.id)).toEqual(['siteName', 'defaultMetaDescription', 'googleSiteVerification', 'robotsTxt'])
    expect(form.embedded).toBe(true)
    expect(form.extraActions).toBeUndefined()
  })

  it('loads initial values from store settings', async () => {
    renderTab()
    await screen.findByTestId('seo-form')
    const form = forms[0]
    expect(form.initialValues).toEqual({
      siteName: 'My Store',
      defaultMetaDescription: 'Shop the best products',
      googleSiteVerification: 'abc123',
      robotsTxt: 'User-agent: *\nDisallow: /admin',
    })
  })

  it('shows empty values when seo settings are absent', async () => {
    const storeWithoutSeo = { ...store, settings: { branding: {}, contact: {}, display: { priceDisplayModeDefault: 'gross' as const, enableSearch: true } } }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <StoreSeoTab store={storeWithoutSeo} reload={jest.fn()} />
      </QueryClientProvider>,
    )
    await screen.findByTestId('seo-form')
    const form = forms[forms.length - 1]
    expect(form.initialValues).toEqual({
      siteName: '',
      defaultMetaDescription: '',
      googleSiteVerification: '',
      robotsTxt: '',
    })
  })

  it('uses store updatedAt for optimistic lock', async () => {
    renderTab()
    await screen.findByTestId('seo-form')
    const form = forms[0]
    expect(form.optimisticLockUpdatedAt).toBe('2026-10-02T10:00:00.000Z')
  })

  it('saves only the seo subtree and omits cleared fields', async () => {
    const reload = renderTab()
    await screen.findByTestId('seo-form')
    const form = forms[0]
    await form.onSubmit({
      siteName: 'New Site Name',
      defaultMetaDescription: '',
      googleSiteVerification: '   ',
      robotsTxt: '',
    } as never)
    expect(updateCrudMock).toHaveBeenCalledTimes(1)
    const [path, body] = updateCrudMock.mock.calls[0]
    expect(path).toBe('ecommerce/stores')
    expect(body).toEqual({ id: 'store-1', settings: { seo: { siteName: 'New Site Name' } } })
    expect(Object.keys(body.settings)).toEqual(['seo'])
    expect(flashMock).toHaveBeenCalledWith('SEO settings saved', 'success')
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('sends an empty seo subtree when every field is cleared', async () => {
    renderTab()
    await screen.findByTestId('seo-form')
    await forms[0].onSubmit({ siteName: '', defaultMetaDescription: '', googleSiteVerification: '', robotsTxt: '' } as never)
    const [, body] = updateCrudMock.mock.calls[0]
    expect(body.settings).toEqual({ seo: {} })
  })

  it('remaps settings.seo.<key> server field errors onto the form field', async () => {
    const serverError = Object.assign(new Error('Invalid input'), {
      status: 400,
      fieldErrors: { 'settings.seo.googleSiteVerification': 'bad token', name: 'other' },
    })
    updateCrudMock.mockRejectedValueOnce(serverError)
    renderTab()
    await screen.findByTestId('seo-form')
    await expect(
      forms[0].onSubmit({ siteName: '', defaultMetaDescription: '', googleSiteVerification: 'x', robotsTxt: '' } as never),
    ).rejects.toMatchObject({
      status: 400,
      fieldErrors: { googleSiteVerification: 'bad token', name: 'other' },
    })
    expect(flashMock).not.toHaveBeenCalled()
  })

  it('uses the server limits for field maxLength', async () => {
    renderTab()
    await screen.findByTestId('seo-form')
    const limits = Object.fromEntries(forms[0].fields.map((f) => [f.id, (f as unknown as { maxLength?: number }).maxLength]))
    expect(limits).toEqual({ siteName: 200, defaultMetaDescription: 500, googleSiteVerification: 128, robotsTxt: 10000 })
  })

  it('is read-only without ecommerce.stores.manage', async () => {
    access = { isResolved: true, canManage: false, canManageBranding: false, canManageDomains: false, canManageChannels: false, canViewAvailability: true, canManageAvailability: true }
    renderTab()
    await screen.findByTestId('seo-form')
    const form = forms[0]
    expect(form.fields.every((f) => f.disabled === true)).toBe(true)
    expect(form.hideFooterActions).toBe(true)
    expect(screen.getByText(/You can view these SEO settings but not change them/)).toBeInTheDocument()
  })
})
