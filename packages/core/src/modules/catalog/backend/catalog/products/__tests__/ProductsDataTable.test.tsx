/**
 * @jest-environment jsdom
 */
import type React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import ProductsDataTable from '../ProductsDataTable'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { deleteCrud, buildCrudExportUrl } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useCustomFieldDefs } from '@open-mercato/ui/backend/utils/customFieldDefs'
import { applyCustomFieldVisibility } from '@open-mercato/ui/backend/utils/customFieldColumns'
import { useOrganizationScopeVersion } from '@/lib/frontend/useOrganizationScope'

const mockTranslate = (key: string, fallback?: string) => fallback ?? key

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  I18nProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

jest.mock('next/link', () => ({ children, href }: any) => <a href={href}>{children}</a>)

jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: (props: any) => (
    <div data-testid="data-table-mock">
      <div data-testid="data-table-title">{props.title}</div>
      <button data-testid="search-trigger" onClick={() => props.onSearchChange?.('widgets')}>
        trigger-search
      </button>
      <div data-testid="row-actions-wrapper">
        {props.rowActions?.({ id: 'prod-1', original: { id: 'prod-1', name: 'Mock product' } })}
      </div>
      {props.actions}
    </div>
  ),
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

jest.mock('@/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: jest.fn(),
}))

jest.mock('@/lib/i18n/context', () => ({
  useT: () => mockTranslate,
}))

jest.mock('lucide-react', () => ({
  Plus: () => null,
  RefreshCw: () => null,
}))

describe('ProductsDataTable', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(apiCall as jest.Mock).mockResolvedValue({
      ok: true,
      result: {
        items: [{ id: 'prod-1', name: 'Mock product' }],
        total: 1,
        totalPages: 1,
      },
    })
    ;(readApiResultOrThrow as jest.Mock).mockResolvedValue({ items: [{ id: 'channel-1', name: 'Retail' }] })
    ;(deleteCrud as jest.Mock).mockResolvedValue(undefined)
    ;(buildCrudExportUrl as jest.Mock).mockImplementation((_path: string, params: Record<string, string>) =>
      `export?${new URLSearchParams(params).toString()}`,
    )
    ;(useCustomFieldDefs as jest.Mock).mockReturnValue({ data: [], isLoading: false })
    ;(applyCustomFieldVisibility as jest.Mock).mockImplementation((cols) => cols)
    ;(useOrganizationScopeVersion as jest.Mock).mockReturnValue(1)
    Object.defineProperty(window, 'confirm', {
      value: jest.fn().mockReturnValue(true),
      configurable: true,
    })
  })

  it('renders table title and loads catalog data', async () => {
    render(<ProductsDataTable />)

    await waitFor(() => expect(apiCall).toHaveBeenCalled())
    expect(screen.getByTestId('data-table-title')).toHaveTextContent('Products & services')
    expect((apiCall as jest.Mock).mock.calls[0][0]).toContain('/api/catalog/products?page=1&pageSize=25')
    expect(applyCustomFieldVisibility).toHaveBeenCalled()
  })

  it('handles row deletion flow with confirmation', async () => {
    render(<ProductsDataTable />)
    await waitFor(() => expect(apiCall).toHaveBeenCalled())

    const deleteButton = await screen.findByTestId('row-action-1')
    fireEvent.click(deleteButton)

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
})
