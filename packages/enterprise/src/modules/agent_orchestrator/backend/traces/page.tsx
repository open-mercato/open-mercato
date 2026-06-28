"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import type { ColumnDef } from '@tanstack/react-table'
import { RotateCw, Smile, Meh, Frown, Clock, ArrowUpDown, ChevronDown, CheckCircle2, Gauge, TriangleAlert } from 'lucide-react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { SearchInput } from '@open-mercato/ui/primitives/search-input'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { mapRun, formatCostMinor, type RunView } from '../../components/types'
import { runStatusLabelKey } from '../../components/cockpitStatus'

type RunsResponse = { items?: Array<Record<string, unknown>> }
type WindowKey = '24h' | '7d' | '30d'
type FacetKey = 'all' | 'errors' | 'needs-review'
type SortKey = 'recentDesc' | 'recentAsc' | 'latencyDesc' | 'confidenceDesc' | 'confidenceAsc' | 'agentAsc'

const LOW_CONFIDENCE_THRESHOLD = 0.5

const SORT_OPTIONS: Array<{ key: SortKey; labelKey: string }> = [
  { key: 'recentDesc', labelKey: 'agent_orchestrator.traces.sort.recentDesc' },
  { key: 'recentAsc', labelKey: 'agent_orchestrator.traces.sort.recentAsc' },
  { key: 'latencyDesc', labelKey: 'agent_orchestrator.traces.sort.latencyDesc' },
  { key: 'confidenceDesc', labelKey: 'agent_orchestrator.traces.sort.confidenceDesc' },
  { key: 'confidenceAsc', labelKey: 'agent_orchestrator.traces.sort.confidenceAsc' },
  { key: 'agentAsc', labelKey: 'agent_orchestrator.traces.sort.agentAsc' },
]

// Run status: ok is the overwhelming majority, so it stays neutral (no green) —
// the Eval column owns the health signal (green pass / red fail). Errors and
// in-flight runs keep their status colour so the eye catches the anomalies.
const TRACE_STATUS_VARIANT: Record<string, 'info' | 'error' | 'neutral'> = {
  running: 'info',
  ok: 'neutral',
  error: 'error',
}

