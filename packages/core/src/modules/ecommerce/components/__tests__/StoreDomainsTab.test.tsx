/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { StoreDomainsTab } from '../StoreDomainsTab'
import type { StoreAdminRecord } from '../storeAdmin'
import type { DomainBindingRecord } from '../storeDomains'
import type { StoreAccess } from '../useStoreAccess'

const apiCallMock = jest.fn()
const updateCrudMock = jest.fn()
const deleteCrudMock = jest.fn()
const confirmMock = jest.fn()
const flashMock = jest.fn()
const scopedHeaderCalls: Array<Record<string, string>> = []
let access: StoreAccess

type CapturedTableProps = {
  columns: Array<{ id?: string; cell?: (ctx: { row: { original: DomainBindingRecord } }) => React.ReactNode }>
  data: DomainBindingRecord[]
  rowActions?: (row: DomainBindingRecord) => React.ReactNode
  actions?: React.ReactNode
  emptyState?: React.ReactNode
}

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string, params?: Record<string, string>) => {
    const text = fallback ?? key
    return params ? text.replace(/\{(\w+)\}/g, (_match, name: string) => params[name] ?? '') : text
  },
  useLocale: () => 'en',
}))

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
  withScopedApiRequestHeaders: <T,>(headers: Record<string, string>, run: () => Promise<T>) => {
    scopedHeaderCalls.push(headers)
    return run()
  },
}))

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  updateCrud: (...args: unknown[]) => updateCrudMock(...args),
  deleteCrud: (...args: unknown[]) => deleteCrudMock(...args),
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
  DataTable: (props: CapturedTableProps) => (
    <div data-testid="data-table">
      {props.actions}
      {props.data.length === 0 ? props.emptyState : null}
      {props.data.map((row) => (
        <div key={row.id} data-testid={`row-${row.id}`}>
          {props.columns.map((column, index) => (
            <span key={index} data-column={column.id}>
              {column.cell ? column.cell({ row: { original: row } }) : null}
            </span>
          ))}
          {props.rowActions?.(row)}
        </div>
      ))}
    </div>
  ),
}))

jest.mock('@open-mercato/ui/backend/RowActions', () => ({
  RowActions: ({ items }: { items: Array<{ id: string; label: string; onSelect?: () => void }> }) => (
    <div>
      {items.map((item) => (
        <button key={item.id} type="button" data-testid={`action-${item.id}`} onClick={() => item.onSelect?.()}>
          {item.label}
        </button>
      ))}
    </div>
  ),
}))

jest.mock('@open-mercato/ui/backend/filters/ListEmptyState', () => ({
  ListEmptyState: ({ title, onCreate }: { title: string; onCreate?: () => void }) => (
    <div data-testid="empty-state">
      {title}
      {onCreate ? <button type="button" data-testid="empty-create" onClick={onCreate} /> : null}
    </div>
  ),
}))

jest.mock('../StoreDomainBindingDialog', () => ({
  StoreDomainBindingDialog: ({ binding }: { binding: DomainBindingRecord | null }) => (
    <div data-testid="binding-dialog" data-binding-id={binding?.id ?? ''} />
  ),
}))

jest.mock('../useStoreAccess', () => ({
  useStoreAccess: () => access,
}))

const store: StoreAdminRecord = {
  id: 'store-1',
  code: 'main',
  name: 'Main store',
  slug: 'main',
  status: 'draft',
  defaultLocale: 'en',
  supportedLocales: ['en'],
  defaultCurrencyCode: 'EUR',
  isPrimary: true,
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-02T10:00:00.000Z',
}

function binding(id: string, overrides: Partial<DomainBindingRecord> = {}): DomainBindingRecord {
  return {
    id,
    storeId: 'store-1',
    domainMappingId: `mapping-${id}`,
    pathPrefix: null,
    isPrimary: false,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: `2026-10-02T10:00:0${id.length}.000Z`,
    _domainMapping: {
      state: 'found',
      hostname: `${id}.example.com`,
      status: 'active',
      lastDnsCheckAt: '2026-10-04T08:00:00.000Z',
      dnsFailureReason: null,
      tlsFailureReason: null,
    },
    ...overrides,
  }
}

function mockApi(items: DomainBindingRecord[]) {
  apiCallMock.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/ecommerce/domain-mappings')) {
      return { ok: true, status: 200, result: { items: [], total: 0 } }
    }
    return { ok: true, status: 200, result: { items, total: items.length, totalPages: 1 } }
  })
}

