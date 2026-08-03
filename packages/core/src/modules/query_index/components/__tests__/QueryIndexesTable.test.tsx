/**
 * @jest-environment jsdom
 */

import '@testing-library/jest-dom'
import * as React from 'react'
import { screen, waitFor } from '@testing-library/react'
import QueryIndexesTable from '../QueryIndexesTable'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = MockResizeObserver

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: jest.fn(),
  apiCallOrThrow: jest.fn(),
}))

jest.mock('@open-mercato/ui/primitives/status-badge', () => {
  const original = jest.requireActual('@open-mercato/ui/primitives/status-badge')
  return {
    ...original,
    StatusBadge: ({ variant, children, ...props }: any) => (
      <div data-testid={`status-badge-${variant}`} {...props}>
        {children}
      </div>
    ),
  }
})

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn(), replace: jest.fn() }),
  usePathname: () => '',
  useSearchParams: () => new URLSearchParams(),
}))

const dict = {
  'query_index.nav.queryIndexes': 'Query Indexes',
  'query_index.table.status.failed': 'FailedStatus',
  'query_index.table.status.stalled': 'StalledStatus',
  'query_index.table.status.reindexing': 'ReindexingStatus',
  'query_index.table.status.purging': 'PurgingStatus',
  'query_index.table.status.in_sync': 'InSyncStatus',
  'query_index.table.status.out_of_sync': 'OutOfSyncStatus',
  'query_index.table.status.not_measured': 'NotMeasuredStatus',
  'query_index.table.status.scopeLabel': 'Scope',
  'query_index.table.status.partitionLabel': 'Partition {{index}}',
  'query_index.table.status.scope.completed': 'Done',
  'query_index.table.status.scope.reindexing': 'Running',
  'query_index.table.status.scope.stalled': 'Stalled',
  'query_index.table.status.progress': '{{processed}}/{{total}}',
  'query_index.table.status.withProgress': '{{status}} ({{progress}})',
  'query_index.table.columns.entity': 'Entity',
  'query_index.table.columns.records': 'Records',
  'query_index.table.columns.indexed': 'Indexed',
  'query_index.table.columns.vector': 'Vector',
  'query_index.table.columns.fulltext': 'Fulltext',
  'query_index.table.columns.status': 'Status',
  'query_index.table.filters.backend': 'Backend',
  'query_index.table.filters.backendOptions.vector': 'Vector search',
  'query_index.table.filters.backendOptions.fulltext': 'Full-text search',
  'query_index.table.filters.backendOptions.customFields': 'Custom fields',
  'query_index.table.status.scope.purging': 'Purging',
  'query_index.table.status.purging': 'PurgingStatus',
  'ui.dataTable.pagination.results': 'Showing {start} to {end} of {total} results',
}

const mockItems = [
  {
    entityId: 'idle_ok',
    label: 'Idle OK',
    baseCount: 10,
    indexCount: 10,
    vectorCount: 10,
    vectorEnabled: true,
    fulltextCount: 10,
    fulltextEnabled: true,
    ok: true,
    job: { status: 'idle' },
  },
  {
    entityId: 'failed_err',
    label: 'Failed',
    baseCount: 10,
    indexCount: 9,
    vectorCount: 9,
    vectorEnabled: false,
    fulltextCount: 9,
    fulltextEnabled: false,
    ok: false,
    job: { status: 'failed' },
  },
  {
    entityId: 'stalled_err',
    label: 'Stalled',
    baseCount: 10,
    indexCount: 5,
    vectorCount: 5,
    vectorEnabled: false,
    fulltextCount: 5,
    fulltextEnabled: false,
    ok: false,
    job: { status: 'stalled' },
  },
  {
    entityId: 'reindexing_warn',
    label: 'Reindexing',
    baseCount: 10,
    indexCount: 5,
    vectorCount: 5,
    vectorEnabled: false,
    fulltextCount: 5,
    fulltextEnabled: false,
    ok: false,
    job: { status: 'reindexing' },
  },
  {
    entityId: 'purging_warn',
    label: 'Purging',
    baseCount: 10,
    indexCount: 5,
    vectorCount: 5,
    vectorEnabled: false,
    fulltextCount: 5,
    fulltextEnabled: false,
    ok: false,
    job: { status: 'purging' },
  },
  {
    entityId: 'idle_not_ok',
    label: 'Idle Not OK',
    baseCount: 10,
    indexCount: 5,
    vectorCount: 5,
    vectorEnabled: false,
    fulltextCount: 5,
    fulltextEnabled: false,
    ok: false,
    job: { status: 'idle' },
  },
]

