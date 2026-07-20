"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Check, X, MinusCircle, ChevronRight, Target, Timer, Hash, Coins, Wrench, Play, Flag, Cpu, Plus, RotateCcw, Workflow, ShieldAlert, ShieldCheck, Inbox, ClipboardCheck } from 'lucide-react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Popover, PopoverTrigger, PopoverContent } from '@open-mercato/ui/primitives/popover'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { JsonDisplay } from '@open-mercato/ui/backend/JsonDisplay'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useT, useLocale } from '@open-mercato/shared/lib/i18n/context'
import { useCoalescedReload } from '../../../components/useCoalescedReload'
import {
  mapRunDetail,
  formatConfidence,
  formatDateTime,
  formatDurationMs,
  formatTokens,
  formatCostMinor,
  type ContextBundleView,
  type GuardrailCheckView,
  type ProposalView,
  type RunDetailView,
  type SpanView,
  type ToolCallView,
} from '../../../components/types'
import { deriveReasoning } from '../../../components/proposalFactsData'
import { runStatusVariant, runStatusLabelKey, confidenceFace, confidencePctOf, ConfidenceFaceValue } from '../../../components/cockpitStatus'
import { EmptyArt } from '../../../components/EmptyArt'

// llm / tool / system get distinct DS tokens so the waterfall reads at a glance
// without inventing colors (brand-violet / accent-indigo / muted neutral).
const SPAN_KIND_BAR: Record<string, string> = {
  llm: 'bg-brand-violet',
  tool: 'bg-accent-indigo',
  system: 'bg-muted-foreground',
}

function spanBarClass(kind: string): string {
  return SPAN_KIND_BAR[kind] ?? 'bg-muted-foreground'
}

function hasSummary(value: unknown): boolean {
  if (value == null) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0
  return true
}

