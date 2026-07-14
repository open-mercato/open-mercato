"use client"

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { CheckCircle2, ClipboardList, Users, Clock, Zap, Bell, BookOpen, ArrowRight, RotateCw, Info, Check, FileSearch, Workflow } from 'lucide-react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { Button } from '@open-mercato/ui/primitives/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { StatusBadge, type StatusMap } from '@open-mercato/ui/primitives/status-badge'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'
import { useT, useLocale } from '@open-mercato/shared/lib/i18n/context'
import {
  mapAgent,
  formatNumber,
  formatWaitMinutes,
  mapAgentWindowMetrics,
  mapOverviewMetrics,
  mapProposal,
  mapRun,
  type OverviewMetricsView,
  type ProposalView,
  type RunView,
} from '../../components/types'
import { subjectRefOf } from '../../components/subjectRef'
import { useCoalescedReload } from '../../components/useCoalescedReload'
import { agentAvatarIcon } from '../../components/agentChips'

type Health = 'good' | 'watch' | 'poor' | 'new'
type ListResponse = { items?: Array<Record<string, unknown>>; total?: number }

type Sla = 'breach' | 'risk' | 'ok'
type Verb = 'do' | 'review'
type TrustRow = { id: string; label: string; icon: string | null; resultKind: 'informative' | 'actionable'; runs: number; overridePct: number | null; status: Health }
type StuckRow = { id: string; processId: string | null; claim: string; agentLabel: string; waitingMin: number | null; waitingFor: Verb; sla: Sla }
type AgentWindowMetrics = { totalRuns: number; overrideRate: number | null; disposedProposals: number }

const statusVariant: StatusMap<Health> = { good: 'success', watch: 'warning', poor: 'error', new: 'neutral' }
const slaVariant: StatusMap<Sla> = { breach: 'error', risk: 'warning', ok: 'success' }
const NEEDS_ATTENTION_PAGE_SIZE = 20

// Rolling windows supported by /metrics/overview and /metrics/agents.
type OverviewWindowKey = '24h' | '7d' | '30d'
const WINDOW_KEYS: readonly OverviewWindowKey[] = ['24h', '7d', '30d'] as const
const WINDOW_LABEL_KEY: Record<OverviewWindowKey, string> = {
  '24h': 'agent_orchestrator.overview.window.h24',
  '7d': 'agent_orchestrator.overview.window.d7',
  '30d': 'agent_orchestrator.overview.window.d30',
}
function windowKeyFrom(raw: string | null): OverviewWindowKey {
  return (WINDOW_KEYS as readonly string[]).includes(raw ?? '') ? (raw as OverviewWindowKey) : '7d'
}

// Per-panel fetch outcome: forbidden and error must never masquerade as empty
// data — the SLA panel rendering "nothing stuck" on a failed fetch is a false
// all-clear.
type PanelState = 'ok' | 'forbidden' | 'error'

// SLA is derived from how long the proposal has been waiting (real, from created_at).
function slaOf(waitingMin: number | null): Sla {
  if (waitingMin != null && waitingMin > 240) return 'breach'
  if (waitingMin != null && waitingMin > 120) return 'risk'
  return 'ok'
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
function minutesAgo(value: string | null): number | null {
  if (!value) return null
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) return null
  return Math.max(0, Math.round((Date.now() - parsed) / 60000))
}
type ListFetch =
  | { ok: true; items: Array<Record<string, unknown>>; total: number }
  | { ok: false; status: number }

async function fetchList(path: string): Promise<ListFetch> {
  const call = await apiCall<ListResponse>(path, undefined, { fallback: { items: [] } })
  if (!call.ok) return { ok: false, status: call.status }
  const items = Array.isArray(call.result?.items) ? call.result!.items : []
  const total = typeof call.result?.total === 'number' ? call.result!.total : items.length
  return { ok: true, items, total }
}

function panelStateOf(res: ListFetch): PanelState {
  if (res.ok) return 'ok'
  return res.status === 403 ? 'forbidden' : 'error'
}

