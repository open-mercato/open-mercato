"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import type { ColumnDef } from '@tanstack/react-table'
import { RotateCw, TriangleAlert } from 'lucide-react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'
import { useT, useLocale } from '@open-mercato/shared/lib/i18n/context'
import { useCoalescedReload } from '../../components/useCoalescedReload'
import { formatDateTime } from '../../components/types'
import {
  evalSuiteOutcomeVariant,
  evalSuiteStatusVariant,
  formatPassScore,
  mapEvalRunRow,
  type EvalRunRow,
  type EvalSuiteStatusState,
} from '../../components/evalRunTypes'

type EvalRunsResponse = { items?: Array<Record<string, unknown>>; total?: number }

/** `all` is a UI-only facet — it simply omits the server's `status` filter. */
type StatusFilter = 'all' | EvalSuiteStatusState

const STATUS_FILTERS: StatusFilter[] = ['all', 'queued', 'running', 'completed', 'failed', 'cancelled']

export default function AgentEvalRunsPage() {
  const t = useT()
  const locale = useLocale()
  const router = useRouter()
  const [rows, setRows] = React.useState<EvalRunRow[]>([])
  const [total, setTotal] = React.useState(0)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>('all')
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(20)
  const [reloadToken, setReloadToken] = React.useState(0)

  React.useEffect(() => { setPage(1) }, [statusFilter])

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      setError(null)
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
      if (statusFilter !== 'all') params.set('status', statusFilter)
      const call = await apiCall<EvalRunsResponse>(
        `/api/agent_orchestrator/eval-runs?${params.toString()}`,
        undefined,
        { fallback: { items: [], total: 0 } },
      )
      if (cancelled) return
      if (!call.ok) {
        setError(t('agent_orchestrator.evalRuns.error'))
        setIsLoading(false)
        return
      }
      const items = Array.isArray(call.result?.items) ? call.result.items : []
      setRows(items.map((item) => mapEvalRunRow(item)).filter((row): row is EvalRunRow => row !== null))
      setTotal(typeof call.result?.total === 'number' ? call.result.total : items.length)
      setIsLoading(false)
    }
    void load()
    return () => { cancelled = true }
  }, [t, statusFilter, page, pageSize, reloadToken])

  // Live refresh: a suite finishing anywhere in the org changes this list's
  // status/outcome columns. Coalesced so a burst of completions costs one refetch.
  const coalescedReload = useCoalescedReload(
    React.useCallback(() => setReloadToken((token) => token + 1), []),
  )
  useAppEvent('agent_orchestrator.eval_suite_run.completed', () => { coalescedReload() })

  const columns = React.useMemo<ColumnDef<EvalRunRow>[]>(() => [
    {
      id: 'status',
      accessorKey: 'status',
      header: t('agent_orchestrator.evalRuns.col.status'),
      enableSorting: false,
      cell: ({ row }) => (
        <StatusBadge variant={evalSuiteStatusVariant[row.original.status]} dot>
          {t(`agent_orchestrator.evalRuns.status.${row.original.status}`)}
        </StatusBadge>
      ),
    },
    {
      id: 'agent',
      accessorKey: 'agentDefinitionId',
      header: t('agent_orchestrator.evalRuns.col.agent'),
      enableSorting: false,
      meta: { maxWidth: '220px', truncate: true },
      cell: ({ row }) => (
        <span className="truncate text-sm font-medium text-foreground">{row.original.agentDefinitionId}</span>
      ),
    },
    {
      id: 'outcome',
      accessorKey: 'outcome',
      header: t('agent_orchestrator.evalRuns.col.outcome'),
      enableSorting: false,
      cell: ({ row }) => {
        const outcome = row.original.outcome
        if (!outcome) return <span className="text-sm text-muted-foreground">—</span>
        return (
          <StatusBadge variant={evalSuiteOutcomeVariant[outcome]}>
            {t(`agent_orchestrator.evalRuns.outcome.${outcome}`)}
          </StatusBadge>
        )
      },
    },
    {
      id: 'passScore',
      accessorKey: 'passScore',
      header: t('agent_orchestrator.evalRuns.col.passScore'),
      enableSorting: false,
      cell: ({ row }) => {
        const value = formatPassScore(row.original.passScore)
        return value
          ? <span className="text-sm font-medium tabular-nums text-foreground">{value}</span>
          : <span className="text-sm text-muted-foreground">—</span>
      },
    },
    {
      id: 'cases',
      accessorKey: 'caseCount',
      header: t('agent_orchestrator.evalRuns.col.cases'),
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <span className="text-sm tabular-nums text-foreground">{row.original.caseCount}</span>
          {row.original.errorCount > 0 ? (
            <span
              className="inline-flex items-center gap-1 text-sm tabular-nums text-status-warning-text"
              title={t('agent_orchestrator.evalRuns.errorsTooltip')}
            >
              <TriangleAlert className="size-3.5 shrink-0" />
              {t('agent_orchestrator.evalRuns.errorsCount', undefined, { count: row.original.errorCount })}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      id: 'trigger',
      accessorKey: 'trigger',
      header: t('agent_orchestrator.evalRuns.col.trigger'),
      enableSorting: false,
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {t(`agent_orchestrator.evalRuns.trigger.${row.original.trigger}`)}
        </span>
      ),
    },
    {
      id: 'when',
      accessorKey: 'startedAt',
      header: t('agent_orchestrator.evalRuns.col.when'),
      enableSorting: false,
      meta: { maxWidth: '260px' },
      cell: ({ row }) => {
        const started = formatDateTime(row.original.startedAt ?? row.original.createdAt, locale)
        const finished = formatDateTime(row.original.finishedAt, locale)
        return (
          <div className="flex flex-col">
            <span className="text-sm tabular-nums text-foreground">{started ?? '—'}</span>
            <span className="text-xs tabular-nums text-muted-foreground">
              {finished
                ? t('agent_orchestrator.evalRuns.finishedAt', undefined, { value: finished })
                : t('agent_orchestrator.evalRuns.notFinished')}
            </span>
          </div>
        )
      },
    },
  ], [t, locale])

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const showEmpty = !isLoading && !error && total === 0 && statusFilter === 'all'

  return (
    <Page>
      <PageBody className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{t('agent_orchestrator.evalRuns.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('agent_orchestrator.evalRuns.subtitle')}</p>
        </div>

        {isLoading ? (
          <LoadingMessage label={t('agent_orchestrator.evalRuns.title')} />
        ) : error ? (
          <ErrorMessage label={error} />
        ) : showEmpty ? (
          <EmptyState
            title={t('agent_orchestrator.evalRuns.empty')}
            description={t('agent_orchestrator.evalRuns.emptyDescription')}
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <SegmentedControl
                value={statusFilter}
                onValueChange={(value) => setStatusFilter(value as StatusFilter)}
              >
                {STATUS_FILTERS.map((value) => (
                  <SegmentedControlItem key={value} value={value}>
                    {value === 'all'
                      ? t('agent_orchestrator.evalRuns.filter.all')
                      : t(`agent_orchestrator.evalRuns.status.${value}`)}
                  </SegmentedControlItem>
                ))}
              </SegmentedControl>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={t('agent_orchestrator.evalRuns.refresh')}
                className="size-9 shrink-0 px-0 sm:ml-auto"
                onClick={() => setReloadToken((token) => token + 1)}
              >
                <RotateCw className="size-4" />
              </Button>
            </div>

            <DataTable<EvalRunRow>
              columns={columns}
              data={rows}
              onRowClick={(row) => router.push(`/backend/eval-runs/${encodeURIComponent(row.id)}`)}
              emptyState={t('agent_orchestrator.evalRuns.emptyFiltered')}
              pagination={{
                page,
                pageSize,
                total,
                totalPages,
                onPageChange: setPage,
                pageSizeOptions: [10, 20, 50],
                onPageSizeChange: (next) => { setPageSize(next); setPage(1) },
              }}
            />
          </>
        )}
      </PageBody>
    </Page>
  )
}
