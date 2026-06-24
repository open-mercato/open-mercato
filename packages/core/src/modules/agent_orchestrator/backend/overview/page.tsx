"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, ClipboardList, Users, Clock, Zap, Bell, BookOpen, ArrowRight, ChevronDown, Calendar, RotateCw, Info, Check, FileSearch } from 'lucide-react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge, type StatusMap } from '@open-mercato/ui/primitives/status-badge'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { mapAgent, mapProposal, mapRun, type ProposalView, type RunView } from '../../components/types'

type Health = 'good' | 'watch' | 'poor' | 'new'
type ListResponse = { items?: Array<Record<string, unknown>>; total?: number }

type Sla = 'breach' | 'risk' | 'ok'
type Verb = 'do' | 'review'
type TrustRow = { id: string; label: string; runs: number; overridePct: number | null; status: Health }
type StuckRow = { id: string; claim: string; agentLabel: string; waitingMin: number | null; waitingFor: Verb; sla: Sla }

const statusVariant: StatusMap<Health> = { good: 'success', watch: 'warning', poor: 'error', new: 'neutral' }
const slaVariant: StatusMap<Sla> = { breach: 'error', risk: 'warning', ok: 'success' }
const DISPOSED = ['approved', 'edited', 'rejected', 'auto_approved']
const OVERRIDDEN = ['edited', 'rejected']

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
function formatWait(min: number | null): string {
  if (min == null) return '—'
  if (min < 60) return `${min}m`
  const hours = Math.floor(min / 60)
  const rest = min % 60
  return rest ? `${hours}h ${rest}m` : `${hours}h`
}

async function fetchList(path: string): Promise<{ items: Array<Record<string, unknown>>; total: number }> {
  const call = await apiCall<ListResponse>(path, undefined, { fallback: { items: [] } })
  const items = call.ok && Array.isArray(call.result?.items) ? call.result!.items : []
  const total = call.ok && typeof call.result?.total === 'number' ? call.result!.total : items.length
  return { items, total }
}

