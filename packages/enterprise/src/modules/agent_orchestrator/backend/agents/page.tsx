"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { Download, Bot, ShieldCheck, Pencil, Wallet } from 'lucide-react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge, type StatusMap } from '@open-mercato/ui/primitives/status-badge'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT, useLocale } from '@open-mercato/shared/lib/i18n/context'
import {
  mapAgent,
  mapAgentWindowMetrics,
  formatCostMinor,
  formatNumber,
  type AgentView,
  type AgentRuntime,
  type AgentWindowMetricsView,
} from '../../components/types'
import { Chip, TYPE_ICON, AGENT_TYPE_ICON, RUNTIME_ICON, AUTONOMY_ICON, agentAvatarIcon } from '../../components/agentChips'
import { runtimeDisplayLabel } from '../../components/runtimeLabel'
import { isBusinessHarnessRuntime } from '../../lib/runtime/agentRuntimeValues'
import { isAgentPreviewUiEnabled } from '../../lib/featureFlags'
import { AGENT_TYPE_UNDECLARED, collectAgentTagOptions, filterAgentRows } from './agentListFilters'
import type { AgentType } from '../../data/validators'

const AGENT_TYPE_VALUES: readonly AgentType[] = ['researcher', 'decision_maker', 'action']

const RUNTIME_VALUES: AgentRuntime[] = ['in-process', 'native', 'business-harness', 'external']
const AUTONOMY_VALUES: Autonomy[] = ['auto', 'review', 'gated']
const HEALTH_VALUES: Health[] = ['good', 'watch', 'poor', 'new']

type Autonomy = 'auto' | 'review' | 'gated'
type Health = 'good' | 'watch' | 'poor' | 'new'

type AgentRow = AgentView & {
  autonomy: Autonomy
  runs: number
  evalPass: number | null
  overrideRate: number | null
  costPerRun: number | null
  costTotal: number
  currency: string | null
  status: Health
}

const statusVariant: StatusMap<Health> = { good: 'success', watch: 'warning', poor: 'error', new: 'neutral' }

const METRICS_WINDOW = '7d'
const METRICS_BATCH_SIZE = 50

/** One round-trip per 50 agents via GET /metrics/agents (rollup-preferred). */
async function fetchAgentMetrics(ids: string[]): Promise<Map<string, AgentWindowMetricsView>> {
  const byAgent = new Map<string, AgentWindowMetricsView>()
  for (let start = 0; start < ids.length; start += METRICS_BATCH_SIZE) {
    const chunk = ids.slice(start, start + METRICS_BATCH_SIZE)
    const call = await apiCall<{ items?: Array<Record<string, unknown>> }>(
      `/api/agent_orchestrator/metrics/agents?window=${METRICS_WINDOW}&ids=${chunk.map((id) => encodeURIComponent(id)).join(',')}`,
      undefined,
      { fallback: { items: [] } },
    )
    if (!call.ok || !Array.isArray(call.result?.items)) continue
    for (const item of call.result.items) {
      const mapped = mapAgentWindowMetrics(item as Record<string, unknown>)
      if (mapped) byAgent.set(mapped.agentId, mapped)
    }
  }
  return byAgent
}

