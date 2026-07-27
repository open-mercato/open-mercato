"use client"

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { ColumnDef } from '@tanstack/react-table'
import { RotateCw, Check, X, Smile, Meh, Frown, Sparkles, TriangleAlert, Clock, ArrowUpDown, ChevronDown, Inbox, Activity, CheckCircle2, Keyboard, ShieldAlert } from 'lucide-react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { agentAvatarIcon } from '../../components/agentChips'
import { useAgentIconMap } from '../../components/useAgentIcons'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { SearchInput } from '@open-mercato/ui/primitives/search-input'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'
import { Pagination } from '@open-mercato/ui/primitives/pagination'
import { Kbd } from '@open-mercato/ui/primitives/kbd'
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
import { subjectRefOf } from '../../components/subjectRef'
import { useCoalescedReload } from '../../components/useCoalescedReload'
import { summarizeProposalActions } from '../../components/proposalFactsData'
import { FactsGrid, ProposedFields, ReasoningList } from '../../components/ProposalFacts'
import {
  useInboxCursor,
  useCaseloadHotkeys,
  useDeferredApprove,
  intersectSelection,
  hasGuardRisk,
  parseQueueState,
  serializeQueueState,
  firstFailureMessage,
  pruneSelectionAfterDispose,
  type CaseloadHotkeyAction,
  type DisposeOutcome,
} from './hooks'

type ListResponse = { items?: Array<Record<string, unknown>>; total?: number }
// A single status taxonomy drives the tiles, the filter segment, and the table
// Status column so the operator never has to reconcile two vocabularies.
// `autoApproved` is a badge-level split of the approved family — the Approved
// tab still groups all three dispositions, but rubber-stamp review needs to
// SEE which approvals never had a human in the loop.
type CaseStatus = 'actionRequired' | 'approved' | 'autoApproved' | 'rejected'
// Segments stay a three-way split — `autoApproved` is a badge-level status
// only; the Approved tab keeps grouping approved + auto_approved + edited.
type SegmentKey = 'actionRequired' | 'approved' | 'rejected' | 'all'
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
  /** Tenant-configured agent icon (lucide name) + kind for the avatar glyph. */
  agentIcon: string | null
  agentResultKind: 'informative' | 'actionable'
  claim: string
  proposes: string
  /** Humanized primary action type — the bounded filter vocabulary. */
  proposesType: string | null
  /** Raw persisted action type (`set_stage`) — tooltip material. */
  proposesRawType: string | null
  confidencePct: number | null
  waitingLabel: string
  waitingStale: boolean
  status: CaseStatus
  waitingValue: number
  isPending: boolean
  updatedAt: string | null
  /** Guardrail verdict counts from `guard_results` (already in the list response). */
  guardWarnCount: number
  guardBlockCount: number
  /** Any non-pass guardrail verdict — approve goes through the undo window. */
  riskFlagged: boolean
  /** Inside its approve undo window — rendered approved, dispose not yet sent. */
  pendingUndo: boolean
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
  autoApproved: 'info',
  rejected: 'error',
}
const STATUS_DOT: Record<CaseStatus, string> = {
  actionRequired: 'bg-status-info-icon',
  approved: 'bg-status-success-icon',
  autoApproved: 'bg-status-info-icon',
  rejected: 'bg-status-error-icon',
}

