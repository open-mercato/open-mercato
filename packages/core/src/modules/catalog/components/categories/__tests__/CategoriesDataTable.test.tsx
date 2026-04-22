/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import CategoriesDataTable from '../CategoriesDataTable'

const mockUseQuery = jest.fn()
const mockUseQueryClient = jest.fn()
jest.mock('@tanstack/react-query', () => ({
  useQuery: (...args: any[]) => mockUseQuery(...args),
  useQueryClient: () => mockUseQueryClient(),
}))

const mockApiCall = jest.fn()
const mockApiCallOrThrow = jest.fn()
const mockReadApiResultOrThrow = jest.fn()
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: any[]) => mockApiCall(...args),
  apiCallOrThrow: (...args: any[]) => mockApiCallOrThrow(...args),
  readApiResultOrThrow: (...args: any[]) => mockReadApiResultOrThrow(...args),
}))

const mockFlash = jest.fn()
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: (...args: unknown[]) => mockFlash(...args),
}))

jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: ({ title, actions, data = [], isLoading }: any) => (
    <div data-testid="data-table">
      <h2>{title}</h2>
      <div data-testid="actions">{actions}</div>
      <div data-testid="data-count">{Array.isArray(data) ? data.length : 0}</div>
      {isLoading && <div data-testid="loading">Loading...</div>}
    </div>
  ),
}))

jest.mock('@open-mercato/ui/backend/FilterBar', () => ({}))

jest.mock('@open-mercato/ui/backend/RowActions', () => ({
  RowActions: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="row-actions">{children}</div>
  ),
}))

jest.mock('@open-mercato/ui/backend/ValueIcons', () => ({
  BooleanIcon: ({ value }: { value?: boolean }) => <span>{value ? 'Yes' : 'No'}</span>,
}))

jest.mock('@open-mercato/ui/primitives/button', () => ({
  Button: ({ children, asChild, ...props }: any) => (
    <button {...props} type={props.type || 'button'}>{children}</button>
  ),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => {
  const translate = (key: string, fallback?: string, vars?: Record<string, unknown>) => {
    const base = (fallback ?? key) as string
    if (vars) return base.replace(/\{\{(\w+)\}\}/g, (_, token) => String(vars[token] ?? ''))
    return base
  }
  return { useT: () => translate }
})

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => 1,
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({
    confirm: jest.fn().mockResolvedValue(true),
    ConfirmDialogElement: null,
  }),
}))

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, ...props }: any) => <a {...props}>{children}</a>,
}))

const sampleRows = [
  {
    id: 'cat-1',
    name: 'Electronics',
    slug: 'electronics',
    description: null,
    parentId: null,
    parentName: null,
    depth: 0,
    treePath: 'Electronics',
    pathLabel: 'Electronics',
    childCount: 2,
    descendantCount: 5,
    isActive: true,
  },
  {
    id: 'cat-2',
    name: 'Phones',
    slug: 'phones',
    description: null,
    parentId: 'cat-1',
    parentName: 'Electronics',
    depth: 1,
    treePath: 'Electronics / Phones',
    pathLabel: 'Electronics / Phones',
    childCount: 0,
    descendantCount: 0,
    isActive: true,
  },
]

describe('CategoriesDataTable', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockUseQuery.mockReturnValue({
      data: { items: sampleRows, total: 2, page: 1, pageSize: 50, totalPages: 1 },
      isLoading: false,
    })
    mockUseQueryClient.mockReturnValue({ invalidateQueries: jest.fn() })
    mockApiCall.mockResolvedValue({
      ok: true,
      result: { ok: true, granted: ['catalog.categories.manage'] },
    })
  })

  it('renders the Categories title', () => {
    render(<CategoriesDataTable />)
    expect(screen.getByText('Categories')).toBeInTheDocument()
  })

  it('renders rows from query data', () => {
    render(<CategoriesDataTable />)
    expect(screen.getByTestId('data-count')).toHaveTextContent('2')
  })

  it('shows Create button when user has manage permission', async () => {
    render(<CategoriesDataTable />)
    await waitFor(() => {
      expect(screen.getByText('Create')).toBeInTheDocument()
    })
  })

  it('hides Create button when user lacks manage permission', async () => {
    mockApiCall.mockResolvedValue({
      ok: true,
      result: { ok: false, granted: [] },
    })
    render(<CategoriesDataTable />)
    await waitFor(() => {
      expect(screen.queryByText('Create')).not.toBeInTheDocument()
    })
  })

  it('shows loading state', () => {
    mockUseQuery.mockReturnValue({ data: undefined, isLoading: true })
    render(<CategoriesDataTable />)
    expect(screen.getByTestId('loading')).toBeInTheDocument()
  })

  it('shows empty state with zero rows', () => {
    mockUseQuery.mockReturnValue({
      data: { items: [], total: 0, page: 1, pageSize: 50, totalPages: 0 },
      isLoading: false,
    })
    render(<CategoriesDataTable />)
    expect(screen.getByTestId('data-count')).toHaveTextContent('0')
    expect(screen.queryByTestId('loading')).not.toBeInTheDocument()
  })

  it('checks feature permission on mount', async () => {
    render(<CategoriesDataTable />)
    await waitFor(() => {
      expect(mockApiCall).toHaveBeenCalledWith(
        '/api/auth/feature-check',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('catalog.categories.manage'),
        }),
      )
    })
  })

  it('passes correct query key to useQuery', () => {
    render(<CategoriesDataTable />)
    expect(mockUseQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: expect.arrayContaining(['catalog-categories']),
      }),
    )
  })

  it('renders Create link pointing to create page', async () => {
    render(<CategoriesDataTable />)
    await waitFor(() => {
      const createLink = screen.getByText('Create').closest('a')
      expect(createLink).toHaveAttribute('href', '/backend/catalog/categories/create')
    })
  })
})
