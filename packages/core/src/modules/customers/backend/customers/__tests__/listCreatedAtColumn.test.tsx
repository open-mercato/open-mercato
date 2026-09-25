/**
 * @jest-environment jsdom
 *
 * Regression coverage for the Created column on the People and Companies lists:
 * the column definition (header, created_at filter key, date filter type), the
 * created_at -> createdAt row mapping, the rendered date, and the sort wiring that
 * sends sortField=createdAt to the list API.
 */
import * as React from 'react'
import { act, render, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import type { AdvancedFilterTree } from '@open-mercato/shared/lib/query/advanced-filter-tree'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { USER_TIMEZONE } from '../../../lib/localDay'
import { expandCreatedAtDayRules } from '../../../lib/createdAtDayFilter'
import CustomersPeoplePage from '../people/page'
import CustomersCompaniesPage from '../companies/page'

const apiCallMock = jest.fn()
const replaceMock = jest.fn()
const pushMock = jest.fn()
const dataTablePropsCapture: { current: Record<string, unknown> | null } = { current: null }
const filterPanelPropsCapture: { current: Record<string, unknown> | null } = { current: null }
const mockT = (_key: string, fallback?: string, params?: Record<string, unknown>) => {
  if (!fallback) return _key
  return Object.entries(params ?? {}).reduce(
    (label, [key, value]) => label.replace(`{${key}}`, String(value)),
    fallback,
  )
}
let activePathname = '/backend/customers/people'
let activeQuery = ''

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
  AdvancedFilterPanel: (props: Record<string, unknown>) => {
    filterPanelPropsCapture.current = props
    return null
  },
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

type CapturedColumn = {
  accessorKey?: string
  header?: unknown
  meta?: Record<string, unknown>
  cell?: (context: { row: { original: Record<string, unknown> } }) => React.ReactNode
}

const CREATED_AT = '2026-01-05T10:00:00.000Z'

const surfaces = [
  {
    label: 'people',
    Page: CustomersPeoplePage,
    pathname: '/backend/customers/people',
    apiPrefix: '/api/customers/people?',
    item: { id: 'person-1', display_name: 'Ada Lovelace', created_at: CREATED_AT },
  },
  {
    label: 'companies',
    Page: CustomersCompaniesPage,
    pathname: '/backend/customers/companies',
    apiPrefix: '/api/customers/companies?',
    item: { id: 'company-1', display_name: 'Harborview Analytics', created_at: CREATED_AT },
  },
]

function listRequests(prefix: string): URLSearchParams[] {
  return apiCallMock.mock.calls
    .map(([url]) => String(url))
    .filter((url) => url.startsWith(prefix))
    .map((url) => new URL(url, 'http://test').searchParams)
}

function capturedColumns(): CapturedColumn[] {
  return (dataTablePropsCapture.current?.columns ?? []) as CapturedColumn[]
}

describe.each(surfaces)('$label list — Created column', ({ Page, pathname, apiPrefix, item }) => {
  beforeEach(() => {
    activePathname = pathname
    activeQuery = ''
    dataTablePropsCapture.current = null
    apiCallMock.mockReset()
    replaceMock.mockReset()
    pushMock.mockReset()
    apiCallMock.mockImplementation(async (url: unknown) => {
      if (String(url).startsWith(apiPrefix)) {
        return { ok: true, result: { items: [item], total: 1, page: 1, totalPages: 1 }, cacheStatus: null }
      }
      return { ok: true, result: { items: [], total: 0, page: 1, totalPages: 1 }, cacheStatus: null }
    })
  })

  it('declares a date-filterable Created column backed by created_at', async () => {
    renderWithProviders(<Page />)
    await waitFor(() => expect(capturedColumns().length).toBeGreaterThan(0))

    const column = capturedColumns().find((candidate) => candidate.accessorKey === 'createdAt')
    expect(column).toBeDefined()
    expect(column?.header).toBe('Created')
    expect(column?.meta).toMatchObject({ filterKey: 'created_at', filterType: 'date', columnChooserGroup: 'Dates' })
  })

  it('maps created_at onto the row and renders it as a date', async () => {
    renderWithProviders(<Page />)
    await waitFor(() => {
      const rows = (dataTablePropsCapture.current?.data ?? []) as Array<Record<string, unknown>>
      expect(rows[0]?.createdAt).toBe(CREATED_AT)
    })

    const rows = dataTablePropsCapture.current?.data as Array<Record<string, unknown>>
    const column = capturedColumns().find((candidate) => candidate.accessorKey === 'createdAt')
    const { container } = render(<>{column?.cell?.({ row: { original: rows[0] } })}</>)
    expect(container.textContent).toBe(new Date(CREATED_AT).toLocaleDateString())
  })

  it('requests the list sorted by createdAt when the column is sorted', async () => {
    renderWithProviders(<Page />)
    await waitFor(() => expect(listRequests(apiPrefix).length).toBeGreaterThan(0))

    const onSortingChange = dataTablePropsCapture.current?.onSortingChange as (sorting: Array<{ id: string; desc: boolean }>) => void
    act(() => onSortingChange([{ id: 'createdAt', desc: true }]))

    await waitFor(() => {
      const latest = listRequests(apiPrefix).at(-1)
      expect(latest?.get('sortField')).toBe('createdAt')
      expect(latest?.get('sortDir')).toBe('desc')
    })
  })
})

function createdAtIsDayQuery(day: string): string {
  const params = new URLSearchParams()
  params.set('filter[v]', '2')
  params.set('filter[root][combinator]', 'and')
  params.set('filter[root][children][0][type]', 'rule')
  params.set('filter[root][children][0][field]', 'created_at')
  params.set('filter[root][children][0][op]', 'is')
  params.set('filter[root][children][0][value]', day)
  return params.toString()
}

describe.each(surfaces)('$label list — Created filter in the reader time zone', ({ Page, pathname, apiPrefix, item }) => {
  const displayedDay = '2026-01-17'
  const createdJustAfterLocalMidnight = fromZonedTime(`${displayedDay}T00:30:00.000`, USER_TIMEZONE).toISOString()

  beforeEach(() => {
    activePathname = pathname
    activeQuery = createdAtIsDayQuery(displayedDay)
    dataTablePropsCapture.current = null
    apiCallMock.mockReset()
    replaceMock.mockReset()
    apiCallMock.mockImplementation(async (url: unknown) => {
      if (String(url).startsWith(apiPrefix)) {
        const row = { ...item, created_at: createdJustAfterLocalMidnight }
        return { ok: true, result: { items: [row], total: 1, page: 1, totalPages: 1 }, cacheStatus: null }
      }
      return { ok: true, result: { items: [], total: 0, page: 1, totalPages: 1 }, cacheStatus: null }
    })
  })

  it('sends the displayed day as instant bounds in the reader time zone', async () => {
    renderWithProviders(<Page />)
    await waitFor(() => expect(listRequests(apiPrefix).length).toBeGreaterThan(0))

    const request = listRequests(apiPrefix)[0]
    expect(request.get('filter[root][children][0][field]')).toBe('created_at')
    expect(request.get('filter[root][children][0][op]')).toBe('between')
    const [start, end] = JSON.parse(request.get('filter[root][children][0][value]') ?? '[]') as string[]
    expect(start).toBe(fromZonedTime(`${displayedDay}T00:00:00.000`, USER_TIMEZONE).toISOString())
    expect(end).toBe(fromZonedTime(`${displayedDay}T23:59:59.999`, USER_TIMEZONE).toISOString())
  })

  it('matches a record created just after local midnight on the day its Created cell shows', async () => {
    renderWithProviders(<Page />)
    await waitFor(() => {
      const rows = (dataTablePropsCapture.current?.data ?? []) as Array<Record<string, unknown>>
      expect(rows[0]?.createdAt).toBe(createdJustAfterLocalMidnight)
    })

    const rows = dataTablePropsCapture.current?.data as Array<Record<string, unknown>>
    const column = capturedColumns().find((candidate) => candidate.accessorKey === 'createdAt')
    const { container } = render(<>{column?.cell?.({ row: { original: rows[0] } })}</>)
    expect(container.textContent).toBe(new Date(`${displayedDay}T12:00:00`).toLocaleDateString())

    const request = listRequests(apiPrefix)[0]
    const [start, end] = JSON.parse(request.get('filter[root][children][0][value]') ?? '[]') as string[]
    const createdAt = Date.parse(createdJustAfterLocalMidnight)
    expect(createdAt).toBeGreaterThanOrEqual(Date.parse(start))
    expect(createdAt).toBeLessThanOrEqual(Date.parse(end))
  })

  it('keeps the bare day in the page URL', async () => {
    renderWithProviders(<Page />)
    await waitFor(() => expect(listRequests(apiPrefix).length).toBeGreaterThan(0))
    for (const [url] of replaceMock.mock.calls) {
      expect(new URL(String(url), 'http://test').searchParams.get('filter[root][children][0][value]')).toBe(displayedDay)
    }
  })
})

type FilterPreset = { id: string; build: (context: { now: Date; userId?: string | null }) => AdvancedFilterTree }

describe('companies list — Recently created preset', () => {
  beforeEach(() => {
    activePathname = '/backend/customers/companies'
    activeQuery = ''
    filterPanelPropsCapture.current = null
    apiCallMock.mockReset()
    apiCallMock.mockResolvedValue({ ok: true, result: { items: [], total: 0, page: 1, totalPages: 1 }, cacheStatus: null })
  })

  it('starts at local midnight seven days ago once sent to the API', async () => {
    renderWithProviders(<CustomersCompaniesPage />)
    await waitFor(() => expect(filterPanelPropsCapture.current?.presets).toBeDefined())

    const presets = filterPanelPropsCapture.current?.presets as FilterPreset[]
    const preset = presets.find((candidate) => candidate.id === 'recently-created')
    const now = new Date('2026-09-24T12:00:00.000Z')
    const tree = preset!.build({ now, userId: null })
    const [presetRule] = tree.root.children
    expect(presetRule).toMatchObject({ field: 'created_at', operator: 'is_after' })

    const sentRule = expandCreatedAtDayRules(tree, USER_TIMEZONE).root.children[0]
    const firstIncludedDay = formatInTimeZone(new Date(now.getTime() - 7 * 24 * 3600 * 1000), USER_TIMEZONE, 'yyyy-MM-dd')
    const localMidnight = fromZonedTime(`${firstIncludedDay}T00:00:00.000`, USER_TIMEZONE).getTime()
    expect(sentRule).toMatchObject({ operator: 'greater_than', value: new Date(localMidnight - 1).toISOString() })
  })
})
