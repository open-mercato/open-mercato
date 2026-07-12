"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import type { ColumnDef } from '@tanstack/react-table'
import { RotateCw, Check, X, Smile, Meh, Frown, Sparkles, TriangleAlert, Clock, ArrowUpDown, ChevronDown, Inbox, Activity, CheckCircle2 } from 'lucide-react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { SearchInput } from '@open-mercato/ui/primitives/search-input'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'
import { Pagination } from '@open-mercato/ui/primitives/pagination'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import {
  apiCall,
  apiCallOrThrow,
  withScopedApiRequestHeaders,
} from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  mapAgent,
  mapOverviewMetrics,
  mapProposal,
  type AgentFactView,
  type OverviewMetricsView,
  type ProposalView,
} from '../../components/types'
import { useCoalescedReload } from '../../components/useCoalescedReload'
import { FactsGrid, ProposedFields, ReasoningList } from '../../components/ProposalFacts'
import { useInboxCursor, intersectSelection } from './hooks'

type ListResponse = { items?: Array<Record<string, unknown>>; total?: number }
// A single status taxonomy drives the tiles, the filter segment, and the table
// Status column so the operator never has to reconcile two vocabularies.
type CaseStatus = 'actionRequired' | 'approved' | 'rejected'
type SegmentKey = CaseStatus | 'all'
type ViewKey = 'inbox' | 'list'
type SortKey = 'waitingDesc' | 'waitingAsc' | 'confidenceDesc' | 'confidenceAsc' | 'agentAsc'

const SORT_OPTIONS: Array<{ key: SortKey; labelKey: string }> = [
  { key: 'waitingDesc', labelKey: 'agent_orchestrator.caseload.sort.waitingDesc' },
  { key: 'waitingAsc', labelKey: 'agent_orchestrator.caseload.sort.waitingAsc' },
  { key: 'confidenceDesc', labelKey: 'agent_orchestrator.caseload.sort.confidenceDesc' },
  { key: 'confidenceAsc', labelKey: 'agent_orchestrator.caseload.sort.confidenceAsc' },
  { key: 'agentAsc', labelKey: 'agent_orchestrator.caseload.sort.agentAsc' },
]

// Sort + segment translate to server-side query params so ordering and
// filtering apply to the WHOLE backlog, not just the loaded page.
const SORT_PARAMS: Record<SortKey, { field: string; dir: 'asc' | 'desc' }> = {
  waitingDesc: { field: 'createdAt', dir: 'asc' },
  waitingAsc: { field: 'createdAt', dir: 'desc' },
  confidenceDesc: { field: 'confidence', dir: 'desc' },
  confidenceAsc: { field: 'confidence', dir: 'asc' },
  agentAsc: { field: 'agentId', dir: 'asc' },
}
const SEGMENT_DISPOSITIONS: Record<SegmentKey, string | null> = {
  actionRequired: 'pending',
  approved: 'approved,auto_approved,edited',
  rejected: 'rejected',
  all: null,
}

type QueueRow = {
  id: string
  agentLabel: string
  claim: string
  proposes: string
  confidencePct: number | null
  waitingLabel: string
  waitingStale: boolean
  status: CaseStatus
  waitingValue: number
  isPending: boolean
  updatedAt: string | null
}

/** Full data behind one queue row, feeding the DecisionPane's facts/reasoning. */
type DecisionDetail = {
  proposal: ProposalView
  facts?: AgentFactView[]
  runInput: unknown
  runOutput: unknown
}

const STATUS_VARIANT: Record<CaseStatus, 'info' | 'success' | 'error'> = {
  actionRequired: 'info',
  approved: 'success',
  rejected: 'error',
}
const STATUS_DOT: Record<CaseStatus, string> = {
  actionRequired: 'bg-status-info-icon',
  approved: 'bg-status-success-icon',
  rejected: 'bg-status-error-icon',
}
const DECISION_KEYS = ['decision', 'action', 'recommendation', 'outcome', 'verdict', 'resolution', 'status']