function statusOf(disposition: string): CaseStatus {
  if (disposition === 'pending') return 'actionRequired'
  if (disposition === 'rejected') return 'rejected'
  if (disposition === 'auto_approved') return 'autoApproved'
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
/**
 * What the row "Proposes" — a thin wrapper over `summarizeProposalActions`
 * (spec 4 Phase 4): the first action's humanized type plus an action count,
 * NEVER rationale prose. Non-canonical payloads yield '—' and the headline
 * falls back to the agent label.
 */
function summarizeProposal(
  payload: unknown,
  more: (count: number) => string,
): { display: string; typeLabel: string | null; typeRaw: string | null } {
  const parts = summarizeProposalActions(payload)
  if (!parts) return { display: '—', typeLabel: null, typeRaw: null }
  return {
    display: parts.extraCount > 0 ? `${parts.typeLabel} · ${more(parts.extraCount)}` : parts.typeLabel,
    typeLabel: parts.typeLabel,
    typeRaw: parts.typeRaw,
  }
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
  if (proposesFilters.length > 0 && (!row.proposesType || !proposesFilters.includes(row.proposesType))) return false
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
  const searchParams = useSearchParams()
  // Queue state initializes from the URL exactly once (spec 4 Phase 5) —
  // afterwards state is the source of truth and the URL mirrors it below.
  const [initialQueue] = React.useState(() => parseQueueState(searchParams))
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
  const [view, setView] = React.useState<ViewKey>(initialQueue.view)
  const [segment, setSegment] = React.useState<SegmentKey>(initialQueue.segment)
  const [search, setSearch] = React.useState(initialQueue.q)
  const [agentFilters, setAgentFilters] = React.useState<string[]>([])
  const [proposesFilters, setProposesFilters] = React.useState<string[]>([])
  const [sortKey, setSortKey] = React.useState<SortKey>(initialQueue.sort)
  const [page, setPage] = React.useState(initialQueue.page)
  const [pageSize, setPageSize] = React.useState(initialQueue.pageSize)
  const [reloadToken, setReloadToken] = React.useState(0)
  const [busy, setBusy] = React.useState(false)
  const [rejectDialog, setRejectDialog] = React.useState<{ open: boolean; rows: QueueRow[] }>({ open: false, rows: [] })
  const [reason, setReason] = React.useState('')
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set())

  const { runMutation, retryLastMutation } = useGuardedMutation<{ retryLastMutation: () => Promise<boolean> }>({
    contextId: 'agent_orchestrator.caseload',
    blockedMessage: t('agent_orchestrator.proposal.flash.blocked'),
  })

  // Warn-flagged approves defer their dispose behind an undo window (spec 4
  // Phase 3). The committer is bound via a ref because `disposeRows` closes
  // over state declared below; the manager guarantees exactly-once per id.
  const commitDeferredRef = React.useRef<(id: string, row: QueueRow) => void>(() => {})
  const deferredApprove = useDeferredApprove<QueueRow>((id, row) => commitDeferredRef.current(id, row))

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
          claims.set(id, (input && subjectRefOf(input)) || id.slice(0, 12))
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
  // A guardrail trip usually precedes proposal.created by seconds — subscribing
  // keeps the row-level risk chips fresh and the broadcast flag honest
  // (UX consistency pass, Area 1: the flag previously had zero listeners).
  useAppEvent('agent_orchestrator.guardrail.tripped', () => {
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

  const agentIcons = useAgentIconMap()

  const pageRows = React.useMemo<QueueRow[]>(() => {
    const now = Date.now()
    return proposals.map((proposal) => {
      const agentIconInfo = agentIcons.get(proposal.agentId)
      const waiting = waitingFrom(proposal.createdAt, now)
      const confidencePct = confidencePctOf(proposal.confidence)
      const guardWarnCount = proposal.guardResults.filter((check) => check.result === 'warn').length
      const guardBlockCount = proposal.guardResults.filter(
        (check) => check.result !== 'pass' && check.result !== 'warn',
      ).length
      // Rows inside their undo window render approved and stop being pending
      // (cursor, hotkeys, and bulk selection all skip them) even though the
      // dispose has not been sent yet — undo simply restores this overlay.
      const inUndoWindow = deferredApprove.pendingUndo.has(proposal.id)
      const summary = summarizeProposal(proposal.payload, (count) =>
        t('agent_orchestrator.caseload.proposes.more', undefined, { count }),
      )
      return {
        id: proposal.id,
        agentLabel: agentLabels.get(proposal.agentId) || proposal.agentId,
        agentIcon: agentIconInfo?.icon ?? null,
        agentResultKind: agentIconInfo?.resultKind ?? 'informative',
        claim: runClaims.get(proposal.runId) || proposal.id.slice(0, 12),
        proposes: summary.display,
        proposesType: summary.typeLabel,
        proposesRawType: summary.typeRaw,
        confidencePct,
        waitingLabel: waiting.label,
        waitingStale: waiting.stale,
        waitingValue: waiting.value,
        status: inUndoWindow ? 'approved' : statusOf(proposal.disposition),
        isPending: proposal.disposition === 'pending' && !inUndoWindow,
        updatedAt: proposal.updatedAt,
        guardWarnCount,
        guardBlockCount,
        riskFlagged: hasGuardRisk(proposal.guardResults),
        pendingUndo: inUndoWindow,
      }
    })
  }, [proposals, agentLabels, agentIcons, runClaims, deferredApprove.pendingUndo, t])

  // Segment + sort are server-applied; text search and the agent/decision
  // pills narrow the LOADED page only, so both views show the same rows while
  // pagination totals stay server-driven.
  const visibleRows = React.useMemo(
    () => pageRows.filter((row) => matchesSearch(row, search) && matchesFilters(row, agentFilters, proposesFilters)),
    [pageRows, search, agentFilters, proposesFilters],
  )
  const agentOptions = React.useMemo(() => Array.from(new Set(pageRows.map((row) => row.agentLabel))).sort((a, b) => a.localeCompare(b)), [pageRows])
  // Decision filter options are the distinct humanized ACTION TYPES — a
  // bounded vocabulary, never prose (spec 4 Phase 4); tooltips keep the raw type.
  const proposesOptions = React.useMemo(
    () =>
      Array.from(new Set(pageRows.map((row) => row.proposesType).filter((value): value is string => !!value))).sort(
        (a, b) => a.localeCompare(b),
      ),
    [pageRows],
  )
  const proposesOptionTitles = React.useMemo(() => {
    const titles = new Map<string, string>()
    for (const row of pageRows) {
      if (row.proposesType && row.proposesRawType && !titles.has(row.proposesType)) {
        titles.set(row.proposesType, row.proposesRawType)
      }
    }
    return titles
  }, [pageRows])
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
  // Reset to page 1 when the segment/sort/pageSize change — but not on mount,
  // where the values just arrived from a deep link that may carry `page=3`.
  const skipPageResetRef = React.useRef(true)
  React.useEffect(() => {
    if (skipPageResetRef.current) {
      skipPageResetRef.current = false
      return
    }
    setPage(1)
  }, [segment, sortKey, pageSize])
  // Mirror the queue state into the URL (debounced — `q` changes per
  // keystroke) so filtered queues are shareable and the detail page can
  // rebuild this exact view from the forwarded params.
  const queueQuery = React.useMemo(
    () => serializeQueueState({ view, segment, q: search, sort: sortKey, page, pageSize }),
    [view, segment, search, sortKey, page, pageSize],
  )
  React.useEffect(() => {
    if ((searchParams?.toString() ?? '') === queueQuery) return
    const timer = window.setTimeout(() => {
      router.replace(queueQuery ? `/backend/caseload?${queueQuery}` : '/backend/caseload', { scroll: false })
    }, 250)
    return () => window.clearTimeout(timer)
  }, [queueQuery, router, searchParams])
  // Deliberate context switches clear the bulk selection; live refreshes only
  // prune ids that are no longer pending (spec 4 Phase 1 — an org-wide
  // proposal.* event must not wipe an operator's half-built selection).
  // They also commit any approve still inside its undo window — the operator
  // saw it confirmed, so leaving the queue must not silently drop it.
  React.useEffect(() => { setSelectedIds(new Set()); deferredApprove.flushAll() }, [segment, page, view, deferredApprove.flushAll])
  React.useEffect(() => {
    setSelectedIds((prev) => intersectSelection(prev, pageRows.filter((row) => row.isPending).map((row) => row.id)))
  }, [pageRows])
  // Explicit inbox cursor over the loaded, filtered row set — follows the row
  // id across refreshes and advances to the neighbor on dispose instead of
  // resetting to the top.
  const inboxCursor = useInboxCursor(visibleRows)
  const [legendOpen, setLegendOpen] = React.useState(false)
  const undoEntries = React.useMemo(
    () => Array.from(deferredApprove.pendingUndo.values()),
    [deferredApprove.pendingUndo],
  )
  const cursorRow = React.useMemo(
    () => visibleRows.find((row) => row.id === inboxCursor.cursorId) ?? null,
    [visibleRows, inboxCursor.cursorId],
  )
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
  // Failures are AGGREGATED into the returned outcome (spec 4 Phase 5) — the
  // callers emit one flash instead of a per-row toast storm; conflict failures
  // carry a null message because they already surfaced on the conflict bar.
  const disposeRows = React.useCallback(
    async (rows: QueueRow[], disposition: 'approved' | 'rejected', rejectReason?: string): Promise<DisposeOutcome> => {
      const pending = rows.filter((row) => row.isPending)
      if (pending.length === 0) return { ok: 0, failures: [] }
      setBusy(true)
      let ok = 0
      const failures: DisposeOutcome['failures'] = []
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
            const conflictSurfaced = surfaceRecordConflict(err, t)
            failures.push({
              id: row.id,
              message: conflictSurfaced ? null : err instanceof Error ? err.message : null,
            })
          }
        }
      } finally {
        setBusy(false)
      }
      return { ok, failures }
    },
    [runMutation, retryLastMutation, t],
  )

  // One flash per dispose attempt: all-success keeps the count flash, any
  // failure in a bulk emits the aggregate summary, a lone failure keeps the
  // plain error message (conflicts stay silent — the bar owns them).
  const flashDisposeOutcome = React.useCallback(
    (outcome: DisposeOutcome, attempted: number, summaryKey: string, successKey: string) => {
      if (outcome.failures.length === 0) {
        if (outcome.ok > 0) flash(t(successKey, undefined, { count: outcome.ok }), 'success')
        return
      }
      if (attempted > 1) {
        flash(
          t(summaryKey, undefined, {
            ok: outcome.ok,
            failed: outcome.failures.length,
            error: firstFailureMessage(outcome.failures) ?? t('agent_orchestrator.proposal.flash.error'),
          }),
          'error',
        )
        return
      }
      const message = firstFailureMessage(outcome.failures)
      if (message) flash(message, 'error')
    },
    [t],
  )

  const approveRows = React.useCallback(
    async (rows: QueueRow[], source: 'single' | 'bulk' = 'single'): Promise<number> => {
      const pending = rows.filter((row) => row.isPending)
      // Warn-flagged single approves defer behind the undo window instead of a
      // confirm dialog (spec 4 Phase 3): one keystroke stays one keystroke,
      // mistakes stay recoverable. Bulk approve is a deliberate multi-select
      // act and commits immediately, as do clean rows.
      if (source === 'single' && pending.length === 1 && pending[0].riskFlagged) {
        const row = pending[0]
        deferredApprove.defer(row.id, row)
        inboxCursor.advanceAfterDispose([row.id])
        return 1
      }
      const outcome = await disposeRows(rows, 'approved')
      flashDisposeOutcome(outcome, pending.length, 'agent_orchestrator.caseload.bulk.summary', 'agent_orchestrator.caseload.flash.approved')
      const failedIds = new Set(outcome.failures.map((failure) => failure.id))
      const succeededIds = pending.map((row) => row.id).filter((id) => !failedIds.has(id))
      if (succeededIds.length > 0) inboxCursor.advanceAfterDispose(succeededIds)
      // Successes leave the selection; failures stay selected for retry.
      setSelectedIds((prev) => pruneSelectionAfterDispose(prev, succeededIds))
      reload()
      return outcome.ok
    },
    [disposeRows, flashDisposeOutcome, reload, inboxCursor, deferredApprove],
  )

  // The deferred committer sends the SAME guarded, lock-headered dispose the
  // immediate path uses (`isPending` restored — the overlay cleared it), then
  // refreshes counts. A 409 surfaces via the existing conflict bar.
  commitDeferredRef.current = (id, row) => {
    void disposeRows([{ ...row, isPending: true, pendingUndo: false }], 'approved').then((outcome) => {
      if (outcome.ok > 0) {
        reload()
        return
      }
      // A failed deferred commit restores the row to pending on the next
      // reload; a non-conflict failure still deserves its error message.
      const message = firstFailureMessage(outcome.failures)
      if (message) flash(message, 'error')
      reload()
    })
  }

  const undoApprove = React.useCallback(
    (id: string) => {
      const row = deferredApprove.undo(id)
      if (row) inboxCursor.setCursor(id)
    },
    [deferredApprove, inboxCursor],
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
    const pending = rows.filter((row) => row.isPending)
    const outcome = await disposeRows(rows, 'rejected', trimmed)
    flashDisposeOutcome(outcome, pending.length, 'agent_orchestrator.caseload.bulk.summaryRejected', 'agent_orchestrator.caseload.flash.rejected')
    const failedIds = new Set(outcome.failures.map((failure) => failure.id))
    const succeededIds = pending.map((row) => row.id).filter((id) => !failedIds.has(id))
    if (succeededIds.length > 0) inboxCursor.advanceAfterDispose(succeededIds)
    setRejectDialog({ open: false, rows: [] })
    setReason('')
    setSelectedIds((prev) => pruneSelectionAfterDispose(prev, succeededIds))
    reload()
  }, [reason, busy, rejectDialog.rows, disposeRows, flashDisposeOutcome, reload, inboxCursor])

  const openDetail = React.useCallback(
    (row: QueueRow) => {
      // In-app navigation commits synchronously — the undo affordance is gone
      // once the queue is left behind. The current queue params travel on the
      // link so the detail page can return to this exact view (spec 4 Phase 5).
      deferredApprove.flushAll()
      router.push(`/backend/caseload/${encodeURIComponent(row.id)}${queueQuery ? `?${queueQuery}` : ''}`)
    },
    [router, deferredApprove, queueQuery],
  )

  // Keyboard-first triage (spec 4 Phase 2): j/k + A/R/E/X act on the cursor
  // row; the resolver's guards (editable focus, open dialog, modifiers) live
  // in the hook so a keystroke meant for a form can never dispose anything.
  const handleHotkey = React.useCallback(
    (action: CaseloadHotkeyAction) => {
      switch (action) {
        case 'next':
          inboxCursor.moveCursor(1)
          break
        case 'prev':
          inboxCursor.moveCursor(-1)
          break
        case 'open':
          if (!inboxCursor.cursorId) inboxCursor.moveCursor(1)
          break
        case 'approve':
          if (cursorRow?.isPending && !busy) void approveRows([cursorRow])
          break
        case 'reject':
          if (cursorRow?.isPending && !busy) openReject([cursorRow])
          break
        case 'edit':
          if (cursorRow) openDetail(cursorRow)
          break
        case 'toggleSelect':
          if (cursorRow?.isPending) toggleRow(cursorRow.id)
          break
        case 'legend':
          setLegendOpen(true)
          break
        case 'escape':
          inboxCursor.clearCursor()
          break
      }
    },
    [inboxCursor, cursorRow, busy, approveRows, openReject, openDetail, toggleRow],
  )
  useCaseloadHotkeys(view === 'inbox' && !isLoading && !error, handleHotkey)

  const rejectPendingCount = rejectDialog.rows.filter((row) => row.isPending).length

  const columns = React.useMemo<ColumnDef<QueueRow>[]>(() => {
    const base: ColumnDef<QueueRow>[] = [
      {
        accessorKey: 'agentLabel',
        header: t('agent_orchestrator.caseload.col.agent', 'Agent'),
        meta: { maxWidth: '240px' },
        cell: ({ row }) => (
          <div className="flex items-center gap-2.5">
            <Avatar label={row.original.agentLabel} size="sm" variant="monochrome" icon={agentAvatarIcon(row.original.agentIcon, row.original.agentResultKind)} />
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
            <span
              className="inline-flex max-w-full items-center truncate rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-foreground"
              title={row.original.proposesRawType ?? row.original.proposes}
            >
              {row.original.proposes}
            </span>
          ),
      },
      {
        accessorKey: 'riskFlagged',
        header: t('agent_orchestrator.caseload.col.risk', 'Risk'),
        enableSorting: false,
        meta: { maxWidth: '80px' },
        cell: ({ row }) =>
          row.original.riskFlagged ? (
            <GuardRiskChip warn={row.original.guardWarnCount} block={row.original.guardBlockCount} />
          ) : (
            <span className="text-sm text-muted-foreground">—</span>
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
      // No pending rows on this tab → nothing is selectable, so the select-all
      // checkbox would be a dead control (spec 4 Phase 5).
      header: () =>
        selectableIds.length === 0 ? null : (
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
  }, [t, selectedIds, selectableIds, allSelected, someSelected, toggleAll, toggleRow])

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
      <MultiSelectPill
        allLabel={t('agent_orchestrator.caseload.filter.allDecisions')}
        options={proposesOptions}
        optionTitles={proposesOptionTitles}
        selected={proposesFilters}
        onChange={setProposesFilters}
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
    </>
  )

  return (
    <Page>
      <PageBody className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">{t('agent_orchestrator.caseload.title')}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('agent_orchestrator.caseload.subtitleQueue', undefined, {
                count: grandTotal,
                sort: t(SORT_OPTIONS.find((option) => option.key === sortKey)?.labelKey ?? SORT_OPTIONS[0].labelKey),
              })}
            </p>
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
            hotkeysBar={<HotkeysHint legendOpen={legendOpen} onLegendOpenChange={setLegendOpen} />}
            position={
              inboxCursor.cursorIndex >= 0 && total > 0
                ? { current: Math.min((page - 1) * pageSize + inboxCursor.cursorIndex + 1, total), total }
                : null
            }
            onApprove={(row) => approveRows([row])}
            onReject={(row) => openReject([row])}
            onOpenDetail={openDetail}
            undoBar={<UndoBar entries={undoEntries} onUndo={undoApprove} />}
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

            {undoEntries.length > 0 ? (
              <div className="overflow-hidden rounded-lg border border-border">
                <UndoBar entries={undoEntries} onUndo={undoApprove} />
              </div>
            ) : null}

            {selectedRows.length > 0 ? (
              <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2">
                <span className="text-sm font-medium text-foreground">
                  {t('agent_orchestrator.caseload.bulk.selected', undefined, { count: selectedRows.length })}
                </span>
                <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => { void approveRows(selectedRows, 'bulk') }}>
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
              {rejectPendingCount === 1
                ? t('agent_orchestrator.caseload.reject.descriptionOne')
                : t('agent_orchestrator.caseload.reject.description', undefined, { count: rejectPendingCount })}
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
  optionTitles,
  selected,
  onChange,
}: {
  allLabel: string
  options: string[]
  /** Optional per-option tooltip (e.g. the raw action type behind a humanized label). */
  optionTitles?: Map<string, string>
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
                title={optionTitles?.get(value)}
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

/**
 * Inline shortcut hint + the `?`-triggered full legend. The popover content is
 * stamped `data-caseload-hotkey-modal` so the hotkey hook treats an open
 * legend as a modal layer (only Escape acts, handled natively by Radix).
 * Key cap letters (J/K/A/…) are physical key names, not translatable copy.
 */
function HotkeysHint({
  legendOpen,
  onLegendOpenChange,
}: {
  legendOpen: boolean
  onLegendOpenChange: (open: boolean) => void
}) {
  const t = useT()
  const legendRows: Array<{ keys: string[]; label: string }> = [
    { keys: ['J', 'K'], label: t('agent_orchestrator.caseload.hotkeys.navigate') },
    { keys: ['Enter'], label: t('agent_orchestrator.caseload.hotkeys.open') },
    { keys: ['A'], label: t('agent_orchestrator.caseload.hotkeys.approve') },
    { keys: ['R'], label: t('agent_orchestrator.caseload.hotkeys.reject') },
    { keys: ['E'], label: t('agent_orchestrator.caseload.hotkeys.edit') },
    { keys: ['X'], label: t('agent_orchestrator.caseload.hotkeys.select') },
    { keys: ['Esc'], label: t('agent_orchestrator.caseload.hotkeys.close') },
  ]
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-4 py-1.5 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1">
        <Kbd>J</Kbd>
        <Kbd>K</Kbd> {t('agent_orchestrator.caseload.hotkeys.navigate')}
      </span>
      <span className="inline-flex items-center gap-1">
        <Kbd>A</Kbd> {t('agent_orchestrator.caseload.hotkeys.approve')}
      </span>
      <span className="inline-flex items-center gap-1">
        <Kbd>R</Kbd> {t('agent_orchestrator.caseload.hotkeys.reject')}
      </span>
      <span className="inline-flex items-center gap-1">
        <Kbd>E</Kbd> {t('agent_orchestrator.caseload.hotkeys.edit')}
      </span>
      <Popover open={legendOpen} onOpenChange={onLegendOpenChange}>
        <PopoverTrigger asChild>
          <Button type="button" variant="ghost" size="sm" className="ml-auto h-6 gap-1 px-1.5 text-xs font-normal text-muted-foreground">
            <Kbd>?</Kbd> {t('agent_orchestrator.caseload.hotkeys.help')}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-64 p-3" data-caseload-hotkey-modal="">
          <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            <Keyboard className="size-4 opacity-70" />
            {t('agent_orchestrator.caseload.hotkeys.title')}
          </p>
          <dl className="mt-2 space-y-1.5">
            {legendRows.map((row) => (
              <div key={row.label} className="flex items-center justify-between gap-3 text-sm">
                <dt className="text-muted-foreground">{row.label}</dt>
                <dd className="flex items-center gap-1">
                  {row.keys.map((key) => (
                    <Kbd key={key}>{key}</Kbd>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        </PopoverContent>
      </Popover>
    </div>
  )
}

/**
 * Row-level guardrail signal (spec 4 Phase 3): warn verdicts get the warning
 * tone, any block/fail escalates the whole chip to the error tone — the first
 * thing scanned on a row, so speed never means blind approval.
 */
function GuardRiskChip({ warn, block, className }: { warn: number; block: number; className?: string }) {
  const t = useT()
  const total = warn + block
  if (total === 0) return null
  const label = t('agent_orchestrator.caseload.inbox.riskFlagged', undefined, { count: total })
  return (
    <span
      title={label}
      aria-label={label}
      className={cn(
        'inline-flex shrink-0 items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-medium',
        block > 0 ? 'bg-status-error-bg text-status-error-text' : 'bg-status-warning-bg text-status-warning-text',
        className,
      )}
    >
      <ShieldAlert className="size-3 shrink-0" />
      <span className="tabular-nums">{total}</span>
    </span>
  )
}

/**
 * Inline undo affordance for deferred (warn-flagged) approves. The flash
 * primitive carries no action button, so the bar lives inside the queue panel
 * instead — `role="status"` announces it to screen readers.
 */
function UndoBar({ entries, onUndo }: { entries: QueueRow[]; onUndo: (id: string) => void }) {
  const t = useT()
  if (entries.length === 0) return null
  return (
    <div role="status" className="space-y-1.5 border-t border-border bg-status-warning-bg px-4 py-2">
      {entries.map((row) => (
        <div key={row.id} className="flex items-center gap-2 text-sm text-status-warning-text">
          <Check className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            {t('agent_orchestrator.caseload.undo.approved', undefined, { summary: headlineOf(row) })}
          </span>
          <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={() => onUndo(row.id)}>
            {t('agent_orchestrator.caseload.undo.action')}
          </Button>
        </div>
      ))}
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
  hotkeysBar,
  undoBar,
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
  hotkeysBar?: React.ReactNode
  undoBar?: React.ReactNode
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
  // Roving focus: j/k keeps the cursor row visible, and when DOM focus was
  // already on a row (Tab or a previous move), it follows the cursor so
  // Enter/Space keep acting on what the operator sees highlighted.
  const listRef = React.useRef<HTMLUListElement>(null)
  React.useEffect(() => {
    if (!cursorId) return
    const list = listRef.current
    if (!list) return
    const active = list.querySelector<HTMLButtonElement>(`[data-inbox-row="${CSS.escape(cursorId)}"]`)
    if (!active) return
    active.scrollIntoView({ block: 'nearest' })
    const focused = document.activeElement
    if (focused instanceof HTMLElement && focused !== active && focused.hasAttribute('data-inbox-row')) {
      active.focus()
    }
  }, [cursorId])

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(480px,560px)_1fr]">
      <div className="min-w-0 overflow-hidden rounded-xl border border-border bg-card">
        {toolbar}
        <div ref={tabsRef}>
          <StatusTabs segment={segment} counts={counts} total={total} onSegmentChange={onSegmentChange} className="px-4" />
        </div>
        {hotkeysBar}
        {rows.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">{t('agent_orchestrator.caseload.empty')}</div>
        ) : (
          <ul
            ref={listRef}
            role="listbox"
            aria-label={t('agent_orchestrator.caseload.inbox.queueAria')}
            className="max-h-[640px] divide-y divide-border overflow-auto"
          >
            {rows.map((row, index) => {
              const active = row.id === cursorId
              const face = row.confidencePct != null ? confidenceFace(row.confidencePct) : null
              return (
                <li key={row.id} role="presentation">
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    tabIndex={active || (cursorId == null && index === 0) ? 0 : -1}
                    data-inbox-row={row.id}
                    onClick={() => onCursorChange(row.id)}
                    className={cn(
                      'flex w-full items-start gap-3 border-l-2 px-4 py-3 text-left transition-colors focus:outline-none focus-visible:bg-muted/60',
                      active ? 'border-l-brand-violet bg-brand-violet/10' : 'border-l-transparent hover:bg-muted/40',
                      row.pendingUndo && 'opacity-60',
                    )}
                  >
                    <Avatar label={row.agentLabel} size="sm" variant="monochrome" icon={agentAvatarIcon(row.agentIcon, row.agentResultKind)} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-foreground">{row.agentLabel}</span>
                        <WaitingLabel value={row.waitingLabel} className="ml-auto shrink-0 text-xs text-muted-foreground" />
                      </div>
                      <p className="mt-0.5 truncate text-sm font-semibold text-foreground">{headlineOf(row)}</p>
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <GuardRiskChip warn={row.guardWarnCount} block={row.guardBlockCount} />
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
        {undoBar}
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
              <p className="font-medium">{t('agent_orchestrator.caseload.inbox.needsDecision')}</p>
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
              <Kbd className="ml-1.5">R</Kbd>
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenDetail(row)} disabled={busy}>
              {t('agent_orchestrator.proposal.actions.edit')}
              <Kbd className="ml-1.5">E</Kbd>
            </Button>
            <Button type="button" size="sm" className="ml-auto" onClick={() => onApprove(row)} disabled={busy}>
              <Check className="mr-1.5 size-4" />
              {t('agent_orchestrator.proposal.actions.approve')}
              <Kbd className="ml-1.5 border-primary-foreground/30 bg-transparent text-primary-foreground">A</Kbd>
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

