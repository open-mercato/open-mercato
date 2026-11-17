/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import CustomersPeoplePage from '../people/page'
import CustomersCompaniesPage from '../companies/page'
import CustomersDealsPage from '../deals/page'
import type { CustomFieldDefDto } from '@open-mercato/ui/backend/utils/customFieldDefs'
import ProductsDataTable from '@open-mercato/core/modules/catalog/components/products/ProductsDataTable'
import { QueryClient } from '@tanstack/react-query'

const apiCallMock = jest.fn()
const readDefinitionsMock = jest.fn()
const replaceMock = jest.fn()
const pushMock = jest.fn()
const dataTablePropsCapture: { current: Record<string, unknown> | null } = { current: null }
const mockT = (_key: string, fallback?: string, params?: Record<string, unknown>) => {
  if (!fallback) return _key
  return Object.entries(params ?? {}).reduce(
    (label, [key, value]) => label.replace(`{${key}}`, String(value)),
    fallback,
  )
}
let activePathname = '/backend/customers/people'
let activeQuery = 'search=Harborview'
let mockCustomFieldDefs: CustomFieldDefDto[] = []
let mockCustomFieldDefsLoading = false
let mockUseRealCustomFields = false
let mockScopeVersion = 1
let mockProductEvent: (() => void) | undefined
const columnSnapshots: string[][] = []

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, push: pushMock }),
  usePathname: () => activePathname,
  useSearchParams: () => new URLSearchParams(activeQuery),
}))

jest.mock('@open-mercato/core/modules/customers/extension-points', () => ({
  extensionPoints: {
    hosts: {
      peopleTable: { tableId: 'customers.people.list' },
      companiesTable: { tableId: 'customers.companies.list' },
      dealsTable: { tableId: 'customers.deals.list' },
    },
  },
}))

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: (props: Record<string, unknown>) => {
    dataTablePropsCapture.current = props
    columnSnapshots.push((props.columns as Array<{ accessorKey?: string; id?: string }>).map((column) => column.accessorKey ?? column.id ?? ''))
    return <div data-testid="data-table" />
  },
  withDataTableNamespaces: <T,>(row: T) => row,
}))

jest.mock('@open-mercato/ui/primitives/button', () => ({
  Button: ({ children }: React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }) => <>{children}</>,
}))

jest.mock('@open-mercato/ui/backend/RowActions', () => ({
  RowActions: () => null,
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
  apiCallOrThrow: jest.fn(),
  readApiResultOrThrow: (url: string) => url.startsWith('/api/entities/definitions?') ? readDefinitionsMock(url) : Promise.resolve({ items: [] }),
}))

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  buildCrudExportUrl: jest.fn(() => '/export'),
}))

jest.mock('@open-mercato/ui/backend/utils/bulkDelete', () => ({
  groupBulkDeleteFailures: jest.fn(() => []),
  runBulkDelete: jest.fn(async () => ({ succeeded: [], failures: [] })),
}))

jest.mock('@open-mercato/ui/backend/operations/store', () => ({
  coalesceLastOperations: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: async <T,>({ operation }: { operation: () => Promise<T> }) => operation(),
    retryLastMutation: async () => true,
  }),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('#generated/entities.ids.generated', () => ({
  E: {
    customers: {
      customer_entity: 'customers.customer_entity',
      customer_person_profile: 'customers.customer_person_profile',
      customer_company_profile: 'customers.customer_company_profile',
      customer_deal: 'customers.customer_deal',
    },
    catalog: { catalog_product: 'catalog.catalog_product' },
  },
}), { virtual: true })

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => mockScopeVersion,
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  I18nProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useT: () => mockT,
  useLocale: () => 'en',
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: jest.fn(async () => true), ConfirmDialogElement: null }),
}))

jest.mock('@open-mercato/ui/backend/utils/customFieldDefs', () => {
  const actual = jest.requireActual<typeof import('@open-mercato/ui/backend/utils/customFieldDefs')>('@open-mercato/ui/backend/utils/customFieldDefs')
  return {
    ...actual,
    useCustomFieldDefs: (...args: Parameters<typeof actual.useCustomFieldDefs>) => mockUseRealCustomFields
      ? actual.useCustomFieldDefs(...args)
      : { data: mockCustomFieldDefs, isLoading: mockCustomFieldDefsLoading, refetch: jest.fn(async () => ({})) },
  }
})

