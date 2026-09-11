/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import type { StartControlMap } from '../../../lib/start-controls'

const apiCallMock = jest.fn()
const runMutationMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
  withScopedApiRequestHeaders: (_headers: unknown, run: () => unknown) => run(),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({ runMutation: runMutationMock, retryLastMutation: jest.fn() }),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: () => <div data-testid="runs-table" />,
}))

jest.mock('next/navigation', () => ({
  usePathname: () => '/backend/data-sync',
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

import SyncRunsDashboardPage from '../page'

const FULL_SYNC_LABEL = 'Run as full sync'
const BATCH_SIZE_LABEL = 'Batch size'

function mockOptions(startControls: StartControlMap | undefined, supportedEntities: string[]) {
  apiCallMock.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/data_sync/options')) {
      return {
        ok: true,
        status: 200,
        result: {
          items: [{
            integrationId: 'sync_mixed',
            title: 'Mixed',
            description: null,
            providerKey: 'mixed',
            direction: 'import',
            runMode: 'generic',
            canStartRun: true,
            supportedEntities,
            runParameters: [],
            startControls,
            hasCredentials: true,
            isEnabled: true,
            settingsPath: '/backend/integrations/sync_mixed',
          }],
        },
      }
    }
    if (url.startsWith('/api/data_sync/schedules')) {
      return { ok: true, status: 200, result: { items: [] } }
    }
    if (url.startsWith('/api/data_sync/runs')) {
      return { ok: true, status: 200, result: { items: [], total: 0, page: 1, totalPages: 1 } }
    }
    return { ok: false, status: 404, result: null }
  })
}

describe('data sync dashboard start controls', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders both controls for an adapter that declares nothing', async () => {
    mockOptions({}, ['orders.feed'])

    renderWithProviders(<SyncRunsDashboardPage />)

    expect(await screen.findByText(FULL_SYNC_LABEL)).toBeInTheDocument()
    expect(screen.getByText(BATCH_SIZE_LABEL)).toBeInTheDocument()
  })

  it('renders both controls for an entity type the adapter did not restrict', async () => {
    mockOptions({ 'orders.backfill': { fullSync: false, batchSize: true } }, ['orders.feed', 'orders.backfill'])

    renderWithProviders(<SyncRunsDashboardPage />)

    expect(await screen.findByText(FULL_SYNC_LABEL)).toBeInTheDocument()
    expect(screen.getByText(BATCH_SIZE_LABEL)).toBeInTheDocument()
  })

  it('omits the full sync control for an entity type whose adapter declares it inapplicable', async () => {
    mockOptions({ 'orders.backfill': { fullSync: false, batchSize: true } }, ['orders.backfill', 'orders.feed'])

    renderWithProviders(<SyncRunsDashboardPage />)

    // The batch size control is the anchor: it still applies, so its presence
    // proves the card rendered and the absence below is not a mounting failure.
    expect(await screen.findByText(BATCH_SIZE_LABEL)).toBeInTheDocument()
    expect(screen.queryByText(FULL_SYNC_LABEL)).not.toBeInTheDocument()
  })

  it('omits the batch size control for an entity type whose adapter declares it inapplicable', async () => {
    mockOptions({ 'orders.backfill': { fullSync: true, batchSize: false } }, ['orders.backfill'])

    renderWithProviders(<SyncRunsDashboardPage />)

    expect(await screen.findByText(FULL_SYNC_LABEL)).toBeInTheDocument()
    expect(screen.queryByText(BATCH_SIZE_LABEL)).not.toBeInTheDocument()
  })

  it('omits the whole knob row when the adapter restricts every control', async () => {
    mockOptions({ 'orders.backfill': { fullSync: false, batchSize: false } }, ['orders.backfill'])

    renderWithProviders(<SyncRunsDashboardPage />)

    await waitFor(() => expect(screen.getByText('Start sync')).toBeInTheDocument())
    expect(screen.queryByText(FULL_SYNC_LABEL)).not.toBeInTheDocument()
    expect(screen.queryByText(BATCH_SIZE_LABEL)).not.toBeInTheDocument()
  })
})
