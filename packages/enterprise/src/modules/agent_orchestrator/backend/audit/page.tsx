"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import type { ColumnDef } from '@tanstack/react-table'
import { CheckCircle2, Clock, Gavel, Replace, Undo2, Workflow } from 'lucide-react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { agentAvatarIcon } from '../../components/agentChips'
import { useAgentIconMap } from '../../components/useAgentIcons'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge, type StatusMap } from '@open-mercato/ui/primitives/status-badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT, useLocale } from '@open-mercato/shared/lib/i18n/context'
import { formatDateTime, formatNumber, mapAgent, mapOverviewMetrics, type OverviewMetricsView } from '../../components/types'
import { subjectRefOf } from '../../components/subjectRef'

type Disposition = 'pending' | 'approved' | 'edited' | 'rejected' | 'auto_approved'
type DispositionFilter = 'all' | Disposition

type AuditRow = {
  id: string
  when: string | null
  agentId: string
  agentLabel: string
  subjectRef: string
  disposition: Disposition
  operator: string | null
  reason: string | null
  processId: string | null
}

const dispositionVariant: StatusMap<Disposition> = {
  approved: 'success',
  auto_approved: 'success',
  edited: 'warning',
  rejected: 'error',
  pending: 'neutral',
}

const DISPOSITION_FILTERS: DispositionFilter[] = ['all', 'pending', 'approved', 'auto_approved', 'edited', 'rejected']

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}
function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}
function fieldOf(item: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = asString(item[key])
    if (value) return value
  }
  return ''
}
function dispositionOf(value: string): Disposition {
  return (['approved', 'edited', 'rejected', 'auto_approved'] as string[]).includes(value)
    ? (value as Disposition)
    : 'pending'
}
type ListResponse = { items?: Array<Record<string, unknown>>; total?: number }

