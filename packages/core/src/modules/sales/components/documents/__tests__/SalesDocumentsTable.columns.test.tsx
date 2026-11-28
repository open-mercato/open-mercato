/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, act, screen } from '@testing-library/react'
import type { SortingState } from '@tanstack/react-table'
import { SalesDocumentsTable } from '../SalesDocumentsTable'

jest.mock('../../useSalesChannelsEnabled', () => ({
  SALES_CHANNELS_TOGGLE_ID: 'sales_channels_enabled',
  useSalesChannelsEnabled: () => ({ enabled: true, isLoading: false }),
}))

type TestDataTableProps = {
  sortable?: boolean
  manualSorting?: boolean
  sorting?: SortingState
  columns?: Array<{
    id: string
    enableSorting?: boolean
    cell?: (context: { row: { original: { id: string } } }) => React.ReactNode
  }>
  data?: Array<{ id: string }>
  pagination?: { onPageChange?: (page: number) => void }
  onSortingChange?: (sorting: SortingState) => void
}

const mockDataTable = jest.fn<void, [TestDataTableProps]>()
const mockApiCall = jest.fn()

jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  withDataTableNamespaces: (mappedRow: Record<string, unknown>) => mappedRow,
  DataTable: (props: TestDataTableProps) => {
    mockDataTable(props)
    const dateColumn = props.columns?.find((column) => column.id === 'createdAt')
    return props.data?.map((original) => (
      <div key={original.id}>{dateColumn?.cell?.({ row: { original } })}</div>
    )) ?? null
  },
}))

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  PageBody: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/backend/RowActions', () => ({
  RowActions: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/primitives/button', () => ({
  Button: ({ children, ...props }: React.ComponentProps<'button'>) => <button {...props}>{children}</button>,
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => mockApiCall(...args),
  withScopedApiRequestHeaders: (_header: unknown, callback: () => unknown) => callback?.(),
}))

jest.mock('@open-mercato/ui/backend/utils/optimisticLock', () => ({
  buildOptimisticLockHeader: () => ({}),
}))

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  buildCrudExportUrl: () => '/export.csv',
  deleteCrud: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: jest.fn(), ConfirmDialogElement: null }),
}))

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => 1,
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => {
  const translate = (key: string, fallback?: string) => fallback ?? key
  return { useT: () => translate, useLocale: () => 'pl' }
})

jest.mock('@open-mercato/core/modules/dictionaries/components/dictionaryAppearance', () => ({
  DictionaryValue: ({ value }: { value?: React.ReactNode }) => <span>{value}</span>,
  createDictionaryMap: () => ({}),
  normalizeDictionaryEntries: () => [],
}))

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}))

const latestProps = () => mockDataTable.mock.calls.at(-1)?.[0]

const listUrls = (resource: string) =>
  mockApiCall.mock.calls
    .map((call) => String(call[0]))
    .filter((url) => url.startsWith(`/api/sales/${resource}?`))

describe('SalesDocumentsTable column sorting (issue #6943)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockApiCall.mockResolvedValue({ ok: true, result: { items: [] } })
  })

  it.each([
    ['order', 'orders'],
    ['quote', 'quotes'],
  ] as const)('renders sortable %s headers backed by server-side sorting', async (kind) => {
    await act(async () => {
      render(<SalesDocumentsTable kind={kind} />)
    })

    const props = latestProps()
    expect(props?.sortable).toBe(true)
    expect(props?.manualSorting).toBe(true)
    expect(props?.sorting).toEqual([{ id: 'createdAt', desc: true }])

    const sortableIds = (props?.columns ?? [])
      .filter((column) => column.enableSorting !== false)
      .map((column) => column.id)
    expect(sortableIds).toEqual(['number', 'lineItemCount', 'grandTotalNetAmount', 'grandTotalGrossAmount', 'createdAt'])
  })

  it.each([
    ['order', 'orders'],
    ['quote', 'quotes'],
  ] as const)('sends the selected %s sort to the API and resets to the first page', async (kind, resource) => {
    await act(async () => {
      render(<SalesDocumentsTable kind={kind} />)
    })

    await act(async () => {
      latestProps()?.pagination?.onPageChange?.(3)
    })
    expect(listUrls(resource).at(-1)).toContain('page=3')

    mockApiCall.mockClear()
    await act(async () => {
      latestProps()?.onSortingChange?.([{ id: 'number', desc: false }])
    })

    const url = listUrls(resource).at(-1)
    expect(url).toBeDefined()
    const params = new URLSearchParams(url!.split('?')[1])
    expect(params.get('sortField')).toBe('number')
    expect(params.get('sortDir')).toBe('asc')
    expect(params.get('page')).toBe('1')
    expect(latestProps()?.sorting).toEqual([{ id: 'number', desc: false }])
  })
})

describe('SalesDocumentsTable Date column (issue #9625)', () => {
  it.each(['2026-11-16T00:00:00.000Z', '2026-11-16'])(
    'shows placedAt %s as a calendar day in the application locale',
    async (placedAt) => {
      mockApiCall.mockResolvedValue({
        ok: true,
        result: { items: [{ id: 'order-1', placedAt, createdAt: '2026-11-12T23:30:00.000Z' }] },
      })

      await act(async () => {
        render(<SalesDocumentsTable kind="order" />)
      })

      expect(screen.getByText('16 lis 2026')).toBeInTheDocument()
    }
  )

  it.each([
    ['order', { createdAt: '2026-11-16T00:00:00.000Z' }, '2026-11-16T00:00:00.000Z'],
    ['quote', { validUntil: '2026-11-16T23:30:00.000Z' }, '2026-11-16T23:30:00.000Z'],
    ['quote', {}, null],
  ] as const)('preserves the %s fallback display for %j', async (kind, dates, timestamp) => {
    mockApiCall.mockResolvedValue({
      ok: true,
      result: { items: [{ id: 'doc-1', ...dates }] },
    })

    await act(async () => {
      render(<SalesDocumentsTable kind={kind} />)
    })

    expect(screen.getByText(timestamp ? new Date(timestamp).toLocaleString() : '—')).toBeInTheDocument()
  })
})
