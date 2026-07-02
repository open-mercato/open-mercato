/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

const apiCallMock = jest.fn()

// Capture the latest handler registered for each app-event pattern so the
// test can fire an auto-refresh (e.g. om:bridge:reconnected) by hand.
const appEventHandlers: Record<string, (event: { payload: unknown }) => void> = {}

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({ runMutation: jest.fn(), retryLastMutation: jest.fn() }),
}))

jest.mock('@open-mercato/ui/backend/injection/useAppEvent', () => ({
  useAppEvent: (pattern: string, handler: (event: { payload: unknown }) => void) => {
    appEventHandlers[pattern] = handler
  },
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

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

const runFixture = {
  id: 'run-1',
  integrationId: 'example',
  entityType: 'example_orders',
  direction: 'import' as const,
  status: 'completed' as const,
  createdCount: 0,
  updatedCount: 800,
  skippedCount: 0,
  failedCount: 130,
  batchesCompleted: 4,
  lastError: null,
  progressJobId: null,
  progressJob: null,
  triggeredBy: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:20:00.000Z',
}

function logsUrlPage(url: string): string | null {
  return new URL(url, 'http://localhost').searchParams.get('page')
}

function mockApiResponses(total: number) {
  apiCallMock.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/data_sync/runs/')) {
      return { ok: true, status: 200, result: runFixture }
    }
    if (url.startsWith('/api/integrations/logs')) {
      return { ok: true, status: 200, result: { items: [], total } }
    }
    return { ok: false, status: 404, result: null }
  })
}

function logsCalls() {
  return apiCallMock.mock.calls.filter(([url]) => String(url).startsWith('/api/integrations/logs'))
}

beforeEach(() => {
  apiCallMock.mockReset()
  for (const key of Object.keys(appEventHandlers)) delete appEventHandlers[key]
})

describe('SyncRunDetailPage logs pagination', () => {
  it('renders pagination only above one page and fetches the requested page', async () => {
    mockApiResponses(120) // 120 / 50 => 3 pages
    renderWithProviders(<SyncRunDetailPage params={{ id: 'run-1' }} />)

    // The first load requests page 1.
    await waitFor(() => expect(logsCalls().length).toBeGreaterThan(0))
    expect(logsUrlPage(String(logsCalls()[0][0]))).toBe('1')

    // total (120) > LOG_PAGE_SIZE (50) => pagination control is shown.
    const pageTwo = await screen.findByLabelText(/go to page 2/i)
    fireEvent.click(pageTwo)

    await waitFor(() =>
      expect(apiCallMock).toHaveBeenCalledWith(
        expect.stringContaining('page=2'),
        undefined,
        expect.anything(),
      ),
    )
  })

  it('hides pagination when the log count fits a single page', async () => {
    mockApiResponses(30) // 30 <= 50 => one page
    renderWithProviders(<SyncRunDetailPage params={{ id: 'run-1' }} />)

    await waitFor(() => expect(logsCalls().length).toBeGreaterThan(0))
    // Give the render a tick; the pagination control must never appear.
    await waitFor(() => expect(screen.queryByLabelText(/go to page 2/i)).toBeNull())
    expect(screen.queryByLabelText(/^pagination$/i)).toBeNull()
  })

  it('auto-refresh re-fetches the current page, not page 1', async () => {
    mockApiResponses(120)
    renderWithProviders(<SyncRunDetailPage params={{ id: 'run-1' }} />)

    const pageTwo = await screen.findByLabelText(/go to page 2/i)
    fireEvent.click(pageTwo)
    await waitFor(() =>
      expect(apiCallMock).toHaveBeenCalledWith(
        expect.stringContaining('page=2'),
        undefined,
        expect.anything(),
      ),
    )

    apiCallMock.mockClear()
    // Simulate the bridge reconnecting — the handler calls loadLogs() with no
    // argument, which must reuse the live page (logsPageRef), i.e. page 2.
    await act(async () => {
      appEventHandlers['om:bridge:reconnected']?.({ payload: {} })
    })

    await waitFor(() => expect(logsCalls().length).toBeGreaterThan(0))
    expect(logsCalls().every(([url]) => String(url).includes('page=2'))).toBe(true)
  })
})
