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
    expect(errorBadges[0]).toHaveTextContent('StalledStatus')

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
})
