"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowRight,
  Bot,
  Check,
  ChevronRight,
  CircleCheck,
  Inbox,
  Info,
  Code2,
  Wrench,
} from 'lucide-react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { JsonDisplay } from '@open-mercato/ui/backend/JsonDisplay'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT, useLocale } from '@open-mercato/shared/lib/i18n/context'
import { confidenceFace, confidencePctOf } from '../../../components/cockpitStatus'
import {
  formatConfidence,
  formatCostMinor,
  formatDurationMs,
  formatNumber,
  formatTimeShort,
  mapProposal,
  mapRun,
  type ProposalView,
  type RunView,
} from '../../../components/types'
import {
  mapProcessProjection,
  type AgentProcessStatus,
  type ProcessActorKind,
  type ProcessDetailSectionKind,
  type ProcessProjection,
  type ProcessStage,
  type ProcessStateTone,
  type ProcessStep,
} from '../../../components/processTypes'

type StageState = 'done' | 'current' | 'upcoming'

const STATE_DOT: Record<ProcessStateTone, string> = {
  neutral: 'bg-muted-foreground',
  info: 'bg-status-info-text',
  success: 'bg-status-success-text',
  warning: 'bg-status-warning-text',
  error: 'bg-status-error-text',
}

// Maps AgentProcessStatus → state pill tone + i18n label (spec status derivation).
const STATUS_TONE: Record<AgentProcessStatus, ProcessStateTone> = {
  running: 'info',
  waiting_on_you: 'warning',
  question_open: 'info',
  docs_requested: 'warning',
  fraud_hold: 'error',
  auto_completing: 'info',
  auto_completed: 'success',
  completed: 'success',
  failed: 'error',
  cancelled: 'neutral',
}

const STATUS_LABEL_KEY: Record<AgentProcessStatus, string> = {
  running: 'agent_orchestrator.process.status.running',
  waiting_on_you: 'agent_orchestrator.process.status.waitingOnYou',
  question_open: 'agent_orchestrator.process.status.questionOpen',
  docs_requested: 'agent_orchestrator.process.status.docsRequested',
  fraud_hold: 'agent_orchestrator.process.status.fraudHold',
  auto_completing: 'agent_orchestrator.process.status.autoCompleting',
  auto_completed: 'agent_orchestrator.process.status.autoCompleted',
  completed: 'agent_orchestrator.process.status.completed',
  failed: 'agent_orchestrator.process.status.failed',
  cancelled: 'agent_orchestrator.process.status.cancelled',
}

// agent proposes (brand-violet) vs system/Open Mercato disposes (foreground) —
// kept far apart in hue so the two roles read at a glance.
const ACTOR_DOT: Record<ProcessActorKind, string> = {
  agent: 'bg-brand-violet',
  system: 'bg-foreground',
}

const ACTOR_TEXT: Record<ProcessActorKind, string> = {
  agent: 'text-brand-violet',
  system: 'text-foreground',
}

function formatSubjectValue(minor: number | null, currency: string | null, locale: string): string | null {
  if (minor == null) return null
  const major = formatNumber(minor / 100, locale)
  return major == null ? null : `${major}${currency ? ` ${currency}` : ''}`
}

function formatAge(iso: string | null, t: ReturnType<typeof useT>): string | null {
  if (!iso) return null
  const parsed = Date.parse(iso)
  if (!Number.isFinite(parsed)) return null
  const diff = Math.max(0, Date.now() - parsed)
  const days = Math.floor(diff / (24 * 60 * 60 * 1000))
  const hours = Math.floor((diff % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000))
  const minutes = Math.floor((diff % (60 * 60 * 1000)) / (60 * 1000))
  if (days > 0) return t('agent_orchestrator.process.relTimeDh', undefined, { days, hours })
  if (hours > 0) return t('agent_orchestrator.process.relTimeH', undefined, { hours })
  return t('agent_orchestrator.process.relTimeM', undefined, { minutes })
}

/** Calendar-day key used for the timeline's day dividers. */
function dayKeyOf(iso: string | null): string {
  if (!iso) return ''
  return iso.slice(0, 10)
}

function dayLabelOf(dayKey: string, t: ReturnType<typeof useT>): string {
  const today = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  if (dayKey === today) return t('agent_orchestrator.process.today')
  if (dayKey === yesterday) return t('agent_orchestrator.process.yesterday')
  return dayKey
}