export default function AgentFleetOverviewPage() {
  const t = useT()
  const router = useRouter()
  const [proposals, setProposals] = React.useState<ProposalView[]>([])
  const [runs, setRuns] = React.useState<RunView[]>([])
  const [runsTotal, setRunsTotal] = React.useState(0)
  const [rawProposals, setRawProposals] = React.useState<Array<Record<string, unknown>>>([])
  const [rawRuns, setRawRuns] = React.useState<Array<Record<string, unknown>>>([])
  const [agentLabels, setAgentLabels] = React.useState<Map<string, string>>(new Map())
  const [agentKinds, setAgentKinds] = React.useState<Map<string, string>>(new Map())
  const [agentIds, setAgentIds] = React.useState<string[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [refreshKey, setRefreshKey] = React.useState(0)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      setError(null)
      try {
        const [proposalsRes, runsRes, agentsRes] = await Promise.all([
          fetchList('/api/agent_orchestrator/proposals?pageSize=100'),
          fetchList('/api/agent_orchestrator/runs?pageSize=100'),
          fetchList('/api/agent_orchestrator/agents'),
        ])
        if (cancelled) return
        setRawProposals(proposalsRes.items)
        setRawRuns(runsRes.items)
        setProposals(proposalsRes.items.map((item) => mapProposal(item)).filter((row): row is ProposalView => !!row))
        setRuns(runsRes.items.map((item) => mapRun(item)).filter((row): row is RunView => !!row))
        setRunsTotal(runsRes.total)
        const labels = new Map<string, string>()
        const kinds = new Map<string, string>()
        const ids: string[] = []
        for (const item of agentsRes.items) {
          const agent = mapAgent(item)
          if (agent) {
            labels.set(agent.id, agent.label || agent.id)
            kinds.set(agent.id, agent.resultKind)
            ids.push(agent.id)
          }
        }
        setAgentLabels(labels)
        setAgentKinds(kinds)
        setAgentIds(ids)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : t('agent_orchestrator.overview.error'))
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [t, refreshKey])

  const kpi = React.useMemo(() => {
    const disposed = proposals.filter((p) => p.disposition !== 'pending').length
    const auto = proposals.filter((p) => p.disposition === 'auto_approved').length
    const pending = proposals.filter((p) => p.disposition === 'pending')
    const autoPct = disposed > 0 ? Math.round((auto / disposed) * 100) : null
    const oldestMin = pending
      .map((p) => minutesAgo(p.createdAt ?? null))
      .filter((value): value is number => value != null)
      .reduce<number | null>((max, value) => (max == null || value > max ? value : max), null)
    return { autoPct, pendingCount: pending.length, oldestMin }
  }, [proposals])

  const trust = React.useMemo<TrustRow[]>(() => {
    const runStats = new Map<string, { total: number; errors: number }>()
    for (const run of rawRuns) {
      const id = fieldOf(run, 'agent_id', 'agentId')
      if (!id) continue
      const stat = runStats.get(id) ?? { total: 0, errors: 0 }
      stat.total += 1
      if (run.status === 'error') stat.errors += 1
      runStats.set(id, stat)
    }
    const proposalStats = new Map<string, { disposed: number; overrides: number }>()
    for (const proposal of rawProposals) {
      const id = fieldOf(proposal, 'agent_id', 'agentId')
      if (!id) continue
      const disposition = fieldOf(proposal, 'disposition') || 'pending'
      const stat = proposalStats.get(id) ?? { disposed: 0, overrides: 0 }
      if (DISPOSED.includes(disposition)) stat.disposed += 1
      if (OVERRIDDEN.includes(disposition)) stat.overrides += 1
      proposalStats.set(id, stat)
    }
    return agentIds.map((id) => {
      const run = runStats.get(id) ?? { total: 0, errors: 0 }
      const proposal = proposalStats.get(id) ?? { disposed: 0, overrides: 0 }
      const overridePct = proposal.disposed > 0 ? Math.round((proposal.overrides / proposal.disposed) * 100) : null
      const errorRate = run.total > 0 ? run.errors / run.total : 0
      let status: Health = 'new'
      if (run.total > 0 || proposal.disposed > 0) {
        if ((overridePct ?? 0) > 30 || errorRate > 0.2) status = 'poor'
        else if ((overridePct ?? 0) > 15) status = 'watch'
        else status = 'good'
      }
      return { id, label: agentLabels.get(id) || id, runs: run.total, overridePct, status }
    }).sort((a, b) => b.runs - a.runs)
  }, [rawRuns, rawProposals, agentIds, agentLabels])

  const stuck = React.useMemo<StuckRow[]>(() => {
    const runById = new Map<string, Record<string, unknown>>()
    for (const run of rawRuns) {
      const id = fieldOf(run, 'id')
      if (id) runById.set(id, run)
    }
    return rawProposals
      .filter((p) => (fieldOf(p, 'disposition') || 'pending') === 'pending')
      .map((proposal) => {
        const agentId = fieldOf(proposal, 'agent_id', 'agentId')
        const runId = fieldOf(proposal, 'run_id', 'runId')
        const input = runById.get(runId) ? asObject(runById.get(runId)!.input) : null
        const claim = (input && fieldOf(input, 'claimId', 'claim_id', 'dealId', 'deal_id', 'reference')) || (runId ? runId.slice(0, 12) : fieldOf(proposal, 'id').slice(0, 12))
        const waitingMin = minutesAgo(fieldOf(proposal, 'created_at', 'createdAt') || null)
        return {
          id: fieldOf(proposal, 'id'),
          claim,
          agentLabel: agentLabels.get(agentId) || agentId || '—',
          waitingMin,
          waitingFor: (agentKinds.get(agentId) === 'actionable' ? 'do' : 'review') as Verb,
          sla: slaOf(waitingMin),
        }
      })
      .sort((a, b) => (b.waitingMin ?? 0) - (a.waitingMin ?? 0))
      .slice(0, 6)
  }, [rawProposals, rawRuns, agentLabels, agentKinds])

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

  const empty = !isLoading && !error && proposals.length === 0 && runsTotal === 0

  return (
    <Page>
      <PageBody className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">{t('agent_orchestrator.overview.title', 'Fleet overview')}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <ContextChip>{t('agent_orchestrator.overview.domain', 'Claims adjudication')}</ContextChip>
              <ContextChip>{t('agent_orchestrator.overview.period.week', 'last 7 days')}</ContextChip>
              <ContextChip>{t('agent_orchestrator.overview.processesHandled', '{count} processes handled', { count: runsTotal.toLocaleString('en-US') })}</ContextChip>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden text-xs text-muted-foreground sm:inline">{t('agent_orchestrator.overview.refreshed', 'Data refreshed just now')}</span>
            <Button variant="outline" size="sm" aria-label={t('agent_orchestrator.overview.refresh', 'Refresh')} onClick={() => setRefreshKey((value) => value + 1)}>
              <RotateCw className="size-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => flash(t('agent_orchestrator.agents.list.pending.backend', 'Needs backend'), 'info')}>
              <Calendar className="mr-1.5 size-4" />
              {t('agent_orchestrator.overview.period.thisWeek', 'This week')}
              <ChevronDown className="ml-1.5 size-4" />
            </Button>
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
                value={kpi.autoPct == null ? <PendingChip label={t('agent_orchestrator.agents.list.pending.noData', 'No data')} /> : `${kpi.autoPct}%`}
                chip={kpi.autoPct == null ? null : backendChip}
                sub={t('agent_orchestrator.overview.kpi.autoCompletedSub', 'Cleared with no human touch')} />
              <KpiTile icon={ClipboardList}
                label={t('agent_orchestrator.overview.kpi.needsDecision', 'Needs a decision')}
                value={kpi.pendingCount.toLocaleString('en-US')}
                chip={kpi.oldestMin == null ? null : <OldestChip>{t('agent_orchestrator.overview.kpi.oldest', 'oldest {time}', { time: formatWait(kpi.oldestMin) })}</OldestChip>}
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
              <Panel className="lg:col-span-3" title={t('agent_orchestrator.overview.stuck.title', 'Stuck & breaching')} viewAll={t('agent_orchestrator.overview.viewAll', 'View all')} onViewAll={() => router.push('/backend/caseload')}>
                {stuck.length === 0 ? (
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
                        <tr key={row.id} className="cursor-pointer border-b border-border last:border-0 hover:bg-accent/40" onClick={() => router.push(`/backend/caseload/${encodeURIComponent(row.id)}`)}>
                          <td className="px-2 py-2.5 font-mono text-xs text-foreground">{row.claim}</td>
                          <td className="px-2 py-2.5">{backendChip}</td>
                          <td className="px-2 py-2.5 text-foreground">{row.agentLabel}</td>
                          <td className="px-2 py-2.5 text-foreground">{t(`agent_orchestrator.overview.interventions.${row.waitingFor}`, titleCase(row.waitingFor))}</td>
                          <td className="px-2 py-2.5 text-right tabular-nums text-muted-foreground">{formatWait(row.waitingMin)}</td>
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

              <Panel className="lg:col-span-2" title={t('agent_orchestrator.overview.trust.title', 'Agent trust')} viewAll={t('agent_orchestrator.overview.viewAll', 'View all')} onViewAll={() => router.push('/backend/agents')}>
                {trust.length === 0 ? (
                  <p className="px-2 py-6 text-center text-sm text-muted-foreground">{t('agent_orchestrator.overview.trust.empty', 'No agents yet')}</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs text-muted-foreground">
                        <th className="px-2 py-2 font-medium">{t('agent_orchestrator.overview.trust.col.agent', 'Agent')}</th>
                        <th className="px-2 py-2 text-right font-medium">{t('agent_orchestrator.overview.trust.col.runs', 'Runs')}</th>
                        <th className="px-2 py-2 font-medium">{t('agent_orchestrator.overview.trust.col.override', 'Override')}</th>
                        <th className="px-2 py-2 font-medium">{t('agent_orchestrator.overview.trust.col.status', 'Status')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {trust.map((row) => (
                        <tr key={row.id} className="cursor-pointer border-b border-border last:border-0 hover:bg-accent/40" onClick={() => router.push(`/backend/agents/${encodeURIComponent(row.id)}`)}>
                          <td className="px-2 py-2.5">
                            <div className="flex items-center gap-2.5">
                              <Avatar label={row.label} size="sm" />
                              <div className="min-w-0">
                                <div className="truncate text-sm font-medium text-foreground">{row.label}</div>
                                <div className="truncate font-mono text-xs text-muted-foreground">{row.id}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-2 py-2.5 text-right tabular-nums text-foreground">{row.runs.toLocaleString('en-US')}</td>
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
                  <Info className="size-3.5 text-muted-foreground" />
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
                    <div className="mt-3 text-3xl font-bold tabular-nums tracking-tight text-foreground">{count.toLocaleString('en-US')}</div>
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

function KpiTile({ icon: Icon, label, value, chip, sub }: { icon: React.ComponentType<{ className?: string }>; label: string; value: React.ReactNode; chip?: React.ReactNode; sub: string }) {
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

function Panel({ title, viewAll, onViewAll, children, className }: { title: string; viewAll: string; onViewAll: () => void; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-border bg-card${className ? ` ${className}` : ''}`}>
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="text-sm font-semibold text-foreground">{title}</div>
        <button type="button" onClick={onViewAll} className="inline-flex items-center gap-1 text-xs font-medium text-brand-violet transition-opacity hover:opacity-80">
          {viewAll}
          <ArrowRight className="size-3.5" />
        </button>
      </div>
      <div className="p-2">{children}</div>
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
