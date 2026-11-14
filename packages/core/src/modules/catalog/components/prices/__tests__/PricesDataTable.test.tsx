/**
 * @jest-environment jsdom
 */
/**
 * Regression coverage for #8107: the Prices list's customer label lookup
 * only queried `/api/customers/people`, so a price rule scoped to a company
 * customer showed the raw `customerId` instead of a display name. It must
 * now merge labels resolved from both `/api/customers/people` and
 * `/api/customers/companies`.
 */
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import PricesDataTable from '../PricesDataTable'

const mockUseQuery = jest.fn()
jest.mock('@tanstack/react-query', () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}))

const mockApiCall = jest.fn()
const mockReadApiResultOrThrow = jest.fn()
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => mockApiCall(...args),
  apiCallOrThrow: jest.fn(),
  readApiResultOrThrow: (...args: unknown[]) => mockReadApiResultOrThrow(...args),
}))

type CapturedColumn = {
  id?: string
  cell: (props: { row: { original: Record<string, unknown> } }) => React.ReactNode
}

let capturedColumns: CapturedColumn[] = []
jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: ({ columns, data }: { columns: CapturedColumn[]; data?: Array<Record<string, unknown>> }) => {
    capturedColumns = columns
    return <div data-testid="data-table">{JSON.stringify(data?.length ?? 0)}</div>
  },
}))

jest.mock('@open-mercato/ui/backend/filters/ListEmptyState', () => ({
  ListEmptyState: () => <div />,
}))

jest.mock('@open-mercato/ui/backend/RowActions', () => ({ RowActions: () => <div /> }))

jest.mock('@open-mercato/ui/primitives/button', () => ({
  Button: ({ children }: { children?: React.ReactNode }) => <button type="button">{children}</button>,
}))

jest.mock('@open-mercato/ui/primitives/tag', () => ({
  Tag: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => 1,
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: jest.fn(), ConfirmDialogElement: null }),
}))

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}))

const PERSON_ID = '55555555-5555-4555-8555-555555555555'
const COMPANY_ID = '66666666-6666-4666-8666-666666666666'

const rows = [
  { id: 'price-1', kind: 'regular', minQuantity: 1, customerId: PERSON_ID },
  { id: 'price-2', kind: 'regular', minQuantity: 1, customerId: COMPANY_ID },
]

describe('PricesDataTable customer labels (#8107)', () => {
  beforeEach(() => {
    capturedColumns = []
    mockUseQuery.mockReturnValue({
      data: { items: rows, total: rows.length, page: 1, pageSize: 50, totalPages: 1 },
      isLoading: false,
    })
    mockApiCall.mockResolvedValue({ ok: true, result: { ok: false, granted: [] } })
    mockReadApiResultOrThrow.mockImplementation((url: string) => {
      if (url.startsWith('/api/customers/people')) {
        return Promise.resolve({ items: [{ id: PERSON_ID, displayName: 'Jane Doe' }] })
      }
      if (url.startsWith('/api/customers/companies')) {
        return Promise.resolve({ items: [{ id: COMPANY_ID, display_name: 'Acme Inc' }] })
      }
      return Promise.resolve({ items: [] })
    })
  })

  it('labels a company customerId using /api/customers/companies instead of the raw id', async () => {
    render(<PricesDataTable />)

    await waitFor(() => expect(capturedColumns.length).toBeGreaterThan(0))

    await waitFor(() => {
      const scopeColumn = capturedColumns.find((column) => column.id === 'scope')
      if (!scopeColumn) throw new Error('[internal] Scope column missing')
      const { container, unmount } = render(
        <>{scopeColumn.cell({ row: { original: rows[1] } })}</>,
      )
      try {
        expect(container.textContent).toContain('Acme Inc')
        expect(container.textContent).not.toContain(COMPANY_ID)
      } finally {
        unmount()
      }
    })
  })

  it('still labels a person customerId using /api/customers/people', async () => {
    render(<PricesDataTable />)

    await waitFor(() => expect(capturedColumns.length).toBeGreaterThan(0))

    await waitFor(() => {
      const scopeColumn = capturedColumns.find((column) => column.id === 'scope')
      if (!scopeColumn) throw new Error('[internal] Scope column missing')
      const { container, unmount } = render(
        <>{scopeColumn.cell({ row: { original: rows[0] } })}</>,
      )
      try {
        expect(container.textContent).toContain('Jane Doe')
      } finally {
        unmount()
      }
    })
  })
})