describe('QueryIndexesTable', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    ;(readApiResultOrThrow as jest.Mock).mockResolvedValue({ items: mockItems })
  })

  it('maps job.status to the correct StatusBadge variant', async () => {
    renderWithProviders(<QueryIndexesTable />, { dict })

    await waitFor(() => {
      expect(readApiResultOrThrow).toHaveBeenCalled()
    })

    await waitFor(() => {
      expect(screen.getByText('idle_ok')).toBeInTheDocument()
    })

    // Verify mapping job.status -> StatusBadge variant
    const successBadges = screen.getAllByTestId('status-badge-success')
    expect(successBadges[0]).toHaveTextContent('InSyncStatus')

    const errorBadges = screen.getAllByTestId('status-badge-error')
    const errorText = errorBadges.map((badge) => badge.textContent).join(' ')
    expect(errorText).toContain('FailedStatus')
    expect(errorText).toContain('StalledStatus')

    const warningBadges = screen.getAllByTestId('status-badge-warning')
    // We expect both reindexing and purging to map to warning
    const warningText = warningBadges.map((b) => b.textContent).join(' ')
    expect(warningText).toContain('ReindexingStatus')
    expect(warningText).toContain('PurgingStatus')

    const neutralBadges = screen.getAllByTestId('status-badge-neutral')
    expect(neutralBadges[0]).toHaveTextContent('OutOfSyncStatus')
  })

  it('does not contain any hard-coded color classes in the rendered markup', async () => {
    const { container } = renderWithProviders(<QueryIndexesTable />, { dict })

    await waitFor(() => {
      expect(screen.getByText('idle_ok')).toBeInTheDocument()
    })

    const html = container.innerHTML

    // Security check against migration regression
    expect(html).not.toMatch(/text-green-\d+/)
    expect(html).not.toMatch(/text-orange-\d+/)
    expect(html).not.toMatch(/text-red-\d+/)
  })

  it('drops the Label column that always duplicated Entity', async () => {
    renderWithProviders(<QueryIndexesTable />, { dict })

    await waitFor(() => {
      expect(screen.getByText('idle_ok')).toBeInTheDocument()
    })

    expect(screen.queryByText('Idle OK')).not.toBeInTheDocument()
  })

  it('reports an unmeasured entity as pending rather than out of sync', async () => {
    ;(readApiResultOrThrow as jest.Mock).mockResolvedValue({
      items: [
        {
          entityId: 'never_measured',
          label: 'never_measured',
          baseCount: null,
          indexCount: null,
          vectorCount: null,
          vectorEnabled: false,
          fulltextCount: null,
          fulltextEnabled: false,
          ok: false,
          job: { status: 'idle' },
        },
      ],
    })
    renderWithProviders(<QueryIndexesTable />, { dict })

    await waitFor(() => {
      expect(screen.getByText('never_measured')).toBeInTheDocument()
    })

    expect(screen.getByText('NotMeasuredStatus')).toBeInTheDocument()
    expect(screen.queryByText('OutOfSyncStatus')).not.toBeInTheDocument()
  })

  const withPartitions = (jobStatus: string, partitionStatus: string) => ({
    entityId: 'partitioned',
    label: 'partitioned',
    baseCount: 12,
    indexCount: 12,
    vectorCount: null,
    vectorEnabled: false,
    fulltextCount: null,
    fulltextEnabled: false,
    ok: true,
    job: {
      status: jobStatus,
      processedCount: 12,
      totalCount: 12,
      partitions: [
        { partitionIndex: 0, partitionCount: 2, status: partitionStatus, processedCount: 5, totalCount: 5, finishedAt: partitionStatus === 'completed' ? '2026-07-28T10:00:00Z' : null },
        { partitionIndex: 1, partitionCount: 2, status: partitionStatus, processedCount: 3, totalCount: 3, finishedAt: partitionStatus === 'completed' ? '2026-07-28T10:00:00Z' : null },
      ],
    },
  })

  it('drops stale job counters from the badge once the job is idle', async () => {
    // Last run processed 14 rows but only 2 landed in the index. Rendering "(14/14)" beside
    // "Out of sync" contradicted the Records 14 / Indexed 2 columns and read as reassurance.
    ;(readApiResultOrThrow as jest.Mock).mockResolvedValue({
      items: [{
        entityId: 'drifted',
        label: 'drifted',
        baseCount: 14,
        indexCount: 2,
        vectorCount: null,
        vectorEnabled: false,
        fulltextCount: null,
        fulltextEnabled: false,
        ok: false,
        job: { status: 'idle', processedCount: 14, totalCount: 14, partitions: [] },
      }],
    })
    renderWithProviders(<QueryIndexesTable />, { dict })

    await waitFor(() => {
      expect(screen.getByText('drifted')).toBeInTheDocument()
    })

    expect(screen.getByText('OutOfSyncStatus')).toBeInTheDocument()
    expect(screen.queryByText(/14\/14/)).not.toBeInTheDocument()
  })

  it('keeps job progress in the badge while a reindex runs', async () => {
    ;(readApiResultOrThrow as jest.Mock).mockResolvedValue({
      items: [{
        entityId: 'running',
        label: 'running',
        baseCount: 14,
        indexCount: 5,
        vectorCount: null,
        vectorEnabled: false,
        fulltextCount: null,
        fulltextEnabled: false,
        ok: false,
        job: { status: 'reindexing', processedCount: 5, totalCount: 14, partitions: [] },
      }],
    })
    renderWithProviders(<QueryIndexesTable />, { dict })

    await waitFor(() => {
      expect(screen.getByText('running')).toBeInTheDocument()
    })

    expect(screen.getByText(/ReindexingStatus \(5\/14\)/)).toBeInTheDocument()
  })

  it('hides per-partition detail once the job is idle and every partition finished', async () => {
    ;(readApiResultOrThrow as jest.Mock).mockResolvedValue({ items: [withPartitions('idle', 'completed')] })
    renderWithProviders(<QueryIndexesTable />, { dict })

    await waitFor(() => {
      expect(screen.getByText('partitioned')).toBeInTheDocument()
    })

    // The badge already says "In sync (12/12)" — restating it per partition is noise.
    expect(screen.queryByText(/Partition 1/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Partition 2/)).not.toBeInTheDocument()
  })

  it('keeps per-partition detail while a reindex is in flight', async () => {
    ;(readApiResultOrThrow as jest.Mock).mockResolvedValue({ items: [withPartitions('reindexing', 'reindexing')] })
    renderWithProviders(<QueryIndexesTable />, { dict })

    await waitFor(() => {
      expect(screen.getByText('partitioned')).toBeInTheDocument()
    })

    expect(screen.getByText(/Partition 1: Running/)).toBeInTheDocument()
    expect(screen.getByText(/Partition 2: Running/)).toBeInTheDocument()
  })

  it('keeps per-partition detail when a partition is stalled even if the job reads idle', async () => {
    ;(readApiResultOrThrow as jest.Mock).mockResolvedValue({ items: [withPartitions('idle', 'stalled')] })
    renderWithProviders(<QueryIndexesTable />, { dict })

    await waitFor(() => {
      expect(screen.getByText('partitioned')).toBeInTheDocument()
    })

    expect(screen.getByText(/Partition 1: Stalled/)).toBeInTheDocument()
  })

  it('does not repeat vector coverage under the status badge', async () => {
    const { container } = renderWithProviders(<QueryIndexesTable />, { dict })

    await waitFor(() => {
      expect(screen.getByText('idle_ok')).toBeInTheDocument()
    })

    // Vector coverage belongs in the Vector column only — the status cell used to repeat it.
    expect(container.innerHTML).not.toContain('Vector: ')
  })

  describe('scope-only jobs (non-partitioned reindex and every purge)', () => {
    const scopeJob = (status: string, scopeStatus: string) => ({
      entityId: 'scoped',
      label: 'scoped',
      baseCount: 12,
      indexCount: 4,
      vectorCount: null,
      vectorEnabled: false,
      fulltextCount: null,
      fulltextEnabled: false,
      ok: false,
      queryIndexOk: false,
      // The server derives top-level status from partition rows only, so a scope-only run
      // arrives as `idle` with an active scope row.
      job: { status, processedCount: 4, totalCount: 12, partitions: [], scope: { status: scopeStatus, processedCount: 4, totalCount: 12 } },
    })

    it('shows a scope-only reindex as in flight rather than idle', async () => {
      ;(readApiResultOrThrow as jest.Mock).mockResolvedValue({ items: [scopeJob('idle', 'reindexing')] })
      renderWithProviders(<QueryIndexesTable />, { dict })
      await waitFor(() => expect(screen.getByText('scoped')).toBeInTheDocument())

      expect(screen.getByText(/ReindexingStatus \(4\/12\)/)).toBeInTheDocument()
      expect(screen.getByText(/Scope: Running \(4\/12\)/)).toBeInTheDocument()
      expect(screen.queryByText('OutOfSyncStatus')).not.toBeInTheDocument()
    })

    it('shows a scope-only purge as in flight', async () => {
      ;(readApiResultOrThrow as jest.Mock).mockResolvedValue({ items: [scopeJob('idle', 'purging')] })
      renderWithProviders(<QueryIndexesTable />, { dict })
      await waitFor(() => expect(screen.getByText('scoped')).toBeInTheDocument())

      expect(screen.getByText(/PurgingStatus/)).toBeInTheDocument()
      expect(screen.getByText(/Scope: Purging/)).toBeInTheDocument()
    })

    it('shows a stalled scope row as stalled', async () => {
      ;(readApiResultOrThrow as jest.Mock).mockResolvedValue({ items: [scopeJob('idle', 'stalled')] })
      renderWithProviders(<QueryIndexesTable />, { dict })
      await waitFor(() => expect(screen.getByText('scoped')).toBeInTheDocument())

      expect(screen.getByText(/StalledStatus/)).toBeInTheDocument()
    })

    it('hides scope detail once the scope row has completed', async () => {
      ;(readApiResultOrThrow as jest.Mock).mockResolvedValue({ items: [scopeJob('idle', 'completed')] })
      renderWithProviders(<QueryIndexesTable />, { dict })
      await waitFor(() => expect(screen.getByText('scoped')).toBeInTheDocument())

      expect(screen.getByText('OutOfSyncStatus')).toBeInTheDocument()
      expect(screen.queryByText(/Scope:/)).not.toBeInTheDocument()
    })
  })
})