function formatSummary(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function parseTime(value: string | null): number | null {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

type Timeline = { startMs: number; totalMs: number }

function buildTimeline(spans: SpanView[], latencyMs: number | null): Timeline | null {
  const starts = spans.map((span) => parseTime(span.startedAt)).filter((value): value is number => value != null)
  if (starts.length === 0) {
    return latencyMs && latencyMs > 0 ? { startMs: 0, totalMs: latencyMs } : null
  }
  const startMs = Math.min(...starts)
  const ends = spans.map((span) => {
    const started = parseTime(span.startedAt)
    const ended = parseTime(span.endedAt)
    if (ended != null) return ended
    if (started != null && span.durationMs != null) return started + span.durationMs
    return started
  }).filter((value): value is number => value != null)
  const endMs = ends.length ? Math.max(...ends) : startMs
  const spanTotal = endMs - startMs
  const totalMs = Math.max(spanTotal, latencyMs ?? 0, 1)
  return { startMs, totalMs }
}

function StatCell({
  label,
  value,
  icon: Icon,
  iconClassName,
}: {
  label: string
  value: string
  icon: React.ComponentType<{ className?: string }>
  iconClassName?: string
}) {
  return (
    <div className="bg-card p-4">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Icon className={`size-3.5 shrink-0 ${iconClassName ?? ''}`} />
        <p className="text-xs font-medium uppercase tracking-wide">{label}</p>
      </div>
      <p className="mt-1 text-xl font-bold tabular-nums tracking-tight text-foreground">{value}</p>
    </div>
  )
}

function InspectorCard({
  title,
  hint,
  sampleLabel,
  children,
}: {
  title: string
  hint?: string
  sampleLabel?: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {sampleLabel ? (
            <span className="rounded-md border border-border bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
              {sampleLabel}
            </span>
          ) : null}
        </div>
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      </div>
      {children}
    </section>
  )
}

// Context assembled (TDCR) — the run's persisted AgentContextBundle: routed
// sources as chips, the "+N pruned" chip expands to reveal what was dropped, so
// the routed-vs-pruned decision is inspectable.
function contextSourceLabel(source: { ref: string; locator: string | null }): string {
  return source.locator ?? source.ref
}

function ContextAssembledCard({ bundle }: { bundle: ContextBundleView | null }) {
  const t = useT()
  const [showPruned, setShowPruned] = React.useState(false)
  if (!bundle) {
    return (
      <InspectorCard
        title={t('agent_orchestrator.traces.detail.context')}
        hint={t('agent_orchestrator.traces.detail.contextHint')}
      >
        <p className="text-sm text-muted-foreground">{t('agent_orchestrator.traces.detail.contextEmpty')}</p>
      </InspectorCard>
    )
  }
  const routed = bundle.routedSources
  const pruned = bundle.prunedSources
  return (
    <InspectorCard
      title={t('agent_orchestrator.traces.detail.context')}
      hint={t('agent_orchestrator.traces.detail.contextHint')}
    >
      <p className="text-sm text-muted-foreground">
        {t('agent_orchestrator.traces.detail.contextSummary', undefined, {
          routed: routed.length,
          total: routed.length + pruned.length,
          used: formatTokens(bundle.tokensUsed) ?? '—',
          budget: formatTokens(bundle.tokenBudget) ?? '—',
        })}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {routed.map((source, index) => (
          <span
            key={`${source.kind}:${source.ref}:${index}`}
            title={`${source.kind}: ${source.ref}`}
            className="max-w-56 truncate rounded-md border border-transparent bg-brand-violet-soft px-2 py-1 font-mono text-xs text-brand-violet"
          >
            {contextSourceLabel(source)}
          </span>
        ))}
        {showPruned
          ? pruned.map((source, index) => (
              <span
                key={`${source.kind}:${source.ref}:${index}`}
                title={`${source.kind}: ${source.ref} — ${source.reason}`}
                className="max-w-56 truncate rounded-md border border-dashed border-border px-2 py-1 font-mono text-xs text-muted-foreground"
              >
                {source.ref}
              </span>
            ))
          : null}
        {pruned.length > 0 ? (
          <button
            type="button"
            onClick={() => setShowPruned((value) => !value)}
            className="rounded-md border border-dashed border-border px-2 py-1 font-mono text-xs text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
          >
            {showPruned
              ? t('agent_orchestrator.traces.detail.contextHidePruned')
              : t('agent_orchestrator.traces.detail.contextPruned', undefined, { count: pruned.length })}
          </button>
        ) : null}
      </div>
    </InspectorCard>
  )
}

// Guardrails — the run's persisted AgentGuardrailCheck verdicts (all checks,
// passed and tripped), each expandable to its redacted evidence + set version.
const GUARDRAIL_RESULT_VARIANT: Record<GuardrailCheckView['result'], 'success' | 'warning' | 'error'> = {
  pass: 'success',
  warn: 'warning',
  block: 'error',
}

function GuardrailsCard({ checks }: { checks: GuardrailCheckView[] }) {
  const t = useT()
  const [openId, setOpenId] = React.useState<string | null>(null)
  const passedCount = checks.filter((check) => check.result === 'pass').length
  return (
    <InspectorCard
      title={t('agent_orchestrator.traces.detail.guardrails')}
      hint={
        checks.length > 0
          ? t('agent_orchestrator.traces.detail.guardrailsHint', undefined, {
              passed: passedCount,
              total: checks.length,
            })
          : undefined
      }
    >
      {checks.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('agent_orchestrator.traces.detail.noGuardrailChecks')}</p>
      ) : (
        <ul className="space-y-1.5">
          {checks.map((check) => {
            const open = openId === check.id
            const expandable = check.evidence != null || check.guardrailSetVersion != null
            return (
              <li key={check.id} className="overflow-hidden rounded-lg border border-border">
                <button
                  type="button"
                  aria-expanded={expandable ? open : undefined}
                  onClick={() => setOpenId(open ? null : check.id)}
                  disabled={!expandable}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors enabled:hover:bg-muted/40"
                >
                  {check.result === 'pass' ? (
                    <ShieldCheck className="size-4 shrink-0 text-status-success-text" />
                  ) : (
                    <ShieldAlert
                      className={`size-4 shrink-0 ${check.result === 'block' ? 'text-status-error-text' : 'text-status-warning-text'}`}
                    />
                  )}
                  <span className="truncate font-mono text-xs text-foreground">{check.kind}</span>
                  <span className="shrink-0 rounded-md border border-border bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                    {t(`agent_orchestrator.traces.detail.guardrailPhase.${check.phase}`, check.phase)}
                  </span>
                  <span className="min-w-0 flex-1" />
                  <StatusBadge variant={GUARDRAIL_RESULT_VARIANT[check.result]}>
                    {t(`agent_orchestrator.traces.detail.guardrailResult.${check.result}`, check.result)}
                  </StatusBadge>
                  {expandable ? (
                    <ChevronRight
                      className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`}
                    />
                  ) : null}
                </button>
                {open && expandable ? (
                  <div className="space-y-2 border-t border-border bg-muted/30 px-3 py-2.5">
                    {check.guardrailSetVersion ? (
                      <p className="text-xs text-muted-foreground">
                        <span className="font-medium">{t('agent_orchestrator.traces.detail.guardrailSetVersion')}:</span>{' '}
                        <span className="font-mono">{check.guardrailSetVersion}</span>
                      </p>
                    ) : null}
                    {check.evidence != null ? (
                      <div>
                        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          {t('agent_orchestrator.traces.detail.guardrailEvidence')}
                        </p>
                        <JsonDisplay data={check.evidence} />
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </InspectorCard>
  )
}

// Illustrative (Sample) model comparison — a confidence-bar leaderboard so the
// speed/cost/quality trade-off reads at a glance instead of as a flat table.
const MODEL_ALTERNATIVES = [
  { model: 'claude-sonnet-4.x', confidence: 0.79, cost: 0.42 },
  { model: 'gpt-4o', confidence: 0.83, cost: 1.1 },
]

function ModelComparisonCard({ currentModel }: { currentModel: string | null }) {
  const t = useT()
  const current = { model: currentModel ?? 'gpt-4o-mini', confidence: 0.86, cost: 2.05, current: true }
  const rows = [current, ...MODEL_ALTERNATIVES.map((row) => ({ ...row, current: false }))]
  const cheapest = rows.reduce((min, row) => (row.cost < min.cost ? row : min), rows[0])
  const cheaperPct = Math.round((1 - cheapest.cost / current.cost) * 100)
  const confLowerPct = Math.round((1 - cheapest.confidence / current.confidence) * 100)
  const showVerdict = cheapest.model !== current.model && cheaperPct > 0 && confLowerPct >= 0
  return (
    <InspectorCard
      title={t('agent_orchestrator.traces.detail.modelComparison')}
      sampleLabel={t('agent_orchestrator.common.sample')}
    >
      <div className="flex items-center gap-3 pb-2 text-xs text-muted-foreground">
        <span className="min-w-0 flex-1" />
        <span className="w-16 text-right">{t('agent_orchestrator.traces.detail.confidence')}</span>
        <span className="w-16 text-right">{t('agent_orchestrator.traces.detail.cost')}</span>
      </div>
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.model} className="flex items-center gap-3 text-xs">
            <span className="flex min-w-0 flex-1 items-center gap-2 font-mono text-foreground">
              <span className="truncate">{row.model}</span>
              {row.current ? (
                <span className="shrink-0 rounded-md border border-border bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                  {t('agent_orchestrator.traces.detail.modelCurrent')}
                </span>
              ) : null}
              {!row.current && row.model === cheapest.model ? (
                <span className="shrink-0 rounded-md border border-border bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                  {t('agent_orchestrator.traces.detail.modelCheapest')}
                </span>
              ) : null}
            </span>
            <ConfidenceFaceValue confidence={row.confidence} display={row.confidence.toFixed(2)} className="w-16 justify-end text-muted-foreground" />
            <span className="w-16 text-right font-medium tabular-nums text-foreground">{row.cost.toFixed(2)} zł</span>
          </li>
        ))}
      </ul>
      {showVerdict ? (
        <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
          {t('agent_orchestrator.traces.detail.modelVerdict', undefined, {
            model: cheapest.model,
            cost: cheaperPct,
            conf: confLowerPct,
          })}
        </p>
      ) : null}
    </InspectorCard>
  )
}

// Tool calls as an accordion — each row expands to its captured request and
// response (both are real, redacted summaries from the trace).
/**
 * On-demand loader for a full offloaded trace artifact (F1). When the row
 * carries an artifact key, the inline view is a redacted preview; this fetches
 * and renders the full decrypted payload through the secured artifact endpoint.
 * Renders nothing when there is no key (the payload was stored inline).
 */
function ArtifactExpander({
  runId,
  artifactKey,
  kind,
}: {
  runId: string
  artifactKey: string | null
  kind: 'output' | 'tool_request' | 'tool_response'
}) {
  const t = useT()
  const [full, setFull] = React.useState<unknown>(undefined)
  const [isLoading, setIsLoading] = React.useState(false)

  if (!artifactKey) return null

  const loadFull = async () => {
    setIsLoading(true)
    const call = await apiCall<{ payload: unknown }>(
      `/api/agent_orchestrator/runs/${encodeURIComponent(runId)}/artifact?key=${encodeURIComponent(artifactKey)}&kind=${kind}`,
      undefined,
      { fallback: { payload: undefined } },
    )
    setIsLoading(false)
    if (!call.ok) {
      flash(t('agent_orchestrator.traces.detail.artifactError'), 'error')
      return
    }
    setFull(call.result?.payload ?? null)
  }

  if (full !== undefined) {
    return (
      <div className="space-y-1">
        <JsonDisplay data={full} />
        <Button variant="outline" size="sm" onClick={() => setFull(undefined)}>
          {t('agent_orchestrator.traces.detail.collapseArtifact')}
        </Button>
      </div>
    )
  }

  return (
    <Button variant="outline" size="sm" className="mt-1" onClick={loadFull} disabled={isLoading}>
      {isLoading
        ? t('agent_orchestrator.traces.detail.artifactLoading')
        : t('agent_orchestrator.traces.detail.loadFullArtifact')}
    </Button>
  )
}

/** Object/array summaries get the copy-affordance JSON view; strings keep the raw pre. */
function SummaryDisplay({ value }: { value: unknown }) {
  if (value != null && typeof value === 'object') {
    return <JsonDisplay data={value} />
  }
  return <pre className="max-h-40 overflow-auto rounded bg-muted px-2 py-1 text-xs">{formatSummary(value)}</pre>
}

function ToolCallsCard({ toolCalls, runId }: { toolCalls: ToolCallView[]; runId: string }) {
  const t = useT()
  const [openId, setOpenId] = React.useState<string | null>(toolCalls[0]?.id ?? null)
  return (
    <InspectorCard title={t('agent_orchestrator.traces.detail.toolCalls')}>
      {toolCalls.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('agent_orchestrator.traces.detail.noToolCalls')}</p>
      ) : (
        <div className="space-y-2">
          {toolCalls.map((toolCall) => {
            const open = openId === toolCall.id
            return (
              <div key={toolCall.id} className="overflow-hidden rounded-lg border border-border">
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setOpenId(open ? null : toolCall.id)}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/40"
                >
                  <span className="size-2 shrink-0 rounded-sm bg-accent-indigo" />
                  <span className="flex-1 truncate font-mono text-sm text-foreground">{toolCall.toolName}</span>
                  {toolCall.latencyMs != null ? (
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{toolCall.latencyMs}ms</span>
                  ) : null}
                  <StatusBadge variant={toolCall.status === 'error' ? 'error' : 'success'}>
                    {t(`agent_orchestrator.traces.detail.toolStatus.${toolCall.status ?? 'ok'}`, toolCall.status ?? 'ok')}
                  </StatusBadge>
                  <ChevronRight
                    className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`}
                  />
                </button>
                {open ? (
                  <div className="space-y-3 border-t border-border bg-muted/30 px-3 py-3">
                    {toolCall.errorMessage ? (
                      <p className="text-xs text-status-error-text">
                        <span className="font-medium">{t('agent_orchestrator.traces.detail.toolError')}:</span>{' '}
                        {toolCall.errorMessage}
                      </p>
                    ) : null}
                    {hasSummary(toolCall.requestSummary) ? (
                      <div>
                        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          {t('agent_orchestrator.traces.detail.toolRequest')}
                        </p>
                        <SummaryDisplay value={toolCall.requestSummary} />
                        <ArtifactExpander runId={runId} artifactKey={toolCall.requestArtifactKey} kind="tool_request" />
                      </div>
                    ) : null}
                    {hasSummary(toolCall.responseSummary) ? (
                      <div>
                        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          {t('agent_orchestrator.traces.detail.toolResponse')}
                        </p>
                        <SummaryDisplay value={toolCall.responseSummary} />
                        <ArtifactExpander runId={runId} artifactKey={toolCall.responseArtifactKey} kind="tool_response" />
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      )}
    </InspectorCard>
  )
}

// Real reasoning chain: the persisted rationale(s) of the run's proposal(s),
// then rationales of nested upstream findings carried in the run input — the
// same derivation the Caseload decision panel uses (`deriveReasoning`).
function ReasoningCard({ proposals, input }: { proposals: ProposalView[]; input: unknown }) {
  const t = useT()
  const items = React.useMemo(
    () => [
      ...proposals.flatMap((proposal) => deriveReasoning(proposal.rationale, null)),
      ...deriveReasoning(null, input),
    ],
    [proposals, input],
  )
  return (
    <InspectorCard
      title={t('agent_orchestrator.traces.detail.reasoning')}
      hint={
        items.length > 0
          ? t('agent_orchestrator.traces.detail.reasoningHint', undefined, { count: items.length })
          : undefined
      }
    >
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('agent_orchestrator.traces.detail.noReasoning')}</p>
      ) : (
        <ol className="space-y-2">
          {items.map((item, index) => (
            <li key={index} className="flex gap-3">
              <span className="grid size-5 shrink-0 place-items-center rounded-md bg-muted text-xs font-medium tabular-nums text-muted-foreground">
                {index + 1}
              </span>
              <span className="text-sm text-foreground">
                {item.label ? <span className="font-medium">{item.label}: </span> : null}
                {item.text}
              </span>
            </li>
          ))}
        </ol>
      )}
    </InspectorCard>
  )
}

export default function AgentRunTracePage({ params }: { params?: { id?: string } }) {
  const t = useT()
  const locale = useLocale()
  const router = useRouter()
  const runId = params?.id ?? ''
  const [detail, setDetail] = React.useState<RunDetailView | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [reloadToken, setReloadToken] = React.useState(0)
  const loadedRunRef = React.useRef<string | null>(null)
  const [addingToEvals, setAddingToEvals] = React.useState(false)
  const [inEvalSet, setInEvalSet] = React.useState(false)
  const [flagging, setFlagging] = React.useState(false)
  const [rerunning, setRerunning] = React.useState(false)

  const { runMutation, retryLastMutation } = useGuardedMutation<{ retryLastMutation: () => Promise<boolean> }>({
    contextId: 'agent_orchestrator.traces',
    blockedMessage: t('agent_orchestrator.proposal.flash.blocked'),
  })

  const addToEvals = React.useCallback(async () => {
    setAddingToEvals(true)
    try {
      let created = true
      await runMutation({
        operation: async () => {
          const call = await apiCallOrThrow<{ evalCase: { id: string; status: string }; created: boolean }>(
            `/api/agent_orchestrator/runs/${encodeURIComponent(runId)}/eval-case`,
            { method: 'POST' },
          )
          created = call.result?.created ?? true
        },
        context: { retryLastMutation },
      })
      setInEvalSet(true)
      flash(
        created
          ? t('agent_orchestrator.traces.detail.actionAddEvalDone')
          : t('agent_orchestrator.traces.detail.actionAddEvalExists'),
        'success',
      )
    } catch (err) {
      flash(err instanceof Error ? err.message : t('agent_orchestrator.traces.detail.actionAddEvalError'), 'error')
    } finally {
      setAddingToEvals(false)
    }
  }, [runMutation, retryLastMutation, runId, t])

  const toggleFlag = React.useCallback(async () => {
    setFlagging(true)
    try {
      let flagState: { flagged: boolean; flaggedAt: string | null } | null = null
      await runMutation({
        operation: async () => {
          const call = await apiCallOrThrow<{ flagged: boolean; flaggedAt: string | null }>(
            `/api/agent_orchestrator/runs/${encodeURIComponent(runId)}/flag`,
            { method: 'POST' },
          )
          flagState = call.result ?? null
        },
        context: { retryLastMutation },
      })
      if (flagState) {
        const next = flagState as { flagged: boolean; flaggedAt: string | null }
        setDetail((current) =>
          current ? { ...current, run: { ...current.run, flaggedAt: next.flaggedAt } } : current,
        )
        flash(
          next.flagged
            ? t('agent_orchestrator.traces.detail.actionFlagDone')
            : t('agent_orchestrator.traces.detail.actionUnflagDone'),
          'success',
        )
      }
    } catch (err) {
      flash(err instanceof Error ? err.message : t('agent_orchestrator.traces.detail.actionFlagError'), 'error')
    } finally {
      setFlagging(false)
    }
  }, [runMutation, retryLastMutation, runId, t])

  const rerunAgent = React.useCallback(async () => {
    setRerunning(true)
    try {
      let newRunId: string | null = null
      await runMutation({
        operation: async () => {
          const call = await apiCallOrThrow<{ runId: string | null }>(
            `/api/agent_orchestrator/runs/${encodeURIComponent(runId)}/rerun`,
            { method: 'POST' },
          )
          newRunId = call.result?.runId ?? null
        },
        context: { retryLastMutation },
      })
      flash(t('agent_orchestrator.traces.detail.actionRerunDone'), 'success')
      if (newRunId) router.push(`/backend/traces/${encodeURIComponent(newRunId)}`)
    } catch (err) {
      flash(err instanceof Error ? err.message : t('agent_orchestrator.traces.detail.actionRerunError'), 'error')
    } finally {
      setRerunning(false)
    }
  }, [runMutation, retryLastMutation, runId, router, t])

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      // Live-refresh reloads (same run already rendered) refetch silently —
      // no loading flash while the operator is reading the trace.
      const silent = loadedRunRef.current === runId
      if (!silent) setIsLoading(true)
      setError(null)
      const call = await apiCall<Record<string, unknown>>(
        `/api/agent_orchestrator/runs/${encodeURIComponent(runId)}`,
        undefined,
        { fallback: {} },
      )
      if (cancelled) return
      if (!call.ok) {
        setError(t('agent_orchestrator.traces.detail.error'))
        setIsLoading(false)
        return
      }
      loadedRunRef.current = runId
      setDetail(mapRunDetail(call.result ?? {}))
      setIsLoading(false)
    }
    if (runId) void load()
    return () => {
      cancelled = true
    }
  }, [t, runId, reloadToken])

  // Live refresh: a "Running" trace updates when its run completes or its
  // trace ingests (broadcast payloads carry the run id — filter client-side).
  const coalescedDetailReload = useCoalescedReload(
    React.useCallback(() => setReloadToken((token) => token + 1), []),
  )
  useAppEvent(
    'agent_orchestrator.run.completed',
    (event) => {
      if (event.payload?.id === runId) coalescedDetailReload()
    },
    [runId],
  )
  useAppEvent(
    'agent_orchestrator.run.ingested',
    (event) => {
      if (event.payload?.id === runId) coalescedDetailReload()
    },
    [runId],
  )

  const timeline = React.useMemo(
    () => (detail ? buildTimeline(detail.spans, detail.run.latencyMs) : null),
    [detail],
  )

  return (
    <Page>
      <PageBody>
        <div className="mb-4">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              if (!isLoading && (error || !detail)) router.back()
              else router.push('/backend/traces')
            }}
          >
            {t('agent_orchestrator.traces.detail.back')}
          </Button>
        </div>

        {isLoading ? (
          <LoadingMessage label={t('agent_orchestrator.traces.detail.title')} />
        ) : error ? (
          <ErrorMessage label={error} />
        ) : !detail ? (
          <ErrorMessage label={t('agent_orchestrator.traces.detail.error')} />
        ) : (
          (() => {
            const run = detail.run
            // Skipped results (passed === null) are excluded from BOTH sides of the
            // ratio: counting them in the denominator would report "3 of 5 passed"
            // for a run where two assertions never applied.
            const evalApplied = detail.evalResults.filter((result) => result.passed !== null)
            const evalTotal = evalApplied.length
            const evalPass = evalApplied.filter((result) => result.passed === true).length
            const evalSkipped = detail.evalResults.length - evalTotal
            const allPassed = evalTotal > 0 && evalPass === evalTotal
            const tokensTotal =
              run.inputTokens != null || run.outputTokens != null
                ? (run.inputTokens ?? 0) + (run.outputTokens ?? 0)
                : null
            const gated = run.humanConfirmedAt == null && run.resultKind === 'actionable'
            const runLabel = run.externalRunId ?? `RUN-${run.id.slice(0, 8)}`
            const subtitle = [
              run.agentVersion ? `v${run.agentVersion}` : null,
              run.model,
              run.runtime,
            ].filter(Boolean).join(' — ')
            const axisTicks = timeline
              ? [0, 0.25, 0.5, 0.75, 1].map((fraction) => formatDurationMs(timeline.totalMs * fraction) ?? '')
              : []
            return (
              <div className="space-y-6">
                {/* Header + run stats — one card */}
                <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
                  <div className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-mono font-medium text-brand-violet">{runLabel}</span>
                      <span className="rounded-md border border-border bg-muted px-1.5 py-0.5 text-muted-foreground">
                        {t('agent_orchestrator.traces.detail.spansCount', undefined, { count: detail.spans.length })}
                      </span>
                      <StatusBadge variant={runStatusVariant(run.status)}>
                        {t(runStatusLabelKey(run.status))}
                      </StatusBadge>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {evalTotal > 0 ? (
                        <StatusBadge variant={allPassed ? 'success' : 'error'}>
                          {t('agent_orchestrator.traces.detail.evalsBadge', undefined, {
                            passed: evalPass,
                            total: evalTotal,
                          })}
                        </StatusBadge>
                      ) : null}
                      {gated ? (
                        <StatusBadge variant="info">{t('agent_orchestrator.traces.detail.gated')}</StatusBadge>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h1 className="text-2xl font-bold tracking-tight text-foreground">{run.agentId}</h1>
                      {subtitle ? <p className="mt-0.5 font-mono text-sm text-muted-foreground">{subtitle}</p> : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {detail.proposals.length === 1 ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => router.push(`/backend/caseload/${encodeURIComponent(detail.proposals[0].id)}`)}
                        >
                          <Inbox className="size-4" />
                          {t('agent_orchestrator.traces.detail.openProposal')}
                        </Button>
                      ) : detail.proposals.length > 1 ? (
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button variant="outline" size="sm">
                              <Inbox className="size-4" />
                              {t('agent_orchestrator.traces.detail.openProposal')}
                              <ChevronRight className="size-4 rotate-90" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent align="end" className="w-64 p-1">
                            <div className="flex flex-col">
                              {[...detail.proposals]
                                .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''))
                                .map((proposal) => (
                                  <button
                                    key={proposal.id}
                                    type="button"
                                    onClick={() => router.push(`/backend/caseload/${encodeURIComponent(proposal.id)}`)}
                                    className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-muted/60"
                                  >
                                    <span className="truncate font-mono text-xs">{proposal.id.slice(0, 8)}</span>
                                    <span className="shrink-0 text-xs text-muted-foreground">
                                      {formatDateTime(proposal.createdAt, locale) ?? ''}
                                    </span>
                                  </button>
                                ))}
                            </div>
                          </PopoverContent>
                        </Popover>
                      ) : null}
                      {run.processId ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => router.push(`/backend/processes/${encodeURIComponent(run.processId!)}`)}
                        >
                          <Workflow className="size-4" />
                          {t('agent_orchestrator.proposal.openProcess')}
                        </Button>
                      ) : null}
                      {inEvalSet ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => router.push('/backend/eval-cases?status=draft')}
                        >
                          <ClipboardCheck className="size-4" />
                          {t('agent_orchestrator.traces.detail.actionViewEvalSet')}
                        </Button>
                      ) : (
                        <Button size="sm" onClick={() => void addToEvals()} disabled={addingToEvals}>
                          <Plus className="size-4" />
                          {t('agent_orchestrator.traces.detail.actionAddEval')}
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void rerunAgent()}
                        disabled={rerunning}
                      >
                        <RotateCcw className="size-4" />
                        {t('agent_orchestrator.traces.detail.actionRerun')}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void toggleFlag()}
                        disabled={flagging}
                      >
                        <Flag className={run.flaggedAt ? 'size-4 text-status-warning-text' : 'size-4'} />
                        {run.flaggedAt
                          ? t('agent_orchestrator.traces.detail.actionUnflag')
                          : t('agent_orchestrator.traces.detail.actionFlag')}
                      </Button>
                    </div>
                  </div>

                  {run.errorMessage ? (
                    <div className="mt-4 rounded-md border border-status-error-border bg-status-error-bg px-3 py-2 text-sm text-status-error-text">
                      <span className="font-medium">{t('agent_orchestrator.traces.detail.runError')}:</span>{' '}
                      {run.errorMessage}
                    </div>
                  ) : null}
                  </div>

                  {/* Run stats — same card, hairline-divided spec grid */}
                  <div className="grid grid-cols-2 gap-px border-t border-border bg-border sm:grid-cols-4">
                    <StatCell
                      icon={run.confidence != null ? confidenceFace(confidencePctOf(run.confidence)!).Icon : Target}
                      iconClassName={run.confidence != null ? confidenceFace(confidencePctOf(run.confidence)!).color : undefined}
                      label={t('agent_orchestrator.traces.detail.confidence')}
                      value={formatConfidence(run.confidence) ?? '—'}
                    />
                    <StatCell
                      icon={Timer}
                      label={t('agent_orchestrator.traces.detail.duration')}
                      value={formatDurationMs(run.latencyMs) ?? '—'}
                    />
                    <StatCell
                      icon={Hash}
                      label={t('agent_orchestrator.traces.detail.tokens')}
                      value={formatTokens(tokensTotal) ?? '—'}
                    />
                    <StatCell
                      icon={Coins}
                      label={t('agent_orchestrator.traces.detail.cost')}
                      value={formatCostMinor(run.costMinor, run.currency) ?? '—'}
                    />
                    <StatCell
                      icon={Wrench}
                      label={t('agent_orchestrator.traces.detail.toolCalls')}
                      value={String(detail.toolCalls.length)}
                    />
                    <StatCell
                      icon={Play}
                      label={t('agent_orchestrator.traces.detail.started')}
                      value={formatDateTime(run.createdAt, locale) ?? '—'}
                    />
                    <StatCell
                      icon={Flag}
                      label={t('agent_orchestrator.traces.detail.finished')}
                      value={formatDateTime(run.completedAt, locale) ?? '—'}
                    />
                    <StatCell
                      icon={Cpu}
                      label={t('agent_orchestrator.traces.detail.runtimeLabel')}
                      value={run.runtime ?? '—'}
                    />
                  </div>
                </section>

                {/* Execution timeline + Evaluation results — two columns */}
                <div className="grid gap-6 lg:grid-cols-2">
                <InspectorCard
                      title={t('agent_orchestrator.traces.detail.timeline')}
                      hint={
                        timeline
                          ? t('agent_orchestrator.traces.detail.timelineTotal', undefined, {
                              total: formatDurationMs(timeline.totalMs) ?? '',
                            })
                          : undefined
                      }
                    >
                      {detail.spans.length === 0 || !timeline ? (
                        <p className="text-sm text-muted-foreground">
                          {t('agent_orchestrator.traces.detail.noSpans')}
                        </p>
                      ) : (
                        <div className="space-y-1.5">
                          {detail.spans.map((span) => {
                            const start = parseTime(span.startedAt)
                            const offsetMs = start != null ? Math.max(0, start - timeline.startMs) : 0
                            const leftPct = Math.max(0, Math.min(100, (offsetMs / timeline.totalMs) * 100))
                            const rawWidth = ((span.durationMs ?? 0) / timeline.totalMs) * 100
                            const widthPct = Math.max(1.5, Math.min(100 - leftPct, rawWidth))
                            return (
                              <div key={span.id} className="flex items-center gap-3">
                                <div className="flex w-44 shrink-0 items-center gap-2">
                                  <span className={`size-2 shrink-0 rounded-sm ${spanBarClass(span.kind)}`} />
                                  <span className="truncate font-mono text-xs text-foreground">{span.name}</span>
                                </div>
                                <div className="relative h-5 flex-1 rounded bg-muted/60">
                                  <div
                                    className={`absolute top-1/2 h-2.5 -translate-y-1/2 rounded ${spanBarClass(span.kind)} ${span.status === 'error' ? 'opacity-60 ring-1 ring-status-error-border' : ''}`}
                                    style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                                  />
                                </div>
                                <span className="w-14 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                                  {formatDurationMs(span.durationMs) ?? ''}
                                </span>
                              </div>
                            )
                          })}
                          <div className="flex items-center gap-3 pt-1.5">
                            <div className="w-44 shrink-0" />
                            <div className="flex flex-1 justify-between text-xs tabular-nums text-muted-foreground">
                              {axisTicks.map((tick, index) => (
                                <span key={index}>{tick}</span>
                              ))}
                            </div>
                            <div className="w-14 shrink-0" />
                          </div>
                          {/* Span-kind legend — teaches the bar colors without changing them. */}
                          <div className="flex items-center gap-4 pt-2 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1.5">
                              <span className={`size-2 rounded-sm ${SPAN_KIND_BAR.llm}`} />
                              {t('agent_orchestrator.traces.detail.legend.llm')}
                            </span>
                            <span className="flex items-center gap-1.5">
                              <span className={`size-2 rounded-sm ${SPAN_KIND_BAR.tool}`} />
                              {t('agent_orchestrator.traces.detail.legend.tool')}
                            </span>
                          </div>
                        </div>
                      )}
                </InspectorCard>

                {/* Eval assertions — the trust verdict */}
                <InspectorCard title={t('agent_orchestrator.traces.detail.evalResults')}>
                      {detail.evalResults.length === 0 ? (
                        <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
                          <EmptyArt className="size-28 text-muted-foreground" />
                          <p className="text-sm text-muted-foreground">
                            {t('agent_orchestrator.traces.detail.noEvalResults')}
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {evalTotal === 0 ? (
                            // Every assertion skipped — neither a pass nor a fail.
                            <div className="flex items-center gap-3 rounded-lg border border-border bg-muted px-3 py-2.5">
                              <span className="text-sm text-muted-foreground">
                                {t('agent_orchestrator.traces.detail.evalAllSkipped', undefined, {
                                  skipped: evalSkipped,
                                })}
                              </span>
                            </div>
                          ) : (
                          <div
                            className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 ${allPassed ? 'border-status-success-border bg-status-success-bg' : 'border-status-error-border bg-status-error-bg'}`}
                          >
                            <span
                              className={`text-xl font-bold tabular-nums ${allPassed ? 'text-status-success-text' : 'text-status-error-text'}`}
                            >
                              {evalPass}/{evalTotal}
                            </span>
                            <span
                              className={`text-sm ${allPassed ? 'text-status-success-text' : 'text-status-error-text'}`}
                            >
                              {allPassed
                                ? t('agent_orchestrator.traces.detail.evalAllPassed')
                                : t('agent_orchestrator.traces.detail.evalSomeFailed', undefined, {
                                    failed: evalTotal - evalPass,
                                    total: evalTotal,
                                  })}
                            </span>
                            {evalSkipped > 0 ? (
                              <span className="ml-auto text-xs text-muted-foreground">
                                {t('agent_orchestrator.traces.detail.evalSkippedCount', undefined, {
                                  skipped: evalSkipped,
                                })}
                              </span>
                            ) : null}
                          </div>
                          )}
                          <ul className="space-y-1.5">
                            {detail.evalResults.map((result) => (
                              <li key={result.id} className="flex items-center gap-2">
                                {result.passed === null ? (
                                  <MinusCircle
                                    className="size-4 shrink-0 text-muted-foreground"
                                    aria-label={t('agent_orchestrator.traces.detail.evalSkipped')}
                                  />
                                ) : result.passed ? (
                                  <Check className="size-4 shrink-0 text-status-success-text" />
                                ) : (
                                  <X className="size-4 shrink-0 text-status-error-text" />
                                )}
                                <span
                                  className={
                                    result.passed === null
                                      ? 'truncate font-mono text-xs text-muted-foreground'
                                      : 'truncate font-mono text-xs text-foreground'
                                  }
                                >
                                  {result.assertionKey}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                </InspectorCard>
                </div>

                {/* Tool calls + Output — two columns */}
                <div className="grid gap-6 lg:grid-cols-2">
                  <ToolCallsCard toolCalls={detail.toolCalls} runId={run.id} />
                  <InspectorCard title={t('agent_orchestrator.traces.detail.output')}>
                    {run.output != null ? (
                      <div className="space-y-1">
                        <JsonDisplay data={run.output} />
                        <ArtifactExpander runId={run.id} artifactKey={run.outputArtifactKey} kind="output" />
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
                        <EmptyArt className="size-28 text-muted-foreground" />
                        <p className="text-sm text-muted-foreground">{t('agent_orchestrator.traces.detail.noOutput')}</p>
                      </div>
                    )}
                  </InspectorCard>
                </div>

                {/* Run analysis: Reasoning + Guardrails + Context assembled (TDCR) — three columns */}
                <div className="grid gap-6 lg:grid-cols-3">
                  <ReasoningCard proposals={detail.proposals} input={run.input} />
                  <GuardrailsCard checks={detail.guardrailChecks} />
                  <ContextAssembledCard bundle={detail.contextBundle} />
                </div>

                {/* Illustrative — mock sections grouped + de-emphasized at the bottom */}
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {t('agent_orchestrator.traces.detail.illustrative')}
                    </span>
                    <div className="h-px flex-1 bg-border" />
                  </div>
                  <div className="grid gap-6 lg:grid-cols-2">
                    <ModelComparisonCard currentModel={run.model} />
                  </div>
                </div>
              </div>
            )
          })()
        )}
      </PageBody>
    </Page>
  )
}