jest.mock('@open-mercato/ui/backend/injection/useAppEvent', () => ({
  useAppEvent: (_event: string, handler: () => void) => { mockProductEvent = handler },
}))

jest.mock('@open-mercato/ui/backend/utils/customFieldColumns', () => ({
  mapCustomFieldKindToFilterType: jest.fn(() => 'text'),
  normalizeCustomFieldFilterOptions: jest.fn(() => []),
  supportsCustomFieldColumn: jest.fn(() => true),
  applyCustomFieldVisibility: jest.requireActual<typeof import('@open-mercato/ui/backend/utils/customFieldColumns')>('@open-mercato/ui/backend/utils/customFieldColumns').applyCustomFieldVisibility,
}))

jest.mock('@open-mercato/ui/backend/utils/useAutoDiscoveredFields', () => ({
  useAutoDiscoveredFields: () => ({ advancedFilterFields: [] }),
}))

jest.mock('@open-mercato/ui/backend/hooks/useAdvancedFilter', () => ({
  useAdvancedFilterTree: ({ initial }: { initial: { root: { children: unknown[] } } }) => ({
    tree: initial,
    appliedTree: initial,
    setTree: jest.fn(),
    replaceTree: jest.fn(),
    flush: jest.fn(),
    clear: jest.fn(),
    dispatch: jest.fn(),
    pendingErrors: [],
  }),
}))

jest.mock('@open-mercato/ui/backend/filters/AdvancedFilterPanel', () => ({
  AdvancedFilterPanel: () => null,
}))

jest.mock('@open-mercato/ui/backend/filters/ActiveFilterChips', () => ({
  ActiveFilterChips: () => null,
}))

jest.mock('@open-mercato/ui/backend/filters/ListEmptyState', () => ({
  ListEmptyState: () => null,
}))

jest.mock('@open-mercato/ui/backend/utils/useCurrentUserId', () => ({
  useCurrentUserId: () => 'user-1',
}))

jest.mock('../../../lib/dictionaries', () => ({
  DictionaryValue: ({ fallback }: { fallback: React.ReactNode }) => <>{fallback}</>,
  createEmptyCustomerDictionaryMaps: () => ({
    statuses: {},
    sources: {},
    'lifecycle-stages': {},
  }),
  renderDictionaryColor: () => null,
  renderDictionaryIcon: () => null,
}))

jest.mock('../../../components/detail/hooks/useCustomerDictionary', () => ({
  invalidateCustomerDictionary: jest.fn(async () => {}),
  ensureCustomerDictionary: jest.fn(async () => ({ map: {}, entries: [] })),
}))

jest.mock('../../../components/detail/assignableStaff', () => ({
  ensureCurrentUserFilterOption: (options: unknown[]) => options,
  fetchAssignableStaffMembers: jest.fn(async () => []),
  mapAssignableStaffToFilterOptions: jest.fn(() => []),
}))

jest.mock('../../../lib/assignableStaff', () => ({
  ensureCurrentUserFilterOption: (options: unknown[]) => options,
  fetchCurrentUserName: jest.fn(async () => null),
  fetchAssignableStaffMembers: jest.fn(async () => []),
  mapAssignableStaffToFilterOptions: jest.fn(() => []),
}))

jest.mock('@open-mercato/ui/backend/injection/useRegisteredComponent', () => ({
  useRegisteredComponent: (_componentId: string, fallback: React.ComponentType) => fallback,
}))

jest.mock('../deals/pipeline/components/ViewTabsRow', () => ({
  ViewTabsRow: () => null,
  VIEW_TABS_ROW_COMPONENT_ID: 'customers.deals.view-tabs',
}))

jest.mock('../../../components/DealsKpiStrip', () => ({
  DealsKpiStrip: () => null,
}))

jest.mock('../deals/components/ReassignOwnerDialog', () => ({
  ReassignOwnerDialog: () => null,
}))

