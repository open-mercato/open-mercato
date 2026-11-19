"use client"

import * as React from 'react'
import { AlertTriangle, Check, CheckCircle2, ClipboardCheck, FlaskConical, MinusCircle, Plus, X, XCircle } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { JsonDisplay } from '@open-mercato/ui/backend/JsonDisplay'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { mapRunDetail, type EvalResultView, type RunDetailView } from '../../components/types'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@open-mercato/ui/primitives/table'

type PanelState = 'loading' | 'ready' | 'forbidden'

/**
 * Post-run evaluation watch panel for the Playground. Every run is scored online
 * against its agent's assertions; this surfaces those verdicts, and — when the
 * input matched an approved golden case — the run's actual-vs-expected diff plus
 * the golden's own rules. On no match, offers to capture the run as a golden case.
 */
export function PlaygroundEvalPanel({ runId, agentId }: { runId: string; agentId: string }) {
  const t = useT()
  const [detail, setDetail] = React.useState<RunDetailView | null>(null)
  const [state, setState] = React.useState<PanelState>('loading')
  const [savedGolden, setSavedGolden] = React.useState(false)
  const [savingGolden, setSavingGolden] = React.useState(false)
  const { runMutation, retryLastMutation } = useGuardedMutation<{ retryLastMutation: () => Promise<boolean> }>({
    contextId: 'agent_orchestrator.playground.eval',
  })

  React.useEffect(() => {
    let cancelled = false
    setState('loading')
    setDetail(null)
    setSavedGolden(false)
    async function load() {
      const call = await apiCall<Record<string, unknown>>(
        `/api/agent_orchestrator/runs/${encodeURIComponent(runId)}`,
        undefined,
        { fallback: {} },
      )
      if (cancelled) return
      if (!call.ok || !call.result) {
        setState('forbidden')
        return
      }
      setDetail(mapRunDetail(call.result))
      setState('ready')
    }
    load()
    return () => {
      cancelled = true
    }
  }, [runId])

  const online = (detail?.evalResults ?? []).filter((row) => !row.matchedEvalCaseId)
  const golden = (detail?.evalResults ?? []).filter((row) => row.matchedEvalCaseId)
  // Only surface golden verdicts that ADD information over the online list: an
  // assertion the online plane skipped (expected-based, so only the golden plane
  // could score it) or one with no online counterpart. Expected-agnostic
  // assertions produce identical verdicts on both planes — don't list them twice.
  const onlineByKey = new Map(online.map((row) => [row.assertionKey, row]))
  const goldenExtra = golden.filter((row) => {
    const counterpart = onlineByKey.get(row.assertionKey)
    return !counterpart || counterpart.passed === null
  })
  const applied = online.filter((row) => row.passed !== null)
  const matched = detail?.goldenCase ?? null
  // Overall run verdict: a failed gate fails the run; a failed warn downgrades a
  // pass to "pass with warnings"; no applicable assertions → not evaluated.
  const gateFailed = applied.some((row) => row.severity === 'gate' && row.passed === false)
  const warnFailed = applied.some((row) => row.severity === 'warn' && row.passed === false)
  const verdict: RunVerdict = applied.length === 0 ? 'none' : gateFailed ? 'failed' : warnFailed ? 'warnings' : 'passed'

  const saveGolden = React.useCallback(async () => {
    setSavingGolden(true)
    try {
      await runMutation({
        operation: async () => {
          await apiCallOrThrow(`/api/agent_orchestrator/runs/${encodeURIComponent(runId)}/eval-case`, { method: 'POST' })
        },
        context: { retryLastMutation },
        mutationPayload: { runId },
      })
      setSavedGolden(true)
      flash(t('agent_orchestrator.playground.eval.savedGolden', 'Saved as a draft golden case.'), 'success')
    } catch (err) {
      flash(err instanceof Error ? err.message : t('agent_orchestrator.playground.eval.saveGoldenError', 'Could not save golden case.'), 'error')
    } finally {
      setSavingGolden(false)
    }
  }, [runId, runMutation, retryLastMutation, t])

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <FlaskConical className="size-4 text-muted-foreground" />
          <span className="text-sm font-semibold text-foreground">{t('agent_orchestrator.playground.eval.title', 'Evaluation')}</span>
        </div>
        {state === 'ready' ? (
          <div className="flex items-center gap-2">
            {matched ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-status-info-border bg-status-info-bg px-2 py-0.5 text-xs font-medium text-status-info-text">
                <FlaskConical className="size-3" />
                {t('agent_orchestrator.playground.eval.goldenBadge', 'Golden matched')}
              </span>
            ) : null}
            <VerdictBadge verdict={verdict} t={t} />
          </div>
        ) : null}
      </div>

      <div className="space-y-5 p-4">
        {state === 'loading' ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner className="size-4" />{t('agent_orchestrator.playground.eval.loading', 'Scoring this run…')}</div>
        ) : state === 'forbidden' ? (
          <p className="text-sm text-muted-foreground">{t('agent_orchestrator.playground.eval.forbidden', 'You don’t have permission to view this run’s evaluation.')}</p>
        ) : (
          <>
            <section className="space-y-2">
              <SectionHeader title={t('agent_orchestrator.playground.eval.assertions', 'Assertions on this run')} />
              {online.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('agent_orchestrator.playground.eval.noAssertions', 'No assertions apply to this agent yet.')}</p>
              ) : (
                <AssertionTable rows={online} t={t} />
              )}
            </section>

            {matched ? (
              <section className="space-y-3">
                <div className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/40 px-3.5 py-2.5">
                  {goldenIcon(detail?.run.goldenPassed ?? null)}
                  <div className="text-sm text-foreground">
                    <span className="font-semibold">{t(goldenTitleKey(detail?.run.goldenPassed ?? null), goldenTitleFallback(detail?.run.goldenPassed ?? null))}</span>
                    <span className="ml-1 font-mono text-xs text-muted-foreground">{matched.id.slice(0, 8)}</span>
                  </div>
                </div>
                {goldenExtra.length > 0 ? <AssertionTable rows={goldenExtra} t={t} /> : null}
                <SectionHeader title={t('agent_orchestrator.playground.eval.diff', 'Actual vs expected')} />
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  <div>
                    <p className="mb-1 text-overline font-semibold uppercase tracking-widest text-muted-foreground">{t('agent_orchestrator.playground.eval.actual', 'Actual')}</p>
                    <JsonDisplay data={detail?.run.output ?? null} />
                  </div>
                  <div>
                    <p className="mb-1 text-overline font-semibold uppercase tracking-widest text-muted-foreground">{t('agent_orchestrator.playground.eval.expected', 'Expected (golden)')}</p>
                    <JsonDisplay data={matched.expected ?? null} />
                  </div>
                </div>
              </section>
            ) : (
              <section className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-border px-3.5 py-3">
                <p className="text-sm text-muted-foreground">{t('agent_orchestrator.playground.eval.noMatch', 'No golden case matches this input yet.')}</p>
                {savedGolden ? (
                  <span className="inline-flex items-center gap-1.5 text-sm text-status-success-text"><ClipboardCheck className="size-4" />{t('agent_orchestrator.playground.eval.savedGoldenShort', 'Saved as draft golden')}</span>
                ) : (
                  <Button type="button" variant="outline" size="sm" disabled={savingGolden} onClick={saveGolden}>
                    <Plus className="mr-1.5 size-3.5" />
                    {t('agent_orchestrator.playground.eval.saveGolden', 'Save as golden case')}
                  </Button>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  )
}

type RunVerdict = 'passed' | 'warnings' | 'failed' | 'none'

function VerdictBadge({ verdict, t }: { verdict: RunVerdict; t: ReturnType<typeof useT> }) {
  const meta = {
    passed: { variant: 'success' as const, Icon: CheckCircle2, key: 'agent_orchestrator.playground.eval.verdict.passed', fallback: 'Passed' },
    warnings: { variant: 'warning' as const, Icon: AlertTriangle, key: 'agent_orchestrator.playground.eval.verdict.warnings', fallback: 'Pass with warnings' },
    failed: { variant: 'error' as const, Icon: XCircle, key: 'agent_orchestrator.playground.eval.verdict.failed', fallback: 'Failed' },
    none: { variant: 'neutral' as const, Icon: MinusCircle, key: 'agent_orchestrator.playground.eval.verdict.none', fallback: 'Not evaluated' },
  }[verdict]
  return (
    <StatusBadge variant={meta.variant}>
      <meta.Icon className="size-3.5" />
      {t(meta.key, meta.fallback)}
    </StatusBadge>
  )
}

function AssertionTable({ rows, t }: { rows: EvalResultView[]; t: ReturnType<typeof useT> }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-9" aria-hidden="true" />
            <TableHead>{t('agent_orchestrator.playground.eval.col.assertion', 'Assertion')}</TableHead>
            <TableHead>{t('agent_orchestrator.playground.eval.col.severity', 'Severity')}</TableHead>
            <TableHead>{t('agent_orchestrator.playground.eval.col.actual', 'Actual')}</TableHead>
            <TableHead>{t('agent_orchestrator.playground.eval.col.expected', 'Expected')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const meta = verdictMeta(row.passed)
            const { actual, expected } = evidenceActualExpected(row.evidence)
            const actualText = row.passed === null
              ? t('agent_orchestrator.playground.eval.skipped', 'skipped')
              : actual ?? t(meta.labelKey, meta.labelFallback)
            return (
              <TableRow key={row.id}>
                <TableCell><meta.Icon className={`size-4 ${meta.className}`} /></TableCell>
                <TableCell className="whitespace-nowrap font-mono text-foreground">{row.assertionKey}</TableCell>
                <TableCell className="text-muted-foreground">{t(`agent_orchestrator.playground.eval.severity.${row.severity}`, row.severity)}</TableCell>
                <TableCell className="max-w-[280px] truncate font-mono text-foreground" title={actual ?? undefined}>{actualText}</TableCell>
                <TableCell className="whitespace-nowrap font-mono text-muted-foreground">{expected ?? '—'}</TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

const OP_SYMBOL: Record<string, string> = { eq: '=', ne: '≠', gt: '>', gte: '≥', lt: '<', lte: '≤', contains: '⊇', in: '∈' }

function formatEvidenceValue(value: unknown): string {
  if (value === '') return '∅'
  if (value === null || value === undefined) return '—'
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2)
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/**
 * Turns a scorer's `evidence` into a human-readable (actual, expected) pair so
 * each assertion row shows WHAT it checked and WHAT it observed — not a bare
 * 0–1 score. Covers the json_path_compare and confidence_threshold evidence
 * shapes; unknown shapes fall back to just the actual, or the verdict word.
 */
function evidenceActualExpected(evidence: unknown): { actual: string | null; expected: string | null } {
  if (evidence && typeof evidence === 'object' && !Array.isArray(evidence)) {
    const rec = evidence as Record<string, unknown>
    if ('operator' in rec && 'actual' in rec) {
      const op = OP_SYMBOL[String(rec.operator)] ?? String(rec.operator)
      return { actual: formatEvidenceValue(rec.actual), expected: `${op} ${formatEvidenceValue(rec.value)}` }
    }
    if ('confidence' in rec && 'threshold' in rec) {
      const dir = rec.direction === 'lte' ? '≤' : '≥'
      return { actual: formatEvidenceValue(rec.confidence), expected: `${dir} ${formatEvidenceValue(rec.threshold)}` }
    }
    if ('actual' in rec) return { actual: formatEvidenceValue(rec.actual), expected: null }
  }
  return { actual: null, expected: null }
}

function verdictMeta(passed: boolean | null): {
  Icon: React.ComponentType<{ className?: string }>
  className: string
  labelKey: string
  labelFallback: string
} {
  if (passed === null) return { Icon: MinusCircle, className: 'text-muted-foreground', labelKey: 'agent_orchestrator.playground.eval.skipped', labelFallback: 'skipped' }
  if (passed) return { Icon: Check, className: 'text-status-success-icon', labelKey: 'agent_orchestrator.playground.eval.pass', labelFallback: 'pass' }
  return { Icon: X, className: 'text-status-error-icon', labelKey: 'agent_orchestrator.playground.eval.fail', labelFallback: 'fail' }
}

function goldenIcon(passed: boolean | null) {
  if (passed === true) return <Check className="mt-0.5 size-4 shrink-0 text-status-success-icon" />
  if (passed === false) return <X className="mt-0.5 size-4 shrink-0 text-status-error-icon" />
  return <FlaskConical className="mt-0.5 size-4 shrink-0 text-status-info-icon" />
}

function goldenTitleKey(passed: boolean | null): string {
  if (passed === true) return 'agent_orchestrator.playground.eval.goldenPassed'
  if (passed === false) return 'agent_orchestrator.playground.eval.goldenFailed'
  return 'agent_orchestrator.playground.eval.goldenAdvisory'
}

function goldenTitleFallback(passed: boolean | null): string {
  if (passed === true) return 'Matched a golden case — passed'
  if (passed === false) return 'Matched a golden case — failed'
  return 'Matched a golden case — advisory (no gate)'
}
