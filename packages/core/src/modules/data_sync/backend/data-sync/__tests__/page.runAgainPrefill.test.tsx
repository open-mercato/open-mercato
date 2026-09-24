/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, screen, waitFor } from '@testing-library/react'
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

let canConfigureSync = true

jest.mock('../../../components/useDataSyncRunAccess', () => ({
  useDataSyncRunAccess: () => ({ canRunSync: true, canConfigureSync }),
}))

jest.mock('next/navigation', () => ({
  usePathname: () => '/backend/data-sync',
  useRouter: () => ({ push: jest.fn(), replace: routerReplaceMock }),
  useSearchParams: () => searchParams,
}))

import SyncRunsDashboardPage from '../page'

/**
 * Two integrations, so the suite can cover both seeding paths: one where the
 * source run's integration differs from the initially-selected one (the reset
 * effects re-run), and one where it is already selected (they do not).
 */
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
    runParameters: [
      { key: 'segment', label: 'Segment', type: 'text' },
      { key: 'startId', label: 'Start id', type: 'number' },
    ],
    startControls: {},
    hasCredentials: true,
    isEnabled: true,
    settingsPath: '/backend/integrations/erp-ambra',
  }, {
    integrationId: 'shopify-nordvik',
    title: 'Shopify Nordvik',
    description: null,
    providerKey: 'shopify',
    direction: 'import',
    runMode: 'generic',
    canStartRun: true,
    supportedEntities: ['products'],
    runParameters: [{ key: 'collection', label: 'Collection', type: 'text' }],
    startControls: {},
    hasCredentials: true,
    isEnabled: true,
    settingsPath: '/backend/integrations/shopify-nordvik',
  }],
}

const SOURCE_RUN = {
  id: 'run-9',
  integrationId: 'erp-ambra',
  entityType: 'price_lists',
  direction: 'import',
  status: 'completed',
  // `startId` arrives as a JS number, the way the API returns a coerced
  // `type: 'number'` parameter.
  parameters: { segment: 'b2b-active', startId: 4200, legacy_region: 'emea' },
}

/**
 * A run matching what the form settles on by itself: the first integration, its
 * first supported entity and its default direction. Seeding this run changes
 * none of the three, so the `runParameters` memo keeps its identity and the
 * parameter effect has nothing but the seed token to re-run on.
 */
const SAME_SELECTION_RUN = {
  id: 'run-5',
  integrationId: 'erp-ambra',
  entityType: 'customers',
  direction: 'import',
  status: 'completed',
  parameters: { segment: 'retail-core' },
}

/** A run on the OTHER integration, so the cross-integration seed path is real. */
const OTHER_RUN = {
  id: 'run-7',
  integrationId: 'shopify-nordvik',
  entityType: 'products',
  direction: 'export' as const,
  status: 'completed',
  parameters: { collection: 'summer' },
}

