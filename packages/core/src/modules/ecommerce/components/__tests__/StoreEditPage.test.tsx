/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StoreEditPage } from '../StoreEditPage'
import type { StoreEditTabDefinition } from '../storeEditTabs'
import type { StoreAdminRecord } from '../storeAdmin'

const apiCallMock = jest.fn()
const replaceMock = jest.fn()
let currentSearch = ''

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: replaceMock }),
  usePathname: () => '/backend/config/ecommerce/store-1',
  useSearchParams: () => new URLSearchParams(currentSearch),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}))

jest.mock('@open-mercato/ui/backend/forms', () => ({
  FormHeader: ({ title, subtitle, statusBadge }: { title: string; subtitle: string; statusBadge: React.ReactNode }) => (
    <header>
      <h1>{title}</h1>
      <p>{subtitle}</p>
      {statusBadge}
    </header>
  ),
}))

const store: StoreAdminRecord = {
  id: 'store-1',
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
  _ecommerce: {
    primaryDomain: { hostname: 'shop.example.com', pathPrefix: null },
    defaultChannel: { id: 'channel-1', name: 'Web channel' },
  },
}

function tab(id: StoreEditTabDefinition['id'], label: string): StoreEditTabDefinition {
  return { id, labelKey: `test.${id}`, fallbackLabel: label, render: ({ store: record }) => <p>{`${label} for ${record.code}`}</p> }
}

function renderPage(tabs: readonly StoreEditTabDefinition[] = [], storeId: string | null = 'store-1') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <StoreEditPage storeId={storeId} tabs={tabs} />
    </QueryClientProvider>,
  )
}

describe('StoreEditPage', () => {
  beforeEach(() => {
    apiCallMock.mockReset()
    replaceMock.mockReset()
    currentSearch = ''
    apiCallMock.mockResolvedValue({ ok: true, status: 200, result: { items: [store], total: 1, totalPages: 1 } })
  })

  it('loads the store by id and shows its identity and bindings summary', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Main store' })).toBeInTheDocument()
    expect(apiCallMock.mock.calls[0][0]).toContain('id=store-1')
    expect(screen.getByText('main — /main-shop')).toBeInTheDocument()
    expect(screen.getByText('Draft')).toBeInTheDocument()
    expect(screen.getByText('shop.example.com')).toBeInTheDocument()
    expect(screen.getByText('Web channel')).toBeInTheDocument()
    expect(screen.getByText('en, pl')).toBeInTheDocument()
  })

  it('renders no tab strip while no tab is registered', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Main store' })
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
  })

  it('opens the tab named by ?tab= and falls back to the first registered tab for an unknown value', async () => {
    const tabs = [tab('general', 'General'), tab('domains', 'Domains')]
    currentSearch = 'tab=domains'
    const { unmount } = renderPage(tabs)
    expect(await screen.findByText('Domains for main')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Domains' })).toHaveAttribute('aria-selected', 'true')
    unmount()

    currentSearch = 'tab=channels'
    renderPage(tabs)
    expect(await screen.findByText('General for main')).toBeInTheDocument()
  })

  it('writes the selected tab back to the tab query parameter', async () => {
    renderPage([tab('general', 'General'), tab('seo', 'SEO')])
    fireEvent.click(await screen.findByRole('tab', { name: 'SEO' }))
    expect(replaceMock).toHaveBeenCalledWith('/backend/config/ecommerce/store-1?tab=seo')
  })

  it('renders a dedicated not-found state when the store does not exist', async () => {
    apiCallMock.mockResolvedValue({ ok: true, status: 200, result: { items: [], total: 0, totalPages: 1 } })
    renderPage()
    expect(await screen.findByText('Store not found')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Main store' })).not.toBeInTheDocument()
  })

  it('renders not-found without a request when the route has no id', () => {
    renderPage(undefined, null)
    expect(screen.getByText('Store not found')).toBeInTheDocument()
    expect(apiCallMock).not.toHaveBeenCalled()
  })

  it('renders an error with a retry action when loading fails', async () => {
    apiCallMock.mockResolvedValue({ ok: false, status: 500, response: new Response('', { status: 500 }) })
    renderPage()
    expect(await screen.findByText('Failed to load the store.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })
})
