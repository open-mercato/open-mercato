"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Brain, CircleCheck, Clock, Coins, Copy, Cpu, Hash, Info, Replace, SlidersHorizontal, TriangleAlert } from 'lucide-react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { StatusBadge, type StatusMap } from '@open-mercato/ui/primitives/status-badge'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { ConfidenceFaceValue } from '../../../components/cockpitStatus'
import { LoadingMessage, ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { apiCall, apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT, useLocale } from '@open-mercato/shared/lib/i18n/context'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription, DrawerBody, DrawerFooter, DrawerClose } from '@open-mercato/ui/primitives/drawer'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import {
  mapAgentDetail,
  mapAgentWindowMetrics,
  formatCostMinor,
  formatNumber,
  formatTimeShort,
  type AgentDetailView,
  type SkillDetailView,
  type AgentWindowMetricsView,
} from '../../../components/types'
import { subjectRefOf } from '../../../components/subjectRef'
import { SkillDrawer } from '../../../components/SkillDrawer'
import { agentAvatarIcon, resolveAgentIcon } from '../../../components/agentChips'
import { AGENT_ICON_NAMES } from '../../../data/agentIcons'

type PageState = 'loading' | 'notFound' | 'forbidden' | 'error' | 'ready'
type Autonomy = 'auto' | 'review' | 'gated'
type Health = 'good' | 'watch' | 'poor' | 'new'
type Outcome = 'overridden' | 'applied' | 'pending' | 'failed'

type RunRow = {
  id: string
  claim: string
  decision: string
  confidence: number | null
  outcome: Outcome
  when: string | null
}

const statusVariant: StatusMap<Health> = { good: 'success', watch: 'warning', poor: 'error', new: 'neutral' }
const outcomeVariant: Record<Outcome, 'success' | 'error' | 'neutral'> = {
  applied: 'success',
  overridden: 'error',
  failed: 'error',
  pending: 'neutral',
}
const DISPOSED = ['approved', 'edited', 'rejected', 'auto_approved']
const OVERRIDDEN = ['edited', 'rejected']

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}
function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}
function fieldOf(item: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const v = asString(item[key])
    if (v) return v
  }
  return ''
}


async function fetchItems(path: string): Promise<Array<Record<string, unknown>>> {
  const call = await apiCall<{ items?: Array<Record<string, unknown>> }>(path, undefined, { fallback: { items: [] } })
  if (!call.ok || !Array.isArray(call.result?.items)) return []
  return call.result.items
}

