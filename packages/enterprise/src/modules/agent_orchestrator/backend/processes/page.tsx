"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { SearchInput } from '@open-mercato/ui/primitives/search-input'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { formatCostMinor, formatRelativeAge } from '../../components/types'
import { useCoalescedReload } from '../../components/useCoalescedReload'
import {
  PROCESS_HEADER_SORT_FIELDS,
  serverSortToSorting,
  sortingToServerSort,
  type ServerSort,
} from '../../components/serverSort'
import {
  mapProcessListRow,
  PROCESS_STATUS_LABEL_KEY,
  PROCESS_STATUS_TONE,
  type ProcessListRow,
} from '../../components/processTypes'

type Facet = 'all' | 'needs_decision' | 'stuck' | 'high_value' | 'fraud'

/** Facet tab → server-side list scope (spec 2026-06-25 §API Contracts). */
const FACET_SCOPE: Record<Exclude<Facet, 'all'>, string> = {
  needs_decision: 'needs_decision',
  stuck: 'stuck_24h',
  high_value: 'high_value',
  fraud: 'fraud_flagged',
}

const FACETS: Facet[] = ['all', 'needs_decision', 'stuck', 'high_value', 'fraud']

type ListResponse = {
  items?: Array<Record<string, unknown>>
  total?: number
  totalPages?: number
}

function listPath(
  facet: Facet,
  page: number,
  pageSize: number,
  q: string,
  sort: ServerSort | null,
): string {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
  if (facet !== 'all') params.set('scope', FACET_SCOPE[facet])
  if (q) params.set('q', q)
  if (sort) {
    params.set('sortField', sort.field)
    params.set('sortDir', sort.dir)
  }
  return `/api/agent_orchestrator/processes?${params.toString()}`
}