function summarize(proposal: ProposalView, t: ReturnType<typeof useT>): string {
  if (proposal.rationale) return proposal.rationale
  return t('agent_orchestrator.process.stepProposed')
}

/**
 * Builds the propose/dispose timeline from real proposals (+ their runs for the
 * confidence/latency/cost metrics). One agent step per proposal; disposed
 * proposals additionally emit a system "disposed" step at their updatedAt.
 */
function buildSteps(
  proposals: ProposalView[],
  runsById: Map<string, RunView>,
  t: ReturnType<typeof useT>,
): ProcessStep[] {
  const steps: ProcessStep[] = []
  for (const proposal of proposals) {
    const run = runsById.get(proposal.runId) ?? null
    steps.push({
      id: `${proposal.id}:proposed`,
      runId: proposal.runId,
      proposalId: proposal.id,
      disposition: proposal.disposition,
      agentId: proposal.agentId,
      stepId: proposal.stepId,
      actor: proposal.agentId,
      actorKind: 'agent',
      summary: summarize(proposal, t),
      time: formatTimeShort(proposal.createdAt) ?? '',
      day: dayKeyOf(proposal.createdAt),
      detail: {
        confidence: formatConfidence(proposal.confidence ?? run?.confidence ?? null),
        latency: formatDurationMs(run?.latencyMs ?? null),
        cost: formatCostMinor(run?.costMinor ?? null, run?.currency ?? null),
        sections: [],
        payload: proposal.payload,
      },
    })
    if (proposal.disposition !== 'pending') {
      steps.push({
        id: `${proposal.id}:disposed`,
        runId: proposal.runId,
        proposalId: proposal.id,
        disposition: proposal.disposition,
        agentId: null,
        stepId: proposal.stepId,
        actor: t('agent_orchestrator.process.disposes'),
        actorKind: 'system',
        summary: t('agent_orchestrator.process.stepDisposed', undefined, {
          disposition: t(`agent_orchestrator.disposition.${proposal.disposition}`),
        }),
        time: formatTimeShort(proposal.updatedAt ?? proposal.createdAt) ?? '',
        day: dayKeyOf(proposal.updatedAt ?? proposal.createdAt),
        detail: {
          confidence: proposal.dispositionBy?.startsWith('rule:') ? 'auto' : null,
          latency: null,
          cost: null,
          sections: [],
          payload: {
            disposition: proposal.disposition,
            dispositionBy: proposal.dispositionBy,
            dispositionReason: proposal.dispositionReason,
          },
        },
      })
    }
  }
  return steps
}

/** Ordered distinct workflow step ids observed on the process's activity. */
function buildStages(proposals: ProposalView[], currentStage: string | null): ProcessStage[] {
  const seen = new Set<string>()
  const stages: ProcessStage[] = []
  for (const proposal of proposals) {
    if (proposal.stepId && !seen.has(proposal.stepId)) {
      seen.add(proposal.stepId)
      stages.push({ key: proposal.stepId, label: proposal.stepId })
    }
  }
  if (currentStage && !seen.has(currentStage)) {
    stages.push({ key: currentStage, label: currentStage })
  }
  return stages
}

const SECTION_META: Record<
  ProcessDetailSectionKind,
  { icon: React.ComponentType<{ className?: string }>; titleKey: string; success?: boolean }
> = {
  input: { icon: Inbox, titleKey: 'agent_orchestrator.process.sectionInput' },
  tools: { icon: Wrench, titleKey: 'agent_orchestrator.process.sectionTools' },
  output: { icon: CircleCheck, titleKey: 'agent_orchestrator.process.sectionOutput', success: true },
}

function DetailMetric({
  label,
  value,
  face,
}: {
  label: string
  value: string | null
  face?: { Icon: React.ComponentType<{ className?: string }>; color: string } | null
}) {
  const FaceIcon = face?.Icon
  return (
    <div className="px-4 py-2 text-center">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 flex items-center justify-center gap-1.5 text-base font-semibold tabular-nums text-foreground">
        {FaceIcon ? <FaceIcon className={`size-4 shrink-0 ${face!.color}`} /> : null}
        {value ?? '—'}
      </p>
    </div>
  )
}