jest.mock('../../../components/list/CollectionPreviewCell', () => ({
  CollectionPreviewCell: () => null,
  normalizeCollectionLabels: (values: string[]) => values.filter(Boolean),
}))

function findRequestedUrl(prefix: string): string {
  return String(apiCallMock.mock.calls.find(([url]) => String(url).startsWith(prefix))?.[0] ?? '')
}

describe('customer list URL search state', () => {
  beforeEach(() => {
    activePathname = '/backend/customers/people'
    activeQuery = 'search=Harborview'
    dataTablePropsCapture.current = null
    mockCustomFieldDefs = []
    mockCustomFieldDefsLoading = false
    mockUseRealCustomFields = false
    mockScopeVersion = 1
    mockProductEvent = undefined
    columnSnapshots.length = 0
    readDefinitionsMock.mockReset()
    apiCallMock.mockReset()
    replaceMock.mockReset()
    pushMock.mockReset()
    apiCallMock.mockResolvedValue({
      ok: true,
      result: { items: [], total: 0, page: 1, totalPages: 1 },
      cacheStatus: null,
    })
  })

  it.each([
    ['people', CustomersPeoplePage],
    ['companies', CustomersCompaniesPage],
    ['deals', CustomersDealsPage],
    ['products', ProductsDataTable],
  ] as const)('retains %s custom columns throughout a pending definitions refresh', async (_listName, ListPage) => {
    mockUseRealCustomFields = true
    readDefinitionsMock.mockResolvedValueOnce({ items: [{ key: 'priority', kind: 'text', label: 'Priority' }] })
    let finishRefresh!: (value: { items: CustomFieldDefDto[] }) => void
    readDefinitionsMock.mockImplementationOnce(() => new Promise((resolve) => { finishRefresh = resolve }))
    renderWithProviders(<ListPage />)
    await waitFor(() => expect(columnSnapshots.at(-1)).toContain('cf_priority'))
    columnSnapshots.length = 0

    await act(async () => {
      const refresh = dataTablePropsCapture.current?.refreshButton as { onRefresh: () => void }
      refresh.onRefresh()
    })
    await waitFor(() => expect(readDefinitionsMock).toHaveBeenCalledTimes(2))
    expect(columnSnapshots.length).toBeGreaterThan(0)
    expect(columnSnapshots.every((columns) => columns.includes('cf_priority'))).toBe(true)

    await act(async () => { finishRefresh({ items: [{ key: 'priority', kind: 'text', label: 'Updated priority' }] }) })
    await waitFor(() => expect(dataTablePropsCapture.current?.columns).toEqual(expect.arrayContaining([
      expect.objectContaining({ accessorKey: 'cf_priority', header: 'Updated priority' }),
    ])))
  })

  it('does not reuse the previous scope definitions while a different scope loads', async () => {
    mockUseRealCustomFields = true
    readDefinitionsMock.mockResolvedValueOnce({ items: [{ key: 'private_scope_one', kind: 'text', label: 'Scope one' }] })
    let finishScopeChange!: (value: { items: CustomFieldDefDto[] }) => void
    readDefinitionsMock.mockImplementationOnce(() => new Promise((resolve) => { finishScopeChange = resolve }))
    const { rerender } = renderWithProviders(<CustomersCompaniesPage />)
    await waitFor(() => expect(columnSnapshots.at(-1)).toContain('cf_private_scope_one'))

    mockScopeVersion = 2
    rerender(<CustomersCompaniesPage />)
    await waitFor(() => expect(readDefinitionsMock).toHaveBeenCalledTimes(2))
    expect(columnSnapshots.at(-1)).not.toContain('cf_private_scope_one')
    expect(dataTablePropsCapture.current?.isLoading).toBe(true)
    await act(async () => { finishScopeChange({ items: [{ key: 'scope_two', kind: 'text', label: 'Scope two' }] }) })
    await waitFor(() => expect(columnSnapshots.at(-1)).toContain('cf_scope_two'))
  })

  it('retains product columns when a product event refreshes rows', async () => {
    mockUseRealCustomFields = true
    readDefinitionsMock.mockResolvedValueOnce({ items: [{ key: 'priority', kind: 'text', label: 'Priority' }] })
    readDefinitionsMock.mockImplementationOnce(() => new Promise(() => {}))
    renderWithProviders(<ProductsDataTable />)
    await waitFor(() => expect(columnSnapshots.at(-1)).toContain('cf_priority'))
    columnSnapshots.length = 0

    await act(async () => { mockProductEvent?.() })
    expect(columnSnapshots.length).toBeGreaterThan(0)
    expect(columnSnapshots.every((columns) => columns.includes('cf_priority'))).toBe(true)
    expect(readDefinitionsMock).toHaveBeenCalledTimes(1)
  })

  it('retains established columns when refreshing definitions fails', async () => {
    mockUseRealCustomFields = true
    readDefinitionsMock.mockResolvedValueOnce({ items: [{ key: 'priority', kind: 'text', label: 'Priority' }] })
    readDefinitionsMock.mockRejectedValueOnce(new Error('Definitions unavailable'))
    renderWithProviders(<CustomersCompaniesPage />, {
      queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }),
    })
    await waitFor(() => expect(columnSnapshots.at(-1)).toContain('cf_priority'))
    columnSnapshots.length = 0

    await act(async () => {
      const refresh = dataTablePropsCapture.current?.refreshButton as { onRefresh: () => void }
      refresh.onRefresh()
    })
    await waitFor(() => expect(readDefinitionsMock).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(dataTablePropsCapture.current?.isLoading).toBe(false))
    expect(columnSnapshots.every((columns) => columns.includes('cf_priority'))).toBe(true)
  })

  it('hydrates the people list search from the URL before loading data', async () => {
    renderWithProviders(<CustomersPeoplePage />)

    await waitFor(() => {
      expect(findRequestedUrl('/api/customers/people?')).toBeTruthy()
    })

    const requestedUrl = findRequestedUrl('/api/customers/people?')
    expect(new URL(requestedUrl, 'http://test').searchParams.get('search')).toBe('Harborview')
    expect(dataTablePropsCapture.current?.searchValue).toBe('Harborview')
    expect(replaceMock).not.toHaveBeenCalledWith('/backend/customers/people', expect.anything())
  })

  it('hydrates the companies list search from the URL before loading data', async () => {
    activePathname = '/backend/customers/companies'
    renderWithProviders(<CustomersCompaniesPage />)

    await waitFor(() => {
      expect(findRequestedUrl('/api/customers/companies?')).toBeTruthy()
    })

    const requestedUrl = findRequestedUrl('/api/customers/companies?')
    expect(new URL(requestedUrl, 'http://test').searchParams.get('search')).toBe('Harborview')
    expect(dataTablePropsCapture.current?.searchValue).toBe('Harborview')
    expect(replaceMock).not.toHaveBeenCalledWith('/backend/customers/companies', expect.anything())
  })

  it.each([
    ['people', CustomersPeoplePage],
    ['companies', CustomersCompaniesPage],
    ['deals', CustomersDealsPage],
    ['products', ProductsDataTable],
  ] as const)('keeps the %s list loading until custom-field columns resolve', async (listName, CustomersListPage) => {
    activePathname = `/backend/customers/${listName}`
    activeQuery = ''
    mockCustomFieldDefsLoading = true
    apiCallMock.mockResolvedValue({
      ok: true,
      result: {
        items: [{ id: 'customer-1', display_name: 'Customer one', title: 'Customer one' }],
        total: 1,
        totalPages: 1,
      },
      cacheStatus: null,
    })
    const { rerender } = renderWithProviders(<CustomersListPage />)

    await waitFor(() => expect(dataTablePropsCapture.current?.data).toEqual([
      expect.objectContaining({ id: 'customer-1' }),
    ]))
    expect(dataTablePropsCapture.current?.isLoading).toBe(true)

    mockCustomFieldDefs = [{ key: 'priority', kind: 'text', label: 'Priority' }]
    mockCustomFieldDefsLoading = false
    rerender(<CustomersListPage />)

    await waitFor(() => expect(dataTablePropsCapture.current?.isLoading).toBe(false))
    expect(dataTablePropsCapture.current?.columns).toEqual(expect.arrayContaining([
      expect.objectContaining({ accessorKey: 'cf_priority' }),
    ]))
  })
})