function statusOf(disposition: string): CaseStatus {
  if (disposition === 'pending') return 'actionRequired'
  if (disposition === 'rejected') return 'rejected'
  return 'approved'
}
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
function summarizeProposal(payload: unknown): string {
  const obj = asObject(payload)
  if (!obj) return '—'
  for (const key of DECISION_KEYS) {
    const value = obj[key]
    if (typeof value === 'string' && value.trim()) return value
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  }
  const firstString = Object.values(obj).find((value) => typeof value === 'string' && value.trim())
  return typeof firstString === 'string' ? firstString : '—'
}
function confidencePctOf(confidence: number | null): number | null {
  if (confidence == null) return null
  return confidence <= 1 ? confidence * 100 : confidence
}
// Confidence reads faster as a face than a bare number: high = the agent is sure,
// low = scrutinise it. Colours stay on success/neutral/error (no amber per DS).
function confidenceFace(pct: number): { Icon: React.ComponentType<{ className?: string }>; color: string } {
  if (pct >= 70) return { Icon: Smile, color: 'text-status-success-text' }
  if (pct >= 40) return { Icon: Meh, color: 'text-muted-foreground' }
  return { Icon: Frown, color: 'text-status-error-text' }
}
function waitingFrom(createdAt: string | null, now: number): { label: string; stale: boolean; value: number } {
  if (!createdAt) return { label: '—', stale: false, value: 0 }
  const parsed = Date.parse(createdAt)
  if (Number.isNaN(parsed)) return { label: '—', stale: false, value: 0 }
  const minutes = Math.max(0, Math.round((now - parsed) / 60000))
  if (minutes < 60) return { label: `${minutes}m`, stale: false, value: minutes }
  const hours = Math.round(minutes / 60)
  if (hours < 24) return { label: `${hours}h`, stale: hours >= 8, value: minutes }
  const days = Math.round(hours / 24)
  return { label: `${days}d`, stale: true, value: minutes }
}
function headlineOf(row: QueueRow): string {
  return row.proposes === '—' ? row.agentLabel : row.proposes
}
function matchesSearch(row: QueueRow, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return row.claim.toLowerCase().includes(q) || row.agentLabel.toLowerCase().includes(q) || row.proposes.toLowerCase().includes(q)
}
function matchesFilters(row: QueueRow, agentFilters: string[], proposesFilters: string[]): boolean {
  if (agentFilters.length > 0 && !agentFilters.includes(row.agentLabel)) return false
  if (proposesFilters.length > 0 && !proposesFilters.includes(row.proposes)) return false
  return true
}
async function fetchItems(path: string): Promise<Array<Record<string, unknown>>> {
  const call = await apiCall<ListResponse>(path, undefined, { fallback: { items: [] } })
  return call.ok && Array.isArray(call.result?.items) ? call.result!.items : []
}

function LifecycleTile({ icon: Icon, label, value, sub }: { icon: React.ComponentType<{ className?: string }>; label: string; value: React.ReactNode; sub: React.ReactNode }) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-muted-foreground">{label}</p>
        <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-brand-violet">
          <Icon className="size-4" />
        </span>
      </div>
      <div className="mt-2 flex min-h-9 items-center gap-2">
        <span className="text-3xl font-bold tabular-nums tracking-tight text-foreground">{value}</span>
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{sub}</div>
      <div className="absolute inset-x-0 bottom-0 h-1 bg-gradient-to-r from-brand-lime via-brand-lime to-brand-violet" />
    </div>
  )
}