export default function ProcessesListPage() {
  const t = useT()
  const router = useRouter()
  const [facet, setFacet] = React.useState<Facet>('all')
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(50)
  const [rows, setRows] = React.useState<ProcessListRow[]>([])
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [facetCounts, setFacetCounts] = React.useState<Partial<Record<Facet, number>>>({})
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [search, setSearch] = React.useState('')
  // Debounced 300 ms before hitting the server `q` (subject reference/label).
  const [q, setQ] = React.useState('')
  // Header sort → server sortField/sortDir; null = the route's default order.
  const [sort, setSort] = React.useState<ServerSort | null>(null)

  React.useEffect(() => {
    const handle = setTimeout(() => setQ(search.trim()), 300)
    return () => clearTimeout(handle)
  }, [search])

  React.useEffect(() => { setPage(1) }, [q, sort])

  const reload = React.useCallback(async () => {
    setError(null)
    const [listCall, ...countCalls] = await Promise.all([
      apiCall<ListResponse>(listPath(facet, page, pageSize, q, sort), undefined, { fallback: {} }),
      // Facet counts share the search filter so the tab badges always describe
      // the same result set the table shows.
      ...FACETS.map((tab) =>
        apiCall<ListResponse>(listPath(tab, 1, 1, q, null), undefined, { fallback: {} }),
      ),
    ])
    if (!listCall.ok) {
      setError(t('agent_orchestrator.process.list.error'))
      setIsLoading(false)
      return
    }
    const items = Array.isArray(listCall.result?.items) ? listCall.result.items : []
    setRows(items.map(mapProcessListRow).filter((row): row is ProcessListRow => !!row))
    setTotal(typeof listCall.result?.total === 'number' ? listCall.result.total : items.length)
    setTotalPages(typeof listCall.result?.totalPages === 'number' ? listCall.result.totalPages : 1)
    const counts: Partial<Record<Facet, number>> = {}
    FACETS.forEach((tab, index) => {
      const call = countCalls[index]
      if (call?.ok && typeof call.result?.total === 'number') counts[tab] = call.result.total
    })
    setFacetCounts(counts)
    setIsLoading(false)
  }, [facet, page, pageSize, q, sort, t])

  React.useEffect(() => {
    setIsLoading(true)
    void reload()
  }, [reload])

  const coalescedReload = useCoalescedReload(reload)
  useAppEvent('agent_orchestrator.process.updated', () => {
    coalescedReload()
  })

  const columns = React.useMemo<ColumnDef<ProcessListRow>[]>(
    () => [
      {
        accessorKey: 'subjectLabel',
        header: t('agent_orchestrator.process.list.col.claim'),
        // No entry in the route's sortFieldMap — a header sort would only
        // reorder the visible page, which the audit flagged as a lying sort.
        enableSorting: false,
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="font-mono text-sm font-medium text-foreground">{row.original.subjectLabel}</div>
            <div className="truncate text-xs text-muted-foreground">{row.original.subjectTitle}</div>
          </div>
        ),
      },
      {
        accessorKey: 'subjectType',
        header: t('agent_orchestrator.process.list.col.type'),
        enableSorting: false,
        cell: ({ row }) => <span className="text-sm text-foreground">{row.original.subjectType}</span>,
      },
      {
        accessorKey: 'currentStage',
        header: t('agent_orchestrator.process.list.col.stage'),
        enableSorting: false,
        cell: ({ row }) => <span className="text-sm text-muted-foreground">{row.original.currentStage}</span>,
      },
      {
        accessorKey: 'agentIds',
        header: t('agent_orchestrator.process.list.col.agents'),
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex flex-wrap items-center gap-1">
            {row.original.agentIds.slice(0, 4).map((agent) => (
              <Avatar key={agent} label={agent} size="sm" />
            ))}
            {row.original.agentIds.length > 4 ? (
              <span className="text-xs font-medium text-muted-foreground">
                +{row.original.agentIds.length - 4}
              </span>
            ) : null}
          </div>
        ),
      },
      {
        accessorKey: 'status',
        header: t('agent_orchestrator.process.list.col.status'),
        cell: ({ row }) => (
          <StatusBadge variant={PROCESS_STATUS_TONE[row.original.status]} dot>
            {t(PROCESS_STATUS_LABEL_KEY[row.original.status])}
          </StatusBadge>
        ),
      },
      {
        accessorKey: 'openedAt',
        header: t('agent_orchestrator.process.list.col.age'),
        cell: ({ row }) => (
          <span className="text-sm tabular-nums text-muted-foreground">{formatRelativeAge(row.original.openedAt) ?? '—'}</span>
        ),
      },
      {
        accessorKey: 'costMinor',
        header: t('agent_orchestrator.process.list.col.cost'),
        cell: ({ row }) => (
          <span className="text-sm tabular-nums text-muted-foreground">
            {formatCostMinor(row.original.costMinor, row.original.currency) ?? '—'}
          </span>
        ),
      },
    ],
    [t],
  )

  return (
    <Page>
      <PageBody className="space-y-4">
        <div>
          <h1 className="text-lg font-semibold">{t('agent_orchestrator.process.list.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('agent_orchestrator.process.list.subtitle')}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="w-full sm:w-72 lg:w-80">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder={t('agent_orchestrator.process.list.searchPlaceholder')}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {t('agent_orchestrator.process.list.searchHint')}
          </p>
        </div>

        <div role="tablist" className="flex flex-nowrap items-center gap-4 overflow-x-auto border-b border-border">
          {FACETS.map((tab) => {
            const active = facet === tab
            const label = t(`agent_orchestrator.process.facet.${
              tab === 'all' ? 'all'
                : tab === 'needs_decision' ? 'needsDecision'
                  : tab === 'stuck' ? 'stuck'
                    : tab === 'high_value' ? 'highValue'
                      : 'fraud'
            }`)
            return (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  setFacet(tab)
                  setPage(1)
                }}
                className={cn(
                  '-mb-px flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 py-2.5 text-sm transition-colors',
                  active
                    ? 'border-brand-violet font-semibold text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {label}
                <span
                  className={cn(
                    'inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-medium tabular-nums',
                    active ? 'bg-brand-violet/10 text-brand-violet' : 'bg-muted text-muted-foreground',
                  )}
                >
                  {facetCounts[tab] ?? '—'}
                </span>
              </button>
            )
          })}
        </div>

        {isLoading ? (
          <LoadingMessage label={t('agent_orchestrator.process.list.title')} />
        ) : error ? (
          <ErrorMessage label={error} />
        ) : rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {q
              ? t('agent_orchestrator.process.list.searchEmpty')
              : facet !== 'all'
                ? t('agent_orchestrator.process.list.facetEmpty')
                : t('agent_orchestrator.process.list.empty')}
          </p>
        ) : (
          <DataTable<ProcessListRow>
            columns={columns}
            data={rows}
            sortable
            manualSorting
            sorting={serverSortToSorting(sort, PROCESS_HEADER_SORT_FIELDS)}
            onSortingChange={(next: SortingState) =>
              setSort(sortingToServerSort(next, PROCESS_HEADER_SORT_FIELDS))
            }
            onRowClick={(row) => router.push(`/backend/processes/${encodeURIComponent(row.id)}`)}
            pagination={{
              page,
              pageSize,
              total,
              totalPages,
              onPageChange: setPage,
              pageSizeOptions: [20, 50, 100],
              onPageSizeChange: (next) => {
                setPageSize(next)
                setPage(1)
              },
            }}
          />
        )}
      </PageBody>
    </Page>
  )
}