function confidencePctOf(confidence: number | null): number | null {
  if (confidence == null) return null
  return confidence <= 1 ? confidence * 100 : confidence
}
// Confidence reads faster as a face than a bare number — same scale as caseload.
function confidenceFace(pct: number): { Icon: React.ComponentType<{ className?: string }>; color: string } {
  if (pct >= 70) return { Icon: Smile, color: 'text-status-success-text' }
  if (pct >= 40) return { Icon: Meh, color: 'text-muted-foreground' }
  return { Icon: Frown, color: 'text-status-error-text' }
}
function ranAtValue(createdAt: string | null): number {
  if (!createdAt) return 0
  const parsed = Date.parse(createdAt)
  return Number.isNaN(parsed) ? 0 : parsed
}
function relativeFrom(createdAt: string | null, now: number): string {
  const parsed = ranAtValue(createdAt)
  if (!parsed) return '—'
  const minutes = Math.max(0, Math.round((now - parsed) / 60000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.round(hours / 24)}d`
}
function exactFrom(createdAt: string | null): string {
  const parsed = ranAtValue(createdAt)
  return parsed ? new Date(parsed).toLocaleString() : '—'
}
function formatLatency(latencyMs: number | null): string | null {
  if (latencyMs == null) return null
  return latencyMs < 1000 ? `${latencyMs}ms` : `${(latencyMs / 1000).toFixed(1)}s`
}
function matchesSearch(run: RunView, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return [run.agentId, run.model, run.runtime, run.externalRunId]
    .some((field) => typeof field === 'string' && field.toLowerCase().includes(q))
}
// Low confidence almost always co-occurs with a failed eval, so the two are
// collapsed into one "needs review" lens rather than two near-identical tabs.
function isNeedsReview(run: RunView): boolean {
  return run.evalPassed === false || (run.confidence != null && run.confidence < LOW_CONFIDENCE_THRESHOLD)
}
function matchesFacet(run: RunView, facet: FacetKey): boolean {
  if (facet === 'errors') return run.status === 'error'
  if (facet === 'needs-review') return isNeedsReview(run)
  return true
}
function sortRuns(runs: RunView[], key: SortKey): RunView[] {
  const sorted = [...runs]
  switch (key) {
    case 'recentAsc': sorted.sort((a, b) => ranAtValue(a.createdAt) - ranAtValue(b.createdAt)); break
    case 'latencyDesc': sorted.sort((a, b) => (b.latencyMs ?? -1) - (a.latencyMs ?? -1)); break
    case 'confidenceDesc': sorted.sort((a, b) => (b.confidence ?? -1) - (a.confidence ?? -1)); break
    case 'confidenceAsc': sorted.sort((a, b) => (a.confidence ?? Number.POSITIVE_INFINITY) - (b.confidence ?? Number.POSITIVE_INFINITY)); break
    case 'agentAsc': sorted.sort((a, b) => a.agentId.localeCompare(b.agentId)); break
    default: sorted.sort((a, b) => ranAtValue(b.createdAt) - ranAtValue(a.createdAt))
  }
  return sorted
}

export default function AgentTracesPage() {
  const t = useT()
  const router = useRouter()
  const [runs, setRuns] = React.useState<RunView[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [window, setWindow] = React.useState<WindowKey>('7d')
  const [facet, setFacet] = React.useState<FacetKey>('all')
  const [search, setSearch] = React.useState('')
  const [agentFilters, setAgentFilters] = React.useState<string[]>([])
  const [sortKey, setSortKey] = React.useState<SortKey>('recentDesc')
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(20)
  const [reloadToken, setReloadToken] = React.useState(0)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      setError(null)
      const params = new URLSearchParams({ pageSize: '100', window })
      const call = await apiCall<RunsResponse>(`/api/agent_orchestrator/runs?${params.toString()}`, undefined, {
        fallback: { items: [] },
      })
      if (cancelled) return
      if (!call.ok) {
        setError(t('agent_orchestrator.traces.error'))
        setIsLoading(false)
        return
      }
      const items = Array.isArray(call.result?.items) ? call.result!.items : []
      setRuns(items.map((item) => mapRun(item as Record<string, unknown>)).filter((row): row is RunView => !!row))
      setIsLoading(false)
    }
    void load()
    return () => { cancelled = true }
  }, [t, window, reloadToken])

  // Window is the only server-side filter; search/agent/facet/sort/paging are all
  // client-side so the facet tabs can carry live counts of the visible window.
  const searched = React.useMemo(
    () => runs.filter((run) => matchesSearch(run, search) && (agentFilters.length === 0 || agentFilters.includes(run.agentId))),
    [runs, search, agentFilters],
  )
  const counts = React.useMemo(() => ({
    errors: searched.filter((run) => run.status === 'error').length,
    needsReview: searched.filter(isNeedsReview).length,
  }), [searched])
  const facetRows = React.useMemo(() => searched.filter((run) => matchesFacet(run, facet)), [searched, facet])
  const sortedRows = React.useMemo(() => sortRuns(facetRows, sortKey), [facetRows, sortKey])
  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize))
  const pagedRows = React.useMemo(
    () => sortedRows.slice((page - 1) * pageSize, page * pageSize),
    [sortedRows, page, pageSize],
  )
  const agentOptions = React.useMemo(
    () => Array.from(new Set(runs.map((run) => run.agentId))).sort((a, b) => a.localeCompare(b)),
    [runs],
  )
  // Window-scoped aggregates (react to window + search + agent, independent of the
  // facet tab so they stay stable as you drill). p95 latency in particular cannot
  // be eyeballed from paged rows — and it lives nowhere else in the cockpit.
  const kpis = React.useMemo(() => {
    const evaluated = searched.filter((run) => run.evalPassed !== null)
    const passed = evaluated.filter((run) => run.evalPassed === true).length
    const latencies = searched
      .map((run) => run.latencyMs)
      .filter((value): value is number => value != null)
      .sort((a, b) => a - b)
    const errorCount = searched.filter((run) => run.status === 'error').length
    return {
      passRate: evaluated.length > 0 ? Math.round((passed / evaluated.length) * 100) : null,
      p95Latency: latencies.length > 0 ? latencies[Math.min(latencies.length - 1, Math.ceil(0.95 * latencies.length) - 1)] : null,
      errorRate: searched.length > 0 ? Math.round((errorCount / searched.length) * 100) : null,
    }
  }, [searched])

  React.useEffect(() => { setPage(1) }, [window, facet, search, agentFilters, sortKey])

  const columns = React.useMemo<ColumnDef<RunView>[]>(() => [
    {
      id: 'agent',
      accessorKey: 'agentId',
      header: t('agent_orchestrator.traces.col.agent', 'Agent'),
      meta: { maxWidth: '240px' },
      cell: ({ row }) => (
        <div className="flex items-center gap-2.5">
          <Avatar label={row.original.agentId} size="sm" />
          <span className="truncate text-sm font-medium text-foreground">{row.original.agentId}</span>
        </div>
      ),
    },
    {
      id: 'when',
      accessorFn: (row) => ranAtValue(row.createdAt),
      header: t('agent_orchestrator.traces.col.when', 'When'),
      cell: ({ row }) => <WhenLabel createdAt={row.original.createdAt} />,
    },
    {
      id: 'eval',
      accessorFn: (row) => (row.evalPassed === true ? 2 : row.evalPassed === false ? 0 : 1),
      header: t('agent_orchestrator.traces.col.eval', 'Eval'),
      cell: ({ row }) => {
        if (row.original.evalPassed === true) return <StatusBadge variant="success" dot>{t('agent_orchestrator.traces.eval.pass')}</StatusBadge>
        if (row.original.evalPassed === false) return <StatusBadge variant="error" dot>{t('agent_orchestrator.traces.eval.fail')}</StatusBadge>
        return <span className="text-sm text-muted-foreground">—</span>
      },
    },
    {
      id: 'confidence',
      accessorKey: 'confidence',
      header: t('agent_orchestrator.traces.col.confidence', 'Confidence'),
      cell: ({ row }) => {
        const pct = confidencePctOf(row.original.confidence)
        if (pct == null) return <span className="text-sm text-muted-foreground">—</span>
        const { Icon, color } = confidenceFace(pct)
        return (
          <div className="flex items-center gap-1.5">
            <Icon className={cn('size-4 shrink-0', color)} />
            <span className="text-sm tabular-nums text-foreground">{Math.round(pct)}%</span>
          </div>
        )
      },
    },
    {
      id: 'latency',
      accessorKey: 'latencyMs',
      header: t('agent_orchestrator.traces.col.latency', 'Latency'),
      cell: ({ row }) => {
        const value = formatLatency(row.original.latencyMs)
        return value
          ? <span className="text-sm tabular-nums text-foreground">{value}</span>
          : <span className="text-sm text-muted-foreground">—</span>
      },
    },
    {
      id: 'cost',
      accessorKey: 'costMinor',
      header: t('agent_orchestrator.traces.col.cost', 'Cost'),
      cell: ({ row }) => {
        const value = formatCostMinor(row.original.costMinor, row.original.currency)
        return value
          ? <span className="text-sm tabular-nums text-muted-foreground">{value}</span>
          : <span className="text-sm text-muted-foreground">—</span>
      },
    },
    {
      id: 'status',
      accessorKey: 'status',
      header: t('agent_orchestrator.traces.col.status', 'Status'),
      cell: ({ row }) => (
        <StatusBadge variant={TRACE_STATUS_VARIANT[row.original.status ?? 'ok'] ?? 'neutral'}>
          {t(runStatusLabelKey(row.original.status))}
        </StatusBadge>
      ),
    },
  ], [t])

  const showEmpty = !isLoading && !error && runs.length === 0

  return (
    <Page>
      <PageBody className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{t('agent_orchestrator.traces.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('agent_orchestrator.traces.subtitle')}</p>
        </div>

        {isLoading ? (
          <LoadingMessage label={t('agent_orchestrator.traces.title')} />
        ) : error ? (
          <ErrorMessage label={error} />
        ) : showEmpty ? (
          <EmptyState
            title={t('agent_orchestrator.traces.empty')}
            description={t('agent_orchestrator.traces.emptyDescription')}
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <div className="w-full sm:w-72 lg:w-80">
                <SearchInput value={search} onChange={setSearch} placeholder={t('agent_orchestrator.traces.searchPlaceholder')} />
              </div>
              <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
                <div
                  className="flex items-center gap-1.5"
                  title={t('agent_orchestrator.traces.windowTooltip')}
                >
                  <Clock className="size-4 shrink-0 text-muted-foreground" />
                  <SegmentedControl value={window} onValueChange={(value) => setWindow(value as WindowKey)}>
                    <SegmentedControlItem value="24h">{t('agent_orchestrator.traces.window.24h')}</SegmentedControlItem>
                    <SegmentedControlItem value="7d">{t('agent_orchestrator.traces.window.7d')}</SegmentedControlItem>
                    <SegmentedControlItem value="30d">{t('agent_orchestrator.traces.window.30d')}</SegmentedControlItem>
                  </SegmentedControl>
                </div>
                <MultiSelectPill
                  allLabel={t('agent_orchestrator.traces.filter.allAgents')}
                  options={agentOptions}
                  selected={agentFilters}
                  onChange={setAgentFilters}
                />
                <Select value={sortKey} onValueChange={(value) => setSortKey(value as SortKey)}>
                  <SelectTrigger className="h-9 w-auto min-w-40">
                    <ArrowUpDown className="size-4 shrink-0 opacity-70" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SORT_OPTIONS.map((option) => (
                      <SelectItem key={option.key} value={option.key}>{t(option.labelKey)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button type="button" variant="outline" size="sm" aria-label={t('agent_orchestrator.traces.refresh')} className="size-9 shrink-0 px-0" onClick={() => setReloadToken((token) => token + 1)}>
                  <RotateCw className="size-4" />
                </Button>
              </div>
            </div>

            <KpiStrip passRate={kpis.passRate} p95Latency={kpis.p95Latency} errorRate={kpis.errorRate} />

            <FacetTabs facet={facet} counts={counts} total={searched.length} onFacetChange={setFacet} />

            <DataTable<RunView>
              columns={columns}
              data={pagedRows}
              sortable
              columnChooser={{ auto: true }}
              onRowClick={(row) => router.push(`/backend/traces/${row.id}`)}
              pagination={{
                page,
                pageSize,
                total: sortedRows.length,
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

// "7d" alone reads as a mystery number — the clock icon + the exact timestamp in
// the tooltip make it unmistakably "when this run happened".
function WhenLabel({ createdAt }: { createdAt: string | null }) {
  return (
    <span className="inline-flex items-center gap-1 tabular-nums text-sm text-muted-foreground" title={exactFrom(createdAt)}>
      <Clock className="size-3 shrink-0 opacity-70" />
      {relativeFrom(createdAt, Date.now())}
    </span>
  )
}

// Window-scoped observability summary. Mirrors the Overview KpiTile recipe
// (icon badge + 3xl value + sub + brand-gradient accent) so the cockpit reads
// as one product; the metrics here are observability-specific, not fleet repeats.
function KpiStrip({
  passRate,
  p95Latency,
  errorRate,
}: {
  passRate: number | null
  p95Latency: number | null
  errorRate: number | null
}) {
  const t = useT()
  const tiles = [
    { icon: CheckCircle2, label: t('agent_orchestrator.traces.kpi.passRate'), value: passRate == null ? '—' : `${passRate}%`, sub: t('agent_orchestrator.traces.kpi.passRateSub') },
    { icon: Gauge, label: t('agent_orchestrator.traces.kpi.p95Latency'), value: formatLatency(p95Latency) ?? '—', sub: t('agent_orchestrator.traces.kpi.p95LatencySub') },
    { icon: TriangleAlert, label: t('agent_orchestrator.traces.kpi.errorRate'), value: errorRate == null ? '—' : `${errorRate}%`, sub: t('agent_orchestrator.traces.kpi.errorRateSub') },
  ]
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {tiles.map(({ icon: Icon, label, value, sub }) => (
        <div key={label} className="relative overflow-hidden rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm text-muted-foreground">{label}</p>
            <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-brand-violet">
              <Icon className="size-4" />
            </span>
          </div>
          <div className="mt-2 flex min-h-9 items-center gap-2">
            <span className="text-3xl font-bold tabular-nums tracking-tight text-foreground">{value}</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
          <div className="absolute inset-x-0 bottom-0 h-1 bg-gradient-to-r from-brand-lime via-brand-lime to-brand-violet" />
        </div>
      ))}
    </div>
  )
}

function FacetTabs({
  facet,
  counts,
  total,
  onFacetChange,
}: {
  facet: FacetKey
  counts: { errors: number; needsReview: number }
  total: number
  onFacetChange: (facet: FacetKey) => void
}) {
  const t = useT()
  const tabs: Array<{ key: FacetKey; label: string; count: number }> = [
    { key: 'all', label: t('agent_orchestrator.traces.facet.all'), count: total },
    { key: 'errors', label: t('agent_orchestrator.traces.facet.errors'), count: counts.errors },
    { key: 'needs-review', label: t('agent_orchestrator.traces.facet.needsReview'), count: counts.needsReview },
  ]
  return (
    <div className="flex flex-nowrap items-center gap-4 overflow-x-auto border-b border-border">
      {tabs.map((tab) => {
        const active = facet === tab.key
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => onFacetChange(tab.key)}
            className={cn(
              '-mb-px flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 py-2.5 text-sm transition-colors',
              active ? 'border-brand-violet font-semibold text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
            <span
              className={cn(
                'inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-medium tabular-nums',
                active ? 'bg-brand-violet/10 text-brand-violet' : 'bg-muted text-muted-foreground',
              )}
            >
              {tab.count}
            </span>
          </button>
        )
      })}
    </div>
  )
}

function MultiSelectPill({
  allLabel,
  options,
  selected,
  onChange,
}: {
  allLabel: string
  options: string[]
  selected: string[]
  onChange: (next: string[]) => void
}) {
  const t = useT()
  const label =
    selected.length === 0
      ? allLabel
      : selected.length === 1
        ? selected[0]
        : t('agent_orchestrator.traces.filter.selected', undefined, { count: selected.length })
  const toggle = (value: string) =>
    onChange(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value])
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-9 min-w-36 justify-between gap-2 font-normal">
          <span className="truncate">{label}</span>
          <ChevronDown className="size-4 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-1">
        <div className="max-h-64 overflow-auto">
          {options.length === 0 ? (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">—</p>
          ) : (
            options.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => toggle(value)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted"
              >
                <Checkbox checked={selected.includes(value)} className="pointer-events-none" />
                <span className="truncate">{value}</span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
