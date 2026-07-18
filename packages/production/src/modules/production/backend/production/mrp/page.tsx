'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import type { ColumnDef } from '@tanstack/react-table'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { Play } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { MrpRunStatusBadge, type MrpRunStatus } from '../components/MrpBadges'
import { extractServerErrorMessage } from '../../../lib/serverErrorMessage.js'

type MrpRunStats = {
  demandsProcessed?: number
  levelsExploded?: number
  suggestionsInserted?: number
  suggestionsOpen?: number
  suggestionsCarried?: number
  suggestionsSupersededFromPriorRun?: number
  warningsCount?: number
} | null

type MrpRunRow = {
  id: string
  status: MrpRunStatus
  progressJobId: string | null
  startedAt: string | null
  finishedAt: string | null
  stats: MrpRunStats
  createdAt: string
  updatedAt: string
}

type ResponsePayload = {
  items: MrpRunRow[]
  total: number
  page: number
  totalPages: number
}

const RUN_STATUSES: MrpRunStatus[] = ['pending', 'running', 'completed', 'failed']

/**
 * MRP runs list (task 5.4). "Run MRP now" enqueues a run
 * (`production.mrp.createRun` — one `MrpRun` + one per-tenant queue job,
 * spec decision c) and asynchronously executes via the worker; its
 * progress surfaces through the platform-wide `ProgressTopBar` (mounted in
 * `AppShell`, spec § MRP engine point 4) once the job starts — this page
 * only needs to show the row's `status` and refresh on demand, not render
 * its own progress bar (`packages/core/src/modules/progress/AGENTS.md`:
 * "never build per-module progress bars for global operations").
 */