function renderTab(reload: () => Promise<void> = jest.fn().mockResolvedValue(undefined)) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <StoreDomainsTab store={store} reload={reload} />
    </QueryClientProvider>,
  )
  return reload
}

describe('StoreDomainsTab', () => {
  beforeEach(() => {
    apiCallMock.mockReset()
    updateCrudMock.mockReset().mockResolvedValue({ ok: true })
    deleteCrudMock.mockReset().mockResolvedValue({ ok: true })
    confirmMock.mockReset()
    flashMock.mockReset()
    scopedHeaderCalls.length = 0
    access = {
      isResolved: true,
      canManage: true,
      canManageBranding: false,
      canManageDomains: true,
      canManageChannels: false,
      canViewAvailability: true,
      canManageAvailability: true,
    }
  })

  it('loads only the bindings of this store and states the organization limit and the path prefix alternative', async () => {
    mockApi([binding('a')])
    renderTab()
    await screen.findByTestId('row-a')
    const bindingCall = apiCallMock.mock.calls.map((call) => String(call[0])).find((url) => url.includes('store-domain-bindings'))
    expect(bindingCall).toContain('storeId=store-1')
    expect(screen.getByText(/at most two domains: one active plus one pending replacement/)).toBeTruthy()
    expect(screen.getByText(/give it a path prefix such as \/de/)).toBeTruthy()
    const links = screen.getAllByText('Open domain management').map((node) => node.closest('a')?.getAttribute('href'))
    expect(links).toContain('/backend/customer_accounts/settings/domain')
  })

  it.each([
    ['pending', 'Pending'],
    ['verified', 'Verified'],
    ['dns_failed', 'DNS failed'],
    ['tls_failed', 'TLS failed'],
  ])('warns that a %s domain does not serve yet, naming the status', async (status, label) => {
    mockApi([
      binding('a', {
        _domainMapping: {
          state: 'found',
          hostname: 'shop.example.com',
          status,
          lastDnsCheckAt: null,
          dnsFailureReason: null,
          tlsFailureReason: null,
        },
      }),
    ])
    renderTab()
    const row = await screen.findByTestId('row-a')
    expect(within(row).getByText(`This domain is ${label}. Only an active domain serves, so the store does not answer at shop.example.com yet.`)).toBeTruthy()
  })

  it('shows no warning for an active domain and renders its last DNS check', async () => {
    mockApi([binding('a')])
    renderTab()
    const row = await screen.findByTestId('row-a')
    expect(within(row).queryByText(/Only an active domain serves/)).toBeNull()
    expect(within(row).getByText('Active')).toBeTruthy()
    expect(within(row).queryByText('Not checked yet')).toBeNull()
  })

  it('surfaces the TLS failure reason and a never-checked domain read-only', async () => {
    mockApi([
      binding('a', {
        _domainMapping: {
          state: 'found',
          hostname: 'shop.example.com',
          status: 'tls_failed',
          lastDnsCheckAt: null,
          dnsFailureReason: null,
          tlsFailureReason: 'Certificate request rejected',
        },
      }),
    ])
    renderTab()
    const row = await screen.findByTestId('row-a')
    expect(within(row).getByText('Certificate request rejected')).toBeTruthy()
    expect(within(row).getByText('Not checked yet')).toBeTruthy()
  })

  it.each([
    [{ tlsFailureReason: 'HTTP 503', dnsFailureReason: null }, 'The TLS health check returned HTTP 503'],
    [
      { tlsFailureReason: null, dnsFailureReason: 'CNAME points to old.example.net instead of edge.example.com' },
      'The CNAME record points to old.example.net instead of edge.example.com',
    ],
  ])('translates a known failure reason code', async (reasons, expected) => {
    mockApi([
      binding('a', {
        _domainMapping: {
          state: 'found',
          hostname: 'shop.example.com',
          status: reasons.tlsFailureReason ? 'tls_failed' : 'dns_failed',
          lastDnsCheckAt: null,
          ...reasons,
        },
      }),
    ])
    renderTab()
    const row = await screen.findByTestId('row-a')
    expect(within(row).getByText(expected)).toBeTruthy()
  })

  it('renders the domain removed diagnostic with a link to domain management for a dangling binding', async () => {
    mockApi([binding('a', { pathPrefix: '/de', _domainMapping: { state: 'removed' } })])
    renderTab()
    const row = await screen.findByTestId('row-a')
    expect(within(row).getByText('Domain removed')).toBeTruthy()
    expect(within(row).getByText('Removed')).toBeTruthy()
    expect(within(row).getByText(/was deleted in domain management/)).toBeTruthy()
    expect(within(row).getByText('Open domain management').closest('a')?.getAttribute('href')).toBe(
      '/backend/customer_accounts/settings/domain',
    )
  })

  it('does not claim the domain was removed when its details could not be read', async () => {
    mockApi([binding('a', { _domainMapping: { state: 'unavailable' } })])
    renderTab()
    const row = await screen.findByTestId('row-a')
    expect(within(row).queryByText('Domain removed')).toBeNull()
    expect(within(row).getByText('Domain details are unavailable right now.')).toBeTruthy()
  })

  it('marks the primary binding and offers make primary only on the others', async () => {
    mockApi([binding('a', { isPrimary: true }), binding('b')])
    renderTab()
    const primaryRow = await screen.findByTestId('row-a')
    const otherRow = await screen.findByTestId('row-b')
    expect(within(primaryRow).getAllByText('Primary').length).toBeGreaterThan(0)
    expect(within(primaryRow).queryByTestId('action-make-primary')).toBeNull()
    expect(within(otherRow).getByTestId('action-make-primary')).toBeTruthy()
  })

  it('makes a binding primary with its own version as the lock and names the previous primary in the confirmation', async () => {
    const primary = binding('a', { isPrimary: true })
    const other = binding('b')
    mockApi([primary, other])
    const reload = renderTab()
    fireEvent.click(within(await screen.findByTestId('row-b')).getByTestId('action-make-primary'))
    await waitFor(() => expect(updateCrudMock).toHaveBeenCalledTimes(1))
    expect(updateCrudMock.mock.calls[0][0]).toBe('ecommerce/store-domain-bindings')
    expect(updateCrudMock.mock.calls[0][1]).toEqual({ id: 'b', isPrimary: true })
    expect(scopedHeaderCalls[0][OPTIMISTIC_LOCK_HEADER_NAME]).toBe(other.updatedAt)
    await waitFor(() =>
      expect(flashMock).toHaveBeenCalledWith('b.example.com is now the primary domain. a.example.com is no longer primary.', 'success'),
    )
    expect(reload).toHaveBeenCalled()
  })

  it('removes a binding after confirmation, with its version as the lock, and does nothing when cancelled', async () => {
    const target = binding('a', { isPrimary: true })
    mockApi([target])
    renderTab()
    const row = await screen.findByTestId('row-a')

    confirmMock.mockResolvedValueOnce(false)
    fireEvent.click(within(row).getByTestId('action-delete'))
    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1))
    expect(deleteCrudMock).not.toHaveBeenCalled()

    confirmMock.mockResolvedValueOnce(true)
    fireEvent.click(within(row).getByTestId('action-delete'))
    await waitFor(() => expect(deleteCrudMock).toHaveBeenCalledTimes(1))
    expect(deleteCrudMock.mock.calls[0][0]).toBe('ecommerce/store-domain-bindings')
    expect(deleteCrudMock.mock.calls[0][1]).toBe('a')
    expect(scopedHeaderCalls.at(-1)?.[OPTIMISTIC_LOCK_HEADER_NAME]).toBe(target.updatedAt)
    expect(confirmMock.mock.calls[1][0].text).toMatch(/primary binding/)
  })

  it('opens the dialog to add and to edit', async () => {
    mockApi([binding('a')])
    renderTab()
    const row = await screen.findByTestId('row-a')
    fireEvent.click(screen.getByText('Add domain binding'))
    expect(screen.getByTestId('binding-dialog').getAttribute('data-binding-id')).toBe('')
    fireEvent.click(within(row).getByTestId('action-edit'))
    await waitFor(() => expect(screen.getByTestId('binding-dialog').getAttribute('data-binding-id')).toBe('a'))
  })

  it('is view-only without the domains manage feature: no add button, no row actions, an explanation', async () => {
    access = { ...access, canManageDomains: false }
    mockApi([binding('a')])
    renderTab()
    const row = await screen.findByTestId('row-a')
    expect(screen.queryByText('Add domain binding')).toBeNull()
    expect(within(row).queryByTestId('action-edit')).toBeNull()
    expect(within(row).queryByTestId('action-delete')).toBeNull()
    expect(screen.getByText(/You can view these bindings but not change them/)).toBeTruthy()
  })

  it('shows the empty state with an add action for a manager', async () => {
    mockApi([])
    renderTab()
    expect(await screen.findByTestId('empty-state')).toBeTruthy()
    expect(screen.getByTestId('empty-create')).toBeTruthy()
  })
})
