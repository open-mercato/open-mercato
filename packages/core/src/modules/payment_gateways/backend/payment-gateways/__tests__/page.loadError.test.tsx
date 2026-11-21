/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SortingState } from '@tanstack/react-table'
import PaymentGatewaysPage from '../page'

const mockApiCall = jest.fn()
const mockFlash = jest.fn()
const mockTranslate = (_key: string, fallback?: string) => fallback ?? _key

const LOAD_ERROR = 'Failed to load payment transactions'
type TableProps = {
  data?: Array<Record<string, unknown>>
  error?: React.ReactNode
  isLoading?: boolean
  columns: Array<{ accessorKey?: string; enableSorting?: boolean }>
  sortable?: boolean
  manualSorting?: boolean
  sorting?: SortingState
  onSortingChange?: (sorting: SortingState) => void
  pagination: { onPageChange: (page: number) => void }
  onFiltersApply: (filters: Record<string, string>) => void
}
let mockTableProps: TableProps

jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => mockTranslate,
}))

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => 0,
}))

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageHeader: () => null,
  PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: (props: TableProps) => {
    mockTableProps = props
    return (
    <div data-testid="transactions-table" data-loading={String(Boolean(props.isLoading))}>
      {props.error ? <div data-testid="table-error">{props.error}</div> : null}
      <div data-testid="row-count">{(props.data ?? []).length}</div>
      <button onClick={() => props.onSortingChange?.([{ id: 'amount', desc: false }])}>Sort amount</button>
      <button onClick={() => props.onSortingChange?.([{ id: 'amount', desc: true }])}>Reverse amount</button>
      <button onClick={() => props.onSortingChange?.([])}>Clear sort</button>
      <button onClick={() => props.pagination.onPageChange(2)}>Next page</button>
      <button onClick={() => props.onFiltersApply({ providerKey: 'mock', status: 'captured' })}>Filter</button>
    </div>
    )
  },
}))

jest.mock('@open-mercato/ui/backend/injection/InjectionSpot', () => ({
  InjectionSpot: () => null,
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: async ({ operation }: { operation: () => Promise<unknown> }) => operation(),
    retryLastMutation: async () => false,
  }),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: (...args: unknown[]) => mockFlash(...args),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => mockApiCall(...args),
  apiCallOrThrow: jest.fn(),
}))

async function waitForLoaded() {
  await waitFor(() => expect(screen.getByTestId('transactions-table').getAttribute('data-loading')).toBe('false'))
}

describe('payment gateways transactions page load errors', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('passes the load error to the table instead of showing an empty list', async () => {
    mockApiCall.mockResolvedValue({ ok: false, status: 500, result: null })

    render(<PaymentGatewaysPage />)
    await waitForLoaded()

    expect(screen.getByTestId('table-error').textContent).toBe(LOAD_ERROR)
    expect(screen.getByTestId('row-count').textContent).toBe('0')
    expect(mockFlash).toHaveBeenCalledWith(LOAD_ERROR, 'error')
  })

  it('renders no table error when the list loads', async () => {
    mockApiCall.mockResolvedValue({
      ok: true,
      status: 200,
      result: { items: [], total: 0, page: 1, pageSize: 20, totalPages: 1 },
    })

    render(<PaymentGatewaysPage />)
    await waitForLoaded()

    expect(screen.queryByTestId('table-error')).toBeNull()
    expect(mockFlash).not.toHaveBeenCalled()
  })

  it('sorts on the server, retains sort through pages and filters, and resets to page one on a new order', async () => {
    mockApiCall.mockResolvedValue({ ok: true, result: { items: [], total: 40, page: 1, pageSize: 20, totalPages: 2 } })
    render(<PaymentGatewaysPage />)
    await waitForLoaded()
    const expectQuery = async (expected: Record<string, string>) => {
      await waitFor(() => {
        const url = new URL(mockApiCall.mock.calls.at(-1)?.[0] as string, 'http://localhost')
        for (const [key, value] of Object.entries(expected)) expect(url.searchParams.get(key)).toBe(value)
      })
    }

    fireEvent.click(screen.getByText('Sort amount'))
    await expectQuery({ sortField: 'amount', sortDir: 'asc', page: '1' })
    fireEvent.click(screen.getByText('Next page'))
    await expectQuery({ sortField: 'amount', sortDir: 'asc', page: '2' })
    fireEvent.click(screen.getByText('Filter'))
    await expectQuery({ sortField: 'amount', sortDir: 'asc', page: '1', providerKey: 'mock', status: 'captured' })
    fireEvent.click(screen.getByText('Next page'))
    await expectQuery({ page: '2' })
    fireEvent.click(screen.getByText('Reverse amount'))
    await expectQuery({ sortField: 'amount', sortDir: 'desc', page: '1', providerKey: 'mock', status: 'captured' })
    fireEvent.click(screen.getByText('Clear sort'))
    await waitFor(() => {
      const url = new URL(mockApiCall.mock.calls.at(-1)?.[0] as string, 'http://localhost')
      expect(url.searchParams.has('sortField')).toBe(false)
      expect(url.searchParams.has('sortDir')).toBe(false)
    })
  })

  it('enables server sorting only for the supported displayed fields', async () => {
    mockApiCall.mockResolvedValue({ ok: true, result: { items: [], total: 0, page: 1, pageSize: 20, totalPages: 1 } })
    render(<PaymentGatewaysPage />)
    await waitForLoaded()

    expect(mockTableProps.sortable).toBe(true)
    expect(mockTableProps.manualSorting).toBe(true)
    expect(mockTableProps.columns.filter((column) => column.enableSorting).map((column) => column.accessorKey))
      .toEqual(['providerKey', 'unifiedStatus', 'amount', 'updatedAt'])
  })
})
