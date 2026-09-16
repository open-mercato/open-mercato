/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

const apiCallMock = jest.fn()
let canRunSync = true

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({ runMutation: jest.fn(), retryLastMutation: jest.fn() }),
}))

jest.mock('@open-mercato/ui/backend/injection/useAppEvent', () => ({ useAppEvent: () => {} }))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('../../../../../components/useDataSyncRunAccess', () => ({
  useDataSyncRunAccess: () => ({ canRunSync }),
}))

jest.mock('next/navigation', () => ({
  usePathname: () => '/backend/data-sync/runs/run-1',
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

import SyncRunDetailPage from '../page'

function mockRun(status = 'failed') {
  apiCallMock.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/data_sync/runs/')) {
      return {
        ok: true,
        status: 200,
        result: {
          id: 'run-1',
          integrationId: 'example',
          entityType: 'example_orders',
          direction: 'import',
          status,
          cursor: 'updated_at:2026-09-12T04:15:07Z',
          initialCursor: null,
          createdCount: 1,
          updatedCount: 0,
          skippedCount: 0,
          failedCount: 0,
          batchesCompleted: 41,
          lastError: null,
          progressJobId: null,
          parameters: null,
          progressJob: null,
          triggeredBy: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:20:00.000Z',
        },
      }
    }
    if (url.startsWith('/api/integrations/logs')) {
      return { ok: true, status: 200, result: { items: [], total: 0 } }
    }
    return { ok: false, status: 404, result: null }
  })
}

beforeEach(() => {
  apiCallMock.mockReset()
  canRunSync = true
})

describe('SyncRunDetailPage run-access gating', () => {
  it('offers Retry to an operator holding data_sync.run', async () => {
    mockRun()
    renderWithProviders(<SyncRunDetailPage params={{ id: 'run-1' }} />)

    expect(await screen.findByRole('button', { name: /retry/i })).toBeInTheDocument()
  })

  /**
   * The behaviour this adds: the endpoints have always required `data_sync.run`,
   * but both pages declare only `data_sync.view`, so a viewer used to see
   * buttons that answered 403 on click.
   */
  it('hides every action from a data_sync.view-only operator', async () => {
    canRunSync = false
    mockRun()
    renderWithProviders(<SyncRunDetailPage params={{ id: 'run-1' }} />)

    await screen.findByText(/Resumes from batch 41/)
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument()
  })

  it('still shows the resume point to a viewer — it describes the run, not an action', async () => {
    canRunSync = false
    mockRun()
    renderWithProviders(<SyncRunDetailPage params={{ id: 'run-1' }} />)

    expect(await screen.findByText(/Resumes from batch 41/)).toBeInTheDocument()
    // Twice: the retry's start position, and this run's own Committed-through record.
    expect(screen.getAllByText('updated_at:2026-09-12T04:15:07Z')).toHaveLength(2)
  })

  it('hides Cancel from a viewer looking at a running run', async () => {
    canRunSync = false
    mockRun('running')
    renderWithProviders(<SyncRunDetailPage params={{ id: 'run-1' }} />)

    await waitFor(() => expect(screen.getByText('data_sync.runs.detail.progress')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument()
  })
})
