/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { StoreChannelsTab } from '../StoreChannelsTab'
import type { StoreAdminRecord } from '../storeAdmin'
import type { AssortmentCountResult, ChannelBindingRecord } from '../storeChannels'
import type { StoreAccess } from '../useStoreAccess'

const apiCallMock = jest.fn()
const readApiResultMock = jest.fn()
const updateCrudMock = jest.fn()
const deleteCrudMock = jest.fn()
const confirmMock = jest.fn()
const flashMock = jest.fn()
const scopedHeaderCalls: Array<Record<string, string>> = []
let access: StoreAccess

type CapturedTableProps = {
  columns: Array<{ id?: string; cell?: (ctx: { row: { original: ChannelBindingRecord } }) => React.ReactNode }>
  data: ChannelBindingRecord[]
  rowActions?: (row: ChannelBindingRecord) => React.ReactNode
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

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
  readApiResultOrThrow: (...args: unknown[]) => readApiResultMock(...args),
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

jest.mock('../StoreChannelBindingDialog', () => ({
  StoreChannelBindingDialog: ({
    binding,
    readOnly,
    firstBinding,
  }: {
    binding: ChannelBindingRecord | null
    readOnly: boolean
    firstBinding: boolean
  }) => (
    <div
      data-testid="binding-dialog"
      data-binding-id={binding?.id ?? ''}
      data-read-only={String(readOnly)}
      data-first-binding={String(firstBinding)}
    />
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

function binding(id: string, overrides: Partial<ChannelBindingRecord> = {}): ChannelBindingRecord {
  return {
    id,
    storeId: 'store-1',
    salesChannelId: `channel-${id}`,
    priceKindId: null,
    assortmentScope: null,
    priceSortFallback: 'approximate',
    isDefault: false,
    requireAuthentication: false,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: `2026-10-02T10:00:0${id.length}.000Z`,
    ...overrides,
  }
}

function countFor(overrides: Partial<AssortmentCountResult> = {}): AssortmentCountResult {
  return {
    count: 7,
    scopeSource: 'saved',
    requireAuthentication: false,
    reducedByAuthentication: false,
    countWithoutAuthentication: 7,
    unindexedCount: 0,
    ...overrides,
  }
}

function mockApi(items: ChannelBindingRecord[], counts: Record<string, AssortmentCountResult> = {}) {
  apiCallMock.mockImplementation(async (url: string) => {
    const match = /store-channel-bindings\/([^/]+)\/assortment-count/.exec(url)
    if (match) return { ok: true, status: 200, result: counts[match[1]] ?? countFor() }
    return { ok: true, status: 200, result: { items, total: items.length, totalPages: 1 } }
  })
  readApiResultMock.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/sales/channels')) {
      return { items: items.map((item) => ({ id: item.salesChannelId, name: `Channel ${item.id.toUpperCase()}`, code: item.id })) }
    }
    if (url.startsWith('/api/catalog/price-kinds')) return { items: [{ id: 'kind-1', title: 'Wholesale', code: 'wholesale' }] }
    return { items: [] }
  })
}

function renderTab(reload: () => Promise<void> = jest.fn().mockResolvedValue(undefined)) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <StoreChannelsTab store={store} reload={reload} />
    </QueryClientProvider>,
  )
  return reload
}

function cell(rowId: string, column: string): Element {
  const node = screen.getByTestId(`row-${rowId}`).querySelector(`[data-column="${column}"]`)
  if (!node) throw new Error(`[internal] missing ${column} cell`)
  return node
}

