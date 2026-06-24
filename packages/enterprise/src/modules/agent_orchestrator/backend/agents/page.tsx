"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import type { ColumnDef } from '@tanstack/react-table'
import { Download, Filter, Bot, ShieldCheck, Pencil, Wallet } from 'lucide-react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge, type StatusMap } from '@open-mercato/ui/primitives/status-badge'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { mapAgent, type AgentView, type AgentRuntime } from '../../components/types'

const RUNTIME_LABEL: Record<AgentRuntime, string> = {
  'in-process': 'In Process',
  opencode: 'Open Code',
  external: 'External',
}

type Autonomy = 'auto' | 'review' | 'gated'
type Health = 'good' | 'watch' | 'poor' | 'new'

type AgentRow = AgentView & {
  autonomy: Autonomy
  runs: number
  evalPass: number | null
  overrideRate: number | null
  cost: number | null
  pending: number
  status: Health
}

const statusVariant: StatusMap<Health> = { good: 'success', watch: 'warning', poor: 'error', new: 'neutral' }

const DISPOSED = ['approved', 'edited', 'rejected', 'auto_approved']
const OVERRIDDEN = ['edited', 'rejected']

function agentIdOf(item: Record<string, unknown>): string {
  const value = item.agent_id ?? item.agentId
  return typeof value === 'string' ? value : ''
}

async function fetchItems(path: string): Promise<Array<Record<string, unknown>>> {
  const call = await apiCall<{ items?: Array<Record<string, unknown>> }>(path, undefined, { fallback: { items: [] } })
  if (!call.ok || !Array.isArray(call.result?.items)) return []
  return call.result.items
}