export default function AgentCaseloadPage() {
  const t = useT()
  const router = useRouter()
  const [proposals, setProposals] = React.useState<ProposalView[]>([])
  const [total, setTotal] = React.useState(0)
  const [metrics, setMetrics] = React.useState<OverviewMetricsView | null>(null)
  const [agentLabels, setAgentLabels] = React.useState<Map<string, string>>(new Map())
  const [agentFacts, setAgentFacts] = React.useState<Map<string, AgentFactView[]>>(new Map())
  const [runClaims, setRunClaims] = React.useState<Map<string, string>>(new Map())
  const [runIo, setRunIo] = React.useState<Map<string, { input: unknown; output: unknown }>>(new Map())
  const [runningCount, setRunningCount] = React.useState(0)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [view, setView] = React.useState<ViewKey>('inbox')
  const [segment, setSegment] = React.useState<SegmentKey>('actionRequired')
  const [search, setSearch] = React.useState('')
  const [agentFilters, setAgentFilters] = React.useState<string[]>([])
  const [proposesFilters, setProposesFilters] = React.useState<string[]>([])
  const [sortKey, setSortKey] = React.useState<SortKey>('waitingDesc')
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(20)
  const [reloadToken, setReloadToken] = React.useState(0)
  const [busy, setBusy] = React.useState(false)
  const [rejectDialog, setRejectDialog] = React.useState<{ open: boolean; rows: QueueRow[] }>({ open: false, rows: [] })
  const [reason, setReason] = React.useState('')
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set())

  const { runMutation, retryLastMutation } = useGuardedMutation<{ retryLastMutation: () => Promise<boolean> }>({
    contextId: 'agent_orchestrator.caseload',
    blockedMessage: t('agent_orchestrator.proposal.flash.blocked'),
  })

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
        const disposition = SEGMENT_DISPOSITIONS[segment]
        if (disposition) params.set('disposition', disposition)
        const sort = SORT_PARAMS[sortKey]
        params.set('sortField', sort.field)
        params.set('sortDir', sort.dir)
        const [proposalsCall, overviewCall, agents, runningCall] = await Promise.all([
          apiCall<ListResponse>(`/api/agent_orchestrator/proposals?${params.toString()}`, undefined, { fallback: { items: [] } }),
          apiCall<Record<string, unknown>>('/api/agent_orchestrator/metrics/overview?window=7d'),
          fetchItems('/api/agent_orchestrator/agents'),
          apiCall<ListResponse>('/api/agent_orchestrator/runs?status=running&pageSize=1', undefined, { fallback: { items: [] } }),
        ])
        if (cancelled) return
        if (!proposalsCall.ok) {
          setError(t('agent_orchestrator.caseload.error'))
          return
        }
        const items = Array.isArray(proposalsCall.result?.items) ? proposalsCall.result!.items : []
        const pageProposals = items.map((item) => mapProposal(item)).filter((row): row is ProposalView => !!row)
        // Enrich only the loaded page: fetch the runs its proposals reference.
        const runIds = Array.from(new Set(pageProposals.map((row) => row.runId)))
        const runs = runIds.length
          ? await fetchItems(
              `/api/agent_orchestrator/runs?ids=${runIds.map((id) => encodeURIComponent(id)).join(',')}&pageSize=${Math.min(runIds.length, 100)}`,
            )
          : []
        if (cancelled) return
        setProposals(pageProposals)
        setTotal(typeof proposalsCall.result?.total === 'number' ? proposalsCall.result.total : pageProposals.length)
        setMetrics(overviewCall.ok && overviewCall.result ? mapOverviewMetrics(overviewCall.result) : null)
        setRunningCount(runningCall.ok && typeof runningCall.result?.total === 'number' ? runningCall.result.total : 0)
        const labels = new Map<string, string>()
        const facts = new Map<string, AgentFactView[]>()
        for (const item of agents) {
          const agent = mapAgent(item)
          if (!agent) continue
          labels.set(agent.id, agent.label || agent.id)
          if (agent.facts) facts.set(agent.id, agent.facts)
        }
        setAgentLabels(labels)
        setAgentFacts(facts)
        const claims = new Map<string, string>()
        const io = new Map<string, { input: unknown; output: unknown }>()
        for (const run of runs) {
          const id = fieldOf(run, 'id')
          if (!id) continue
          const input = asObject(run.input)
          claims.set(id, (input && fieldOf(input, 'claimId', 'claim_id', 'dealId', 'deal_id', 'reference')) || id.slice(0, 12))
          io.set(id, { input: run.input ?? null, output: run.output ?? null })
        }
        setRunClaims(claims)
        setRunIo(io)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : t('agent_orchestrator.caseload.error'))
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [segment, sortKey, page, pageSize, reloadToken, t])

  const reload = React.useCallback(() => setReloadToken((token) => token + 1), [])

  // Live-refresh when a proposal is created, disposed, or becomes ready
  // (DOM Event Bridge, tenant/org-scoped server-side), coalesced so an event
  // burst triggers at most one refetch per interval.
  const coalescedReload = useCoalescedReload(reload)
  useAppEvent('agent_orchestrator.proposal.*', () => {
    coalescedReload()
  })

  const decisionDetails = React.useMemo<Map<string, DecisionDetail>>(() => {
    const map = new Map<string, DecisionDetail>()
    for (const proposal of proposals) {
      const io = runIo.get(proposal.runId)
      map.set(proposal.id, {
        proposal,
        facts: agentFacts.get(proposal.agentId),
        runInput: io?.input ?? null,
        runOutput: io?.output ?? null,
      })
    }
    return map
  }, [proposals, agentFacts, runIo])

  const pageRows = React.useMemo<QueueRow[]>(() => {
    const now = Date.now()
    return proposals.map((proposal) => {
      const waiting = waitingFrom(proposal.createdAt, now)
      const confidencePct = confidencePctOf(proposal.confidence)
      return {
        id: proposal.id,
        agentLabel: agentLabels.get(proposal.agentId) || proposal.agentId,
        claim: runClaims.get(proposal.runId) || proposal.id.slice(0, 12),
        proposes: summarizeProposal(proposal.payload),
        confidencePct,
        waitingLabel: waiting.label,
        waitingStale: waiting.stale,
        waitingValue: waiting.value,
        status: statusOf(proposal.disposition),
        isPending: proposal.disposition === 'pending',
        updatedAt: proposal.updatedAt,
      }
    })
  }, [proposals, agentLabels, runClaims])

  // Segment + sort are server-applied; text search and the agent/decision
  // pills narrow the LOADED page only, so both views show the same rows while
  // pagination totals stay server-driven.
  const visibleRows = React.useMemo(
    () => pageRows.filter((row) => matchesSearch(row, search) && matchesFilters(row, agentFilters, proposesFilters)),
    [pageRows, search, agentFilters, proposesFilters],
  )
  const agentOptions = React.useMemo(() => Array.from(new Set(pageRows.map((row) => row.agentLabel))).sort((a, b) => a.localeCompare(b)), [pageRows])
  const proposesOptions = React.useMemo(() => Array.from(new Set(pageRows.map((row) => row.proposes).filter((value) => value !== '—'))).sort((a, b) => a.localeCompare(b)), [pageRows])
  // Tab counts come from the org-level metrics endpoint (indexed disposition
  // counts), never from the loaded page.
  const counts = React.useMemo(() => {
    const dispositionCounts = metrics?.dispositionCounts ?? {}
    const countOf = (key: string) => dispositionCounts[key] ?? 0
    return {
      actionRequired: countOf('pending'),
      approved: countOf('approved') + countOf('auto_approved') + countOf('edited'),
      rejected: countOf('rejected'),
    }
  }, [metrics])
  const grandTotal = counts.actionRequired + counts.approved + counts.rejected
  // `waiting` stays 0 until runs can report a queued/scheduled status — the run
  // model only knows running|ok|error|cancelled today, so the previous
  // sample-derived value was always 0 as well.
  const lifecycle = React.useMemo(
    () => ({ needYou: counts.actionRequired, waiting: 0, running: runningCount }),
    [counts.actionRequired, runningCount],
  )
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  React.useEffect(() => { setPage(1) }, [segment, sortKey, pageSize])
  // Deliberate context switches clear the bulk selection; live refreshes only
  // prune ids that are no longer pending (spec 4 Phase 1 — an org-wide
  // proposal.* event must not wipe an operator's half-built selection).
  React.useEffect(() => { setSelectedIds(new Set()) }, [segment, page, view])
  React.useEffect(() => {
    setSelectedIds((prev) => intersectSelection(prev, pageRows.filter((row) => row.isPending).map((row) => row.id)))
  }, [pageRows])
  // Explicit inbox cursor over the loaded, filtered row set — follows the row
  // id across refreshes and advances to the neighbor on dispose instead of
  // resetting to the top.
  const inboxCursor = useInboxCursor(visibleRows)
  const selectableIds = React.useMemo(() => visibleRows.filter((row) => row.isPending).map((row) => row.id), [visibleRows])
  const selectedRows = React.useMemo(() => visibleRows.filter((row) => selectedIds.has(row.id)), [visibleRows, selectedIds])
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id))
  const someSelected = selectedIds.size > 0 && !allSelected
  const clearSelection = React.useCallback(() => setSelectedIds(new Set()), [])
  const toggleRow = React.useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])
  const toggleAll = React.useCallback(() => {
    setSelectedIds((prev) => {
      const everySelected = selectableIds.length > 0 && selectableIds.every((id) => prev.has(id))
      return everySelected ? new Set<string>() : new Set(selectableIds)
    })
  }, [selectableIds])
  // Sequentially dispose each pending row with its own optimistic-lock header.
  const disposeRows = React.useCallback(
    async (rows: QueueRow[], disposition: 'approved' | 'rejected', rejectReason?: string): Promise<number> => {
      const pending = rows.filter((row) => row.isPending)
      if (pending.length === 0) return 0
      setBusy(true)
      let ok = 0
      try {
        for (const row of pending) {
          try {
            await runMutation({
              operation: () =>
                withScopedApiRequestHeaders(buildOptimisticLockHeader(row.updatedAt), () =>
                  apiCallOrThrow(`/api/agent_orchestrator/proposals/${encodeURIComponent(row.id)}/dispose`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify(rejectReason ? { disposition, reason: rejectReason } : { disposition }),
                  }),
                ),
              context: { retryLastMutation },
              mutationPayload: { disposition },
            })
            ok += 1
          } catch (err) {
            if (!surfaceRecordConflict(err, t)) {
              flash(err instanceof Error ? err.message : t('agent_orchestrator.proposal.flash.error'), 'error')
            }
          }
        }
      } finally {
        setBusy(false)
      }
      return ok
    },
    [runMutation, retryLastMutation, t],
  )

  const approveRows = React.useCallback(
    async (rows: QueueRow[]): Promise<number> => {
      const ok = await disposeRows(rows, 'approved')
      if (ok > 0) {
        flash(t('agent_orchestrator.caseload.flash.approved', undefined, { count: ok }), 'success')
        inboxCursor.advanceAfterDispose(rows.filter((row) => row.isPending).map((row) => row.id))
      }
      setSelectedIds(new Set())
      reload()
      return ok
    },
    [disposeRows, reload, inboxCursor, t],
  )

  const openReject = React.useCallback((rows: QueueRow[]) => {
    setReason('')
    setRejectDialog({ open: true, rows })
  }, [])

  const closeReject = React.useCallback(() => {
    setRejectDialog({ open: false, rows: [] })
    setReason('')
  }, [])

  const confirmReject = React.useCallback(async () => {
    const trimmed = reason.trim()
    if (!trimmed || busy) return
    const rows = rejectDialog.rows
    const ok = await disposeRows(rows, 'rejected', trimmed)
    if (ok > 0) {
      flash(t('agent_orchestrator.caseload.flash.rejected', undefined, { count: ok }), 'success')
      inboxCursor.advanceAfterDispose(rows.filter((row) => row.isPending).map((row) => row.id))
    }
    setRejectDialog({ open: false, rows: [] })
    setReason('')
    setSelectedIds(new Set())
    reload()
  }, [reason, busy, rejectDialog.rows, disposeRows, reload, inboxCursor, t])

  const openDetail = React.useCallback((row: QueueRow) => router.push(`/backend/caseload/${encodeURIComponent(row.id)}`), [router])

  const rejectPendingCount = rejectDialog.rows.filter((row) => row.isPending).length

  const columns = React.useMemo<ColumnDef<QueueRow>[]>(() => {
    const base: ColumnDef<QueueRow>[] = [
      {
        accessorKey: 'agentLabel',
        header: t('agent_orchestrator.caseload.col.agent', 'Agent'),
        meta: { maxWidth: '240px' },
        cell: ({ row }) => (
          <div className="flex items-center gap-2.5">
            <Avatar label={row.original.agentLabel} size="sm" />
            <span className="truncate text-sm font-medium text-foreground">{row.original.agentLabel}</span>
          </div>
        ),
      },
      {
        accessorKey: 'claim',
        header: t('agent_orchestrator.caseload.col.claim', 'Claim'),
        cell: ({ row }) => <span className="font-mono text-xs text-foreground">{row.original.claim}</span>,
      },
      {
        accessorKey: 'proposes',
        header: t('agent_orchestrator.caseload.col.proposes', 'Proposes'),
        meta: { maxWidth: '260px' },
        cell: ({ row }) =>
          row.original.proposes === '—' ? (
            <span className="text-sm text-muted-foreground">—</span>
          ) : (
            <span className="inline-flex max-w-full items-center truncate rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-foreground" title={row.original.proposes}>
              {row.original.proposes}
            </span>
          ),
      },
      {
        accessorKey: 'confidencePct',
        header: t('agent_orchestrator.caseload.col.confidence', 'Confidence'),
        cell: ({ row }) => {
          const pct = row.original.confidencePct
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
        accessorKey: 'waitingValue',
        header: t('agent_orchestrator.caseload.col.waiting', 'Waiting'),
        cell: ({ row }) => (
          <WaitingLabel
            value={row.original.waitingLabel}
            className={cn('text-sm', row.original.waitingStale ? 'font-medium text-foreground' : 'text-muted-foreground')}
          />
        ),
      },
      {
        accessorKey: 'status',
        header: t('agent_orchestrator.caseload.col.status', 'Status'),
        cell: ({ row }) => (
          <StatusBadge variant={STATUS_VARIANT[row.original.status]} dot>
            {t(`agent_orchestrator.caseload.status.${row.original.status}`)}
          </StatusBadge>
        ),
      },
    ]
    const selectColumn: ColumnDef<QueueRow> = {
      id: 'select',
      enableSorting: false,
      meta: { maxWidth: '44px' },
      header: () => (
        <Checkbox
          checked={allSelected ? true : someSelected ? 'indeterminate' : false}
          onCheckedChange={toggleAll}
          aria-label={t('agent_orchestrator.caseload.bulk.selectAll')}
        />
      ),
      cell: ({ row }) =>
        row.original.isPending ? (
          <div className="flex items-center" onClick={(event) => event.stopPropagation()}>
            <Checkbox
              checked={selectedIds.has(row.original.id)}
              onCheckedChange={() => toggleRow(row.original.id)}
              aria-label={t('agent_orchestrator.caseload.bulk.selectRow')}
            />
          </div>
        ) : null,
    }
    return [selectColumn, ...base]
  }, [t, selectedIds, allSelected, someSelected, toggleAll, toggleRow])

  const rowActions = React.useCallback(
    (row: QueueRow) => {
      if (!row.isPending) return null
      return (
        <div className="flex items-center justify-end gap-1" onClick={(event) => event.stopPropagation()}>
          <IconButton
            size="sm"
            variant="outline"
            aria-label={t('agent_orchestrator.caseload.actions.approveAria')}
            title={t('agent_orchestrator.proposal.actions.approve')}
            disabled={busy}
            onClick={() => { void approveRows([row]) }}
          >
            <Check className="size-4 text-status-success-text" />
          </IconButton>
          <IconButton
            size="sm"
            variant="outline"
            aria-label={t('agent_orchestrator.caseload.actions.rejectAria')}
            title={t('agent_orchestrator.proposal.actions.reject')}
            disabled={busy}
            onClick={() => openReject([row])}
          >
            <X className="size-4 text-status-error-text" />
          </IconButton>
        </div>
      )
    },
    [approveRows, openReject, busy, t],
  )

  // Defined once, composed into both the inbox (inside its container) and the
  // list (above the table) toolbars so the controls live where each view needs them.
  const searchControl = (
    <SearchInput value={search} onChange={setSearch} placeholder={t('agent_orchestrator.caseload.searchPlaceholder')} />
  )
  const filterPills = (
    <>
      <MultiSelectPill allLabel={t('agent_orchestrator.caseload.filter.allAgents')} options={agentOptions} selected={agentFilters} onChange={setAgentFilters} />
      <MultiSelectPill allLabel={t('agent_orchestrator.caseload.filter.allDecisions')} options={proposesOptions} selected={proposesFilters} onChange={setProposesFilters} />
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
    </>
  )

  return (
    <Page>
      <PageBody className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">{t('agent_orchestrator.caseload.title')}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t('agent_orchestrator.caseload.subtitlePersonal', undefined, { count: grandTotal })}</p>
          </div>
          <div className="flex items-center gap-2">
            <SegmentedControl value={view} onValueChange={(value) => setView(value as ViewKey)}>
              <SegmentedControlItem value="inbox">{t('agent_orchestrator.caseload.view.inbox')}</SegmentedControlItem>
              <SegmentedControlItem value="list">{t('agent_orchestrator.caseload.view.list')}</SegmentedControlItem>
            </SegmentedControl>
            <Button type="button" variant="outline" size="sm" aria-label={t('agent_orchestrator.caseload.refresh')} onClick={reload}>
              <RotateCw className="size-4" />
            </Button>
          </div>
        </div>

        {!isLoading && !error && (grandTotal > 0 || runningCount > 0) ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <LifecycleTile
              icon={Inbox}
              label={t('agent_orchestrator.caseload.lifecycle.needYou')}
              value={lifecycle.needYou}
              sub={t('agent_orchestrator.caseload.lifecycle.needYouHint')}
            />
            <LifecycleTile icon={Clock} label={t('agent_orchestrator.caseload.lifecycle.waiting')} value={lifecycle.waiting} sub={t('agent_orchestrator.caseload.lifecycle.waitingHint')} />
            <LifecycleTile icon={Activity} label={t('agent_orchestrator.caseload.lifecycle.running')} value={lifecycle.running} sub={t('agent_orchestrator.caseload.lifecycle.runningHint')} />
            <LifecycleTile
              icon={CheckCircle2}
              label={t('agent_orchestrator.caseload.lifecycle.closedToday')}
              value={
                <span className="inline-flex items-center rounded-md border border-dashed border-border bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground">
                  {t('agent_orchestrator.agents.list.pending.backend', 'Needs backend')}
                </span>
              }
              sub={t('agent_orchestrator.caseload.lifecycle.closedHint')}
            />
          </div>
        ) : null}

        {isLoading ? (
          <LoadingMessage label={t('agent_orchestrator.caseload.title')} />
        ) : error ? (
          <ErrorMessage label={error} />
        ) : grandTotal === 0 && pageRows.length === 0 ? (
          <EmptyState
            title={t('agent_orchestrator.caseload.empty')}
            description={t('agent_orchestrator.caseload.emptyDescription')}
          />
        ) : view === 'inbox' ? (
          <ExceptionsInbox
            toolbar={
              <div className="space-y-2 border-b border-border p-3">
                {searchControl}
                <div className="flex flex-wrap items-center gap-2">{filterPills}</div>
              </div>
            }
            rows={visibleRows}
            details={decisionDetails}
            counts={counts}
            total={grandTotal}
            segment={segment}
            onSegmentChange={setSegment}
            busy={busy}
            cursorId={inboxCursor.cursorId}
            onCursorChange={inboxCursor.setCursor}
            position={
              inboxCursor.cursorIndex >= 0 && total > 0
                ? { current: Math.min((page - 1) * pageSize + inboxCursor.cursorIndex + 1, total), total }
                : null
            }
            onApprove={(row) => approveRows([row])}
            onReject={(row) => openReject([row])}
            onOpenDetail={openDetail}
            footer={
              total > 0 ? (
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2.5">
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {t('agent_orchestrator.caseload.inbox.range', undefined, {
                      from: Math.min((page - 1) * pageSize + 1, total),
                      to: Math.min(page * pageSize, total),
                      total,
                    })}
                  </span>
                  {total > pageSize ? (
                    <Pagination
                      page={page}
                      pageSize={pageSize}
                      total={total}
                      onPageChange={setPage}
                      onPageSizeChange={(next) => { setPageSize(next); setPage(1) }}
                      pageSizeOptions={[10, 20, 50]}
                      showInfo={false}
                      showFirstLast={false}
                    />
                  ) : null}
                </div>
              ) : null
            }
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <div className="w-full sm:w-72 lg:w-80">{searchControl}</div>
              <div className="flex flex-wrap items-center gap-2 sm:ml-auto">{filterPills}</div>
            </div>

            <StatusTabs segment={segment} counts={counts} total={grandTotal} onSegmentChange={setSegment} />

            {selectedRows.length > 0 ? (
              <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2">
                <span className="text-sm font-medium text-foreground">
                  {t('agent_orchestrator.caseload.bulk.selected', undefined, { count: selectedRows.length })}
                </span>
                <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => { void approveRows(selectedRows) }}>
                  <Check className="mr-1.5 size-4 text-status-success-text" />
                  {t('agent_orchestrator.proposal.actions.approve')}
                </Button>
                <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => openReject(selectedRows)}>
                  <X className="mr-1.5 size-4 text-status-error-text" />
                  {t('agent_orchestrator.proposal.actions.reject')}
                </Button>
                <Button type="button" size="sm" variant="ghost" className="ml-auto" onClick={clearSelection}>
                  {t('agent_orchestrator.caseload.bulk.clear')}
                </Button>
              </div>
            ) : null}

            <DataTable<QueueRow>
              columns={columns}
              data={visibleRows}
              sortable
              rowActions={rowActions}
              onRowClick={(row) => openDetail(row)}
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

      <Dialog open={rejectDialog.open} onOpenChange={(next) => { if (!next) closeReject() }}>
        <DialogContent
          className="sm:max-w-md"
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault()
              void confirmReject()
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('agent_orchestrator.proposal.reject.heading')}</DialogTitle>
            <DialogDescription>
              {t('agent_orchestrator.caseload.reject.description', undefined, { count: rejectPendingCount })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={t('agent_orchestrator.proposal.reject.reasonPlaceholder')}
              rows={3}
              autoFocus
            />
            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="outline" onClick={closeReject} disabled={busy}>
                {t('agent_orchestrator.proposal.actions.cancelEdit')}
              </Button>
              <Button type="button" variant="destructive" onClick={() => { void confirmReject() }} disabled={busy || !reason.trim()}>
                {t('agent_orchestrator.proposal.reject.confirm')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Page>
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
        : t('agent_orchestrator.caseload.bulk.selected', undefined, { count: selected.length })
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

function StatusTabs({
  segment,
  counts,
  total,
  onSegmentChange,
  className,
}: {
  segment: SegmentKey
  counts: { actionRequired: number; approved: number; rejected: number }
  total: number
  onSegmentChange: (segment: SegmentKey) => void
  className?: string
}) {
  const t = useT()
  const tabs: Array<{ key: SegmentKey; label: string; count: number }> = [
    { key: 'actionRequired', label: t('agent_orchestrator.caseload.status.actionRequired'), count: counts.actionRequired },
    { key: 'approved', label: t('agent_orchestrator.caseload.status.approved'), count: counts.approved },
    { key: 'rejected', label: t('agent_orchestrator.caseload.status.rejected'), count: counts.rejected },
    { key: 'all', label: t('agent_orchestrator.caseload.filters.all'), count: total },
  ]
  return (
    <div className={cn('flex flex-nowrap items-center gap-4 overflow-x-auto border-b border-border', className)}>
      {tabs.map((tab) => {
        const active = segment === tab.key
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => onSegmentChange(tab.key)}
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

// "7d" on its own reads as a mystery number — the clock icon + tooltip make it
// unmistakably "how long this has been waiting".
function WaitingLabel({ value, className }: { value: string; className?: string }) {
  const t = useT()
  return (
    <span
      className={cn('inline-flex items-center gap-1 tabular-nums', className)}
      title={t('agent_orchestrator.caseload.waitingTooltip', undefined, { duration: value })}
    >
      <Clock className="size-3 shrink-0 opacity-70" />
      {value}
    </span>
  )
}

function ExceptionsInbox({
  toolbar,
  rows,
  details,
  counts,
  total,
  segment,
  onSegmentChange,
  busy,
  cursorId,
  onCursorChange,
  position,
  onApprove,
  onReject,
  onOpenDetail,
  footer,
}: {
  toolbar: React.ReactNode
  rows: QueueRow[]
  details: Map<string, DecisionDetail>
  counts: { actionRequired: number; approved: number; rejected: number }
  total: number
  segment: SegmentKey
  onSegmentChange: (segment: SegmentKey) => void
  busy: boolean
  cursorId: string | null
  onCursorChange: (id: string) => void
  position: { current: number; total: number } | null
  onApprove: (row: QueueRow) => void
  onReject: (row: QueueRow) => void
  onOpenDetail: (row: QueueRow) => void
  footer?: React.ReactNode
}) {
  const t = useT()
  const selected = rows.find((row) => row.id === cursorId) ?? null
  // When the queue empties (last item disposed), return focus to the tab bar
  // so the operator's next keystroke/tab lands on a segment switch.
  const tabsRef = React.useRef<HTMLDivElement>(null)
  const hadRowsRef = React.useRef(rows.length > 0)
  React.useEffect(() => {
    if (rows.length === 0 && hadRowsRef.current) {
      tabsRef.current?.querySelector('button')?.focus()
    }
    hadRowsRef.current = rows.length > 0
  }, [rows.length])

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(480px,560px)_1fr]">
      <div className="min-w-0 overflow-hidden rounded-xl border border-border bg-card">
        {toolbar}
        <div ref={tabsRef}>
          <StatusTabs segment={segment} counts={counts} total={total} onSegmentChange={onSegmentChange} className="px-4" />
        </div>
        {rows.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">{t('agent_orchestrator.caseload.empty')}</div>
        ) : (
          <ul className="max-h-[640px] divide-y divide-border overflow-auto">
            {rows.map((row) => {
              const active = row.id === cursorId
              const face = row.confidencePct != null ? confidenceFace(row.confidencePct) : null
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    aria-current={active ? 'true' : undefined}
                    onClick={() => onCursorChange(row.id)}
                    className={cn('flex w-full items-start gap-3 border-l-2 px-4 py-3 text-left transition-colors focus:outline-none', active ? 'border-l-brand-violet bg-brand-violet/10' : 'border-l-transparent hover:bg-muted/40')}
                  >
                    <Avatar label={row.agentLabel} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-foreground">{row.agentLabel}</span>
                        <WaitingLabel value={row.waitingLabel} className="ml-auto shrink-0 text-xs text-muted-foreground" />
                      </div>
                      <p className="mt-0.5 truncate text-sm font-semibold text-foreground">{headlineOf(row)}</p>
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <span className="inline-flex shrink-0 items-center rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">{row.claim}</span>
                        {face ? (
                          <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                            <face.Icon className={cn('size-3.5', face.color)} />
                            <span className="tabular-nums">{Math.round(row.confidencePct ?? 0)}%</span>
                          </span>
                        ) : null}
                        <span
                          className={cn('ml-auto size-2 shrink-0 rounded-full', STATUS_DOT[row.status])}
                          title={t(`agent_orchestrator.caseload.status.${row.status}`)}
                        />
                      </div>
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        {footer}
      </div>

      <div className="min-w-0 rounded-xl border border-border bg-card">
        {selected ? (
          <DecisionPane
            row={selected}
            detail={details.get(selected.id) ?? null}
            busy={busy}
            position={position}
            onApprove={onApprove}
            onReject={onReject}
            onOpenDetail={onOpenDetail}
          />
        ) : (
          <div className="flex h-full min-h-[320px] items-center justify-center p-8 text-center">
            <div>
              <p className="text-sm font-medium text-foreground">{t('agent_orchestrator.caseload.inbox.emptyTitle')}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t('agent_orchestrator.caseload.inbox.emptyDescription')}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function DecisionPane({
  row,
  detail,
  busy,
  position,
  onApprove,
  onReject,
  onOpenDetail,
}: {
  row: QueueRow
  detail: DecisionDetail | null
  busy: boolean
  position: { current: number; total: number } | null
  onApprove: (row: QueueRow) => void
  onReject: (row: QueueRow) => void
  onOpenDetail: (row: QueueRow) => void
}) {
  const t = useT()
  const face = row.confidencePct != null ? confidenceFace(row.confidencePct) : null

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border p-5">
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">{row.claim}</span>
          <div className="flex shrink-0 items-center gap-2">
            {position ? (
              <span className="text-xs tabular-nums text-muted-foreground">
                {t('agent_orchestrator.caseload.inbox.position', undefined, {
                  position: position.current,
                  total: position.total,
                })}
              </span>
            ) : null}
            <WaitingLabel value={row.waitingLabel} className="text-xs text-muted-foreground" />
            <StatusBadge variant={STATUS_VARIANT[row.status]} dot>
              {t(`agent_orchestrator.caseload.status.${row.status}`)}
            </StatusBadge>
          </div>
        </div>
        <h2 className="mt-2 text-lg font-semibold text-foreground">{headlineOf(row)}</h2>
      </div>

      <div className="space-y-5 p-5">
        {detail ? (
          <FactsGrid
            facts={detail.facts}
            sources={{ input: detail.runInput, payload: detail.proposal.payload, output: detail.runOutput }}
          />
        ) : null}

        <div className="overflow-hidden rounded-lg border border-border border-l-2 border-l-brand-violet bg-brand-violet/10 p-4">
          <div className="flex items-center gap-3">
            <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-violet text-brand-violet-foreground">
              <Sparkles className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-foreground">{headlineOf(row)}</p>
              <p className="truncate text-xs text-muted-foreground">{t('agent_orchestrator.caseload.inbox.recommends', undefined, { agent: row.agentLabel })}</p>
            </div>
            {row.confidencePct != null ? (
              <div className="flex items-center gap-1.5">
                {face ? <face.Icon className={cn('size-4', face.color)} /> : null}
                <span className="text-sm font-semibold tabular-nums text-brand-violet">{Math.round(row.confidencePct)}%</span>
              </div>
            ) : null}
          </div>
        </div>

        {row.isPending ? (
          <div className="flex items-start gap-2.5 rounded-lg bg-muted px-3.5 py-2.5 text-sm text-foreground">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-status-warning-text" />
            <div>
              <p className="font-medium">{t('agent_orchestrator.caseload.inbox.gatedTitle')}</p>
              <p className="mt-0.5 text-muted-foreground">{t('agent_orchestrator.proposal.gate')}</p>
            </div>
          </div>
        ) : null}

        {detail ? <ProposedFields payload={detail.proposal.payload} /> : null}

        {detail ? (
          <ReasoningList
            rationale={detail.proposal.rationale}
            input={detail.runInput}
            guardResults={detail.proposal.guardResults}
          />
        ) : null}
      </div>

      <div className="mt-auto flex items-center gap-2 border-t border-border p-4">
        {row.isPending ? (
          <>
            <Button type="button" variant="outline" size="sm" onClick={() => onReject(row)} disabled={busy}>
              <X className="mr-1.5 size-4 text-status-error-text" />
              {t('agent_orchestrator.proposal.actions.reject')}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenDetail(row)} disabled={busy}>
              {t('agent_orchestrator.proposal.actions.edit')}
            </Button>
            <Button type="button" size="sm" className="ml-auto" onClick={() => onApprove(row)} disabled={busy}>
              <Check className="mr-1.5 size-4" />
              {t('agent_orchestrator.proposal.actions.approve')}
            </Button>
          </>
        ) : (
          <Button type="button" variant="outline" size="sm" className="ml-auto" onClick={() => onOpenDetail(row)}>
            {t('agent_orchestrator.caseload.inbox.openDetail')}
          </Button>
        )}
      </div>
    </div>
  )
}

