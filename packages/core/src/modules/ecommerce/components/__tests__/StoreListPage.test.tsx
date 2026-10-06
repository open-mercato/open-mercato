/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { StoreListPage } from '../StoreListPage'
import type { StoreAdminRecord } from '../storeAdmin'

const apiCallMock = jest.fn()
const confirmMock = jest.fn()
const flashMock = jest.fn()
const scopedHeaderCalls: Array<Record<string, string>> = []
const routerPush = jest.fn()
let grantedFeatures: string[] | undefined = ['ecommerce.stores.view']

type CapturedTableProps = {
  columns: Array<{ id?: string; accessorKey?: string; cell?: (ctx: { row: { original: StoreAdminRecord } }) => React.ReactNode }>
  data: StoreAdminRecord[]
  rowActions?: (row: StoreAdminRecord) => React.ReactNode
  actions?: React.ReactNode
  emptyState?: React.ReactNode
  filterAwareEmptyState?: { active: boolean; onClearAll: () => void }
  onFiltersApply?: (values: Record<string, unknown>) => void
  onSearchChange?: (value: string) => void
  pagination?: { pageSize: number }
}

let tableProps: CapturedTableProps | null = null

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string, params?: Record<string, string>) => {
    const text = fallback ?? key
    return params ? text.replace(/\{(\w+)\}/g, (_match, name: string) => params[name] ?? '') : text
  },
  useLocale: () => 'en',
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, replace: jest.fn() }),
}))

jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({
  useBackendChrome: () => ({ payload: grantedFeatures ? { grantedFeatures } : null }),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
  withScopedApiRequestHeaders: <T,>(headers: Record<string, string>, run: () => Promise<T>) => {
    scopedHeaderCalls.push(headers)
    return run()
  },
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: (...args: unknown[]) => flashMock(...args) }))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: confirmMock, ConfirmDialogElement: null }),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: ({ operation }: { operation: () => Promise<unknown> }) => operation(),
    retryLastMutation: jest.fn(),
  }),
}))

jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: (props: CapturedTableProps) => {
    tableProps = props
    return (
      <div data-testid="data-table">
        {props.actions}
        {props.data.length === 0 ? props.emptyState : null}
        {props.data.map((row) => (
          <div key={row.id} data-testid={`row-${row.id}`}>
            {props.columns.map((column, index) => (
              <span key={index} data-column={column.id ?? column.accessorKey}>
                {column.cell
                  ? column.cell({ row: { original: row } })
                  : String((row as unknown as Record<string, unknown>)[column.accessorKey ?? ''] ?? '')}
              </span>
            ))}
            {props.rowActions?.(row)}
          </div>
        ))}
      </div>
    )
  },
}))

jest.mock('@open-mercato/ui/backend/RowActions', () => ({
  RowActions: ({ items }: { items: Array<{ id: string; label: string; href?: string; onSelect?: () => void }> }) => (
    <div>
      {items.map((item) => (
        <button key={item.id} type="button" data-testid={`action-${item.id}`} data-href={item.href} onClick={() => item.onSelect?.()}>
          {item.label}
        </button>
      ))}
    </div>
  ),
}))

jest.mock('../StoreCreateDialog', () => ({
  StoreCreateDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="create-dialog" /> : null),
}))

function buildStore(overrides: Partial<StoreAdminRecord> = {}): StoreAdminRecord {
  return {
    id: 'store-1',
    code: 'main',
    name: 'Main store',
    slug: 'main',
    status: 'active',
    defaultLocale: 'en',
    supportedLocales: ['en'],
    defaultCurrencyCode: 'EUR',
    isPrimary: true,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-02T10:00:00.000Z',
    _ecommerce: {
      primaryDomain: { hostname: 'shop.example.com', pathPrefix: '/de' },
      defaultChannel: { id: 'channel-1', name: 'Web channel' },
    },
    ...overrides,
  }
}

function mockListResponse(items: StoreAdminRecord[]) {
  apiCallMock.mockImplementation(async (url: string, init?: { method?: string }) => {
    if (init?.method === 'PUT') return { ok: true, status: 200, result: { ok: true } }
    return { ok: true, status: 200, result: { items, total: items.length, totalPages: 1 } }
  })
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <StoreListPage />
    </QueryClientProvider>,
  )
}

