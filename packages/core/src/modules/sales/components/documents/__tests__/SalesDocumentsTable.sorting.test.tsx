/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, act } from '@testing-library/react'
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
  columns?: Array<{ id: string; enableSorting?: boolean }>
  pagination?: { onPageChange?: (page: number) => void }
  onSortingChange?: (sorting: SortingState) => void
}

const mockDataTable = jest.fn<void, [TestDataTableProps]>()
const mockApiCall = jest.fn()

jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  withDataTableNamespaces: (mappedRow: Record<string, unknown>) => mappedRow,
  DataTable: (props: TestDataTableProps) => {
    mockDataTable(props)
    return null
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
  return { useLocale: () => 'en', useT: () => translate }
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