function mockApi(runResponse: { ok: boolean; status: number; result: unknown } | null = null) {
  apiCallMock.mockImplementation(async (url: string) => {
    if (url === '/api/data_sync/runs/run-7') return { ok: true, status: 200, result: OTHER_RUN }
    if (url === '/api/data_sync/runs/run-5') return { ok: true, status: 200, result: SAME_SELECTION_RUN }
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
  canConfigureSync = true
})

/**
 * Reads what the entity-type control actually shows. Asserting the banner alone
 * is what let a completely non-functional prefill ship green in review — the
 * banner claimed four fields were copied while the form held none of them.
 */
function selectedEntityTypeText(): string {
  const combos = screen.getAllByRole('combobox')
  return combos.map((node) => node.textContent ?? '').join(' | ')
}

describe('SyncRunsDashboardPage ?from= prefill', () => {
  it('seeds the entity type into the form, not just the banner', async () => {
    searchParams = new URLSearchParams('from=run-9')
    mockApi()
    renderWithProviders(<SyncRunsDashboardPage />)

    await screen.findByText(/copied from erp-ambra/i)
    // price_lists, from the source run — NOT customers, the first supported entity.
    await waitFor(() => expect(selectedEntityTypeText()).toMatch(/Price Lists/))
    expect(selectedEntityTypeText()).not.toMatch(/\bCustomers\b/)
  })

  it('seeds the stored run parameter into its input', async () => {
    searchParams = new URLSearchParams('from=run-9')
    mockApi()
    renderWithProviders(<SyncRunsDashboardPage />)

    await screen.findByText(/copied from erp-ambra/i)
    await waitFor(() => expect(screen.getByDisplayValue('b2b-active')).toBeInTheDocument())
  })

  /**
   * Mounting with `?from=` already present: the integration still transitions
   * null → erp-ambra, so the reset effects do re-run and carry the seed. The
   * case where they do NOT re-run is the one below, which must be reached by
   * seeding a form that has already settled.
   */
  it('seeds when the source run belongs to the already-selected integration', async () => {
    searchParams = new URLSearchParams('from=run-9')
    mockApi()
    renderWithProviders(<SyncRunsDashboardPage />)

    await screen.findByText(/copied from erp-ambra/i)
    await waitFor(() => expect(selectedEntityTypeText()).toMatch(/Price Lists/))
    expect(screen.getByDisplayValue('b2b-active')).toBeInTheDocument()
  })

  /**
   * The dashboard row menu's own path: the operator is already on the page, the
   * form has settled on the first integration, and "Run again…" names a run
   * with that same integration, entity type and direction. Nothing the
   * `runParameters` memo keys on changes, so before the seed token the
   * parameter effect never re-ran and the form kept its defaults while the
   * banner claimed the parameters had been copied.
   */
  it('seeds the parameters of a run the settled form already matches', async () => {
    mockApi()
    const { rerender } = renderWithProviders(<SyncRunsDashboardPage />)

    // Let the form settle on erp-ambra / customers / import by itself.
    await waitFor(() => expect(selectedEntityTypeText()).toMatch(/Customers/))
    expect(screen.queryByDisplayValue('retail-core')).not.toBeInTheDocument()

    searchParams = new URLSearchParams('from=run-5')
    rerender(<SyncRunsDashboardPage />)

    await screen.findByText(/copied from erp-ambra/i)
    await waitFor(() => expect(screen.getByDisplayValue('retail-core')).toBeInTheDocument())
  })

  it('ignores a slower seed fetch that a later "Run again" superseded', async () => {
    mockApi()
    let resolveSlowRun: (value: unknown) => void = () => {}
    const defaultImplementation = apiCallMock.getMockImplementation()
    apiCallMock.mockImplementation((url: string, ...rest: unknown[]) => {
      if (url === '/api/data_sync/runs/run-9') {
        return new Promise((resolve) => { resolveSlowRun = resolve })
      }
      return defaultImplementation?.(url, ...rest)
    })
    const { rerender } = renderWithProviders(<SyncRunsDashboardPage />)
    await waitFor(() => expect(selectedEntityTypeText()).toMatch(/Customers/))

    searchParams = new URLSearchParams('from=run-9')
    rerender(<SyncRunsDashboardPage />)
    await waitFor(() => expect(
      apiCallMock.mock.calls.some(([url]) => String(url) === '/api/data_sync/runs/run-9'),
    ).toBe(true))

    searchParams = new URLSearchParams('from=run-5')
    rerender(<SyncRunsDashboardPage />)
    await waitFor(() => expect(screen.getByDisplayValue('retail-core')).toBeInTheDocument())

    await act(async () => {
      resolveSlowRun({ ok: true, status: 200, result: SOURCE_RUN })
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(screen.getByDisplayValue('retail-core')).toBeInTheDocument()
    expect(screen.queryByDisplayValue('b2b-active')).not.toBeInTheDocument()
    expect(selectedEntityTypeText()).not.toMatch(/Price Lists/)
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

  /**
   * F1: a `type: 'number'` parameter arrives as a JS number. The text input
   * renders only strings, so before this it showed blank while
   * `buildRunParametersPayload` still submitted the seeded value — the form and
   * the request disagreeing silently.
   */
  it('renders a seeded number parameter as text rather than blank', async () => {
    searchParams = new URLSearchParams('from=run-9')
    mockApi()
    renderWithProviders(<SyncRunsDashboardPage />)

    await screen.findByText(/copied from erp-ambra/i)
    await waitFor(() => expect(screen.getByDisplayValue('4200')).toBeInTheDocument())
  })

  /**
   * F5: every earlier test used the already-selected integration, so the
   * selection effect's seed branch was never entered. Deleting it left the suite
   * green while a cross-integration seed silently reset the direction.
   */
  it('seeds across integrations, keeping the source run’s direction', async () => {
    searchParams = new URLSearchParams('from=run-7')
    mockApi()
    renderWithProviders(<SyncRunsDashboardPage />)

    await screen.findByText(/copied from shopify-nordvik/i)
    await waitFor(() => expect(selectedEntityTypeText()).toMatch(/Products/))
    // shopify-nordvik declares direction 'import'; the run was an export, and
    // the seed must win over the integration's default.
    expect(screen.getByDisplayValue('summer')).toBeInTheDocument()
  })

  it('does not seed an entity type the adapter has since dropped', async () => {
    searchParams = new URLSearchParams('from=run-9')
    mockApi({ ok: true, status: 200, result: { ...SOURCE_RUN, entityType: 'retired_entity' } })
    renderWithProviders(<SyncRunsDashboardPage />)

    await waitFor(() => expect(apiCallMock).toHaveBeenCalledWith(
      '/api/data_sync/runs/run-9', undefined, expect.anything(),
    ))
    // No banner, because nothing was copied — Start sync must not be left
    // pointing at a value the API answers 422 to.
    expect(screen.queryByText(/copied from/i)).not.toBeInTheDocument()
  })

  /** F6: the schedule gate shipped with no coverage, which is why it drifted. */
  it('disables every schedule control without data_sync.configure', async () => {
    canConfigureSync = false
    mockApi()
    renderWithProviders(<SyncRunsDashboardPage />)

    const save = await screen.findByRole('button', { name: /save recurring schedule/i })
    expect(save).toBeDisabled()
    expect(screen.getByRole('button', { name: /remove schedule/i })).toBeDisabled()
  })

  it('enables the schedule controls with data_sync.configure', async () => {
    mockApi()
    renderWithProviders(<SyncRunsDashboardPage />)

    const save = await screen.findByRole('button', { name: /save recurring schedule/i })
    // The shared disabled expression also covers the schedule fetch, so wait for
    // it to settle rather than asserting on the loading frame.
    await waitFor(() => expect(save).not.toBeDisabled())
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