function StepDetailPanel({
  step,
  dayLabel,
  onOpenTrace,
  onReviewInCaseload,
}: {
  step: ProcessStep
  dayLabel: string
  onOpenTrace: () => void
  onReviewInCaseload?: () => void
}) {
  const t = useT()
  const roleLabel = t(
    step.actorKind === 'agent'
      ? 'agent_orchestrator.process.proposes'
      : 'agent_orchestrator.process.disposes',
  )
  // Confidence is a pre-formatted string ("0.95" / "auto"); a numeric one gets a face.
  const confNum = step.detail.confidence != null ? Number(step.detail.confidence) : Number.NaN
  const confFace = Number.isFinite(confNum) ? confidenceFace(confidencePctOf(confNum)!) : null
  return (
    <section className="flex flex-col rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`size-2 shrink-0 rounded-full ${ACTOR_DOT[step.actorKind]}`} />
            <span className={`text-xs font-semibold uppercase tracking-wide ${ACTOR_TEXT[step.actorKind]}`}>
              {roleLabel}
            </span>
            <span className="text-xs text-muted-foreground">
              {dayLabel} {step.time}
            </span>
          </div>
          <h2 className="mt-1 text-lg font-semibold text-foreground">{step.actor}</h2>
        </div>
        <div className="flex shrink-0 items-stretch divide-x divide-border overflow-hidden rounded-lg border border-border">
          <DetailMetric label={t('agent_orchestrator.process.confidence')} value={step.detail.confidence} face={confFace} />
          <DetailMetric label={t('agent_orchestrator.process.latency')} value={step.detail.latency} />
          <DetailMetric label={t('agent_orchestrator.process.cost')} value={step.detail.cost} />
        </div>
      </div>

      <div className="mt-5 grid flex-1 gap-4 sm:grid-cols-2">
        <div className="space-y-4">
          {step.detail.sections.map((section) => {
            const meta = SECTION_META[section.kind]
            const Icon = meta.icon
            return (
              <div key={section.kind} className="overflow-hidden rounded-lg border border-border">
                <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Icon
                      className={`size-4 ${meta.success ? 'text-status-success-text' : 'text-muted-foreground'}`}
                    />
                    <span className="text-sm font-medium text-foreground">{t(meta.titleKey)}</span>
                  </div>
                  <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground">
                    {section.rows.length}
                  </span>
                </div>
                <dl className="divide-y divide-border">
                  {section.rows.map((row) => (
                    <div key={row.label} className="flex items-center justify-between gap-3 px-3 py-2">
                      <dt
                        className={`min-w-0 truncate text-xs text-muted-foreground ${section.kind === 'input' ? '' : 'font-mono'}`}
                      >
                        {row.label}
                      </dt>
                      <dd className="truncate text-right text-xs font-medium text-foreground">{row.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )
          })}
          {step.detail.sections.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t('agent_orchestrator.process.detail.payloadOnly')}
            </p>
          ) : null}
        </div>

        <div className="overflow-hidden rounded-lg border border-border">
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
            <div className="flex items-center gap-2">
              <Code2 className="size-4 text-muted-foreground" />
              <span className="text-sm font-medium text-foreground">
                {t('agent_orchestrator.process.outputPayload')}
              </span>
            </div>
            <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">json</span>
          </div>
          <div className="p-3">
            <JsonDisplay data={step.detail.payload} defaultExpanded maxInitialDepth={3} showCopy />
          </div>
        </div>
      </div>

      <div className="mt-5 flex justify-end gap-2 border-t border-border pt-4">
        <Button type="button" variant="outline" size="sm" onClick={onOpenTrace}>
          {t('agent_orchestrator.process.openTrace')}
          <ArrowRight className="size-4" />
        </Button>
        {step.disposition === 'pending' && step.proposalId && onReviewInCaseload ? (
          <Button type="button" size="sm" onClick={onReviewInCaseload}>
            {t('agent_orchestrator.process.reviewInCaseload')}
            <ArrowRight className="size-4" />
          </Button>
        ) : null}
      </div>
    </section>
  )
}

type ListResponse = { items?: Array<Record<string, unknown>> }

export default function ProcessDetailPage({ params }: { params?: { id?: string } }) {
  const t = useT()
  const locale = useLocale()
  const router = useRouter()
  const processId = params?.id ?? ''

  const [projection, setProjection] = React.useState<ProcessProjection | null>(null)
  const [degraded, setDegraded] = React.useState(false)
  const [proposals, setProposals] = React.useState<ProposalView[]>([])
  const [runsById, setRunsById] = React.useState<Map<string, RunView>>(new Map())
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      setError(null)
      const [headerCall, proposalsCall] = await Promise.all([
        apiCall<{ process?: Record<string, unknown> }>(
          `/api/agent_orchestrator/processes/${encodeURIComponent(processId)}`,
          undefined,
          { fallback: {} },
        ),
        apiCall<ListResponse>(
          `/api/agent_orchestrator/proposals?processId=${encodeURIComponent(processId)}&pageSize=100&sortField=createdAt&sortDir=asc`,
          undefined,
          { fallback: { items: [] } },
        ),
      ])
      if (cancelled) return

      const proposalRows = (Array.isArray(proposalsCall.result?.items) ? proposalsCall.result.items : [])
        .map((row) => mapProposal(row))
        .filter((row): row is ProposalView => !!row)

      const header = headerCall.ok && headerCall.result?.process
        ? mapProcessProjection(headerCall.result.process)
        : null

      if (!header && proposalRows.length === 0) {
        setError(t('agent_orchestrator.process.detail.error'))
        setIsLoading(false)
        return
      }

      // Header degradation (spec): no projection row yet → render the process by
      // its id from activity data alone, clearly hinted, instead of failing.
      const fallbackHeader: ProcessProjection = {
        processId,
        workflowId: null,
        workflowVersion: null,
        subjectType: null,
        subjectId: null,
        subjectLabel: null,
        subjectTitle: null,
        subjectValueMinor: null,
        subjectFraud: null,
        subjectFacets: null,
        status: proposalRows.some((p) => p.disposition === 'pending') ? 'waiting_on_you' : 'running',
        currentStage: proposalRows[proposalRows.length - 1]?.stepId ?? null,
        agentIds: Array.from(new Set(proposalRows.map((p) => p.agentId))),
        costMinor: null,
        currency: null,
        runCount: new Set(proposalRows.map((p) => p.runId)).size,
        pendingProposalCount: proposalRows.filter((p) => p.disposition === 'pending').length,
        assigneeUserId: null,
        teamId: null,
        waitingSince: null,
        openedAt: proposalRows[0]?.createdAt ?? null,
        lastActivityAt: proposalRows[proposalRows.length - 1]?.updatedAt ?? null,
      }
      setProjection(header ?? fallbackHeader)
      setDegraded(!header)
      setProposals(proposalRows)

      const runIds = Array.from(new Set(proposalRows.map((p) => p.runId))).filter(Boolean)
      if (runIds.length > 0) {
        const runsCall = await apiCall<ListResponse>(
          `/api/agent_orchestrator/runs?ids=${runIds.map((id) => encodeURIComponent(id)).join(',')}&pageSize=${Math.min(runIds.length, 100)}`,
          undefined,
          { fallback: { items: [] } },
        )
        if (!cancelled && runsCall.ok) {
          const map = new Map<string, RunView>()
          for (const row of runsCall.result?.items ?? []) {
            const run = mapRun(row)
            if (run) map.set(run.id, run)
          }
          setRunsById(map)
        }
      }
      if (!cancelled) setIsLoading(false)
    }
    if (processId) void load()
    return () => {
      cancelled = true
    }
  }, [processId, t])

  const steps = React.useMemo(
    () => buildSteps(proposals, runsById, t),
    [proposals, runsById, t],
  )
  const stages = React.useMemo(
    () => buildStages(proposals, projection?.currentStage ?? null),
    [proposals, projection],
  )

  const [selectedId, setSelectedId] = React.useState<string>('')
  // Default focus: the first pending step (the one demanding a decision), else
  // the newest step — never the oldest, which is history the operator has seen.
  const selected =
    steps.find((step) => step.id === selectedId) ??
    steps.find((step) => step.disposition === 'pending') ??
    steps[steps.length - 1]

  const openTrace = React.useCallback(() => {
    if (selected?.runId) {
      router.push(`/backend/traces/${selected.runId}`)
      return
    }
    router.push('/backend/traces')
  }, [router, selected])

  const reviewSelectedInCaseload = React.useCallback(() => {
    if (selected?.proposalId) {
      router.push(`/backend/caseload/${encodeURIComponent(selected.proposalId)}`)
    }
  }, [router, selected])

  const oldestPendingProposalId = React.useMemo(
    () => proposals.find((proposal) => proposal.disposition === 'pending')?.id ?? null,
    [proposals],
  )

  if (isLoading) {
    return (
      <Page>
        <PageBody>
          <LoadingMessage label={t('agent_orchestrator.process.list.title')} />
        </PageBody>
      </Page>
    )
  }

  if (error || !projection) {
    return (
      <Page>
        <PageBody>
          <div className="mb-4">
            <Button type="button" variant="outline" size="sm" onClick={() => router.back()}>
              {t('agent_orchestrator.process.back')}
            </Button>
          </div>
          <ErrorMessage label={error ?? t('agent_orchestrator.process.detail.error')} />
        </PageBody>
      </Page>
    )
  }

  const process = projection
  const currentStageIndex = stages.findIndex(
    (stage) => stage.key === process.currentStage || stage.label === process.currentStage,
  )
  const claimedValue = formatSubjectValue(process.subjectValueMinor, process.currency, locale)
  const openedAge = formatAge(process.openedAt, t)

  // Day dividers are emitted inline as the day changes down the trace.
  let lastDay: string | null = null

  return (
    <Page>
      <PageBody>
        <div className="mb-4">
          <Button type="button" variant="outline" size="sm" onClick={() => router.push('/backend/processes')}>
            {t('agent_orchestrator.process.back')}
          </Button>
        </div>

        {degraded ? (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            <p>{t('agent_orchestrator.process.detail.degraded')}</p>
          </div>
        ) : null}

        {/* Claim header + stage stepper */}
        <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {process.subjectType ?? t('agent_orchestrator.process.list.title')}{' '}
                <span className="font-semibold text-foreground">
                  {process.subjectLabel ?? process.processId.slice(0, 8).toUpperCase()}
                </span>
              </p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground">
                {process.subjectTitle ?? process.workflowId ?? process.processId}
              </h1>
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                {process.status === 'waiting_on_you' && oldestPendingProposalId ? (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => router.push(`/backend/caseload/${encodeURIComponent(oldestPendingProposalId)}`)}
                  >
                    {t('agent_orchestrator.process.reviewInCaseload')}
                    <ArrowRight className="size-4" />
                  </Button>
                ) : null}
                <Button type="button" variant="outline" size="sm" disabled>
                  {t('agent_orchestrator.process.actionPause')}
                </Button>
                <Button type="button" variant="outline" size="sm" disabled>
                  {t('agent_orchestrator.process.actionReassign')}
                </Button>
                <Button type="button" variant="outline" size="sm" disabled>
                  {t('agent_orchestrator.process.actionTakeOver')}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">{t('agent_orchestrator.process.actionsComingSoon')}</p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-start gap-x-10 gap-y-4">
            {(() => {
              const facets = (process.subjectFacets ?? null) as { policyholder?: string | null; ownerLabel?: string | null } | null
              return (
                <>
                  {facets?.policyholder ? (
                    <HeaderFact
                      label={t('agent_orchestrator.process.factPolicyholder')}
                      value={facets.policyholder}
                    />
                  ) : null}
                  {claimedValue ? (
                    <HeaderFact label={t('agent_orchestrator.process.factClaimed')} value={claimedValue} />
                  ) : null}
                  {openedAge ? (
                    <HeaderFact label={t('agent_orchestrator.process.factOpened')} value={openedAge} />
                  ) : null}
                  {facets?.ownerLabel ? (
                    <HeaderFact
                      label={t('agent_orchestrator.process.factOwner')}
                      value={facets.ownerLabel}
                    />
                  ) : null}
                </>
              )
            })()}
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t('agent_orchestrator.process.factState')}
              </p>
              <p className="mt-0.5 flex items-center gap-1.5 text-sm font-medium text-foreground">
                <span className={`size-2 shrink-0 rounded-full ${STATE_DOT[STATUS_TONE[process.status]]}`} />
                {t(STATUS_LABEL_KEY[process.status])}
              </p>
            </div>
          </div>

          {stages.length > 0 ? (
            <div className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-3 border-t border-border pt-4">
              {stages.map((stage, index) => {
                // Terminal processes render every stage as done — no phantom
                // "current" stage on a completed/failed/cancelled case.
                const isTerminal = ['auto_completed', 'completed', 'failed', 'cancelled'].includes(process.status)
                const state: StageState = isTerminal
                  ? 'done'
                  : currentStageIndex < 0
                    ? 'upcoming'
                    : index < currentStageIndex
                      ? 'done'
                      : index === currentStageIndex
                        ? 'current'
                        : 'upcoming'
                return (
                  <React.Fragment key={stage.key}>
                    <div className="flex items-center gap-2">
                      <StageNode state={state} position={index + 1} />
                      <span
                        className={
                          state === 'upcoming'
                            ? 'text-sm text-muted-foreground'
                            : state === 'current'
                              ? 'text-sm font-semibold text-foreground'
                              : 'text-sm text-foreground'
                        }
                      >
                        {stage.label}
                      </span>
                    </div>
                    {index < stages.length - 1 ? (
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                    ) : null}
                  </React.Fragment>
                )
              })}
            </div>
          ) : null}
        </section>

        {/* Split view: activity trace ↔ selected step detail */}
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
          <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-foreground">
              {t('agent_orchestrator.process.activityTrace')}
            </h2>

            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className={`size-2 rounded-full ${ACTOR_DOT.agent}`} />
                {t('agent_orchestrator.process.legendProposes')}
              </span>
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className={`size-2 rounded-full ${ACTOR_DOT.system}`} />
                {t('agent_orchestrator.process.legendDisposes')}
              </span>
            </div>

            {steps.length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">
                {t('agent_orchestrator.process.detail.noActivity')}
              </p>
            ) : (
              <div className="mt-4">
                {steps.map((step) => {
                  const showDay = step.day !== lastDay
                  lastDay = step.day
                  const isSelected = step.id === selected?.id
                  return (
                    <React.Fragment key={step.id}>
                      {showDay ? (
                        <div className="flex items-center gap-2">
                          <span className="relative flex w-5 flex-none items-center justify-center self-stretch py-1.5">
                            <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border" />
                            <span className="relative size-1.5 rounded-full bg-muted-foreground ring-2 ring-card" />
                          </span>
                          <p className="py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            {dayLabelOf(step.day, t)}
                          </p>
                        </div>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => setSelectedId(step.id)}
                        aria-pressed={isSelected}
                        className="flex w-full items-stretch gap-2 text-left"
                      >
                        <span className="relative flex w-5 flex-none items-center justify-center">
                          <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border" />
                          <span
                            className={`relative rounded-full ring-2 ring-card ${ACTOR_DOT[step.actorKind]} ${isSelected ? 'size-3' : 'size-2.5'}`}
                          />
                        </span>
                        <span
                          className={`flex flex-1 items-center gap-3 rounded-lg px-3 py-2.5 transition-colors ${isSelected ? 'bg-brand-violet-soft' : 'hover:bg-muted/50'}`}
                        >
                          {step.actorKind === 'system' ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src="/open-mercato.svg" alt="" className="size-7 shrink-0 rounded-md" />
                          ) : (
                            <span className="grid size-7 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                              <Bot className="size-4" />
                            </span>
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center justify-between gap-2">
                              <span className="truncate text-sm font-medium text-foreground">{step.actor}</span>
                              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{step.time}</span>
                            </span>
                            <span className="mt-0.5 block truncate text-xs text-muted-foreground">{step.summary}</span>
                          </span>
                        </span>
                      </button>
                    </React.Fragment>
                  )
                })}
              </div>
            )}
          </section>

          {selected ? (
            <StepDetailPanel
              step={selected}
              dayLabel={dayLabelOf(selected.day, t)}
              onOpenTrace={openTrace}
              onReviewInCaseload={reviewSelectedInCaseload}
            />
          ) : null}
        </div>
      </PageBody>
    </Page>
  )
}

function HeaderFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate text-sm font-medium text-foreground">{value}</p>
    </div>
  )
}

function StageNode({ state, position }: { state: StageState; position: number }) {
  if (state === 'done') {
    return (
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-status-success-icon text-status-success-bg">
        <Check className="size-3.5" />
      </span>
    )
  }
  if (state === 'current') {
    return (
      <span className="grid size-6 shrink-0 place-items-center rounded-full border-2 border-brand-violet text-xs font-semibold tabular-nums text-brand-violet">
        {position}
      </span>
    )
  }
  return (
    <span className="grid size-6 shrink-0 place-items-center rounded-full border border-border text-xs tabular-nums text-muted-foreground">
      {position}
    </span>
  )
}