export default function MrpRunsPage() {
  const t = useT()
  const router = useRouter()
  const [rows, setRows] = React.useState<MrpRunRow[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [filters, setFilters] = React.useState<FilterValues>({})
  const [isLoading, setIsLoading] = React.useState(true)
  const [isStartingRun, setIsStartingRun] = React.useState(false)
  const [reloadToken, setReloadToken] = React.useState(0)
  const scopeVersion = useOrganizationScopeVersion()

  const mutationContextId = 'production-mrp-runs:create-run'
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: mutationContextId,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      try {
        const params = new URLSearchParams({ page: String(page), pageSize: '20' })
        const statusFilter = filters.status
        if (Array.isArray(statusFilter) && statusFilter.length > 0) {
          params.set('status', statusFilter.join(','))
        } else if (typeof statusFilter === 'string' && statusFilter) {
          params.set('status', statusFilter)
        }

        const fallback: ResponsePayload = { items: [], total: 0, page, totalPages: 1 }
        const call = await apiCall<ResponsePayload>(`/api/production/mrp/runs?${params.toString()}`, undefined, { fallback })
        if (!call.ok) {
          if (!cancelled) flash(t('production.mrp.error.list_failed', 'Failed to load MRP runs'), 'error')
          return
        }
        const payload = call.result ?? fallback
        if (!cancelled) {
          setRows(Array.isArray(payload.items) ? payload.items : [])
          setTotal(payload.total || 0)
          setTotalPages(payload.totalPages || 1)
        }
      } catch {
        if (!cancelled) flash(t('production.mrp.error.list_failed', 'Failed to load MRP runs'), 'error')
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [page, filters, reloadToken, scopeVersion, t])

  const handleRunNow = React.useCallback(async () => {
    if (isStartingRun) return
    setIsStartingRun(true)
    try {
      await runMutation({
        operation: async () => {
          const result = await apiCall('/api/production/mrp/runs', { method: 'POST', body: JSON.stringify({}) })
          if (!result.ok) {
            throw Object.assign(new Error('[internal] production.mrp.createRun failed'), {
              status: result.status,
              ...((result.result as Record<string, unknown> | null) ?? {}),
            })
          }
          return result
        },
        context: { formId: mutationContextId, resourceKind: 'production.mrp_run', retryLastMutation },
      })
      flash(t('production.mrp.success.run_started', 'MRP run started. Progress appears in the top bar.'), 'success')
      setReloadToken((prev) => prev + 1)
    } catch (err) {
      const serverMessage = extractServerErrorMessage(err)
      flash(serverMessage ?? t('production.mrp.error.run_start_failed', 'Failed to start MRP run'), 'error')
    } finally {
      setIsStartingRun(false)
    }
  }, [isStartingRun, mutationContextId, retryLastMutation, runMutation, t])

  const columns = React.useMemo<ColumnDef<MrpRunRow>[]>(
    () => [
      {
        id: 'status',
        accessorKey: 'status',
        header: t('production.mrp.run.field.status', 'Status'),
        enableSorting: false,
        cell: ({ row }) => <MrpRunStatusBadge status={row.original.status} t={t} />,
      },
      {
        id: 'startedAt',
        accessorKey: 'startedAt',
        header: t('production.mrp.run.field.started_at', 'Started'),
        cell: ({ row }) => (row.original.startedAt ? new Date(row.original.startedAt).toLocaleString() : '—'),
      },
      {
        id: 'finishedAt',
        accessorKey: 'finishedAt',
        header: t('production.mrp.run.field.finished_at', 'Finished'),
        cell: ({ row }) => (row.original.finishedAt ? new Date(row.original.finishedAt).toLocaleString() : '—'),
      },
      {
        id: 'stats',
        accessorKey: 'stats',
        header: t('production.mrp.run.field.stats', 'Stats'),
        enableSorting: false,
        cell: ({ row }) => {
          const stats = row.original.stats
          if (!stats) return '—'
          return t(
            'production.mrp.run.stats_summary',
            '{open} open suggestions / {demands} demands / {warnings} warnings',
            {
              open: stats.suggestionsOpen ?? 0,
              demands: stats.demandsProcessed ?? 0,
              warnings: stats.warningsCount ?? 0,
            },
          )
        },
      },
      {
        id: 'createdAt',
        accessorKey: 'createdAt',
        header: t('production.mrp.run.field.created_at', 'Created'),
        cell: ({ row }) => new Date(row.original.createdAt).toLocaleString(),
      },
    ],
    [t],
  )

  const filterDefs = React.useMemo<FilterDef[]>(
    () => [
      {
        id: 'status',
        label: t('production.mrp.run.filters.status', 'Status'),
        type: 'select',
        multiple: true,
        options: RUN_STATUSES.map((status) => ({
          value: status,
          label: t(`production.mrp.run.status.${status}`, status),
        })),
      },
    ],
    [t],
  )

  return (
    <Page>
      <PageBody>
        <DataTable<MrpRunRow>
          title={t('production.mrp.title', 'MRP Runs')}
          columns={columns}
          data={rows}
          filters={filterDefs}
          filterValues={filters}
          onFiltersApply={(values) => {
            setFilters(values)
            setPage(1)
          }}
          onFiltersClear={() => {
            setFilters({})
            setPage(1)
          }}
          actions={
            <Button onClick={handleRunNow} disabled={isStartingRun}>
              <Play className="mr-2 h-4 w-4" />
              {isStartingRun
                ? t('production.mrp.action.starting', 'Starting…')
                : t('production.mrp.action.run_now', 'Run MRP now')}
            </Button>
          }
          onRowClick={(row) => router.push(`/backend/production/mrp/runs/${row.id}`)}
          rowActions={(row) => (
            <RowActions
              items={[
                {
                  id: 'view',
                  label: t('production.mrp.action.view', 'View suggestions'),
                  href: `/backend/production/mrp/runs/${row.id}`,
                },
              ]}
            />
          )}
          emptyState={(
            <ListEmptyState
              entityName={t('production.mrp.title', 'MRP Runs')}
              createLabel={t('production.mrp.action.run_now', 'Run MRP now')}
              onCreate={handleRunNow}
            />
          )}
          refreshButton={{
            label: t('production.mrp.action.refresh', 'Refresh'),
            onRefresh: () => setReloadToken((prev) => prev + 1),
          }}
          pagination={{ page, pageSize: 20, total, totalPages, onPageChange: setPage }}
          isLoading={isLoading}
        />
      </PageBody>
    </Page>
  )
}
