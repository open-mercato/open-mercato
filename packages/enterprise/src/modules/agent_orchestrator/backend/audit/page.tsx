"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import type { ColumnDef } from '@tanstack/react-table'
import { CheckCircle2, Clock, Download, Filter, Gavel, Replace, Workflow } from 'lucide-react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge, type StatusMap } from '@open-mercato/ui/primitives/status-badge'
import { SearchInput } from '@open-mercato/ui/primitives/search-input'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { mapAgent } from '../../components/types'

type Disposition = 'pending' | 'approved' | 'edited' | 'rejected' | 'auto_approved'

type AuditRow = {
  id: string
  when: string | null
  agentId: string
  agentLabel: string
  claim: string
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
const APPROVED = ['approved', 'auto_approved']
const OVERRIDDEN = ['edited', 'rejected']

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
function formatWhen(value: string | null): string {
  if (!value) return '—'
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) return '—'
  return new Date(parsed).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

async function fetchItems(path: string): Promise<Array<Record<string, unknown>>> {
  const call = await apiCall<{ items?: Array<Record<string, unknown>> }>(path, undefined, { fallback: { items: [] } })
  if (!call.ok || !Array.isArray(call.result?.items)) return []
  return call.result.items
}

export default function AgentAuditPage() {
  const t = useT()
  const router = useRouter()
  const [rows, setRows] = React.useState<AuditRow[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(20)
  const [query, setQuery] = React.useState('')

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      setError(null)
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
      const agentLabels = new Map<string, string>()
      for (const item of Array.isArray(agentsCall.result?.items) ? agentsCall.result.items : []) {
        const agent = mapAgent(item)
        if (agent) agentLabels.set(agent.id, agent.label || agent.id)
      }

      const [proposals, runs] = await Promise.all([
        fetchItems('/api/agent_orchestrator/proposals?pageSize=100'),
        fetchItems('/api/agent_orchestrator/runs?pageSize=100'),
      ])
      if (cancelled) return

      const runById = new Map<string, Record<string, unknown>>()
      for (const run of runs) {
        const runId = fieldOf(run, 'id')
        if (runId) runById.set(runId, run)
      }

      const built: AuditRow[] = proposals.map((proposal) => {
        const agentId = fieldOf(proposal, 'agent_id', 'agentId')
        const runId = fieldOf(proposal, 'run_id', 'runId')
        const run = runById.get(runId)
        const input = run ? asObject(run.input) : null
        const claim = (input && fieldOf(input, 'claimId', 'claim_id', 'dealId', 'deal_id', 'reference')) || (runId ? runId.slice(0, 12) : fieldOf(proposal, 'id').slice(0, 12))
        return {
          id: fieldOf(proposal, 'id'),
          when: fieldOf(proposal, 'created_at', 'createdAt') || null,
          agentId,
          agentLabel: agentLabels.get(agentId) || agentId || '—',
          claim,
          disposition: dispositionOf(fieldOf(proposal, 'disposition') || 'pending'),
          operator: fieldOf(proposal, 'disposition_by', 'dispositionBy') || null,
          reason: fieldOf(proposal, 'disposition_reason', 'dispositionReason') || null,
          processId: fieldOf(proposal, 'process_id', 'processId') || null,
        }
      })
      built.sort((a, b) => Date.parse(b.when || '') - Date.parse(a.when || ''))
      setRows(built)
      setIsLoading(false)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [t])

  const columns = React.useMemo<ColumnDef<AuditRow>[]>(() => [
    {
      accessorKey: 'when',
      header: t('agent_orchestrator.audit.col.when', 'When'),
      cell: ({ row }) => <span className="whitespace-nowrap text-sm tabular-nums text-muted-foreground">{formatWhen(row.original.when)}</span>,
    },
    {
      accessorKey: 'agentLabel',
      header: t('agent_orchestrator.audit.col.agent', 'Agent'),
      meta: { maxWidth: '280px' },
      cell: ({ row }) => (
        <div className="flex items-center gap-2.5">
          <Avatar label={row.original.agentLabel} size="sm" />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-foreground">{row.original.agentLabel}</div>
            <div className="truncate font-mono text-xs text-muted-foreground">{row.original.agentId}</div>
          </div>
        </div>
      ),
    },
    {
      accessorKey: 'claim',
      header: t('agent_orchestrator.audit.col.claim', 'Claim'),
      cell: ({ row }) => <span className="font-mono text-xs text-foreground">{row.original.claim}</span>,
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
  ], [t, router])

  if (isLoading) {
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

  const total = rows.length
  const approvedCount = rows.filter((row) => APPROVED.includes(row.disposition)).length
  const overriddenCount = rows.filter((row) => OVERRIDDEN.includes(row.disposition)).length
  const pendingCount = rows.filter((row) => row.disposition === 'pending').length

  // KPIs summarize the whole log; the search narrows only the table below.
  const q = query.trim().toLowerCase()
  const filteredRows = q
    ? rows.filter((row) =>
        [row.claim, row.agentLabel, row.agentId, row.operator, row.reason].some((value) =>
          (value ?? '').toLowerCase().includes(q),
        ),
      )
    : rows
  const filteredTotal = filteredRows.length
  const totalPages = Math.max(1, Math.ceil(filteredTotal / pageSize))
  const pagedRows = filteredRows.slice((page - 1) * pageSize, page * pageSize)

  return (
    <Page>
      <PageBody className="space-y-5">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-lg font-semibold">{t('agent_orchestrator.audit.title', 'Audit log')}</h1>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm">
              <Filter className="mr-2 size-4" />
              {t('agent_orchestrator.agents.actions.filters', 'Filters')}
            </Button>
            <Button variant="outline" size="sm">
              <Download className="mr-2 size-4" />
              {t('agent_orchestrator.agents.actions.export', 'Export')}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            icon={Gavel}
            label={t('agent_orchestrator.audit.kpi.total', 'Decisions')}
            value={total.toLocaleString('en-US')}
            sub={t('agent_orchestrator.audit.kpi.totalSub', 'Agent decisions logged')}
          />
          <StatCard
            icon={CheckCircle2}
            label={t('agent_orchestrator.audit.kpi.approved', 'Approved')}
            value={approvedCount.toLocaleString('en-US')}
            sub={t('agent_orchestrator.audit.kpi.approvedSub', 'Approved or auto-approved')}
          />
          <StatCard
            icon={Replace}
            label={t('agent_orchestrator.audit.kpi.overridden', 'Overridden')}
            value={overriddenCount.toLocaleString('en-US')}
            sub={t('agent_orchestrator.audit.kpi.overriddenSub', 'Edited or rejected')}
          />
          <StatCard
            icon={Clock}
            label={t('agent_orchestrator.audit.kpi.pending', 'Pending')}
            value={pendingCount.toLocaleString('en-US')}
            sub={t('agent_orchestrator.audit.kpi.pendingSub', 'Awaiting a decision')}
          />
        </div>

        {rows.length === 0 ? (
          <EmptyState
            title={t('agent_orchestrator.audit.empty', 'No agent decisions yet')}
            description={t('agent_orchestrator.audit.emptyDescription', 'Agent proposals and their dispositions will appear here once agents start running.')}
          />
        ) : (
          <DataTable<AuditRow>
            columns={columns}
            data={pagedRows}
            sortable
            // Search lives in the DataTable title slot (left) so it shares one row
            // with the right-aligned Views switcher — no divider, no stray ••• band.
            title={
              <SearchInput
                value={query}
                onChange={(value) => { setQuery(value); setPage(1) }}
                placeholder={t('agent_orchestrator.audit.searchPlaceholder', 'Search logs…')}
                className="w-full max-w-xs"
              />
            }
            pagination={{
              page,
              pageSize,
              total: filteredTotal,
              totalPages,
              onPageChange: setPage,
              pageSizeOptions: [10, 20, 50],
              onPageSizeChange: (next) => { setPageSize(next); setPage(1) },
            }}
            columnChooser={{ auto: true }}
            perspective={{ tableId: 'agent_orchestrator.audit.list', align: 'right' }}
            onRowClick={(row) => router.push(`/backend/caseload/${encodeURIComponent(row.id)}`)}
            rowActions={(row) => (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                title={t('agent_orchestrator.proposal.openProcess', 'Open process')}
                onClick={() => router.push(`/backend/processes/${encodeURIComponent(row.processId ?? row.id)}`)}
              >
                <Workflow className="size-4" />
                <span className="sr-only">{t('agent_orchestrator.proposal.openProcess', 'Open process')}</span>
              </Button>
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
