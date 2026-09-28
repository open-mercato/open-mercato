"use client"

import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { formatDateTime } from '@open-mercato/shared/lib/time'

type JobRow = {
  id: string
  kind: string
  campaignId: string | null
  startedAt: string
  finishedAt: string | null
  status: string
  counters: Record<string, number> | null
  error: string | null
}

const STATUS_VARIANTS: Record<string, StatusBadgeVariant> = {
  ok: 'success',
  running: 'info',
  failed: 'error',
}

/**
 * What the background jobs have been doing.
 *
 * The screen for the morning-after question. A sweep that quietly stopped firing looks exactly like a sweep
 * with nothing to do — until this list shows the last one was on Friday.
 */
export default function MarketingJobsPage() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()

  const [rows, setRows] = React.useState<JobRow[]>([])
  const [loading, setLoading] = React.useState(true)
  const [loadFailed, setLoadFailed] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    setLoadFailed(false)
    try {
      const result = await apiCall<{ items?: JobRow[] }>('/api/marketing_automation/jobs?limit=100')
      setRows(result.ok && Array.isArray(result.result?.items) ? result.result.items : [])
    } catch {
      setLoadFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { void load() }, [load, scopeVersion])

  const columns = React.useMemo<ColumnDef<JobRow>[]>(() => [
    {
      accessorKey: 'kind',
      header: t('marketing_automation.jobs.columns.kind', 'Job'),
      cell: ({ row }) => t(`marketing_automation.jobs.kind.${row.original.kind}`, row.original.kind),
    },
    {
      accessorKey: 'startedAt',
      header: t('marketing_automation.jobs.columns.startedAt', 'Started'),
      cell: ({ row }) => formatDateTime(row.original.startedAt),
    },
    {
      id: 'status',
      header: t('marketing_automation.jobs.columns.status', 'Status'),
      cell: ({ row }) => (
        <StatusBadge variant={STATUS_VARIANTS[row.original.status] ?? 'neutral'}>
          {t(`marketing_automation.jobs.status.${row.original.status}`, row.original.status)}
        </StatusBadge>
      ),
    },
    {
      id: 'counters',
      header: t('marketing_automation.jobs.columns.counters', 'Result'),
      cell: ({ row }) => {
        const counters = row.original.counters ?? {}
        const entries = Object.entries(counters)
        if (entries.length === 0) {
          return <span className="text-xs text-muted-foreground">—</span>
        }
        return (
          <span className="flex flex-wrap gap-1">
            {entries.map(([key, value]) => (
              <span key={key} className="rounded-sm bg-muted px-2 py-1 text-xs text-muted-foreground">
                {`${t(`marketing_automation.jobs.counter.${key}`, key)}: ${value}`}
              </span>
            ))}
          </span>
        )
      },
    },
    {
      id: 'campaign',
      header: t('marketing_automation.jobs.columns.campaign', 'Campaign'),
      cell: ({ row }) => (row.original.campaignId
        ? (
          <a className="underline" href={`/backend/marketing/campaigns/${row.original.campaignId}`}>
            {t('marketing_automation.jobs.openCampaign', 'Open')}
          </a>
        )
        : <span className="text-xs text-muted-foreground">—</span>),
    },
    {
      id: 'error',
      header: '',
      cell: ({ row }) => (row.original.error
        ? <span className="text-xs text-status-error-text">{row.original.error}</span>
        : null),
    },
  ], [t])

  return (
    <Page>
      <PageBody>
        <div className="mb-3 flex justify-end">
          <Button variant="outline" onClick={() => void load()}>
            {t('marketing_automation.jobs.refresh', 'Refresh')}
          </Button>
        </div>
        {loadFailed ? (
          <div className="mb-3">
            <ErrorMessage label={t('marketing_automation.jobs.loadFailed', 'Could not load the job history.')} />
          </div>
        ) : null}
        <DataTable
          columns={columns}
          data={rows}
          isLoading={loading}
          emptyState={(
            <ListEmptyState
              title={t('marketing_automation.jobs.emptyTitle', 'No job runs recorded yet')}
              description={t('marketing_automation.jobs.emptyBody', 'Scheduled campaigns and waiting journeys are processed in the background. Each pass appears here with what it did.')}
            />
          )}
        />
      </PageBody>
    </Page>
  )
}
