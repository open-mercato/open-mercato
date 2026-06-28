"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowRight,
  Bot,
  Check,
  ChevronRight,
  CircleCheck,
  Code2,
  Inbox,
  Info,
  Wrench,
} from 'lucide-react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { JsonDisplay } from '@open-mercato/ui/backend/JsonDisplay'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { confidenceFace, confidencePctOf } from '../../../components/cockpitStatus'
import {
  buildSampleProcess,
  type AgentProcessStatus,
  type ProcessActorKind,
  type ProcessDetailSectionKind,
  type ProcessStateTone,
  type ProcessStep,
  type ProcessView,
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

function formatSubjectValue(minor: number | null, currency: string | null): string | null {
  if (minor == null) return null
  const major = minor / 100
  return `${major.toLocaleString('en-US')}${currency ? ` ${currency}` : ''}`
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
  onOpenTrace,
}: {
  step: ProcessStep
  onOpenTrace: () => void
}) {
  const t = useT()
  const dayLabel = t(
    step.day === 'today' ? 'agent_orchestrator.process.today' : 'agent_orchestrator.process.yesterday',
  )
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

      <div className="mt-5 flex justify-end border-t border-border pt-4">
        <Button type="button" variant="outline" size="sm" onClick={onOpenTrace}>
          {t('agent_orchestrator.process.openTrace')}
          <ArrowRight className="size-4" />
        </Button>
      </div>
    </section>
  )
}

export default function ProcessDetailPage({ params }: { params?: { id?: string } }) {
  const t = useT()
  const router = useRouter()
  const processId = params?.id ?? ''

  // Sample-driven until the AgentProcess projection + processes routes land
  // (spec 2026-06-25, owner Patryk). When they do, swap to GET /processes/:id
  // (header) + GET /proposals?processId=… (+ /runs/:id) for the timeline.
  const view: ProcessView = React.useMemo(
    () => buildSampleProcess(processId || 'CLM-2026-04417'),
    [processId],
  )
  const { process } = view

  const [selectedId, setSelectedId] = React.useState<string>(view.steps[0]?.id ?? '')
  const selected = view.steps.find((step) => step.id === selectedId) ?? view.steps[0]

  const openTrace = React.useCallback(() => {
    if (selected?.runId) {
      router.push(`/backend/traces/${selected.runId}`)
      return
    }
    router.push('/backend/traces')
  }, [router, selected])

  const currentStageIndex = view.stages.findIndex((stage) => stage.label === process.currentStage)
  const claimedValue = formatSubjectValue(process.subjectValueMinor, process.currency)
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

        {view.isSample ? (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            <p>
              <span className="mr-1.5 rounded-md border border-border bg-card px-1.5 py-0.5 font-medium text-foreground">
                {t('agent_orchestrator.process.preview')}
              </span>
              {t('agent_orchestrator.process.previewNote')}
            </p>
          </div>
        ) : null}

        {/* Claim header + stage stepper */}
        <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {process.subjectType}{' '}
                <span className="font-semibold text-foreground">{process.subjectLabel}</span>
              </p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground">{process.subjectTitle}</h1>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => flash(t('agent_orchestrator.process.actionPreviewOnly'), 'success')}
              >
                {t('agent_orchestrator.process.actionPause')}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => flash(t('agent_orchestrator.process.actionPreviewOnly'), 'success')}
              >
                {t('agent_orchestrator.process.actionReassign')}
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => flash(t('agent_orchestrator.process.actionPreviewOnly'), 'success')}
              >
                {t('agent_orchestrator.process.actionTakeOver')}
              </Button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-start gap-x-10 gap-y-4">
            {process.subjectFacets?.policyholder ? (
              <HeaderFact
                label={t('agent_orchestrator.process.factPolicyholder')}
                value={process.subjectFacets.policyholder}
              />
            ) : null}
            {claimedValue ? (
              <HeaderFact label={t('agent_orchestrator.process.factClaimed')} value={claimedValue} />
            ) : null}
            {openedAge ? (
              <HeaderFact label={t('agent_orchestrator.process.factOpened')} value={openedAge} />
            ) : null}
            {process.subjectFacets?.ownerLabel ? (
              <HeaderFact
                label={t('agent_orchestrator.process.factOwner')}
                value={process.subjectFacets.ownerLabel}
              />
            ) : null}
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

          <div className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-3 border-t border-border pt-4">
            {view.stages.map((stage, index) => {
              const state: StageState =
                currentStageIndex < 0
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
                  {index < view.stages.length - 1 ? (
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  ) : null}
                </React.Fragment>
              )
            })}
          </div>
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

            {/* Timeline: one continuous spine; nodes (incl. day markers) ride it.
                The selectable highlight is a separate block to the RIGHT of the
                spine, so it never overlaps the line, and its px-3 keeps a margin
                after the time. */}
            <div className="mt-4">
              {view.steps.map((step) => {
                const showDay = step.day !== lastDay
                lastDay = step.day
                const isSelected = step.id === selected?.id
                const dayLabel = t(
                  step.day === 'today'
                    ? 'agent_orchestrator.process.today'
                    : 'agent_orchestrator.process.yesterday',
                )
                return (
                  <React.Fragment key={step.id}>
                    {showDay ? (
                      <div className="flex items-center gap-2">
                        <span className="relative flex w-5 flex-none items-center justify-center self-stretch py-1.5">
                          <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border" />
                          <span className="relative size-1.5 rounded-full bg-muted-foreground ring-2 ring-card" />
                        </span>
                        <p className="py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {dayLabel}
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
          </section>

          {selected ? <StepDetailPanel step={selected} onOpenTrace={openTrace} /> : null}
        </div>
      </PageBody>
    </Page>
  )
}
