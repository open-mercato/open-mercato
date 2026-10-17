"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { PageHeader } from '@open-mercato/ui/backend/Page'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { LinkButton } from '@open-mercato/ui/primitives/link-button'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { SIMULATION_LIST_PAGE_SIZE, simulationRunPagePath } from '../../lib/client/simulation/api'
import { describeSimulationError, simulationKindLabel } from '../../lib/client/simulation/format'
import { useSimulationRuns } from '../../lib/client/simulation/hooks'
import type { SimulationRunSummary } from '../../lib/client/simulation/types'
import { formatXrayDateTime, shortId } from '../../lib/client/xray/format'
import { SimulationStatusContent, simulationStatusVariant } from './SimulationStatusBadge'

/** The viewer's own change simulations (private to the requester), newest first, paginated. */
export function SimulationRunsPageClient() {
  const t = useT()
  const locale = useLocale()
  const router = useRouter()
  const [page, setPage] = React.useState(1)
  const runs = useSimulationRuns(page)
  const none = t('insights.simulation.ui.common.none')

  const columns = React.useMemo<ColumnDef<SimulationRunSummary>[]>(() => [
    {
      accessorKey: 'kind',
      header: t('insights.simulation.ui.list.columns.kind'),
      cell: ({ row }) => (
        <LinkButton asChild variant="black" underline="hover">
          <Link href={simulationRunPagePath(row.original.id)} data-testid="simulation-run-link">
            {simulationKindLabel(row.original.kind, row.original.kindLabelKey, t)}
          </Link>
        </LinkButton>
      ),
    },
    {
      accessorKey: 'status',
      header: t('insights.simulation.ui.list.columns.status'),
      cell: ({ row }) => (
        <StatusBadge variant={simulationStatusVariant(row.original.status)}>
          <SimulationStatusContent status={row.original.status} />
        </StatusBadge>
      ),
    },
    {
      accessorKey: 'artifactId',
      header: t('insights.simulation.ui.list.columns.artifact'),
      cell: ({ row }) => row.original.artifactId
        ? <span className="font-mono text-xs" title={row.original.artifactId}>{shortId(row.original.artifactId)}</span>
        : <span className="text-muted-foreground">{t('insights.simulation.ui.list.newArtifact')}</span>,
    },
    {
      accessorKey: 'createdAt',
      header: t('insights.simulation.ui.list.columns.created'),
      cell: ({ row }) => formatXrayDateTime(row.original.createdAt, locale) ?? none,
    },
    {
      accessorKey: 'completedAt',
      header: t('insights.simulation.ui.list.columns.completed'),
      cell: ({ row }) => formatXrayDateTime(row.original.completedAt, locale) ?? none,
    },
    {
      accessorKey: 'expiresAt',
      header: t('insights.simulation.ui.list.columns.expires'),
      cell: ({ row }) => formatXrayDateTime(row.original.expiresAt, locale) ?? none,
    },
  ], [locale, none, t])

  return (
    <div className="space-y-6" data-testid="simulation-runs-page">
      <PageHeader title={t('insights.simulation.ui.list.title')} description={t('insights.simulation.ui.list.description')} />
      <DataTable<SimulationRunSummary>
        embedded
        columns={columns}
        data={runs.data?.items ?? []}
        isLoading={runs.loading}
        error={runs.error ? describeSimulationError(runs.error, t, 'insights.simulation.ui.errors.listFailed') : null}
        onRowClick={(row, event) => {
          if (event.target instanceof Element && event.target.closest('a')) return
          router.push(simulationRunPagePath(row.id))
        }}
        emptyState={(
          <EmptyState
            variant="subtle"
            title={t('insights.simulation.ui.list.emptyTitle')}
            description={t('insights.simulation.ui.list.emptyDescription')}
          />
        )}
        pagination={{
          page: runs.data?.page ?? page,
          pageSize: runs.data?.pageSize ?? SIMULATION_LIST_PAGE_SIZE,
          total: runs.data?.total ?? 0,
          totalPages: runs.data?.totalPages ?? 1,
          onPageChange: setPage,
        }}
        showQueryTime={false}
      />
    </div>
  )
}
