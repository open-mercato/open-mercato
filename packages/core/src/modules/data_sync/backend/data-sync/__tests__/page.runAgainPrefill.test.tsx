/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

const apiCallMock = jest.fn()
const routerReplaceMock = jest.fn()
let searchParams = new URLSearchParams()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
  withScopedApiRequestHeaders: (_headers: unknown, run: () => unknown) => run(),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({ runMutation: jest.fn(), retryLastMutation: jest.fn() }),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/backend/DataTable', () => ({ DataTable: () => <div data-testid="runs-table" /> }))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: jest.fn(), ConfirmDialogElement: null }),
}))

jest.mock('../../../components/useDataSyncRunAccess', () => ({
  useDataSyncRunAccess: () => ({ canRunSync: true }),
}))

jest.mock('next/navigation', () => ({
  usePathname: () => '/backend/data-sync',
  useRouter: () => ({ push: jest.fn(), replace: routerReplaceMock }),
  useSearchParams: () => searchParams,
}))

import SyncRunsDashboardPage from '../page'

const OPTIONS = {
  items: [{
    integrationId: 'erp-ambra',
    title: 'ERP Ambra',
    description: null,
    providerKey: 'ambra',
    direction: 'import',
    runMode: 'generic',
    canStartRun: true,
    supportedEntities: ['customers', 'price_lists'],
    runParameters: [{ key: 'segment', label: 'Segment', type: 'text' }],
    startControls: {},
    hasCredentials: true,
    isEnabled: true,
    settingsPath: '/backend/integrations/erp-ambra',
  }],
}

const SOURCE_RUN = {
  id: 'run-9',
  integrationId: 'erp-ambra',
  entityType: 'price_lists',
  direction: 'import',
  status: 'completed',
  parameters: { segment: 'b2b-active', legacy_region: 'emea' },
}

function mockApi(runResponse: { ok: boolean; status: number; result: unknown } | null = null) {
  apiCallMock.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/data_sync/options')) return { ok: true, status: 200, result: OPTIONS }
    if (url.startsWith('/api/data_sync/runs/')) {
      return runResponse ?? { ok: true, status: 200, result: SOURCE_RUN }
    }
    if (url.startsWith('/api/data_sync/runs')) {
      return { ok: true, status: 200, result: { items: [], total: 0, page: 1, totalPages: 1 } }
    }
    if (url.startsWith('/api/data_sync/schedules')) return { ok: true, status: 200, result: { items: [] } }
    return { ok: false, status: 404, result: null }
  })
}

beforeEach(() => {
  apiCallMock.mockReset()
  routerReplaceMock.mockReset()
  searchParams = new URLSearchParams()
})

describe('SyncRunsDashboardPage ?from= prefill', () => {
  it('seeds the form from the named run', async () => {
    searchParams = new URLSearchParams('from=run-9')
    mockApi()
    renderWithProviders(<SyncRunsDashboardPage />)

    expect(await screen.findByText(/copied from erp-ambra/i)).toBeInTheDocument()
  })

  it('names the dropped parameter the adapter no longer declares', async () => {
    searchParams = new URLSearchParams('from=run-9')
    mockApi()
    renderWithProviders(<SyncRunsDashboardPage />)

    expect(await screen.findByText(/legacy_region is no longer declared/i)).toBeInTheDocument()
  })

  /**
   * `sync_runs` stores neither `full_sync` nor `batch_size`, so there is nothing
   * to copy and the banner says so rather than leaving the operator to wonder.
   */
  it('states that batch size and full sync are not seeded', async () => {
    searchParams = new URLSearchParams('from=run-9')
    mockApi()
    renderWithProviders(<SyncRunsDashboardPage />)

    expect(await screen.findByText(/Batch size and full sync are at their defaults/i)).toBeInTheDocument()
  })

  it('strips the parameter so a re-render cannot re-seed over later edits', async () => {
    searchParams = new URLSearchParams('from=run-9')
    mockApi()
    renderWithProviders(<SyncRunsDashboardPage />)

    await waitFor(() => expect(routerReplaceMock).toHaveBeenCalledWith('/backend/data-sync'))
  })

  it('fetches the source run exactly once', async () => {
    searchParams = new URLSearchParams('from=run-9')
    mockApi()
    renderWithProviders(<SyncRunsDashboardPage />)

    await screen.findByText(/copied from erp-ambra/i)
    const detailCalls = apiCallMock.mock.calls.filter(([url]) => String(url) === '/api/data_sync/runs/run-9')
    expect(detailCalls).toHaveLength(1)
  })

  it.each([
    ['an unknown id', { ok: false, status: 404, result: null }],
    ['a malformed id', { ok: false, status: 400, result: null }],
  ])('renders the plain form for %s, with no banner and no error', async (_label, response) => {
    searchParams = new URLSearchParams('from=nope')
    mockApi(response)
    renderWithProviders(<SyncRunsDashboardPage />)

    await waitFor(() => expect(apiCallMock).toHaveBeenCalledWith(
      '/api/data_sync/runs/nope', undefined, expect.anything(),
    ))
    expect(screen.queryByText(/copied from/i)).not.toBeInTheDocument()
  })

  it('shows no banner at all without the parameter', async () => {
    mockApi()
    renderWithProviders(<SyncRunsDashboardPage />)

    await waitFor(() => expect(screen.getByTestId('runs-table')).toBeInTheDocument())
    expect(screen.queryByText(/copied from/i)).not.toBeInTheDocument()
    expect(apiCallMock.mock.calls.some(([url]) => String(url).startsWith('/api/data_sync/runs/'))).toBe(false)
  })

  it('submits nothing on arrival — a prefill is not a trigger', async () => {
    searchParams = new URLSearchParams('from=run-9')
    mockApi()
    renderWithProviders(<SyncRunsDashboardPage />)

    await screen.findByText(/copied from erp-ambra/i)
    const posts = apiCallMock.mock.calls.filter(([, init]) => (init as { method?: string } | undefined)?.method === 'POST')
    expect(posts).toHaveLength(0)
  })
})
