/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import ApiKeysListPage from '../api_keys/backend/api-keys/page'
import CurrenciesPage from '../currencies/backend/currencies/page'
import DirectoryTenantsPage from '../directory/backend/directory/tenants/page'

const apiCallMock = jest.fn()
const readApiResultMock = jest.fn()
const replaceMock = jest.fn()
const dataTableProps: { current: Record<string, unknown> | null } = { current: null }
let activePathname = '/backend/api-keys'
let activeQuery = ''
const mockTranslate = (key: string, fallback?: string) => fallback ?? key

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, push: jest.fn(), refresh: jest.fn() }),
  usePathname: () => activePathname,
  useSearchParams: () => new URLSearchParams(activeQuery),
}))

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/i18n/context'),
  useT: () => mockTranslate,
  useLocale: () => 'en',
}))

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => 1,
}))

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: (props: Record<string, unknown>) => {
    dataTableProps.current = props
    return <div data-testid="data-table" />
  },
}))

jest.mock('@open-mercato/ui/backend/filters/ListEmptyState', () => ({
  ListEmptyState: () => null,
}))

jest.mock('@open-mercato/ui/backend/RowActions', () => ({
  RowActions: () => null,
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: jest.fn(async () => true), ConfirmDialogElement: null }),
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

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
  apiCallOrThrow: jest.fn(),
  readApiResultOrThrow: (...args: unknown[]) => readApiResultMock(...args),
  withScopedApiRequestHeaders: (_headers: unknown, run: () => unknown) => run(),
}))

const emptyList = { items: [], total: 0, page: 1, totalPages: 1 }

function requestedUrls(): string[] {
  return [
    ...apiCallMock.mock.calls.map(([url]) => String(url)),
    ...readApiResultMock.mock.calls.map(([url]) => String(url)),
  ]
}

function findListUrl(prefix: string): string | undefined {
  return requestedUrls().filter((url) => url.startsWith(prefix)).at(-1)
}

function searchOf(url: string | undefined): string | null {
  return url ? new URL(url, 'http://test').searchParams.get('search') : null
}

const cases = [
  { name: 'api keys', Component: ApiKeysListPage, pathname: '/backend/api-keys', listPrefix: '/api/api_keys/keys?' },
  { name: 'currencies', Component: CurrenciesPage, pathname: '/backend/currencies', listPrefix: '/api/currencies/currencies?' },
  { name: 'directory tenants', Component: DirectoryTenantsPage, pathname: '/backend/directory/tenants', listPrefix: '/api/directory/tenants?' },
] as const

describe('backend list pages keep ?search as a permalink', () => {
  beforeEach(() => {
    dataTableProps.current = null
    replaceMock.mockReset()
    apiCallMock.mockReset()
    readApiResultMock.mockReset()
    apiCallMock.mockResolvedValue({ ok: true, status: 200, result: emptyList })
    readApiResultMock.mockResolvedValue(emptyList)
  })

  it.each(cases)('hydrates the $name search from the URL before the first list request', async ({ Component, pathname, listPrefix }) => {
    activePathname = pathname
    activeQuery = 'search=Harborview&tab=all'
    renderWithProviders(<Component />)

    await waitFor(() => expect(findListUrl(listPrefix)).toBeTruthy())
    const firstListUrl = requestedUrls().find((url) => url.startsWith(listPrefix))
    expect(searchOf(firstListUrl)).toBe('Harborview')
    expect(dataTableProps.current?.searchValue).toBe('Harborview')
    expect(replaceMock).not.toHaveBeenCalled()
  })

  it.each(cases)('mirrors $name search edits into the address bar without dropping other params', async ({ Component, pathname, listPrefix }) => {
    activePathname = pathname
    activeQuery = 'tab=all'
    renderWithProviders(<Component />)
    await waitFor(() => expect(findListUrl(listPrefix)).toBeTruthy())
    expect(searchOf(findListUrl(listPrefix))).toBeNull()

    await act(async () => {
      const onSearchChange = dataTableProps.current?.onSearchChange as (value: string) => void
      onSearchChange('Acme')
    })

    await waitFor(() => expect(searchOf(findListUrl(listPrefix))).toBe('Acme'))
    expect(replaceMock).toHaveBeenCalledTimes(1)
    expect(replaceMock).toHaveBeenCalledWith(`${pathname}?tab=all&search=Acme`, { scroll: false })
  })
})