export default function AgentFleetOverviewPage() {
  const t = useT()
  const locale = useLocale()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [windowKey, setWindowKey] = React.useState<OverviewWindowKey>(() => windowKeyFrom(searchParams?.get('window') ?? null))
  const [metrics, setMetrics] = React.useState<OverviewMetricsView | null>(null)
  const [pendingProposals, setPendingProposals] = React.useState<ProposalView[]>([])
  const [pendingState, setPendingState] = React.useState<PanelState>('ok')
  const [pendingRuns, setPendingRuns] = React.useState<Map<string, RunView>>(new Map())
  const [agentLabels, setAgentLabels] = React.useState<Map<string, string>>(new Map())
  const [agentKinds, setAgentKinds] = React.useState<Map<string, string>>(new Map())
  const [agentIcons, setAgentIcons] = React.useState<Map<string, string | null>>(new Map())
  const [agentIds, setAgentIds] = React.useState<string[]>([])
  const [agentMetrics, setAgentMetrics] = React.useState<Map<string, AgentWindowMetrics>>(new Map())
  const [trustState, setTrustState] = React.useState<PanelState>('ok')
  const [lastLoadedAt, setLastLoadedAt] = React.useState<number | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [refreshKey, setRefreshKey] = React.useState(0)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      setError(null)
      try {
        const [overviewCall, pendingRes, agentsRes] = await Promise.all([
          apiCall<Record<string, unknown>>(`/api/agent_orchestrator/metrics/overview?window=${windowKey}`),
          fetchList(
            `/api/agent_orchestrator/proposals?disposition=pending&sortField=createdAt&sortDir=asc&pageSize=${NEEDS_ATTENTION_PAGE_SIZE}`,
          ),
          fetchList('/api/agent_orchestrator/agents'),
        ])
        if (cancelled) return
        const overview = overviewCall.ok && overviewCall.result ? mapOverviewMetrics(overviewCall.result) : null
        if (!overview) {
          setError(t('agent_orchestrator.overview.error'))
          return
        }
        const pending = pendingRes.ok
          ? pendingRes.items.map((item) => mapProposal(item)).filter((row): row is ProposalView => !!row)
          : []
        const labels = new Map<string, string>()
        const kinds = new Map<string, string>()
        const icons = new Map<string, string | null>()
        const ids: string[] = []
        if (agentsRes.ok) {
          for (const item of agentsRes.items) {
            const agent = mapAgent(item)
            if (agent) {
              labels.set(agent.id, agent.label || agent.id)
              kinds.set(agent.id, agent.resultKind)
              icons.set(agent.id, agent.icon)
              ids.push(agent.id)
            }
          }
        }
        const runIds = Array.from(new Set(pending.map((row) => row.runId)))
        // Per-agent trust metrics come from ONE batched /metrics/agents call
        // (chunked at the endpoint's 50-id cap) instead of an N+1 fan-out over
        // /agents/:id/metrics — same rollup-preferred data, one round-trip.
        const metricsChunks: string[][] = []
        for (let start = 0; start < ids.length; start += 50) metricsChunks.push(ids.slice(start, start + 50))
        const [runsRes, batchedMetrics] = await Promise.all([
          runIds.length
            ? fetchList(
                `/api/agent_orchestrator/runs?ids=${runIds.map((id) => encodeURIComponent(id)).join(',')}&pageSize=${Math.min(runIds.length, 100)}`,
              )
            : Promise.resolve<ListFetch>({ ok: true, items: [], total: 0 }),
          Promise.all(
            metricsChunks.map((chunk) =>
              apiCall<{ items?: Array<Record<string, unknown>> }>(
                `/api/agent_orchestrator/metrics/agents?window=${windowKey}&ids=${chunk.map((id) => encodeURIComponent(id)).join(',')}`,
                undefined,
                { fallback: { items: [] } },
              ),
            ),
          ),
        ])
        if (cancelled) return
        // Run enrichment is cosmetic (claim labels) — its failure degrades to
        // run-id prefixes and never flips a panel into an error state.
        const runs = new Map<string, RunView>()
        if (runsRes.ok) {
          for (const item of runsRes.items) {
            const run = mapRun(item)
            if (run) runs.set(run.id, run)
          }
        }
        const perAgent = new Map<string, AgentWindowMetrics>()
        let metricsFailure: PanelState = 'ok'
        for (const call of batchedMetrics) {
          if (!call.ok) {
            metricsFailure = call.status === 403 ? 'forbidden' : metricsFailure === 'forbidden' ? 'forbidden' : 'error'
            continue
          }
          if (!Array.isArray(call.result?.items)) continue
          for (const item of call.result.items) {
            const mapped = mapAgentWindowMetrics(item as Record<string, unknown>)
            if (!mapped) continue
            perAgent.set(mapped.agentId, {
              totalRuns: mapped.runsTotal,
              overrideRate: mapped.overrideRate,
              disposedProposals: mapped.disposedProposals,
            })
          }
        }
        setMetrics(overview)
        setPendingProposals(pending)
        setPendingState(panelStateOf(pendingRes))
        setPendingRuns(runs)
        setAgentLabels(labels)
        setAgentKinds(kinds)
        setAgentIcons(icons)
        setAgentIds(ids)
        setAgentMetrics(perAgent)
        // The trust panel needs both the registry and its metrics; surface the
        // stronger signal (forbidden beats error) when either fails.
        setTrustState(!agentsRes.ok ? panelStateOf(agentsRes) : metricsFailure)
        setLastLoadedAt(Date.now())
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : t('agent_orchestrator.overview.error'))
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [t, refreshKey, windowKey])

  // Live-refresh KPIs + needs-attention queue on any proposal lifecycle change
  // (DOM Event Bridge, tenant/org-scoped server-side), coalesced so an event
  // burst triggers at most one reload per interval.
  const triggerReload = React.useCallback(() => setRefreshKey((key) => key + 1), [])
  const coalescedReload = useCoalescedReload(triggerReload)
  useAppEvent('agent_orchestrator.proposal.*', () => {
    coalescedReload()
  })

  const changeWindow = React.useCallback(
    (value: string) => {
      const next = windowKeyFrom(value)
      setWindowKey(next)
      router.replace(`/backend/overview?window=${next}`, { scroll: false })
    },
    [router],
  )

  // Re-render every 30s so the "refreshed X ago" text stays honest without a reload.
  const [, setClockTick] = React.useState(0)
  React.useEffect(() => {
    const id = setInterval(() => setClockTick((value) => value + 1), 30_000)
    return () => clearInterval(id)
  }, [])
  const refreshedMin = lastLoadedAt == null ? null : Math.floor((Date.now() - lastLoadedAt) / 60_000)
  const windowLabel = t(WINDOW_LABEL_KEY[windowKey])

  const kpi = React.useMemo(() => {
    if (!metrics) return { autoPct: null as number | null, pendingCount: 0, oldestMin: null as number | null }
    return {
      autoPct: metrics.autoApproveRate == null ? null : Math.round(metrics.autoApproveRate * 100),
      pendingCount: metrics.pendingCount,
      oldestMin: minutesAgo(metrics.oldestPendingAt),
    }
  }, [metrics])

  const trust = React.useMemo<TrustRow[]>(() => {
    // Backed by GET /agents/:id/metrics (rollup-preferred, live fallback) so
    // large fleets read stable windows instead of a capped 100-row sample.
    return agentIds
      .map((id) => {
        const stats = agentMetrics.get(id) ?? null
        const runsCount = stats?.totalRuns ?? 0
        const overridePct = stats && stats.overrideRate != null ? Math.round(stats.overrideRate * 100) : null
        let status: Health = 'new'
        if (runsCount > 0 || (stats?.disposedProposals ?? 0) > 0) {
          if ((overridePct ?? 0) > 30) status = 'poor'
          else if ((overridePct ?? 0) > 15) status = 'watch'
          else status = 'good'
        }
        const resultKind: 'informative' | 'actionable' = agentKinds.get(id) === 'actionable' ? 'actionable' : 'informative'
        return { id, label: agentLabels.get(id) || id, icon: agentIcons.get(id) ?? null, resultKind, runs: runsCount, overridePct, status }
      })
      .sort((a, b) => b.runs - a.runs)
  }, [agentIds, agentMetrics, agentLabels, agentIcons, agentKinds])

  const stuck = React.useMemo<StuckRow[]>(() => {
    return pendingProposals
      .map((proposal) => {
        const run = pendingRuns.get(proposal.runId) ?? null
        const input = run ? asObject(run.input) : null
        const claim =
          (input && subjectRefOf(input)) ||
          proposal.runId.slice(0, 12)
        const waitingMin = minutesAgo(proposal.createdAt)
        return {
          id: proposal.id,
          processId: proposal.processId,
          claim,
          agentLabel: agentLabels.get(proposal.agentId) || proposal.agentId || '—',
          waitingMin,
          waitingFor: (agentKinds.get(proposal.agentId) === 'actionable' ? 'do' : 'review') as Verb,
          sla: slaOf(waitingMin),
        }
      })
      .sort((a, b) => (b.waitingMin ?? 0) - (a.waitingMin ?? 0))
      .slice(0, 6)
  }, [pendingProposals, pendingRuns, agentLabels, agentKinds])

  const backendChip = <PendingChip label={t('agent_orchestrator.agents.list.pending.backend', 'Needs backend')} />
  // Per-verb intervention counts need a backend taxonomy (Review/Question/Do/Notify/Know).
  // Until then these are representative demo figures so the section reads like the design.
  const interventions = [
    { key: 'review', icon: Check, count: 412, pct: 41 },
    { key: 'question', icon: FileSearch, count: 188, pct: 18 },
    { key: 'do', icon: Zap, count: 96, pct: 10 },
    { key: 'notify', icon: Bell, count: 61, pct: 6 },
    { key: 'know', icon: BookOpen, count: 53, pct: 5 },
  ] as const

  const dispositionTotal = metrics
    ? Object.values(metrics.dispositionCounts).reduce((sum, count) => sum + count, 0)
    : 0
  const empty = !isLoading && !error && (!metrics || (metrics.runsTotal === 0 && dispositionTotal === 0))

  return (
    <Page>
      <PageBody className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">{t('agent_orchestrator.overview.title', 'Fleet overview')}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <ContextChip>
                {t('agent_orchestrator.overview.processesHandled', '{count} processes handled', { count: formatNumber(metrics?.runsTotal ?? 0, locale) ?? '0' })}
                <span className="ml-1 text-muted-foreground/70">· {windowLabel}</span>
              </ContextChip>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {metrics?.source === 'live' ? (
              <span className="hidden text-xs text-muted-foreground sm:inline">{t('agent_orchestrator.overview.liveSource', 'Live figures — rollups not computed yet')}</span>
            ) : null}
            {refreshedMin != null ? (
              <span className="hidden text-xs text-muted-foreground sm:inline">
                {refreshedMin < 1
                  ? t('agent_orchestrator.overview.refreshedJustNow', 'Updated just now')
                  : t('agent_orchestrator.overview.refreshedAt', 'Updated {time} ago', { time: formatWaitMinutes(refreshedMin) ?? '—' })}
              </span>
            ) : null}
            <Button variant="outline" size="sm" aria-label={t('agent_orchestrator.overview.refresh', 'Refresh')} onClick={() => setRefreshKey((value) => value + 1)}>
              <RotateCw className="size-4" />
            </Button>
            <Select value={windowKey} onValueChange={changeWindow}>
              <SelectTrigger className="h-9 w-auto min-w-36" aria-label={t('agent_orchestrator.overview.window.select', 'Time window')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WINDOW_KEYS.map((key) => (
                  <SelectItem key={key} value={key}>
                    {t(WINDOW_LABEL_KEY[key])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {isLoading ? (
          <LoadingMessage label={t('agent_orchestrator.overview.title', 'Fleet overview')} />
        ) : error ? (
          <ErrorMessage label={error} />
        ) : empty ? (
          <EmptyState
            title={t('agent_orchestrator.overview.empty')}
            description={t('agent_orchestrator.overview.emptyDescription')}
          />
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <KpiTile icon={CheckCircle2}
                label={t('agent_orchestrator.overview.kpi.autoCompleted', 'Auto-completed')}
                caption={windowLabel}
                value={kpi.autoPct == null ? <PendingChip label={t('agent_orchestrator.agents.list.pending.noData', 'No data')} /> : `${kpi.autoPct}%`}
                sub={t('agent_orchestrator.overview.kpi.autoCompletedSub', 'Cleared with no human touch')} />
              <KpiTile icon={ClipboardList}
                label={t('agent_orchestrator.overview.kpi.needsDecision', 'Needs a decision')}
                caption={t('agent_orchestrator.overview.window.now', 'now')}
                value={formatNumber(kpi.pendingCount, locale) ?? '0'}
                chip={kpi.oldestMin == null ? null : <OldestChip>{t('agent_orchestrator.overview.kpi.oldest', 'oldest {time}', { time: formatWaitMinutes(kpi.oldestMin) ?? '—' })}</OldestChip>}
                sub={t('agent_orchestrator.overview.kpi.needsDecisionSub', 'Waiting in the inbox now')} />
              <KpiTile icon={Users}
                label={t('agent_orchestrator.overview.kpi.operatorRatio', 'Operator ratio')}
                value={backendChip}
                sub={t('agent_orchestrator.overview.kpi.operatorRatioSub', 'Processes per supervisor')} />
              <KpiTile icon={Clock}
                label={t('agent_orchestrator.overview.kpi.slaBreaches', 'SLA breaches')}
                value={backendChip}
                sub={t('agent_orchestrator.overview.kpi.slaBreachesSub', 'Over 4h since reroute')} />
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
              <Panel className="lg:col-span-3" title={t('agent_orchestrator.overview.stuck.title', 'Stuck & breaching')} caption={t('agent_orchestrator.overview.window.now', 'now')} viewAll={t('agent_orchestrator.overview.viewAll', 'View all')} onViewAll={() => router.push('/backend/caseload')}>
                {pendingState !== 'ok' ? (
                  <PanelNote state={pendingState} onRetry={triggerReload} />
                ) : stuck.length === 0 ? (
                  <p className="px-2 py-6 text-center text-sm text-muted-foreground">{t('agent_orchestrator.overview.stuck.empty', 'Nothing stuck right now')}</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs text-muted-foreground">
                        <th className="px-2 py-2 font-medium">{t('agent_orchestrator.overview.stuck.col.id', 'ID')}</th>
                        <th className="px-2 py-2 font-medium">{t('agent_orchestrator.overview.stuck.col.process', 'Process')}</th>
                        <th className="px-2 py-2 font-medium">{t('agent_orchestrator.overview.stuck.col.agent', 'Agent')}</th>
                        <th className="px-2 py-2 font-medium">{t('agent_orchestrator.overview.stuck.col.waitingFor', 'Waiting for')}</th>
                        <th className="px-2 py-2 text-right font-medium">{t('agent_orchestrator.overview.stuck.col.waitingTime', 'Waiting time')}</th>
                        <th className="px-2 py-2 font-medium">{t('agent_orchestrator.overview.stuck.col.sla', 'SLA')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stuck.map((row) => (
                        <tr
                          key={row.id}
                          tabIndex={0}
                          role="link"
                          aria-label={t('agent_orchestrator.overview.stuck.openRow', undefined, { id: row.claim })}
                          className="cursor-pointer border-b border-border last:border-0 hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none"
                          onClick={() => router.push(`/backend/caseload/${encodeURIComponent(row.id)}`)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              router.push(`/backend/caseload/${encodeURIComponent(row.id)}`)
                            }
                          }}
                        >
                          <td className="px-2 py-2.5 font-mono text-xs text-foreground">{row.claim}</td>
                          <td className="px-2 py-2.5">
                            {row.processId ? (
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  router.push(`/backend/processes/${encodeURIComponent(row.processId!)}`)
                                }}
                                className="inline-flex items-center gap-1 text-xs font-medium text-brand-violet transition-opacity hover:opacity-80"
                              >
                                <Workflow className="size-3.5" />
                                {t('agent_orchestrator.proposal.openProcess', 'Open process')}
                              </button>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-2 py-2.5 text-foreground">{row.agentLabel}</td>
                          <td className="px-2 py-2.5 text-foreground">{t(`agent_orchestrator.overview.interventions.${row.waitingFor}`, titleCase(row.waitingFor))}</td>
                          <td className="px-2 py-2.5 text-right tabular-nums text-muted-foreground">{formatWaitMinutes(row.waitingMin) ?? '—'}</td>
                          <td className="px-2 py-2.5">
                            <StatusBadge variant={slaVariant[row.sla]} dot>
                              {t(`agent_orchestrator.overview.stuck.sla.${row.sla}`, titleCase(row.sla))}
                            </StatusBadge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Panel>

              <Panel className="lg:col-span-2" title={t('agent_orchestrator.overview.trust.title', 'Agent trust')} caption={windowLabel} viewAll={t('agent_orchestrator.overview.viewAll', 'View all')} onViewAll={() => router.push('/backend/agents')}>
                {trustState !== 'ok' ? (
                  <PanelNote state={trustState} onRetry={triggerReload} />
                ) : trust.length === 0 ? (
                  <p className="px-2 py-6 text-center text-sm text-muted-foreground">{t('agent_orchestrator.overview.trust.empty', 'No agents yet')}</p>
                ) : (
                  <table className="w-full table-fixed text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs text-muted-foreground">
                        <th className="px-2 py-2 font-medium">{t('agent_orchestrator.overview.trust.col.agent', 'Agent')}</th>
                        <th className="w-16 px-2 py-2 text-right font-medium">{t('agent_orchestrator.overview.trust.col.runs', 'Runs')}</th>
                        <th className="w-28 px-2 py-2 font-medium">{t('agent_orchestrator.overview.trust.col.override', 'Override')}</th>
                        <th className="w-20 px-2 py-2 font-medium">{t('agent_orchestrator.overview.trust.col.status', 'Status')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {trust.map((row) => (
                        <tr
                          key={row.id}
                          tabIndex={0}
                          role="link"
                          aria-label={t('agent_orchestrator.overview.trust.openRow', undefined, { id: row.id })}
                          className="cursor-pointer border-b border-border last:border-0 hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none"
                          onClick={() => router.push(`/backend/agents/${encodeURIComponent(row.id)}`)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              router.push(`/backend/agents/${encodeURIComponent(row.id)}`)
                            }
                          }}
                        >
                          <td className="px-2 py-2.5">
                            <div className="flex items-center gap-2.5">
                              <Avatar label={row.label} size="sm" variant="monochrome" icon={agentAvatarIcon(row.icon, row.resultKind)} />
                              <div className="min-w-0">
                                <div className="truncate text-sm font-medium text-foreground">{row.label}</div>
                                <div className="truncate font-mono text-xs text-muted-foreground">{row.id}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-2 py-2.5 text-right tabular-nums text-foreground">{formatNumber(row.runs, locale) ?? '0'}</td>
                          <td className="px-2 py-2.5"><OverrideMeter pct={row.overridePct} /></td>
                          <td className="px-2 py-2.5">
                            <StatusBadge variant={statusVariant[row.status]} dot>
                              {t(`agent_orchestrator.agents.list.status.${row.status}`, row.status)}
                            </StatusBadge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Panel>
            </div>

            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <div className="text-sm font-semibold text-foreground">{t('agent_orchestrator.overview.interventions.title', 'Where humans stepped in')}</div>
                  <span className="rounded-md border border-border bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
                    {t('agent_orchestrator.common.sample', 'Sample')}
                  </span>
                  <span
                    className="inline-flex"
                    title={t('agent_orchestrator.overview.interventions.sampleHint')}
                    aria-label={t('agent_orchestrator.overview.interventions.sampleHint')}
                  >
                    <Info className="size-3.5 text-muted-foreground" aria-hidden />
                  </span>
                </div>
                <button type="button" onClick={() => router.push('/backend/audit')} className="inline-flex items-center gap-1 text-xs font-medium text-brand-violet transition-opacity hover:opacity-80">
                  {t('agent_orchestrator.overview.viewAll', 'View all')}
                  <ArrowRight className="size-3.5" />
                </button>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {interventions.map(({ key, icon: Icon, count, pct }) => (
                  <div key={key} className="rounded-lg border border-border bg-card p-3.5">
                    <div className="flex items-start gap-2.5">
                      <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                        <Icon className="size-4" />
                      </span>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-foreground">{t(`agent_orchestrator.overview.interventions.${key}`, titleCase(key))}</div>
                        <div className="truncate text-xs text-muted-foreground">{t(`agent_orchestrator.overview.interventions.${key}Sub`, '')}</div>
                      </div>
                    </div>
                    <div className="mt-3 text-3xl font-bold tabular-nums tracking-tight text-foreground">{formatNumber(count, locale) ?? '0'}</div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      <span className="font-semibold text-foreground">{pct}%</span> {t('agent_orchestrator.overview.interventions.ofTotal', 'of all interventions')}
                    </p>
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-brand-violet" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </PageBody>
    </Page>
  )
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function KpiTile({ icon: Icon, label, caption, value, chip, sub }: { icon: React.ComponentType<{ className?: string }>; label: string; caption?: string; value: React.ReactNode; chip?: React.ReactNode; sub: string }) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {label}
          {caption ? <span className="ml-1.5 text-xs text-muted-foreground/70">· {caption}</span> : null}
        </p>
        <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-brand-violet">
          <Icon className="size-4" />
        </span>
      </div>
      <div className="mt-2 flex min-h-9 items-center gap-2">
        <span className="text-3xl font-bold tabular-nums tracking-tight text-foreground">{value}</span>
        {chip}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
      <div className="absolute inset-x-0 bottom-0 h-1 bg-gradient-to-r from-brand-lime via-brand-lime to-brand-violet" />
    </div>
  )
}

function ContextChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-muted-foreground">
      {children}
    </span>
  )
}

function OldestChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md bg-status-warning-bg px-2 py-0.5 text-xs font-medium text-status-warning-text">
      {children}
    </span>
  )
}

function Panel({ title, caption, viewAll, onViewAll, children, className }: { title: string; caption?: string; viewAll: string; onViewAll: () => void; children: React.ReactNode; className?: string }) {
  return (
    <div className={`overflow-hidden rounded-xl border border-border bg-card${className ? ` ${className}` : ''}`}>
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="text-sm font-semibold text-foreground">
          {title}
          {caption ? <span className="ml-1.5 text-xs font-normal text-muted-foreground/70">· {caption}</span> : null}
        </div>
        <button type="button" onClick={onViewAll} className="inline-flex items-center gap-1 text-xs font-medium text-brand-violet transition-opacity hover:opacity-80">
          {viewAll}
          <ArrowRight className="size-3.5" />
        </button>
      </div>
      <div className="p-2">{children}</div>
    </div>
  )
}

/**
 * Honest panel failure states: a 403 must read as "no access", a fetch failure
 * as an error with retry — never as an empty (all-clear) dataset.
 */
function PanelNote({ state, onRetry }: { state: Exclude<PanelState, 'ok'>; onRetry: () => void }) {
  const t = useT()
  if (state === 'forbidden') {
    return (
      <p className="px-2 py-6 text-center text-sm text-muted-foreground">
        {t('agent_orchestrator.overview.panel.forbidden', "You don't have access to this data.")}
      </p>
    )
  }
  return (
    <div className="flex flex-col items-center gap-2 px-2 py-6 text-center">
      <p className="text-sm text-status-error-text">{t('agent_orchestrator.overview.panel.error', "Couldn't load this panel.")}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        {t('agent_orchestrator.overview.panel.retry', 'Retry')}
      </Button>
    </div>
  )
}

function PendingChip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-md border border-dashed border-border bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground">
      {label}
    </span>
  )
}

// Segmented "barcode" meter: filled ticks sample the OM brand gradient (lime -> yellow ->
// violet) so higher override shifts toward yellow; remaining ticks are muted.
function OverrideMeter({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-xs text-muted-foreground">—</span>
  const total = 16
  const step = 3
  const filled = pct === 0 ? 0 : Math.max(1, Math.min(total, Math.round((pct / 100) * total)))
  return (
    <div className="flex items-center gap-2">
      <span className="w-8 shrink-0 text-xs tabular-nums text-foreground">{pct}%</span>
      <div className="flex items-end gap-px">
        {Array.from({ length: total }).map((_, index) => (
          <div
            key={index}
            className="h-3.5 w-0.5 rounded-sm"
            style={index < filled ? {
              backgroundImage: 'linear-gradient(90deg, var(--brand-lime), var(--brand-yellow), var(--brand-violet))',
              backgroundSize: `${total * step}px 100%`,
              backgroundPosition: `${-(index * step)}px 0`,
            } : { backgroundColor: 'var(--border)' }}
          />
        ))}
      </div>
    </div>
  )
}