export default function AgentsRegistryPage() {
  const t = useT()
  const locale = useLocale()
  const router = useRouter()
  const [rows, setRows] = React.useState<AgentRow[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(20)
  const [search, setSearch] = React.useState('')
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})
  const previewUi = isAgentPreviewUiEnabled()

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      setError(null)
      // Patryk's real registry is the source of truth for which agents exist.
      const agentsCall = await apiCall<{ items?: Array<Record<string, unknown>> }>(
        '/api/agent_orchestrator/agents',
        undefined,
        { fallback: { items: [] } },
      )
      if (cancelled) return
      if (!agentsCall.ok) {
        setError(t('agent_orchestrator.agents.list.error'))
        setIsLoading(false)
        return
      }
      const agents = (Array.isArray(agentsCall.result?.items) ? agentsCall.result.items : [])
        .map((item) => mapAgent(item))
        .filter((agent): agent is AgentView => !!agent)

      // Real per-agent window metrics (rollup-preferred, live fallback) — one
      // batch round-trip instead of the old global-100-row sample.
      const metricsByAgent = await fetchAgentMetrics(agents.map((agent) => agent.id))
      if (cancelled) return

      const built: AgentRow[] = agents.map((agent) => {
        const metrics = metricsByAgent.get(agent.id) ?? null
        const overrideRate = metrics?.overrideRate ?? null
        const errorRate = metrics?.errorRate ?? 0
        // UI heuristic until the backend exposes a real autonomy setting.
        const autonomy: Autonomy = agent.resultKind === 'researcher' ? 'auto' : 'review'
        let status: Health = 'new'
        if ((metrics?.runsTotal ?? 0) > 0 || (metrics?.disposedProposals ?? 0) > 0) {
          if ((overrideRate ?? 0) > 0.3 || (errorRate ?? 0) > 0.2) status = 'poor'
          else if ((overrideRate ?? 0) > 0.15) status = 'watch'
          else status = 'good'
        }
        return {
          ...agent,
          autonomy,
          runs: metrics?.runsTotal ?? 0,
          evalPass: metrics?.evalPassRate ?? null,
          overrideRate,
          costPerRun: metrics?.avgCostMinor ?? null,
          costTotal: metrics?.costMinorTotal ?? 0,
          currency: metrics?.currency ?? null,
          status,
        }
      })
      setRows(built)
      setIsLoading(false)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [t])

  const columns = React.useMemo<ColumnDef<AgentRow>[]>(() => [
    {
      accessorKey: 'label',
      header: t('agent_orchestrator.agents.list.col.agent', 'Agent'),
      meta: { maxWidth: '320px' },
      cell: ({ row }) => {
        const agent = row.original
        return (
          <div className="flex items-center gap-2.5">
            <Avatar
              label={agent.label || agent.id}
              size="sm"
              variant="monochrome"
              icon={agentAvatarIcon(agent.icon, agent.resultKind)}
            />
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-foreground">{agent.label || agent.id}</div>
            </div>
          </div>
        )
      },
    },
    {
      accessorKey: 'resultKind',
      header: t('agent_orchestrator.agents.list.col.type', 'Type'),
      cell: ({ row }) => (
        <Chip icon={TYPE_ICON[row.original.resultKind]}>{t(`agent_orchestrator.agents.list.resultKind.${row.original.resultKind}`)}</Chip>
      ),
    },
    {
      accessorKey: 'agentType',
      header: t('agent_orchestrator.agents.list.col.agentType', 'Purpose'),
      cell: ({ row }) => {
        // The DECLARED type — what the agent is FOR, known before it has ever run.
        // Undeclared is its own state, never silently rendered as "Researcher".
        const agentType = row.original.agentType
        if (!agentType) {
          return <PendingChip label={t('agent_orchestrator.agents.list.agentType.undeclared', 'Undeclared')} />
        }
        return <Chip icon={AGENT_TYPE_ICON[agentType]}>{t(`agent_orchestrator.agents.list.agentType.${agentType}`)}</Chip>
      },
    },
    {
      accessorKey: 'runtime',
      header: t('agent_orchestrator.agents.list.col.runtime', 'Runtime'),
      cell: ({ row }) => (
        <Chip icon={RUNTIME_ICON[row.original.runtime]}>
          {runtimeDisplayLabel(t, row.original.runtime, row.original.runtimeMode)}
        </Chip>
      ),
    },
    {
      accessorKey: 'autonomy',
      header: t('agent_orchestrator.agents.list.col.autonomy', 'Autonomy'),
      cell: ({ row }) => {
        const autonomy = row.original.autonomy
        return <Chip icon={AUTONOMY_ICON[autonomy]}>{t(`agent_orchestrator.agents.list.autonomy.${autonomy}`, titleCase(autonomy))}</Chip>
      },
    },
    {
      accessorKey: 'tags',
      header: t('agent_orchestrator.agents.list.col.tags', 'Tags'),
      enableSorting: false,
      meta: { maxWidth: '260px' },
      cell: ({ row }) => {
        const tags = row.original.tags
        if (!tags.length) return <span className="text-sm text-muted-foreground">—</span>
        return (
          <div className="flex flex-wrap gap-1">
            {tags.map((tag) => (
              <Chip key={tag}>{tag}</Chip>
            ))}
          </div>
        )
      },
    },
    {
      accessorKey: 'runs',
      header: t('agent_orchestrator.agents.list.col.runs', 'Runs'),
      cell: ({ row }) => <div className="text-right text-sm tabular-nums">{formatNumber(row.original.runs, locale) ?? '0'}</div>,
    },
    {
      accessorKey: 'evalPass',
      header: t('agent_orchestrator.agents.list.col.evalPass', 'Eval pass'),
      cell: ({ row }) => {
        const value = row.original.evalPass
        if (value == null) return <PendingChip label={t('agent_orchestrator.agents.list.pending.noData', 'No data')} />
        return <span className="text-sm tabular-nums text-foreground">{Math.round(value * 100)}%</span>
      },
    },
    {
      accessorKey: 'overrideRate',
      header: t('agent_orchestrator.agents.list.col.override', 'Override'),
      cell: ({ row }) => {
        const value = row.original.overrideRate
        if (value == null) return <PendingChip label={t('agent_orchestrator.agents.list.pending.noData', 'No data')} />
        const pct = Math.round(value * 100)
        return (
          <div className="flex items-center gap-2">
            <span className="w-9 text-sm tabular-nums">{pct}%</span>
            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-brand-violet" style={{ width: `${Math.min(100, (pct / 40) * 100)}%` }} />
            </div>
          </div>
        )
      },
    },
    {
      accessorKey: 'costPerRun',
      header: t('agent_orchestrator.agents.list.col.cost', 'Cost / run (est.)'),
      cell: ({ row }) => {
        const value = formatCostMinor(row.original.costPerRun, row.original.currency)
        if (!value) return <PendingChip label={t('agent_orchestrator.agents.list.pending.noData', 'No data')} />
        return <span className="text-sm tabular-nums text-muted-foreground">{value}</span>
      },
    },
    {
      accessorKey: 'status',
      header: t('agent_orchestrator.agents.list.col.status', 'Status'),
      cell: ({ row }) => (
        <StatusBadge variant={statusVariant[row.original.status]} dot>
          {t(`agent_orchestrator.agents.list.status.${row.original.status}`, titleCase(row.original.status))}
        </StatusBadge>
      ),
    },
  ], [t])

  const tagOptions = React.useMemo(() => collectAgentTagOptions(rows), [rows])
  const harnessRuntimeMode = React.useMemo(
    () => rows.find((row) => row.runtimeMode !== null)?.runtimeMode ?? null,
    [rows],
  )

  const filterDefs = React.useMemo<FilterDef[]>(() => [
    {
      id: 'resultKind',
      label: t('agent_orchestrator.agents.list.col.type', 'Type'),
      type: 'select',
      multiple: true,
      options: (['researcher', 'proposal'] as const).map((value) => ({
        value,
        label: t(`agent_orchestrator.agents.list.resultKind.${value}`),
      })),
    },
    {
      id: 'agentType',
      label: t('agent_orchestrator.agents.list.col.agentType', 'Purpose'),
      type: 'select',
      multiple: true,
      options: [
        ...AGENT_TYPE_VALUES.map((value) => ({
          value,
          label: t(`agent_orchestrator.agents.list.agentType.${value}`),
        })),
        {
          value: AGENT_TYPE_UNDECLARED,
          label: t('agent_orchestrator.agents.list.agentType.undeclared', 'Undeclared'),
        },
      ],
    },
    {
      id: 'runtime',
      label: t('agent_orchestrator.agents.list.col.runtime', 'Runtime'),
      type: 'select',
      multiple: true,
      options: RUNTIME_VALUES.map((value) => ({
        value,
        label: runtimeDisplayLabel(t, value, isBusinessHarnessRuntime(value) ? harnessRuntimeMode : null),
      })),
    },
    {
      id: 'autonomy',
      label: t('agent_orchestrator.agents.list.col.autonomy', 'Autonomy'),
      type: 'select',
      multiple: true,
      options: AUTONOMY_VALUES.map((value) => ({
        value,
        label: t(`agent_orchestrator.agents.list.autonomy.${value}`, titleCase(value)),
      })),
    },
    {
      id: 'status',
      label: t('agent_orchestrator.agents.list.col.status', 'Status'),
      type: 'select',
      multiple: true,
      options: HEALTH_VALUES.map((value) => ({
        value,
        label: t(`agent_orchestrator.agents.list.status.${value}`, titleCase(value)),
      })),
    },
    {
      id: 'tags',
      label: t('agent_orchestrator.agents.list.col.tags', 'Tags'),
      type: 'tags',
      placeholder: t('agent_orchestrator.agents.tags.filterPlaceholder', 'Pick a tag'),
      options: tagOptions.map((tag) => ({ value: tag, label: tag })),
    },
  ], [t, tagOptions, harnessRuntimeMode])

  const filteredRows = React.useMemo(
    () => filterAgentRows(rows, search, filterValues),
    [rows, search, filterValues],
  )

  if (isLoading) {
    return (
      <Page>
        <PageBody>
          <LoadingMessage label={t('agent_orchestrator.agents.list.title')} />
        </PageBody>
      </Page>
    )
  }

  if (error) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage label={error} />
        </PageBody>
      </Page>
    )
  }

  const gatedCount = rows.filter((agent) => agent.autonomy === 'gated').length
  const reviewCount = rows.filter((agent) => agent.autonomy === 'review').length
  const ratedRows = rows.filter((agent) => agent.overrideRate != null)
  const avgOverride = ratedRows.length
    ? Math.round((ratedRows.reduce((sum, agent) => sum + (agent.overrideRate ?? 0), 0) / ratedRows.length) * 100)
    : null
  const evalRatedRows = rows.filter((agent) => agent.evalPass != null)
  const avgEvalPass = evalRatedRows.length
    ? Math.round((evalRatedRows.reduce((sum, agent) => sum + (agent.evalPass ?? 0), 0) / evalRatedRows.length) * 100)
    : null
  const spendMinorTotal = rows.reduce((sum, agent) => sum + agent.costTotal, 0)
  const spendCurrency = rows.find((agent) => agent.currency)?.currency ?? null
  const spendLabel = spendMinorTotal > 0 ? formatCostMinor(spendMinorTotal, spendCurrency) : null

  const total = filteredRows.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const pagedRows = filteredRows.slice((page - 1) * pageSize, page * pageSize)
  const filtersActive = Object.values(filterValues).some((value) => (Array.isArray(value) ? value.length > 0 : value != null && value !== ''))

  return (
    <Page>
      <PageBody className="space-y-5">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-lg font-semibold">{t('agent_orchestrator.agents.list.title')}</h1>
          {previewUi ? (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm">
                <Download className="mr-2 size-4" />
                {t('agent_orchestrator.agents.actions.export', 'Export')}
              </Button>
              <Button size="sm" onClick={() => flash(t('agent_orchestrator.agents.actions.codeOnly', 'Agents are defined in code for now — UI creation needs backend.'), 'info')}>
                {t('agent_orchestrator.agents.actions.newAgent', 'New agent')}
              </Button>
            </div>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard icon={Bot} label={t('agent_orchestrator.agents.kpi.active', 'Active agents')} sub={t('agent_orchestrator.agents.kpi.activeSub', '{gated} gated, {review} review', { gated: gatedCount, review: reviewCount })}>
            <span className="text-3xl font-bold tabular-nums tracking-tight text-foreground">{formatNumber(rows.length, locale) ?? '0'}</span>
          </StatCard>
          <StatCard icon={ShieldCheck} label={t('agent_orchestrator.agents.kpi.avgEval', 'Avg eval pass')}>
            {avgEvalPass == null ? (
              <PendingChip label={t('agent_orchestrator.agents.list.pending.noData', 'No data')} />
            ) : (
              <span className="text-3xl font-bold tabular-nums tracking-tight text-foreground">
                {avgEvalPass}
                <span className="text-xl font-semibold text-muted-foreground">%</span>
              </span>
            )}
          </StatCard>
          <StatCard icon={Pencil} label={t('agent_orchestrator.agents.kpi.avgOverride', 'Avg override')}>
            {avgOverride == null ? (
              <PendingChip label={t('agent_orchestrator.agents.list.pending.noData', 'No data')} />
            ) : (
              <span className="text-3xl font-bold tabular-nums tracking-tight text-foreground">
                {avgOverride}
                <span className="text-xl font-semibold text-muted-foreground">%</span>
              </span>
            )}
          </StatCard>
          <StatCard icon={Wallet} label={t('agent_orchestrator.agents.kpi.spend', 'Spend (7d, est.)')}>
            {spendLabel == null ? (
              <PendingChip label={t('agent_orchestrator.agents.list.pending.noData', 'No data')} />
            ) : (
              <span className="text-3xl font-bold tabular-nums tracking-tight text-foreground">{spendLabel}</span>
            )}
          </StatCard>
        </div>

        {rows.length === 0 ? (
          <EmptyState
            title={t('agent_orchestrator.agents.list.empty')}
            description={t('agent_orchestrator.agents.list.emptyDescription')}
          />
        ) : (
          <DataTable<AgentRow>
            columns={columns}
            data={pagedRows}
            sortable
            searchValue={search}
            onSearchChange={(value) => { setSearch(value); setPage(1) }}
            searchPlaceholder={t('agent_orchestrator.agents.list.searchPlaceholder', 'Search agents, tags…')}
            filters={filterDefs}
            filterValues={filterValues}
            onFiltersApply={(values) => { setFilterValues(values); setPage(1) }}
            onFiltersClear={() => { setFilterValues({}); setPage(1) }}
            filterAwareEmptyState={{
              active: filtersActive,
              entityNamePlural: t('agent_orchestrator.agents.list.entityPlural', 'agents'),
              canRemoveLast: false,
              onClearAll: () => { setFilterValues({}); setPage(1) },
              onRemoveLast: () => {},
            }}
            pagination={{
              page,
              pageSize,
              total,
              totalPages,
              onPageChange: setPage,
              pageSizeOptions: [10, 20, 50],
              onPageSizeChange: (next) => { setPageSize(next); setPage(1) },
            }}
            columnChooser={{ auto: true }}
            perspective={{ tableId: 'agent_orchestrator.agents.list', align: 'right' }}
            onRowClick={(row) => router.push(`/backend/agents/${encodeURIComponent(row.id)}`)}
            rowActions={(row) => (
              <RowActions
                items={[
                  { id: 'view', label: t('agent_orchestrator.agents.list.actions.view', 'View'), onSelect: () => router.push(`/backend/agents/${encodeURIComponent(row.id)}`) },
                  { id: 'playground', label: t('agent_orchestrator.agents.list.openPlayground', 'Open in playground'), onSelect: () => router.push(`/backend/playground?agent=${encodeURIComponent(row.id)}`) },
                  ...(previewUi
                    ? [
                        { id: 'duplicate', label: t('agent_orchestrator.agents.list.actions.duplicate', 'Duplicate'), onSelect: () => flash(t('agent_orchestrator.agents.actions.codeOnly', 'Agents are defined in code for now — UI creation needs backend.'), 'info') },
                        { id: 'disable', label: t('agent_orchestrator.agents.list.actions.disable', 'Disable'), destructive: true, onSelect: () => flash(t('agent_orchestrator.agents.actions.codeOnly', 'Agents are defined in code for now — UI creation needs backend.'), 'info') },
                      ]
                    : []),
                ]}
              />
            )}
          />
        )}
      </PageBody>
    </Page>
  )
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}


function PendingChip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-md border border-dashed border-border bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground">
      {label}
    </span>
  )
}

function StatCard({ icon: Icon, label, sub, children }: { icon: React.ComponentType<{ className?: string }>; label: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-muted-foreground">{label}</p>
        <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-brand-violet">
          <Icon className="size-4" />
        </span>
      </div>
      <div className="mt-2 flex min-h-9 items-center gap-2">{children}</div>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
      <div className="absolute inset-x-0 bottom-0 h-1 bg-gradient-to-r from-brand-lime via-brand-lime to-brand-violet" />
    </div>
  )
}
