/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

const apiCallMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({ runMutation: jest.fn(), retryLastMutation: jest.fn() }),
}))

jest.mock('@open-mercato/ui/backend/injection/useAppEvent', () => ({
  useAppEvent: () => {},
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('next/navigation', () => ({
  usePathname: () => '/backend/data-sync/runs/run-1',
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

import SyncRunDetailPage from '../page'

type RunOverrides = Partial<Record<string, unknown>>

function buildRun(overrides: RunOverrides = {}) {
  return {
    id: 'run-1',
    integrationId: 'example',
    entityType: 'example_orders',
    direction: 'import' as const,
    status: 'failed' as const,
    cursor: 'updated_at:2026-09-12T04:15:07Z',
    initialCursor: 'updated_at:2026-09-01T00:00:00Z',
    createdCount: 3214,
    updatedCount: 906,
    skippedCount: 0,
    failedCount: 12,
    batchesCompleted: 41,
    lastError: 'boom',
    progressJobId: null,
    parameters: null,
    progressJob: null,
    triggeredBy: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:20:00.000Z',
    ...overrides,
  }
}

function mockRun(overrides: RunOverrides = {}) {
  apiCallMock.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/data_sync/runs/')) {
      return { ok: true, status: 200, result: buildRun(overrides) }
    }
    if (url.startsWith('/api/integrations/logs')) {
      return { ok: true, status: 200, result: { items: [], total: 0 } }
    }
    return { ok: false, status: 404, result: null }
  })
}

beforeEach(() => {
  apiCallMock.mockReset()
})

describe('SyncRunDetailPage resume point', () => {
  it('names the batch a retry resumes from, and the cursor verbatim', async () => {
    mockRun()
    renderWithProviders(<SyncRunDetailPage params={{ id: 'run-1' }} />)

    expect(await screen.findByText(/Resumes from batch 41/)).toBeInTheDocument()
    // Verbatim: the cursor is the only value an operator can paste into a ticket.
    // It appears twice on purpose — once as the retry's start position, once as
    // this run's own "Committed through" record.
    expect(screen.getAllByText('updated_at:2026-09-12T04:15:07Z')).toHaveLength(2)
  })

  it('renders no batch denominator — no such number is derivable', async () => {
    mockRun()
    renderWithProviders(<SyncRunDetailPage params={{ id: 'run-1' }} />)

    const line = await screen.findByText(/Resumes from batch 41/)
    expect(line.textContent).not.toMatch(/of\s*~?\d/)
  })

  it('stays non-committal when the run committed no batch', async () => {
    mockRun({ cursor: null, batchesCompleted: 0 })
    renderWithProviders(<SyncRunDetailPage params={{ id: 'run-1' }} />)

    expect(await screen.findByText(/committed no batch/i)).toBeInTheDocument()
  })

  /**
   * The regression this whole design exists to prevent: the retry endpoint falls
   * back to the shared cursor, so a run with no cursor of its own may still
   * resume mid-stream. The page must never promise otherwise.
   */
  it('never claims a retry starts from the beginning', async () => {
    mockRun({ cursor: null, batchesCompleted: 0 })
    renderWithProviders(<SyncRunDetailPage params={{ id: 'run-1' }} />)

    await screen.findByText(/committed no batch/i)
    expect(screen.queryByText(/starts from the beginning/i)).not.toBeInTheDocument()
  })

  it.each(['pending', 'running', 'completed'])(
    'renders no resume point for a %s run',
    async (status) => {
      mockRun({ status })
      renderWithProviders(<SyncRunDetailPage params={{ id: 'run-1' }} />)

      await waitFor(() => expect(screen.getByText('data_sync.runs.detail.progress')).toBeInTheDocument())
      expect(screen.queryByText(/Resumes from batch/i)).not.toBeInTheDocument()
      expect(screen.queryByText(/committed no batch/i)).not.toBeInTheDocument()
    },
  )

  it('records this run’s own start and end positions for every state', async () => {
    mockRun({ status: 'completed' })
    renderWithProviders(<SyncRunDetailPage params={{ id: 'run-1' }} />)

    expect(await screen.findByText('Started from')).toBeInTheDocument()
    expect(screen.getByText('Committed through')).toBeInTheDocument()
    expect(screen.getByText('updated_at:2026-09-01T00:00:00Z')).toBeInTheDocument()
  })

  it('words a null cursor rather than rendering an empty cell', async () => {
    mockRun({ initialCursor: null, cursor: null })
    renderWithProviders(<SyncRunDetailPage params={{ id: 'run-1' }} />)

    expect(await screen.findByText('beginning of source')).toBeInTheDocument()
    expect(screen.getByText('nothing committed')).toBeInTheDocument()
  })
})
