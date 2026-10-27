/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import CustomersPeoplePage from '../people/page'
import CustomersCompaniesPage from '../companies/page'

const apiCallMock = jest.fn()
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
    },
  },
}), { virtual: true })

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => 1,
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  I18nProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useT: () => mockT,
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: jest.fn(async () => true), ConfirmDialogElement: null }),
}))

jest.mock('@open-mercato/ui/backend/utils/customFieldDefs', () => ({
  useCustomFieldDefs: () => ({ data: [] }),
}))

jest.mock('@open-mercato/ui/backend/utils/customFieldColumns', () => ({
  mapCustomFieldKindToFilterType: jest.fn(() => 'text'),
  normalizeCustomFieldFilterOptions: jest.fn(() => []),
  supportsCustomFieldColumn: jest.fn(() => false),
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
  ensureCustomerDictionary: jest.fn(async () => ({ map: {}, entries: [] })),
}))

jest.mock('../../../components/detail/assignableStaff', () => ({
  ensureCurrentUserFilterOption: (options: unknown[]) => options,
  fetchAssignableStaffMembers: jest.fn(async () => []),
  mapAssignableStaffToFilterOptions: jest.fn(() => []),
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
    apiCallMock.mockReset()
    replaceMock.mockReset()
    pushMock.mockReset()
    apiCallMock.mockResolvedValue({
      ok: true,
      result: { items: [], total: 0, page: 1, totalPages: 1 },
      cacheStatus: null,
    })
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
})