export default function AgentAuditPage() {
  const t = useT()
  const locale = useLocale()
  const router = useRouter()
  const [rows, setRows] = React.useState<AuditRow[]>([])
  const [total, setTotal] = React.useState(0)
  const [metrics, setMetrics] = React.useState<OverviewMetricsView | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(20)
  const [disposition, setDisposition] = React.useState<DispositionFilter>('all')

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      setError(null)
      const listParams = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        sortField: 'createdAt',
        sortDir: 'desc',
      })
      if (disposition !== 'all') listParams.set('disposition', disposition)
      // Server-paginated log + org-level KPIs — the old 100-row client join is
      // gone; totals now describe the whole tenant, not a sample.
      const [agentsCall, proposalsCall, overviewCall] = await Promise.all([
        apiCall<ListResponse>('/api/agent_orchestrator/agents', undefined, { fallback: { items: [] } }),
        apiCall<ListResponse>(`/api/agent_orchestrator/proposals?${listParams.toString()}`, undefined, {
          fallback: { items: [], total: 0 },
        }),
        apiCall<Record<string, unknown>>('/api/agent_orchestrator/metrics/overview?window=7d'),
      ])
      if (cancelled) return
      if (!proposalsCall.ok) {
        setError(t('agent_orchestrator.audit.error', 'Could not load the audit log.'))
        setIsLoading(false)
        return
      }
      const agentLabels = new Map<string, string>()
      for (const item of agentsCall.ok && Array.isArray(agentsCall.result?.items) ? agentsCall.result.items : []) {
        const agent = mapAgent(item)
        if (agent) agentLabels.set(agent.id, agent.label || agent.id)
      }
      const proposals = Array.isArray(proposalsCall.result?.items) ? proposalsCall.result.items : []
      setTotal(typeof proposalsCall.result?.total === 'number' ? proposalsCall.result.total : proposals.length)
      setMetrics(overviewCall.ok && overviewCall.result ? mapOverviewMetrics(overviewCall.result) : null)

      // Per-page run enrichment (caseload precedent) — only the visible rows.
      const runIds = Array.from(new Set(proposals.map((p) => fieldOf(p, 'run_id', 'runId')).filter(Boolean)))
      const runById = new Map<string, Record<string, unknown>>()
      if (runIds.length > 0) {
        const runsCall = await apiCall<ListResponse>(
          `/api/agent_orchestrator/runs?ids=${runIds.map((id) => encodeURIComponent(id)).join(',')}&pageSize=${Math.min(runIds.length, 100)}`,
          undefined,
          { fallback: { items: [] } },
        )
        if (cancelled) return
        for (const run of runsCall.ok && Array.isArray(runsCall.result?.items) ? runsCall.result.items : []) {
          const runId = fieldOf(run, 'id')
          if (runId) runById.set(runId, run)
        }
      }

      const built: AuditRow[] = proposals.map((proposal) => {
        const agentId = fieldOf(proposal, 'agent_id', 'agentId')
        const runId = fieldOf(proposal, 'run_id', 'runId')
        const run = runById.get(runId)
        const input = run ? asObject(run.input) : null
        const subjectRef =
          (input && subjectRefOf(input)) ||
          (runId ? runId.slice(0, 12) : fieldOf(proposal, 'id').slice(0, 12))
        return {
          id: fieldOf(proposal, 'id'),
          when: fieldOf(proposal, 'created_at', 'createdAt') || null,
          agentId,
          agentLabel: agentLabels.get(agentId) || agentId || '—',
          subjectRef,
          disposition: dispositionOf(fieldOf(proposal, 'disposition') || 'pending'),
          operator: fieldOf(proposal, 'disposition_by', 'dispositionBy') || null,
          reason: fieldOf(proposal, 'disposition_reason', 'dispositionReason') || null,
          processId: fieldOf(proposal, 'process_id', 'processId') || null,
        }
      })
      setRows(built)
      setIsLoading(false)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [t, page, pageSize, disposition])

  const agentIcons = useAgentIconMap()

  const columns = React.useMemo<ColumnDef<AuditRow>[]>(() => [
    {
      accessorKey: 'when',
      header: t('agent_orchestrator.audit.col.when', 'When'),
      cell: ({ row }) => <span className="whitespace-nowrap text-sm tabular-nums text-muted-foreground">{formatDateTime(row.original.when, locale) ?? '—'}</span>,
    },
    {
      accessorKey: 'agentLabel',
      header: t('agent_orchestrator.audit.col.agent', 'Agent'),
      meta: { maxWidth: '280px' },
      cell: ({ row }) => {
        const info = agentIcons.get(row.original.agentId)
        return (
          <div className="flex items-center gap-2.5">
            <Avatar label={row.original.agentLabel} size="sm" variant="monochrome" icon={agentAvatarIcon(info?.icon ?? null, info?.resultKind)} />
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-foreground">{row.original.agentLabel}</div>
              <div className="truncate font-mono text-xs text-muted-foreground">{row.original.agentId}</div>
            </div>
          </div>
        )
      },
    },
    {
      accessorKey: 'subjectRef',
      header: t('agent_orchestrator.audit.col.claim', 'Claim'),
      cell: ({ row }) => <span className="font-mono text-xs text-foreground">{row.original.subjectRef}</span>,
    },
    {
      accessorKey: 'disposition',
      header: t('agent_orchestrator.audit.col.action', 'Action'),
      cell: ({ row }) => (
        <StatusBadge variant={dispositionVariant[row.original.disposition]} dot>
          {t(`agent_orchestrator.disposition.${row.original.disposition}`, titleCase(row.original.disposition))}
        </StatusBadge>
      ),
    },
    {
      accessorKey: 'operator',
      header: t('agent_orchestrator.audit.col.operator', 'Operator'),
      cell: ({ row }) => row.original.operator
        ? (
          <button
            type="button"
            onClick={() => router.push(`/backend/audit/by-instigator/${encodeURIComponent(row.original.operator ?? '')}`)}
            title={t('agent_orchestrator.audit.actions.chains', 'On-behalf-of chains')}
            aria-label={t('agent_orchestrator.audit.actions.chains', 'On-behalf-of chains')}
            className="text-sm text-brand-violet transition-opacity hover:opacity-80"
          >
            {row.original.operator}
          </button>
        )
        : <span className="text-sm text-muted-foreground">—</span>,
    },
    {
      accessorKey: 'reason',
      header: t('agent_orchestrator.audit.col.reason', 'Reason'),
      meta: { maxWidth: '320px' },
      cell: ({ row }) => row.original.reason
        ? <span className="block truncate text-sm text-muted-foreground" title={row.original.reason}>{row.original.reason}</span>
        : <span className="text-sm text-muted-foreground">—</span>,
    },
  ], [t, locale, router, agentIcons])

  if (isLoading && rows.length === 0) {
    return (
      <Page>
        <PageBody>
          <LoadingMessage label={t('agent_orchestrator.audit.title', 'Audit log')} />
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

  // KPIs are org-level aggregates from /metrics/overview — dispositionCounts is
  // the CURRENT backlog state (all proposals), correctionsCount is windowed.
  const counts = metrics?.dispositionCounts ?? {}
  const decisionsTotal = Object.values(counts).reduce((sum, count) => sum + count, 0)
  const approvedCount = (counts.approved ?? 0) + (counts.auto_approved ?? 0)
  const overriddenCount = (counts.edited ?? 0) + (counts.rejected ?? 0)
  const pendingCount = counts.pending ?? 0
  const correctionsCount = metrics?.correctionsCount ?? null

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <Page>
      <PageBody className="space-y-5">
        <h1 className="text-lg font-semibold">{t('agent_orchestrator.audit.title', 'Audit log')}</h1>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatCard
            icon={Gavel}
            label={t('agent_orchestrator.audit.kpi.total', 'Decisions')}
            value={formatNumber(decisionsTotal, locale) ?? '—'}
            sub={t('agent_orchestrator.audit.kpi.totalSub', 'Agent decisions logged')}
          />
          <StatCard
            icon={CheckCircle2}
            label={t('agent_orchestrator.audit.kpi.approved', 'Approved')}
            value={formatNumber(approvedCount, locale) ?? '—'}
            sub={t('agent_orchestrator.audit.kpi.approvedSub', 'Approved or auto-approved')}
          />
          <StatCard
            icon={Replace}
            label={t('agent_orchestrator.audit.kpi.overridden', 'Overridden')}
            value={formatNumber(overriddenCount, locale) ?? '—'}
            sub={t('agent_orchestrator.audit.kpi.overriddenSub', 'Edited or rejected')}
          />
          <StatCard
            icon={Undo2}
            label={t('agent_orchestrator.audit.kpi.corrections', 'Corrections (7d)')}
            value={formatNumber(correctionsCount, locale) ?? '—'}
            sub={t('agent_orchestrator.audit.kpi.correctionsSub', 'Operator corrections recorded')}
          />
          <StatCard
            icon={Clock}
            label={t('agent_orchestrator.audit.kpi.pending', 'Pending')}
            value={formatNumber(pendingCount, locale) ?? '—'}
            sub={t('agent_orchestrator.audit.kpi.pendingSub', 'Awaiting a decision')}
          />
        </div>

        {total === 0 && disposition === 'all' ? (
          <EmptyState
            title={t('agent_orchestrator.audit.empty', 'No agent decisions yet')}
            description={t('agent_orchestrator.audit.emptyDescription', 'Agent proposals and their dispositions will appear here once agents start running.')}
          />
        ) : (
          <div className="space-y-2">
            <DataTable<AuditRow>
              columns={columns}
              data={rows}
              title={
                <Select value={disposition} onValueChange={(value) => { setDisposition(value as DispositionFilter); setPage(1) }}>
                  <SelectTrigger className="h-9 w-auto min-w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DISPOSITION_FILTERS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option === 'all'
                          ? t('agent_orchestrator.audit.filter.all', 'All dispositions')
                          : t(`agent_orchestrator.disposition.${option}`, titleCase(option))}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              }
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
              perspective={{ tableId: 'agent_orchestrator.audit.list', align: 'right' }}
              onRowClick={(row) => router.push(`/backend/caseload/${encodeURIComponent(row.id)}`)}
              rowActions={(row) =>
                row.processId ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    title={t('agent_orchestrator.proposal.openProcess', 'Open process')}
                    onClick={() => router.push(`/backend/processes/${encodeURIComponent(row.processId!)}`)}
                  >
                    <Workflow className="size-4" />
                    <span className="sr-only">{t('agent_orchestrator.proposal.openProcess', 'Open process')}</span>
                  </Button>
                ) : null
              }
            />
            <p className="text-xs text-muted-foreground">
              {t('agent_orchestrator.audit.log.serverPaginatedNote', 'The log is paginated server-side across all decisions; narrow it with the disposition filter.')}
            </p>
          </div>
        )}
      </PageBody>
    </Page>
  )
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

// Matches the canonical cockpit KPI tile (overview): a white card with an icon
// chip and a thin brand gradient accent bar along the bottom.
function StatCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  sub: string
}) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-muted-foreground">{label}</p>
        <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-brand-violet">
          <Icon className="size-4" />
        </span>
      </div>
      <div className="mt-2 flex min-h-9 items-center">
        <span className="text-3xl font-bold tabular-nums tracking-tight text-foreground">{value}</span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
      <div className="absolute inset-x-0 bottom-0 h-1 bg-gradient-to-r from-brand-lime via-brand-lime to-brand-violet" />
    </div>
  )
}