describe('StoreChannelsTab', () => {
  beforeEach(() => {
    apiCallMock.mockReset()
    readApiResultMock.mockReset()
    updateCrudMock.mockReset().mockResolvedValue({ ok: true })
    deleteCrudMock.mockReset().mockResolvedValue({ ok: true })
    confirmMock.mockReset()
    flashMock.mockReset()
    scopedHeaderCalls.length = 0
    access = {
      isResolved: true,
      canManage: true,
      canManageBranding: false,
      canManageDomains: false,
      canManageChannels: true,
      canViewAvailability: true,
      canManageAvailability: true,
    }
  })

  it('lists the bindings of this store with channel, default, price kind, sign-in, fallback and count', async () => {
    mockApi(
      [
        binding('a', { isDefault: true, priceKindId: 'kind-1' }),
        binding('b', { requireAuthentication: true, priceSortFallback: 'unavailable', assortmentScope: { tagIds: ['t-1', 't-2'] } }),
      ],
      { b: countFor({ count: 0, requireAuthentication: true, reducedByAuthentication: true, countWithoutAuthentication: 25 }) },
    )
    renderTab()
    await screen.findByTestId('row-a')
    const listCall = apiCallMock.mock.calls.map((call) => String(call[0])).find((url) => url.includes('store-channel-bindings?'))
    expect(listCall).toContain('storeId=store-1')
    await waitFor(() => expect(cell('a', 'channel').textContent).toBe('Channel A (a)'))
    expect(cell('a', 'default').textContent).toBe('Default')
    await waitFor(() => expect(cell('a', 'priceKind').textContent).toBe('Wholesale (wholesale)'))
    expect(cell('a', 'scope').textContent).toBe('All products')
    expect(cell('a', 'requireAuthentication').textContent).toBe('Public')
    expect(cell('a', 'priceSortFallback').textContent).toBe('Approximate order from the default price kind')
    expect(cell('b', 'scope').textContent).toBe('Restricted (2 rules)')
    expect(cell('b', 'requireAuthentication').textContent).toBe('Sign-in required')
    expect(cell('b', 'priceSortFallback').textContent).toBe('Withdraw price sorting')
    await waitFor(() => expect(cell('a', 'count').textContent).toBe('7'))
    await waitFor(() => expect(cell('b', 'count').textContent).toBe('0 (25 without the sign-in requirement)'))
  })

  it('scrolls the bindings table horizontally inside its card instead of overflowing it', async () => {
    mockApi([binding('a', { isDefault: true })], {})
    renderTab()
    await screen.findByTestId('row-a')
    expect(screen.getByTestId('data-table').parentElement).toHaveClass('overflow-x-auto')
  })

  it('makes a binding the default with its own version as the lock', async () => {
    mockApi([binding('a', { isDefault: true }), binding('b')])
    renderTab()
    await screen.findByTestId('row-b')
    expect(within(screen.getByTestId('row-a')).queryByTestId('action-make-default')).toBeNull()
    fireEvent.click(within(screen.getByTestId('row-b')).getByTestId('action-make-default'))
    await waitFor(() => expect(updateCrudMock).toHaveBeenCalled())
    expect(updateCrudMock.mock.calls[0][0]).toBe('ecommerce/store-channel-bindings')
    expect(updateCrudMock.mock.calls[0][1]).toEqual({ id: 'b', isDefault: true })
    expect(scopedHeaderCalls[0]).toEqual({ [OPTIMISTIC_LOCK_HEADER_NAME]: binding('b').updatedAt })
  })

  it('warns before removing the default binding that the storefront stops serving', async () => {
    mockApi([binding('a', { isDefault: true })])
    confirmMock.mockResolvedValue(true)
    renderTab()
    await screen.findByTestId('row-a')
    fireEvent.click(within(screen.getByTestId('row-a')).getByTestId('action-delete'))
    await waitFor(() => expect(deleteCrudMock).toHaveBeenCalledWith('ecommerce/store-channel-bindings', 'a', expect.any(Object)))
    expect(confirmMock.mock.calls[0][0].text).toMatch(/This is the default binding/)
  })

  it('flags a store whose bindings have no default', async () => {
    mockApi([binding('a')])
    renderTab()
    await screen.findByTestId('row-a')
    expect(screen.getByText(/No binding is the default, so the storefront cannot serve/)).toBeTruthy()
  })

  it('opens the add dialog proposing the first binding as the default', async () => {
    mockApi([])
    renderTab()
    fireEvent.click(await screen.findByText('Add channel binding'))
    const dialog = screen.getByTestId('binding-dialog')
    expect(dialog.getAttribute('data-binding-id')).toBe('')
    expect(dialog.getAttribute('data-first-binding')).toBe('true')
    expect(dialog.getAttribute('data-read-only')).toBe('false')
  })

  it('is view-only without the channels manage feature', async () => {
    access = { ...access, canManageChannels: false }
    mockApi([binding('a', { isDefault: true })])
    renderTab()
    await screen.findByTestId('row-a')
    expect(screen.queryByText('Add channel binding')).toBeNull()
    expect(screen.getByText(/You can view these bindings but not change them/)).toBeTruthy()
    const row = within(screen.getByTestId('row-a'))
    expect(row.queryByTestId('action-edit')).toBeNull()
    expect(row.queryByTestId('action-delete')).toBeNull()
    fireEvent.click(row.getByTestId('action-view'))
    expect(screen.getByTestId('binding-dialog').getAttribute('data-read-only')).toBe('true')
  })
})
