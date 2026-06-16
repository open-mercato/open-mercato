/**
 * @jest-environment jsdom
 */
import type React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import ProductsDataTable from '../../../../components/products/ProductsDataTable'
import { apiCall, readApiResultOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { deleteCrud, buildCrudExportUrl } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useCustomFieldDefs } from '@open-mercato/ui/backend/utils/customFieldDefs'
import { applyCustomFieldVisibility } from '@open-mercato/ui/backend/utils/customFieldColumns'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'

const mockTranslate = (key: string, fallback?: string) => fallback ?? key

// Captures the column definitions passed to the (mocked) DataTable so individual
// cell renderers can be exercised directly in tests.
let mockLatestColumns: any[] = []

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  I18nProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

jest.mock('next/link', () => ({ children, href }: any) => <a href={href}>{children}</a>)

jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  withDataTableNamespaces: (mappedRow: Record<string, unknown>, sourceItem: Record<string, unknown>) => ({
    ...mappedRow,
    ...Object.fromEntries(Object.entries(sourceItem).filter(([key]) => key.startsWith('_'))),
  }),
  DataTable: (props: any) => {
    mockLatestColumns = props.columns
    return (
    <div data-testid="data-table-mock">
      <div data-testid="data-table-title">{props.title}</div>
      <div data-testid="data-table-cache-status">{props.pagination?.cacheStatus ?? ''}</div>
      <div data-testid="data-table-sticky-actions">{String(Boolean(props.stickyActionsColumn))}</div>
      <button data-testid="search-trigger" onClick={() => props.onSearchChange?.('widgets')}>
        trigger-search
      </button>
      <div data-testid="row-actions-wrapper">
        {props.rowActions?.({ id: 'prod-1', original: { id: 'prod-1', title: 'Mock product' } })}
      </div>
      {props.refreshButton ? (
        <button data-testid="refresh-button" onClick={() => props.refreshButton.onRefresh?.()}>
          {props.refreshButton.label}
        </button>
      ) : null}
      {props.actions}
    </div>
    )
  },
}))

jest.mock('@open-mercato/ui/primitives/button', () => ({
  Button: ({ children, asChild, ...rest }: any) =>
    asChild ? <span {...rest}>{children}</span> : <button {...rest}>{children}</button>,
}))

jest.mock('@open-mercato/ui/backend/RowActions', () => ({
  RowActions: ({ items }: any) => (
    <div>
      {items.map((item: any, idx: number) => (
        <button key={item.label} data-testid={`row-action-${idx}`} onClick={() => item.onSelect?.()}>
          {item.label}
        </button>
      ))}
    </div>
  ),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
  readApiResultOrThrow: jest.fn(),
  withScopedApiRequestHeaders: jest.fn((_headers: Record<string, string>, run: () => Promise<unknown>) => run()),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  deleteCrud: jest.fn(),
  buildCrudExportUrl: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/utils/customFieldDefs', () => ({
  useCustomFieldDefs: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/utils/customFieldColumns', () => ({
  applyCustomFieldVisibility: jest.fn((cols) => cols),
}))

jest.mock('@open-mercato/ui/backend/ValueIcons', () => ({
  BooleanIcon: ({ value }: { value: boolean }) => (
    <span data-testid="boolean-icon">{String(value)}</span>
  ),
}))

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => mockTranslate,
}))

jest.mock('lucide-react', () => ({
  RefreshCw: () => null,
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({
    confirm: jest.fn(() => {
      return new Promise<boolean>((resolve) => {
        // Auto-confirm after a tick
        setTimeout(() => resolve(true), 0)
      })
    }),
    ConfirmDialogElement: null,
  }),
}))

// Mock HTMLDialogElement methods for jsdom compatibility
HTMLDialogElement.prototype.showModal = jest.fn(function(this: HTMLDialogElement) {
  this.open = true
  this.setAttribute('open', '')
})
HTMLDialogElement.prototype.close = jest.fn(function(this: HTMLDialogElement) {
  this.open = false
  this.removeAttribute('open')
})

describe('ProductsDataTable', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(apiCall as jest.Mock).mockResolvedValue({
      ok: true,
      cacheStatus: 'hit',
      result: {
        items: [{ id: 'prod-1', title: 'Mock product', sku: 'SKU-001' }],
        total: 1,
        totalPages: 1,
      },
    })
    ;(readApiResultOrThrow as jest.Mock).mockResolvedValue({ items: [{ id: 'channel-1', name: 'Retail' }] })
    ;(withScopedApiRequestHeaders as jest.Mock).mockImplementation((_headers: Record<string, string>, run: () => Promise<unknown>) => run())
    ;(deleteCrud as jest.Mock).mockResolvedValue(undefined)
    ;(buildCrudExportUrl as jest.Mock).mockImplementation((_path: string, params: Record<string, string>) =>
      `export?${new URLSearchParams(params).toString()}`,
    )
    ;(useCustomFieldDefs as jest.Mock).mockReturnValue({ data: [], isLoading: false })
    ;(applyCustomFieldVisibility as jest.Mock).mockImplementation((cols) => cols)
    ;(useOrganizationScopeVersion as jest.Mock).mockReturnValue(1)
  })

  it('renders table title and loads catalog data', async () => {
    render(<ProductsDataTable />)

    await waitFor(() => {
      expect(apiCall).toHaveBeenCalled()
      expect(screen.getByTestId('data-table-cache-status')).toHaveTextContent('hit')
    })
    expect(screen.getByTestId('data-table-title')).toHaveTextContent('Products')
    expect(screen.getByTestId('data-table-sticky-actions')).toHaveTextContent('true')
    expect((apiCall as jest.Mock).mock.calls[0][0]).toContain('/api/catalog/products?page=1&pageSize=25')
    expect(applyCustomFieldVisibility).toHaveBeenCalled()
  })

  it('handles row deletion flow with confirmation', async () => {
    render(<ProductsDataTable />)
    await waitFor(() => expect(apiCall).toHaveBeenCalled())

    const deleteButton = await screen.findByTestId('row-action-1')
    fireEvent.click(deleteButton)

    // Wait for delete to complete (mock auto-confirms)
    await waitFor(() => expect(deleteCrud).toHaveBeenCalledWith('catalog/products', 'prod-1', expect.any(Object)))
    expect(flash).toHaveBeenCalledWith(expect.stringContaining('Product deleted'), 'success')
  })

  it('refreshes data when refresh button is clicked', async () => {
    render(<ProductsDataTable />)
    await waitFor(() => expect(apiCall).toHaveBeenCalledTimes(1))

    const refreshButton = screen.getByText('Refresh')
    fireEvent.click(refreshButton)

    await waitFor(() => expect(apiCall).toHaveBeenCalledTimes(2))
  })

  it('strips markdown formatting from the product description cell', async () => {
    render(<ProductsDataTable />)
    await waitFor(() => expect(mockLatestColumns.length).toBeGreaterThan(0))

    const titleColumn = mockLatestColumns.find((col) => col.accessorKey === 'title')
    expect(titleColumn).toBeTruthy()

    const cell = titleColumn.cell({
      row: { original: { id: 'p1', title: 'Widget', description: '# Heading\n\n**bold** _em_' } },
    }) as React.ReactElement
    const { container } = render(cell)

    expect(container.textContent).toContain('Heading bold em')
    expect(container.textContent).not.toContain('**')
    expect(container.textContent).not.toContain('#')
    expect(container.textContent).not.toContain('_')
  })
})
