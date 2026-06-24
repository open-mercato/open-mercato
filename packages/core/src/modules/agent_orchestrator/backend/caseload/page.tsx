"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import type { ColumnDef } from '@tanstack/react-table'
import { ClipboardList, CheckCircle2, XCircle, RotateCw, Check, X, Smile, Meh, Frown } from 'lucide-react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
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
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { mapAgent, mapProposal, type ProposalView } from '../../components/types'

type ListResponse = { items?: Array<Record<string, unknown>>; total?: number }
// A single status taxonomy drives the tiles, the filter segment, and the table
// Status column so the operator never has to reconcile two vocabularies.
type CaseStatus = 'actionRequired' | 'approved' | 'rejected'
type SegmentKey = CaseStatus | 'all'

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

const STATUS_VARIANT: Record<CaseStatus, 'info' | 'success' | 'error'> = {
  actionRequired: 'info',
  approved: 'success',
  rejected: 'error',
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
async function fetchItems(path: string): Promise<Array<Record<string, unknown>>> {
  const call = await apiCall<ListResponse>(path, undefined, { fallback: { items: [] } })
  return call.ok && Array.isArray(call.result?.items) ? call.result!.items : []
}

export default function AgentCaseloadPage() {
  const t = useT()
  const router = useRouter()
  const [proposals, setProposals] = React.useState<ProposalView[]>([])
  const [agentLabels, setAgentLabels] = React.useState<Map<string, string>>(new Map())
  const [runClaims, setRunClaims] = React.useState<Map<string, string>>(new Map())
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [segment, setSegment] = React.useState<SegmentKey>('actionRequired')
  const [reloadToken, setReloadToken] = React.useState(0)
  const [busy, setBusy] = React.useState(false)
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set())
  const [rejectDialog, setRejectDialog] = React.useState<{ open: boolean; rows: QueueRow[] }>({ open: false, rows: [] })
  const [reason, setReason] = React.useState('')

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
        // Always fetch the full set so the tiles count every status correctly;
        // the segment narrows only the visible rows, client-side.
        const [proposalsCall, agents, runs] = await Promise.all([
          apiCall<ListResponse>('/api/agent_orchestrator/proposals?pageSize=100', undefined, { fallback: { items: [] } }),
          fetchItems('/api/agent_orchestrator/agents'),
          fetchItems('/api/agent_orchestrator/runs?pageSize=100'),
        ])
        if (cancelled) return
        if (!proposalsCall.ok) {
          setError(t('agent_orchestrator.caseload.error'))
          return
        }
        const items = Array.isArray(proposalsCall.result?.items) ? proposalsCall.result!.items : []
        setProposals(items.map((item) => mapProposal(item)).filter((row): row is ProposalView => !!row))
        const labels = new Map<string, string>()
        for (const item of agents) {
          const agent = mapAgent(item)
          if (agent) labels.set(agent.id, agent.label || agent.id)
        }
        setAgentLabels(labels)
        const claims = new Map<string, string>()
        for (const run of runs) {
          const id = fieldOf(run, 'id')
          if (!id) continue
          const input = asObject(run.input)
          claims.set(id, (input && fieldOf(input, 'claimId', 'claim_id', 'dealId', 'deal_id', 'reference')) || id.slice(0, 12))
        }
        setRunClaims(claims)
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
  }, [reloadToken, t])

  const reload = React.useCallback(() => setReloadToken((token) => token + 1), [])

  // Selection never survives a segment switch or a refetch.
  React.useEffect(() => { setSelectedIds(new Set()) }, [segment, reloadToken])

  const counts = React.useMemo(() => {
    let actionRequired = 0
    let approved = 0
    let rejected = 0
    for (const proposal of proposals) {
      const status = statusOf(proposal.disposition)
      if (status === 'actionRequired') actionRequired += 1
      else if (status === 'approved') approved += 1
      else rejected += 1
    }
    return { actionRequired, approved, rejected }
  }, [proposals])

  const queueRows = React.useMemo<QueueRow[]>(() => {
    const now = Date.now()
    return proposals
      .filter((proposal) => segment === 'all' || statusOf(proposal.disposition) === segment)
      .map((proposal) => {
        const waiting = waitingFrom(proposal.createdAt, now)
        return {
          id: proposal.id,
          agentLabel: agentLabels.get(proposal.agentId) || proposal.agentId,
          claim: runClaims.get(proposal.runId) || proposal.id.slice(0, 12),
          proposes: summarizeProposal(proposal.payload),
          confidencePct: confidencePctOf(proposal.confidence),
          waitingLabel: waiting.label,
          waitingStale: waiting.stale,
          waitingValue: waiting.value,
          status: statusOf(proposal.disposition),
          isPending: proposal.disposition === 'pending',
          updatedAt: proposal.updatedAt,
        }
      })
      .sort((a, b) => b.waitingValue - a.waitingValue)
  }, [proposals, segment, agentLabels, runClaims])

  const selectableIds = React.useMemo(() => queueRows.filter((row) => row.isPending).map((row) => row.id), [queueRows])
  const selectedRows = React.useMemo(() => queueRows.filter((row) => selectedIds.has(row.id)), [queueRows, selectedIds])
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
  // Already-disposed rows (visible in other segments) are skipped so a mixed
  // selection never 409s. Conflicts surface on the shared bar; other errors flash.
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
    async (rows: QueueRow[]) => {
      const ok = await disposeRows(rows, 'approved')
      if (ok > 0) flash(t('agent_orchestrator.caseload.flash.approved', undefined, { count: ok }), 'success')
      setSelectedIds(new Set())
      reload()
    },
    [disposeRows, reload, t],
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
    if (ok > 0) flash(t('agent_orchestrator.caseload.flash.rejected', undefined, { count: ok }), 'success')
    setRejectDialog({ open: false, rows: [] })
    setReason('')
    setSelectedIds(new Set())
    reload()
  }, [reason, busy, rejectDialog.rows, disposeRows, reload, t])

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
          <span className={cn('text-sm tabular-nums', row.original.waitingStale ? 'font-medium text-foreground' : 'text-muted-foreground')}>
            {row.original.waitingLabel}
          </span>
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
    if (selectableIds.length === 0) return base
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
  }, [t, selectableIds, selectedIds, allSelected, someSelected, toggleAll, toggleRow])

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

  return (
    <Page>
      <PageBody className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{t('agent_orchestrator.caseload.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('agent_orchestrator.caseload.subtitle')}</p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <CaseTile icon={ClipboardList} label={t('agent_orchestrator.caseload.status.actionRequired')} value={counts.actionRequired} />
          <CaseTile icon={CheckCircle2} label={t('agent_orchestrator.caseload.status.approved')} value={counts.approved} />
          <CaseTile icon={XCircle} label={t('agent_orchestrator.caseload.status.rejected')} value={counts.rejected} />
        </div>

        <div className="flex items-center gap-2">
          <SegmentedControl value={segment} onValueChange={(value) => setSegment(value as SegmentKey)}>
            <SegmentedControlItem value="actionRequired">{t('agent_orchestrator.caseload.status.actionRequired')}</SegmentedControlItem>
            <SegmentedControlItem value="approved">{t('agent_orchestrator.caseload.status.approved')}</SegmentedControlItem>
            <SegmentedControlItem value="rejected">{t('agent_orchestrator.caseload.status.rejected')}</SegmentedControlItem>
            <SegmentedControlItem value="all">{t('agent_orchestrator.caseload.filters.all')}</SegmentedControlItem>
          </SegmentedControl>
          <Button type="button" variant="outline" size="sm" aria-label={t('agent_orchestrator.caseload.refresh')} onClick={reload}>
            <RotateCw className="size-4" />
          </Button>
        </div>

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

        {isLoading ? (
          <LoadingMessage label={t('agent_orchestrator.caseload.title')} />
        ) : error ? (
          <ErrorMessage label={error} />
        ) : queueRows.length === 0 ? (
          <EmptyState
            title={t('agent_orchestrator.caseload.empty')}
            description={t('agent_orchestrator.caseload.emptyDescription')}
          />
        ) : (
          <DataTable<QueueRow>
            columns={columns}
            data={queueRows}
            sortable
            rowActions={rowActions}
            onRowClick={(row) => router.push(`/backend/caseload/${encodeURIComponent(row.id)}`)}
          />
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

function CaseTile({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: number }) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-muted-foreground">{label}</p>
        <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-brand-violet">
          <Icon className="size-4" />
        </span>
      </div>
      <div className="mt-2 text-3xl font-bold tabular-nums tracking-tight text-foreground">{value.toLocaleString('en-US')}</div>
      <div className="absolute inset-x-0 bottom-0 h-1 bg-gradient-to-r from-brand-lime via-brand-lime to-brand-violet" />
    </div>
  )
}