export default function AgentsRegistryPage() {
  const t = useT()
  const router = useRouter()
  const [rows, setRows] = React.useState<AgentRow[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(20)

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

      // Governance metrics computed from the real run/proposal lists.
      const [runs, proposals] = await Promise.all([
        fetchItems('/api/agent_orchestrator/runs?pageSize=100'),
        fetchItems('/api/agent_orchestrator/proposals?pageSize=100'),
      ])
      if (cancelled) return

      const runStats = new Map<string, { total: number; errors: number }>()
      for (const run of runs) {
        const id = agentIdOf(run)
        if (!id) continue
        const stat = runStats.get(id) ?? { total: 0, errors: 0 }
        stat.total += 1
        if (run.status === 'error') stat.errors += 1
        runStats.set(id, stat)
      }
      const proposalStats = new Map<string, { disposed: number; overrides: number; pending: number }>()
      for (const proposal of proposals) {
        const id = agentIdOf(proposal)
        if (!id) continue
        const stat = proposalStats.get(id) ?? { disposed: 0, overrides: 0, pending: 0 }
        const disposition = typeof proposal.disposition === 'string' ? proposal.disposition : 'pending'
        if (disposition === 'pending') stat.pending += 1
        if (DISPOSED.includes(disposition)) stat.disposed += 1
        if (OVERRIDDEN.includes(disposition)) stat.overrides += 1
        proposalStats.set(id, stat)
      }

      const built: AgentRow[] = agents.map((agent) => {
        const run = runStats.get(agent.id) ?? { total: 0, errors: 0 }
        const proposal = proposalStats.get(agent.id) ?? { disposed: 0, overrides: 0, pending: 0 }
        const overrideRate = proposal.disposed > 0 ? proposal.overrides / proposal.disposed : null
        const errorRate = run.total > 0 ? run.errors / run.total : 0
        // UI heuristic until the backend exposes a real autonomy setting.
        const autonomy: Autonomy = agent.resultKind === 'informative' ? 'auto' : 'review'
        let status: Health = 'new'
        if (run.total > 0 || proposal.disposed > 0) {
          if ((overrideRate ?? 0) > 0.3 || errorRate > 0.2) status = 'poor'
          else if ((overrideRate ?? 0) > 0.15) status = 'watch'
          else status = 'good'
        }
        return { ...agent, autonomy, runs: run.total, evalPass: null, overrideRate, cost: null, pending: proposal.pending, status }
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
            <Avatar label={agent.label || agent.id} size="sm" />
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-foreground">{agent.label || agent.id}</div>
              <div className="truncate font-mono text-xs text-muted-foreground">{agent.id}</div>
            </div>
          </div>
        )
      },
    },
    {
      accessorKey: 'resultKind',
      header: t('agent_orchestrator.agents.list.col.type', 'Type'),
      cell: ({ row }) => (
        <Chip>{t(`agent_orchestrator.agents.list.resultKind.${row.original.resultKind}`)}</Chip>
      ),
    },
    {
      accessorKey: 'runtime',
      header: t('agent_orchestrator.agents.list.col.runtime', 'Runtime'),
      cell: ({ row }) => (
        <Chip>
          {t(`agent_orchestrator.agents.list.runtime.${row.original.runtime}`, RUNTIME_LABEL[row.original.runtime])}
        </Chip>
      ),
    },
    {
      accessorKey: 'autonomy',
      header: t('agent_orchestrator.agents.list.col.autonomy', 'Autonomy'),
      cell: ({ row }) => {
        const autonomy = row.original.autonomy
        return <Chip>{t(`agent_orchestrator.agents.list.autonomy.${autonomy}`, titleCase(autonomy))}</Chip>
      },
    },
    {
      accessorKey: 'runs',
      header: t('agent_orchestrator.agents.list.col.runs', 'Runs'),
      cell: ({ row }) => <div className="text-right text-sm tabular-nums">{row.original.runs.toLocaleString('en-US')}</div>,
    },
    {
      accessorKey: 'evalPass',
      header: t('agent_orchestrator.agents.list.col.evalPass', 'Eval pass'),
      cell: () => <PendingChip label={t('agent_orchestrator.agents.list.pending.backend', 'Needs backend')} />,
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
      accessorKey: 'cost',
      header: t('agent_orchestrator.agents.list.col.cost', 'Cost / run'),
      cell: () => <PendingChip label={t('agent_orchestrator.agents.list.pending.backend', 'Needs backend')} />,
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

  const total = rows.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const pagedRows = rows.slice((page - 1) * pageSize, page * pageSize)

  return (
    <Page>
      <PageBody className="space-y-5">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-lg font-semibold">{t('agent_orchestrator.agents.list.title')}</h1>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm">
              <Filter className="mr-2 size-4" />
              {t('agent_orchestrator.agents.actions.filters', 'Filters')}
            </Button>
            <Button variant="outline" size="sm">
              <Download className="mr-2 size-4" />
              {t('agent_orchestrator.agents.actions.export', 'Export')}
            </Button>
            <Button size="sm" onClick={() => flash(t('agent_orchestrator.agents.actions.codeOnly', 'Agents are defined in code for now — UI creation needs backend.'), 'info')}>
              {t('agent_orchestrator.agents.actions.newAgent', 'New agent')}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard icon={Bot} label={t('agent_orchestrator.agents.kpi.active', 'Active agents')} sub={t('agent_orchestrator.agents.kpi.activeSub', '{gated} gated, {review} review', { gated: gatedCount, review: reviewCount })}>
            <span className="text-3xl font-bold tabular-nums tracking-tight text-foreground">{rows.length.toLocaleString('en-US')}</span>
          </StatCard>
          <StatCard icon={ShieldCheck} label={t('agent_orchestrator.agents.kpi.avgEval', 'Avg eval pass')}>
            <PendingChip label={t('agent_orchestrator.agents.list.pending.backend', 'Needs backend')} />
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
          <StatCard icon={Wallet} label={t('agent_orchestrator.agents.kpi.spend', 'Spend (7d)')}>
            <PendingChip label={t('agent_orchestrator.agents.list.pending.backend', 'Needs backend')} />
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
                  { id: 'duplicate', label: t('agent_orchestrator.agents.list.actions.duplicate', 'Duplicate'), onSelect: () => flash(t('agent_orchestrator.agents.actions.codeOnly', 'Agents are defined in code for now — UI creation needs backend.'), 'info') },
                  { id: 'disable', label: t('agent_orchestrator.agents.list.actions.disable', 'Disable'), destructive: true, onSelect: () => flash(t('agent_orchestrator.agents.actions.codeOnly', 'Agents are defined in code for now — UI creation needs backend.'), 'info') },
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

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md border border-border bg-background px-2 py-0.5 text-xs font-medium text-foreground">
      {children}
    </span>
  )
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