export default function AgentDetailPage({ params }: { params?: { id?: string } }) {
  const t = useT()
  const locale = useLocale()
  const router = useRouter()
  const agentId = params?.id ?? ''

  const [state, setState] = React.useState<PageState>('loading')
  const [agent, setAgent] = React.useState<AgentDetailView | null>(null)
  const [runs, setRuns] = React.useState<Array<Record<string, unknown>>>([])
  const [proposals, setProposals] = React.useState<Array<Record<string, unknown>>>([])
  const [activeSkill, setActiveSkill] = React.useState<SkillDetailView | null>(null)
  const [autonomy, setAutonomy] = React.useState<Autonomy>('review')
  const [configOpen, setConfigOpen] = React.useState(false)
  const [windowMetrics, setWindowMetrics] = React.useState<AgentWindowMetricsView | null>(null)
  const [reloadKey, setReloadKey] = React.useState(0)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setState('loading')
      const call = await apiCall<Record<string, unknown>>(`/api/agent_orchestrator/agents/${encodeURIComponent(agentId)}`)
      if (cancelled) return
      if (!call.ok) {
        if (call.status === 404) setState('notFound')
        else if (call.status === 403) setState('forbidden')
        else setState('error')
        return
      }
      const mapped = call.result ? mapAgentDetail(call.result) : null
      if (!mapped) {
        setState('notFound')
        return
      }
      // UI heuristic until the backend exposes a real autonomy setting.
      setAutonomy(mapped.resultKind === 'informative' ? 'auto' : 'review')
      const [runItems, proposalItems, metricsCall] = await Promise.all([
        fetchItems(`/api/agent_orchestrator/runs?agentId=${encodeURIComponent(agentId)}&pageSize=100`),
        fetchItems(`/api/agent_orchestrator/proposals?agentId=${encodeURIComponent(agentId)}&pageSize=100`),
        // Windowed KPIs from the batch metrics endpoint (rollup-preferred) —
        // same gate as this page (`agents.view`), single-id batch.
        apiCall<{ items?: Array<Record<string, unknown>> }>(
          `/api/agent_orchestrator/metrics/agents?window=7d&ids=${encodeURIComponent(agentId)}`,
          undefined,
          { fallback: { items: [] } },
        ),
      ])
      if (cancelled) return
      setAgent(mapped)
      setRuns(runItems)
      setProposals(proposalItems)
      const metricsItem =
        metricsCall.ok && Array.isArray(metricsCall.result?.items) && metricsCall.result.items[0]
          ? mapAgentWindowMetrics(metricsCall.result.items[0] as Record<string, unknown>)
          : null
      setWindowMetrics(metricsItem)
      setState('ready')
    }
    if (agentId) load()
    else setState('notFound')
    return () => {
      cancelled = true
    }
  }, [agentId, reloadKey])

  const ICON_DEFAULT = '__default__'
  const { runMutation, retryLastMutation } = useGuardedMutation<{ retryLastMutation: () => Promise<boolean> }>({
    contextId: 'agent_orchestrator.agents.detail',
    blockedMessage: t('agent_orchestrator.proposal.flash.blocked'),
  })
  const [savingIcon, setSavingIcon] = React.useState(false)

  const updateIcon = React.useCallback(
    async (value: string) => {
      if (!agent) return
      const nextIcon = value === ICON_DEFAULT ? null : value
      if (nextIcon === (agent.icon ?? null)) return
      setSavingIcon(true)
      try {
        let saved: { icon: string | null; updatedAt: string } | null = null
        await runMutation({
          operation: () =>
            withScopedApiRequestHeaders(buildOptimisticLockHeader(agent.iconUpdatedAt), async () => {
              const call = await apiCallOrThrow<{ icon: string | null; updatedAt: string }>(
                `/api/agent_orchestrator/agents/${encodeURIComponent(agent.id)}/settings`,
                {
                  method: 'PUT',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ icon: nextIcon, updatedAt: agent.iconUpdatedAt }),
                },
              )
              saved = call.result ?? null
            }),
          context: { retryLastMutation },
          mutationPayload: { icon: nextIcon },
        })
        setAgent((prev) =>
          prev && saved ? { ...prev, icon: saved.icon as AgentDetailView['icon'], iconUpdatedAt: saved.updatedAt } : prev,
        )
        flash(t('agent_orchestrator.agentDetail.icon.saved', 'Icon updated'), 'success')
      } catch (err) {
        if (surfaceRecordConflict(err, t)) {
          setReloadKey((key) => key + 1)
          return
        }
        flash(err instanceof Error ? err.message : t('agent_orchestrator.agentDetail.icon.error', 'Could not update icon'), 'error')
      } finally {
        setSavingIcon(false)
      }
    },
    [agent, runMutation, retryLastMutation, t],
  )

  const metrics = React.useMemo(() => {
    const proposalByRun = new Map<string, Record<string, unknown>>()
    let disposed = 0
    let overrides = 0
    let pending = 0
    for (const proposal of proposals) {
      const runId = fieldOf(proposal, 'run_id', 'runId')
      if (runId) proposalByRun.set(runId, proposal)
      const disposition = fieldOf(proposal, 'disposition') || 'pending'
      if (disposition === 'pending') pending += 1
      if (DISPOSED.includes(disposition)) disposed += 1
      if (OVERRIDDEN.includes(disposition)) overrides += 1
    }
    const overrideRate = disposed > 0 ? overrides / disposed : null
    const errors = runs.filter((run) => run.status === 'error').length
    const errorRate = runs.length > 0 ? errors / runs.length : 0
    let status: Health = 'new'
    if (runs.length > 0 || disposed > 0) {
      if ((overrideRate ?? 0) > 0.3 || errorRate > 0.2) status = 'poor'
      else if ((overrideRate ?? 0) > 0.15) status = 'watch'
      else status = 'good'
    }

    const sortedRuns = [...runs].sort((a, b) => Date.parse(fieldOf(b, 'created_at', 'createdAt') || '') - Date.parse(fieldOf(a, 'created_at', 'createdAt') || ''))
    const lastActive = formatTimeShort(fieldOf(sortedRuns[0] ?? {}, 'created_at', 'createdAt') || null) ?? ''
    const recent: RunRow[] = sortedRuns.slice(0, 6).map((run) => {
      const runId = fieldOf(run, 'id')
      const input = asObject(run.input)
      const proposal = proposalByRun.get(runId)
      const payload = proposal ? asObject(proposal.payload) : null
      const disposition = proposal ? fieldOf(proposal, 'disposition') || 'pending' : 'pending'
      let outcome: Outcome = 'pending'
      if (run.status === 'error') outcome = 'failed'
      else if (OVERRIDDEN.includes(disposition)) outcome = 'overridden'
      else if (disposition === 'approved' || disposition === 'auto_approved') outcome = 'applied'
      return {
        id: runId,
        claim: (input && subjectRefOf(input)) || runId.slice(0, 12),
        decision: (payload && fieldOf(payload, 'decision', 'action', 'label')) || fieldOf(run, 'result_kind', 'resultKind') || '—',
        confidence: proposal ? asNumber(proposal.confidence) : null,
        outcome,
        when: fieldOf(run, 'created_at', 'createdAt') || null,
      }
    })
    return { overrideRate, pending, status, lastActive, runCount: runs.length, recent }
  }, [runs, proposals])

  if (state === 'loading') {
    return <Page><PageBody><LoadingMessage label={t('agent_orchestrator.agentDetail.title')} /></PageBody></Page>
  }
  if (state === 'notFound' || state === 'forbidden') {
    return (
      <Page>
        <PageBody>
          <RecordNotFoundState
            label={state === 'forbidden' ? t('agent_orchestrator.agentDetail.forbidden') : t('agent_orchestrator.agentDetail.notFound')}
            description={state === 'forbidden' ? t('agent_orchestrator.agentDetail.forbiddenDescription') : t('agent_orchestrator.agentDetail.notFoundDescription')}
            backHref="/backend/agents"
            backLabel={t('agent_orchestrator.agentDetail.back')}
          />
        </PageBody>
      </Page>
    )
  }
  if (state === 'error' || !agent) {
    return <Page><PageBody><ErrorMessage label={t('agent_orchestrator.agentDetail.error')} /></PageBody></Page>
  }

  const overridePct = metrics.overrideRate == null ? null : Math.round(metrics.overrideRate * 100)
  const overrideGate = overridePct != null && overridePct > 30

  return (
    <Page>
      <PageBody className="space-y-4">
        {/* Header */}
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="flex flex-wrap items-start justify-between gap-4 p-5">
            <div className="flex min-w-0 items-start gap-3">
              <Avatar label={agent.label || agent.id} size="lg" variant="monochrome" icon={agentAvatarIcon(agent.icon, agent.resultKind)} />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-lg font-semibold text-foreground">{agent.label || agent.id}</h1>
                  <StatusBadge variant={statusVariant[metrics.status]} dot>
                    {t(`agent_orchestrator.agents.list.status.${metrics.status}`, titleCase(metrics.status))}
                  </StatusBadge>
                </div>
                <p className="mt-0.5 text-sm text-muted-foreground">{agent.description || agent.id}</p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">{t('agent_orchestrator.agentDetail.icon.label', 'Icon')}</span>
                <Select value={agent.icon ?? ICON_DEFAULT} onValueChange={updateIcon} disabled={savingIcon}>
                  <SelectTrigger size="sm" className="w-40" aria-label={t('agent_orchestrator.agentDetail.icon.label', 'Icon')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ICON_DEFAULT}>{t('agent_orchestrator.agentDetail.icon.default', 'Default (by type)')}</SelectItem>
                    {AGENT_ICON_NAMES.map((name) => {
                      const Glyph = resolveAgentIcon(name)
                      return (
                        <SelectItem key={name} value={name}>
                          <span className="flex items-center gap-2">
                            {Glyph ? <Glyph className="size-4 text-muted-foreground" /> : null}
                            {name}
                          </span>
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>
              </div>
              <Button variant="outline" size="sm" onClick={() => flash(t('agent_orchestrator.agentDetail.actions.codeOnly', 'Managed in code for now — UI wiring needs backend.'), 'info')}>
                {t('agent_orchestrator.agentDetail.actions.pause', 'Pause')}
              </Button>
              <Button size="sm" onClick={() => setConfigOpen(true)}>
                {t('agent_orchestrator.agentDetail.actions.configure', 'Configure')}
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-px border-t border-border bg-border sm:grid-cols-3 lg:grid-cols-7">
            <StatCell icon={Hash} label={t('agent_orchestrator.agents.list.col.runs', 'Runs')}>
              <span className="text-xl font-bold tabular-nums text-foreground">{formatNumber(metrics.runCount, locale) ?? '0'}</span>
            </StatCell>
            <StatCell icon={CircleCheck} label={t('agent_orchestrator.agents.list.col.evalPass', 'Eval pass')}>
              {windowMetrics?.evalPassRate == null
                ? <PendingChip label={t('agent_orchestrator.agents.list.pending.noData', 'No data')} />
                : <span className="text-xl font-bold tabular-nums text-foreground">{Math.round(windowMetrics.evalPassRate * 100)}%</span>}
            </StatCell>
            <StatCell icon={Replace} label={t('agent_orchestrator.agents.list.col.override', 'Override')}>
              {overridePct == null
                ? <PendingChip label={t('agent_orchestrator.agents.list.pending.noData', 'No data')} />
                : <span className={`text-xl font-bold tabular-nums ${overrideGate ? 'text-status-error-text' : 'text-foreground'}`}>{overridePct}%</span>}
            </StatCell>
            <StatCell icon={Coins} label={t('agent_orchestrator.agents.list.col.cost', 'Cost / run (est.)')}>
              {(() => {
                const value = formatCostMinor(windowMetrics?.avgCostMinor ?? null, windowMetrics?.currency ?? null)
                return value
                  ? <span className="text-xl font-bold tabular-nums text-foreground">{value}</span>
                  : <PendingChip label={t('agent_orchestrator.agents.list.pending.noData', 'No data')} />
              })()}
            </StatCell>
            <StatCell icon={Clock} label={t('agent_orchestrator.agentDetail.fields.lastActive', 'Last active')}>
              <span className="text-xl font-bold tabular-nums text-foreground">{metrics.lastActive || '—'}</span>
            </StatCell>
            <StatCell icon={Cpu} label={t('agent_orchestrator.agentDetail.fields.model', 'Model')}>
              <span className="truncate font-mono text-sm text-foreground">{agent.defaultModel ?? t('agent_orchestrator.agentDetail.defaultValue')}</span>
            </StatCell>
            <StatCell icon={SlidersHorizontal} label={t('agent_orchestrator.agents.list.col.autonomy', 'Autonomy')}>
              <span className="text-xl font-bold text-foreground">{t(`agent_orchestrator.agents.list.autonomy.${autonomy}`, titleCase(autonomy))}</span>
            </StatCell>
          </div>
        </div>

        {overrideGate ? (
          <NoticeBanner icon={TriangleAlert}>
            {t('agent_orchestrator.agentDetail.autonomy.gateWarning', 'Override {pct}% is above the 30% gate — consider Gated.', { pct: overridePct })}
          </NoticeBanner>
        ) : null}

        <DashCard title={t('agent_orchestrator.agentDetail.recent.title', 'Recent runs')}>
              {metrics.recent.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('agent_orchestrator.agentDetail.recent.empty', 'No runs yet for this agent.')}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs text-muted-foreground">
                        <th className="py-2 pr-3 font-medium">{t('agent_orchestrator.agentDetail.recent.claim', 'Claim')}</th>
                        <th className="py-2 pr-3 font-medium">{t('agent_orchestrator.agentDetail.recent.decision', 'Decision')}</th>
                        <th className="py-2 pr-3 text-right font-medium">{t('agent_orchestrator.agentDetail.recent.conf', 'Conf.')}</th>
                        <th className="py-2 pr-3 font-medium">{t('agent_orchestrator.agentDetail.recent.outcome', 'Outcome')}</th>
                        <th className="py-2 pr-3 text-right font-medium">{t('agent_orchestrator.agents.list.col.cost', 'Cost')}</th>
                        <th className="py-2 text-right font-medium">{t('agent_orchestrator.agentDetail.recent.when', 'When')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {metrics.recent.map((run) => (
                        <tr
                          key={run.id}
                          tabIndex={0}
                          role="link"
                          aria-label={t('agent_orchestrator.agentDetail.recent.openTrace', 'Open run trace')}
                          className="cursor-pointer border-b border-border outline-none transition-colors last:border-0 hover:bg-accent/40 focus-visible:bg-accent/40"
                          onClick={() => router.push(`/backend/traces/${encodeURIComponent(run.id)}`)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              router.push(`/backend/traces/${encodeURIComponent(run.id)}`)
                            }
                          }}
                        >
                          <td className="py-2.5 pr-3 font-mono text-xs text-foreground">{run.claim}</td>
                          <td className="py-2.5 pr-3 text-foreground">{run.decision}</td>
                          <td className="py-2.5 pr-3 text-right text-muted-foreground">
                            <ConfidenceFaceValue
                              confidence={run.confidence}
                              display={run.confidence == null ? undefined : run.confidence.toFixed(2)}
                              className="justify-end"
                            />
                          </td>
                          <td className="py-2.5 pr-3">
                            <StatusBadge variant={outcomeVariant[run.outcome]}>
                              {t(`agent_orchestrator.agentDetail.outcome.${run.outcome}`, titleCase(run.outcome))}
                            </StatusBadge>
                          </td>
                          <td className="py-2.5 pr-3 text-right text-muted-foreground">—</td>
                          <td className="py-2.5 text-right tabular-nums text-muted-foreground">{formatTimeShort(run.when) ?? ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
        </DashCard>

        {/* Definition (real backend data) */}
        <section className="space-y-2">
          <SectionHeader title={t('agent_orchestrator.agentDetail.fields.tools', 'Tools')} />
          {agent.tools.length ? (
            <div className="flex flex-wrap gap-1">
              {agent.tools.map((tool) => <Tag key={tool} variant="neutral">{tool}</Tag>)}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t('agent_orchestrator.agentDetail.noTools')}</p>
          )}
        </section>

        {agent.subAgents.length ? (
          <section className="space-y-2">
            <SectionHeader title={t('agent_orchestrator.agentDetail.fields.subAgents')} />
            <div className="flex flex-wrap gap-1">
              {agent.subAgents.map((subId) => (
                <Button key={subId} asChild variant="outline" size="sm">
                  <Link href={`/backend/agents/${encodeURIComponent(subId)}`}>{subId}</Link>
                </Button>
              ))}
            </div>
          </section>
        ) : null}

        <section className="space-y-2">
          <SectionHeader title={t('agent_orchestrator.agentDetail.fields.skills', 'Skills')} />
          {agent.skillDetails.length ? (
            <ul className="space-y-2">
              {agent.skillDetails.map((skill) => (
                <li key={skill.id}>
                  <button
                    type="button"
                    onClick={() => setActiveSkill(skill)}
                    className="flex w-full items-start gap-3 rounded-lg border border-border bg-card p-3 text-left transition-colors hover:bg-accent/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={t('agent_orchestrator.agentDetail.viewSkill', undefined, { skill: skill.label })}
                  >
                    <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                      <Brain className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-mono text-sm font-medium text-foreground">{skill.id}</p>
                        <span className="text-xs text-muted-foreground">{skill.label}</span>
                      </div>
                      {skill.description ? <p className="mt-1 text-sm text-muted-foreground">{skill.description}</p> : null}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{t('agent_orchestrator.agentDetail.noSkills')}</p>
          )}
        </section>

        <SkillDrawer open={!!activeSkill} onOpenChange={(open) => { if (!open) setActiveSkill(null) }} skill={activeSkill} />
        <AgentConfigDrawer open={configOpen} onOpenChange={setConfigOpen} agent={agent} autonomy={autonomy} />

        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <SectionHeader title={t('agent_orchestrator.agentDetail.fields.instructions', 'Instructions')} />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!agent.instructions}
              onClick={() => {
                if (!agent.instructions || typeof navigator === 'undefined' || !navigator.clipboard) return
                navigator.clipboard.writeText(agent.instructions).then(
                  () => flash(t('agent_orchestrator.agentDetail.instructionsCopied', 'Instructions copied to clipboard.'), 'success'),
                  () => flash(t('agent_orchestrator.agentDetail.copyFailed', 'Could not copy to clipboard.'), 'error'),
                )
              }}
            >
              <Copy className="mr-1.5 size-3.5" />
              {t('agent_orchestrator.agentDetail.copy', 'Copy')}
            </Button>
          </div>
          <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg border border-border bg-muted/40 p-4 text-sm text-foreground">
            {agent.instructions || t('agent_orchestrator.agentDetail.defaultValue')}
          </pre>
        </section>

        {agent.runtime === 'opencode' && agent.tokenUsage ? <TokenUsageCard agent={agent} /> : null}
      </PageBody>
    </Page>
  )
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function autonomyHintFallback(autonomy: Autonomy): string {
  if (autonomy === 'auto') return 'Runs autonomously and applies its output without human review.'
  if (autonomy === 'gated') return 'Every action is gated behind an explicit human approval.'
  return 'A human reviews every output before it is applied.'
}

// Hairline spec-grid cell, matching the trace inspector run-stats grid.
function StatCell({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="min-w-0 bg-card p-4">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Icon className="size-3.5 shrink-0" />
        <p className="text-xs font-medium uppercase tracking-wide">{label}</p>
      </div>
      <div className="mt-1 flex min-h-8 items-center">{children}</div>
    </div>
  )
}

function DashCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="text-sm font-semibold text-foreground">{title}</div>
      <div className="mt-4">{children}</div>
    </div>
  )
}

function TokenBar({ pct }: { pct: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div className="h-full rounded-full bg-primary/70" style={{ width: `${Math.max(2, Math.min(100, Math.round(pct)))}%` }} />
    </div>
  )
}

function TokenRow({
  label,
  tokens,
  max,
  locale,
}: {
  label: React.ReactNode
  tokens: number
  max: number
  locale: string
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-sm text-foreground">{label}</span>
        <span className="shrink-0 tabular-nums text-sm text-muted-foreground">{formatNumber(tokens, locale)}</span>
      </div>
      <div className="mt-1">
        <TokenBar pct={max > 0 ? (tokens / max) * 100 : 0} />
      </div>
    </div>
  )
}

function TokenGroupLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{children}</p>
}

// Token-usage breakdown of a file-defined agent's construction files. Estimated
// with the shared o200k_base tokenizer — surfaced as guidance, not an exact count.
function TokenUsageCard({ agent }: { agent: AgentDetailView }) {
  const t = useT()
  const locale = useLocale()
  const usage = agent.tokenUsage
  if (!usage) return null
  const max = Math.max(
    1,
    usage.agent,
    usage.outcome,
    ...usage.skills.map((skill) => skill.tokens),
    ...usage.tools.map((tool) => tool.tokens),
    ...usage.subAgents.map((sub) => sub.tokens),
  )
  return (
    <section className="space-y-2">
      <SectionHeader title={t('agent_orchestrator.agentDetail.tokens.title', 'Token usage')} />
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-end justify-between gap-3">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Coins className="size-3.5 shrink-0" />
            <span className="text-xs">{t('agent_orchestrator.agentDetail.tokens.estimate', 'Estimated with o200k_base — an approximation, not an exact model count.')}</span>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold tabular-nums text-foreground">{formatNumber(usage.total, locale)}</div>
            <div className="text-xs text-muted-foreground">{t('agent_orchestrator.agentDetail.tokens.totalTokens', 'tokens total')}</div>
          </div>
        </div>

        <div className="mt-5 space-y-4">
          <div className="space-y-2">
            <TokenGroupLabel>{t('agent_orchestrator.agentDetail.tokens.core', 'Core files')}</TokenGroupLabel>
            <TokenRow label="AGENT.md" tokens={usage.agent} max={max} locale={locale} />
            <TokenRow label="OUTCOME.md" tokens={usage.outcome} max={max} locale={locale} />
          </div>

          {usage.skills.length ? (
            <div className="space-y-2">
              <TokenGroupLabel>{t('agent_orchestrator.agentDetail.tokens.skills', 'Skills')}</TokenGroupLabel>
              {usage.skills.map((skill) => (
                <div key={skill.id} className="space-y-1">
                  <TokenRow label={<span className="font-mono">{skill.id}</span>} tokens={skill.tokens} max={max} locale={locale} />
                  {skill.files.length ? (
                    <ul className="space-y-0.5 pl-4">
                      {skill.files.map((file) => (
                        <li key={file.path} className="flex items-baseline justify-between gap-3">
                          <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">{file.path.replace(`skills/${skill.id}/`, '')}</span>
                          <span className="shrink-0 tabular-nums text-xs text-muted-foreground">{formatNumber(file.tokens, locale)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {usage.tools.length ? (
            <div className="space-y-2">
              <TokenGroupLabel>{t('agent_orchestrator.agentDetail.tokens.tools', 'Tools')}</TokenGroupLabel>
              {usage.tools.map((tool) => (
                <TokenRow key={tool.path} label={<span className="font-mono">{tool.name}</span>} tokens={tool.tokens} max={max} locale={locale} />
              ))}
            </div>
          ) : null}

          {usage.subAgents.length ? (
            <div className="space-y-2">
              <TokenGroupLabel>{t('agent_orchestrator.agentDetail.tokens.subAgents', 'Sub-agents')}</TokenGroupLabel>
              {usage.subAgents.map((sub) => (
                <TokenRow key={sub.id} label={<span className="font-mono">{sub.id}</span>} tokens={sub.tokens} max={max} locale={locale} />
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  )
}

// Deliberately disabled (data-honesty spec §3.7): autonomy is a UI heuristic
// with no persistence — a safety-relevant control must never look live while
// doing nothing. Persisting autonomy is the deployment-gating spec's scope.
function AutonomySegmented({ value }: { value: Autonomy }) {
  const t = useT()
  return (
    <SegmentedControl value={value} disabled aria-label={t('agent_orchestrator.agents.list.col.autonomy', 'Autonomy')}>
      <SegmentedControlItem value="auto">{t('agent_orchestrator.agents.list.autonomy.auto', 'Auto')}</SegmentedControlItem>
      <SegmentedControlItem value="review">{t('agent_orchestrator.agents.list.autonomy.review', 'Review')}</SegmentedControlItem>
      <SegmentedControlItem value="gated">{t('agent_orchestrator.agents.list.autonomy.gated', 'Gated')}</SegmentedControlItem>
    </SegmentedControl>
  )
}

function PendingChip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-md border border-dashed border-border bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground">
      {label}
    </span>
  )
}

function NoticeBanner({ icon: Icon, children }: { icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg bg-muted px-3.5 py-2.5 text-sm text-foreground">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <span>{children}</span>
    </div>
  )
}

function SectionBand({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-muted px-6 py-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </div>
  )
}

function ConfigField({ label, pending, children }: { label: string; pending?: boolean; children: React.ReactNode }) {
  const t = useT()
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label>{label}</Label>
        {pending ? <span className="text-xs text-muted-foreground">{t('agent_orchestrator.agents.list.pending.backend', 'Needs backend')}</span> : null}
      </div>
      {children}
    </div>
  )
}

function AgentConfigDrawer({ open, onOpenChange, agent, autonomy }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  agent: AgentDetailView
  autonomy: Autonomy
}) {
  const t = useT()
  const defaultValue = t('agent_orchestrator.agentDetail.defaultValue', 'Default')
  const codeOnly = t('agent_orchestrator.agentDetail.actions.codeOnly', 'Managed in code for now — UI wiring needs backend.')
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent side="right">
        <DrawerHeader>
          <DrawerTitle>{t('agent_orchestrator.agentDetail.config.title', 'Configure')}</DrawerTitle>
          <DrawerDescription>{agent.label || agent.id}</DrawerDescription>
        </DrawerHeader>
        <DrawerBody className="p-0">
          <div className="px-6 pt-4 pb-2">
            <NoticeBanner icon={Info}>
              {t('agent_orchestrator.agentDetail.config.notice', 'Target UX — agents are defined in code for now; editing and saving need backend.')}
            </NoticeBanner>
          </div>

          <SectionBand>{t('agent_orchestrator.agentDetail.config.runtime', 'Runtime')}</SectionBand>
          <div className="space-y-4 px-6 py-4">
            <div className="grid grid-cols-2 gap-3">
              <ConfigField label={t('agent_orchestrator.agentDetail.fields.provider', 'Provider')}>
                <Input defaultValue={agent.defaultProvider ?? defaultValue} disabled />
              </ConfigField>
              <ConfigField label={t('agent_orchestrator.agentDetail.fields.model', 'Model')}>
                <Input defaultValue={agent.defaultModel ?? defaultValue} disabled />
              </ConfigField>
            </div>
            <ConfigField label={t('agent_orchestrator.agentDetail.fields.maxSteps', 'Max steps')}>
              <Input defaultValue={agent.loopMaxSteps != null ? String(agent.loopMaxSteps) : defaultValue} disabled />
            </ConfigField>
          </div>

          <SectionBand>{t('agent_orchestrator.agentDetail.config.governance', 'Governance')}</SectionBand>
          <div className="space-y-4 px-6 py-4">
            <ConfigField label={t('agent_orchestrator.agents.list.col.autonomy', 'Autonomy')} pending>
              <AutonomySegmented value={autonomy} />
              <p className="mt-2 text-sm text-muted-foreground">{t(`agent_orchestrator.agentDetail.autonomy.${autonomy}Hint`, autonomyHintFallback(autonomy))}</p>
            </ConfigField>
            <ConfigField label={t('agent_orchestrator.agentDetail.config.spendCap', 'Spend cap / month')} pending>
              <Input placeholder="—" disabled />
            </ConfigField>
            <ConfigField label={t('agent_orchestrator.agentDetail.config.rateLimit', 'Rate limit / min')} pending>
              <Input placeholder="—" disabled />
            </ConfigField>
            <ConfigField label={t('agent_orchestrator.agentDetail.config.owner', 'Owner')} pending>
              <Input placeholder={t('agent_orchestrator.agentDetail.config.unassigned', 'Unassigned')} disabled />
            </ConfigField>
          </div>
        </DrawerBody>
        <DrawerFooter layout="equal">
          <DrawerClose asChild>
            <Button variant="outline">{t('agent_orchestrator.proposal.actions.cancelEdit', 'Cancel')}</Button>
          </DrawerClose>
          <Button disabled title={codeOnly}>{t('agent_orchestrator.agentDetail.config.save', 'Save')}</Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
