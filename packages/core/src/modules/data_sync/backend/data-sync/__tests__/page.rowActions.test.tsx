/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

const apiCallMock = jest.fn()

/**
 * The real `DataTable` is replaced with a stub that captures the `rowActions`
 * render prop's output, so the menu can be asserted without opening a popover.
 */
let capturedRowActions: ((row: Record<string, unknown>) => React.ReactNode) | null = null

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

jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: (props: { rowActions?: (row: Record<string, unknown>) => React.ReactNode }) => {
    capturedRowActions = props.rowActions ?? null
    return <div data-testid="runs-table" />
  },
}))

jest.mock('@open-mercato/ui/backend/RowActions', () => ({
  RowActions: ({ items }: { items: Array<{ id?: string; label: string }> }) => (
    <div data-testid="row-actions">
      {items.map((item, index) => (
        <span key={item.id ?? index} data-action-id={item.id}>{item.label}</span>
      ))}
    </div>
  ),
}))

jest.mock('../../../components/useDataSyncRunAccess', () => ({
  useDataSyncRunAccess: () => ({ canRunSync: true }),
}))

jest.mock('next/navigation', () => ({
  usePathname: () => '/backend/data-sync',
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

import SyncRunsDashboardPage from '../page'

function buildRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'run-1',
    integrationId: 'example',
    entityType: 'example_orders',
    direction: 'import' as const,
    status: 'failed' as const,
    cursor: 'updated_at:2026-09-12T04:15:07Z',
    initialCursor: null,
    batchesCompleted: 41,
    createdCount: 1,
    updatedCount: 2,
    failedCount: 3,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function mockList() {
  apiCallMock.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/data_sync/runs')) {
      return { ok: true, status: 200, result: { items: [], total: 0, page: 1, totalPages: 1 } }
    }
    if (url.startsWith('/api/data_sync/options')) {
      return { ok: true, status: 200, result: { items: [] } }
    }
    if (url.startsWith('/api/data_sync/schedules')) {
      return { ok: true, status: 200, result: { items: [] } }
    }
    return { ok: false, status: 404, result: null }
  })
}

/** Renders the captured row-action items for one row and returns their labels. */
async function labelsFor(row: Record<string, unknown>): Promise<string[]> {
  mockList()
  const { container } = renderWithProviders(<SyncRunsDashboardPage />)
  await waitFor(() => expect(capturedRowActions).not.toBeNull())

  const node = capturedRowActions!(row) as React.ReactElement<{
    items: Array<{ id?: string; label: string }>
  }>
  void container
  return node.props.items.map((item) => item.label)
}

beforeEach(() => {
  apiCallMock.mockReset()
  capturedRowActions = null
})

describe('SyncRunsDashboardPage row actions', () => {
  it('names the resume point inside the Retry label for a failed run', async () => {
    const labels = await labelsFor(buildRow())
    expect(labels).toContain('Retry (resumes from batch 41)')
  })

  it('renders no batch denominator — no such number is derivable', async () => {
    const labels = await labelsFor(buildRow())
    expect(labels.join(' ')).not.toMatch(/of\s*~?\d/)
  })

  it('reads Resume, not Retry, for a run the operator stopped on purpose', async () => {
    const labels = await labelsFor(buildRow({ status: 'cancelled', batchesCompleted: 3 }))
    expect(labels).toContain('Resume (resumes from batch 3)')
    // The overflow must not smuggle "Retry" back in on the one state that
    // deliberately avoids the word.
    expect(labels).toContain('Start from the beginning')
    expect(labels.some((label) => /Retry/.test(label))).toBe(false)
  })

  it('offers the from-scratch replay alongside the resumable retry', async () => {
    const labels = await labelsFor(buildRow())
    expect(labels).toContain('Retry from the beginning')
  })

  it('stays non-committal when the run committed no batch', async () => {
    const labels = await labelsFor(buildRow({ cursor: null, batchesCompleted: 0 }))
    expect(labels).toContain("Retry (resumes from this feed's last saved position)")
    // The resume-point label itself never claims a from-scratch start; the
    // separate action is a different item, and stays available precisely here.
    const resumeLabel = labels.find((label) => label.includes('resumes from'))
    expect(resumeLabel).not.toMatch(/from the beginning/i)
    expect(labels).toContain('Retry from the beginning')
  })

  it.each(['pending', 'running', 'completed'])('offers no retry for a %s run', async (status) => {
    const labels = await labelsFor(buildRow({ status }))
    expect(labels.some((label) => /Retry|Resume/.test(label))).toBe(false)
  })
})