describe('StoreListPage', () => {
  beforeEach(() => {
    apiCallMock.mockReset()
    confirmMock.mockReset()
    flashMock.mockReset()
    routerPush.mockReset()
    scopedHeaderCalls.length = 0
    tableProps = null
    grantedFeatures = ['ecommerce.stores.view']
  })

  it('renders name, code, status, primary domain, channel and created from the list response', async () => {
    mockListResponse([buildStore()])
    renderPage()
    const row = await screen.findByTestId('row-store-1')
    expect(row).toHaveTextContent('Main store')
    expect(row).toHaveTextContent('main')
    expect(row).toHaveTextContent('Active')
    expect(row).toHaveTextContent('shop.example.com/de')
    expect(row).toHaveTextContent('Web channel')
    expect(row).toHaveTextContent('Oct 1, 2026')
  })

  it('marks a store without a default channel and without a primary domain', async () => {
    mockListResponse([buildStore({ _ecommerce: { primaryDomain: null, defaultChannel: null } })])
    renderPage()
    const row = await screen.findByTestId('row-store-1')
    expect(row).toHaveTextContent('No default channel')
    expect(row.querySelector('[data-column="primaryDomain"]')).toHaveTextContent('—')
  })

  it('requests a bounded page and sends the status filter and search to the API', async () => {
    mockListResponse([buildStore()])
    renderPage()
    await screen.findByTestId('row-store-1')
    expect(apiCallMock.mock.calls[0][0]).toContain('pageSize=25')
    expect(apiCallMock.mock.calls[0][0]).toContain('sortField=name')

    act(() => tableProps?.onFiltersApply?.({ status: 'archived' }))
    await waitFor(() => {
      const lastUrl = String(apiCallMock.mock.calls[apiCallMock.mock.calls.length - 1][0])
      expect(lastUrl).toContain('status=archived')
    })
    act(() => tableProps?.onSearchChange?.('acme'))
    await waitFor(() => {
      const lastUrl = String(apiCallMock.mock.calls[apiCallMock.mock.calls.length - 1][0])
      expect(lastUrl).toContain('search=acme')
    })
  })

  it('shows the seeded-default empty state when nothing is filtered and the filter-aware state when a status filter matches nothing', async () => {
    mockListResponse([])
    renderPage()
    expect(await screen.findByText('No stores yet')).toBeInTheDocument()
    expect(screen.getByText(/run the pending upgrade action/i)).toBeInTheDocument()
    expect(tableProps?.filterAwareEmptyState?.active).toBe(false)

    act(() => tableProps?.onFiltersApply?.({ status: 'archived' }))
    await waitFor(() => expect(tableProps?.filterAwareEmptyState?.active).toBe(true))
  })

  it('hides Create and Archive without the manage feature and keeps Edit, Domains and Channels', async () => {
    mockListResponse([buildStore()])
    renderPage()
    await screen.findByTestId('row-store-1')
    expect(screen.queryByRole('button', { name: 'Create store' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('action-archive')).not.toBeInTheDocument()
    expect(screen.getByTestId('action-edit')).toHaveAttribute('data-href', '/backend/config/ecommerce/store-1?tab=general')
    expect(screen.getByTestId('action-domains')).toHaveAttribute('data-href', '/backend/config/ecommerce/store-1?tab=domains')
    expect(screen.getByTestId('action-channels')).toHaveAttribute('data-href', '/backend/config/ecommerce/store-1?tab=channels')
  })

  it('explains the empty state without a create action to read-only users', async () => {
    mockListResponse([])
    renderPage()
    expect(await screen.findByText(/an administrator needs to run the pending upgrade action/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Create store' })).not.toBeInTheDocument()
  })

  it('shows Create and Archive for a wildcard manage grant and opens the create dialog', async () => {
    grantedFeatures = ['ecommerce.*']
    mockListResponse([buildStore(), buildStore({ id: 'store-2', status: 'archived' })])
    renderPage()
    await screen.findByTestId('row-store-1')
    fireEvent.click(screen.getByRole('button', { name: 'Create store' }))
    expect(screen.getByTestId('create-dialog')).toBeInTheDocument()
    expect(screen.getAllByTestId('action-archive')).toHaveLength(1)
  })

  it('does not archive when the confirmation is declined', async () => {
    grantedFeatures = ['ecommerce.stores.manage']
    confirmMock.mockResolvedValue(false)
    mockListResponse([buildStore()])
    renderPage()
    await screen.findByTestId('row-store-1')
    fireEvent.click(screen.getByTestId('action-archive'))
    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1))
    expect(confirmMock.mock.calls[0][0]).toMatchObject({ variant: 'destructive', title: 'Archive store "Main store"?' })
    expect(apiCallMock.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(0)
  })

  it('archives behind the confirmation with the optimistic-lock header and reloads the list', async () => {
    grantedFeatures = ['ecommerce.stores.manage']
    confirmMock.mockResolvedValue(true)
    mockListResponse([buildStore()])
    renderPage()
    await screen.findByTestId('row-store-1')
    fireEvent.click(screen.getByTestId('action-archive'))
    await waitFor(() => expect(flashMock).toHaveBeenCalledWith('Store archived', 'success'))
    const putCall = apiCallMock.mock.calls.find(([, init]) => init?.method === 'PUT')
    expect(putCall?.[0]).toBe('/api/ecommerce/stores')
    expect(JSON.parse(putCall?.[1].body)).toEqual({ id: 'store-1', status: 'archived' })
    expect(scopedHeaderCalls).toContainEqual({ [OPTIMISTIC_LOCK_HEADER_NAME]: '2026-10-02T10:00:00.000Z' })
    const listCalls = apiCallMock.mock.calls.filter(([, init]) => init?.method !== 'PUT')
    expect(listCalls.length).toBeGreaterThanOrEqual(2)
  })

  it('leaves a 409 conflict to the shared conflict bar instead of flashing a generic error', async () => {
    grantedFeatures = ['ecommerce.stores.manage']
    confirmMock.mockResolvedValue(true)
    apiCallMock.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (init?.method === 'PUT') {
        return {
          ok: false,
          status: 409,
          response: new Response(
            JSON.stringify({
              code: 'optimistic_lock_conflict',
              currentUpdatedAt: '2026-10-03T10:00:00.000Z',
              expectedUpdatedAt: '2026-10-02T10:00:00.000Z',
            }),
            { status: 409, headers: { 'content-type': 'application/json' } },
          ),
        }
      }
      return { ok: true, status: 200, result: { items: [buildStore()], total: 1, totalPages: 1 } }
    })
    renderPage()
    await screen.findByTestId('row-store-1')
    fireEvent.click(screen.getByTestId('action-archive'))
    await waitFor(() => expect(apiCallMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(true))
    await waitFor(() => expect(confirmMock).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(flashMock).not.toHaveBeenCalledWith(expect.anything(), 'error')
  })
})
