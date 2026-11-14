"use client"

import * as React from 'react'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { Kbd, KbdShortcut } from '@open-mercato/ui/primitives/kbd'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@open-mercato/ui/primitives/table'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { mapRun, type RunView, type SpanView } from '../types'
import {
  buildCompareCandidatesUrl,
  buildCompareUrl,
  candidateLabel,
  countLlmSteps,
  formatDiffValue,
  parseRunCompareResult,
  pickDefaultCompareTarget,
  previousRunCandidates,
  type CompareCandidate,
  type CompareContentStatus,
  type CompareFieldDiff,
  type CompareJsonDiff,
  type CompareSubject,
  type CompareTextDiff,
  type RunCompareResult,
  type RunCompareSide,
} from './runCompareView'

export type RunCompareDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  run: CompareSubject & Pick<RunView, 'externalRunId'>
  spans: readonly SpanView[]
}

type CompareState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ok'; result: RunCompareResult }

const CONTENT_STATUS_VARIANT: Record<CompareContentStatus, StatusBadgeVariant> = {
  ok: 'success',
  expired: 'warning',
  unavailable: 'error',
  not_captured: 'neutral',
  forbidden: 'neutral',
}

const TEXT_LINE_CLASS: Record<CompareTextDiff['lines'][number]['op'], string> = {
  equal: 'text-foreground',
  added: 'bg-status-success-bg text-status-success-text',
  removed: 'bg-status-error-bg text-status-error-text',
}

const TEXT_LINE_PREFIX: Record<CompareTextDiff['lines'][number]['op'], string> = {
  equal: ' ',
  added: '+',
  removed: '-',
}

const JSON_OP_VARIANT: Record<CompareJsonDiff['entries'][number]['op'], StatusBadgeVariant> = {
  added: 'success',
  removed: 'error',
  changed: 'warning',
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</h3>
}

function ValueCell({ value }: { value: unknown }) {
  return <span className="block max-w-xs break-all font-mono text-xs text-foreground">{formatDiffValue(value)}</span>
}

function NoDifferences() {
  const t = useT()
  return <p className="text-sm text-muted-foreground">{t('agent_orchestrator.trace.compare.noDifferences')}</p>
}

function TruncatedBadge({ truncated }: { truncated: boolean }) {
  const t = useT()
  if (!truncated) return null
  return <StatusBadge variant="warning">{t('agent_orchestrator.trace.compare.truncated')}</StatusBadge>
}

function FieldDiffSection({ title, diffs, testId }: { title: string; diffs: CompareFieldDiff[]; testId: string }) {
  const t = useT()
  return (
    <section className="space-y-2" data-testid={testId}>
      <SectionTitle>{title}</SectionTitle>
      {diffs.length === 0 ? (
        <NoDifferences />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('agent_orchestrator.trace.compare.field')}</TableHead>
                <TableHead>{t('agent_orchestrator.trace.compare.thisRun')}</TableHead>
                <TableHead>{t('agent_orchestrator.trace.compare.otherRun')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {diffs.map((diff) => (
                <TableRow key={diff.key}>
                  <TableCell className="break-all font-mono text-xs text-muted-foreground">{diff.key}</TableCell>
                  <TableCell>
                    <ValueCell value={diff.left} />
                  </TableCell>
                  <TableCell>
                    <ValueCell value={diff.right} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  )
}

function TextDiffSection({ diff }: { diff: CompareTextDiff }) {
  const t = useT()
  return (
    <section className="space-y-2" data-testid="compare-system-prompt">
      <div className="flex flex-wrap items-center gap-2">
        <SectionTitle>{t('agent_orchestrator.trace.compare.systemPrompt')}</SectionTitle>
        <TruncatedBadge truncated={diff.truncated} />
      </div>
      {!diff.changed ? (
        <NoDifferences />
      ) : (
        <div className="max-h-96 overflow-auto rounded-md border border-border bg-muted">
          <pre className="font-mono text-xs">
            {diff.lines.map((line, index) => (
              <div key={index} data-op={line.op} className={`whitespace-pre-wrap break-words px-3 ${TEXT_LINE_CLASS[line.op]}`}>
                <span aria-hidden="true" className="mr-2 select-none">
                  {TEXT_LINE_PREFIX[line.op]}
                </span>
                {line.text}
              </div>
            ))}
          </pre>
        </div>
      )}
    </section>
  )
}

function JsonDiffSection({ title, diff, testId }: { title: string; diff: CompareJsonDiff; testId: string }) {
  const t = useT()
  return (
    <section className="space-y-2" data-testid={testId}>
      <div className="flex flex-wrap items-center gap-2">
        <SectionTitle>{title}</SectionTitle>
        <TruncatedBadge truncated={diff.truncated} />
      </div>
      {!diff.changed ? (
        <NoDifferences />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('agent_orchestrator.trace.compare.path')}</TableHead>
                <TableHead>{t('agent_orchestrator.trace.compare.change')}</TableHead>
                <TableHead>{t('agent_orchestrator.trace.compare.thisRun')}</TableHead>
                <TableHead>{t('agent_orchestrator.trace.compare.otherRun')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {diff.entries.map((entry) => (
                <TableRow key={`${entry.op}:${entry.path}`}>
                  <TableCell className="break-all font-mono text-xs text-muted-foreground">{entry.path}</TableCell>
                  <TableCell>
                    <StatusBadge variant={JSON_OP_VARIANT[entry.op]}>
                      {t(`agent_orchestrator.trace.compare.op.${entry.op}`)}
                    </StatusBadge>
                  </TableCell>
                  <TableCell>
                    <ValueCell value={entry.left} />
                  </TableCell>
                  <TableCell>
                    <ValueCell value={entry.right} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  )
}

function SideSummary({ title, side }: { title: string; side: RunCompareSide }) {
  const t = useT()
  return (
    <div className="min-w-0 space-y-1 rounded-md border border-border p-3" data-testid={`compare-side-${side.runId}`}>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
      <p className="truncate font-mono text-sm text-foreground">{candidateLabel({ id: side.runId, externalRunId: null })}</p>
      <p className="truncate font-mono text-xs text-muted-foreground">
        {[side.model, side.runtime, side.spanName].filter(Boolean).join(' — ') ||
          t('agent_orchestrator.trace.compare.stepMissing')}
      </p>
      <StatusBadge variant={CONTENT_STATUS_VARIANT[side.contentStatus]}>
        {t(`agent_orchestrator.trace.compare.contentStatus.${side.contentStatus}`)}
      </StatusBadge>
    </div>
  )
}

function CompareResultView({ result }: { result: RunCompareResult }) {
  const t = useT()
  const { diff } = result
  const hasContentDiff = Boolean(diff.systemPrompt || diff.messages || diff.tools)
  return (
    <div className="space-y-5" data-testid="run-compare-result">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SideSummary title={t('agent_orchestrator.trace.compare.thisRun')} side={result.left} />
        <SideSummary title={t('agent_orchestrator.trace.compare.otherRun')} side={result.right} />
      </div>
      <FieldDiffSection
        title={t('agent_orchestrator.trace.compare.manifest')}
        diffs={diff.manifest}
        testId="compare-manifest"
      />
      <FieldDiffSection title={t('agent_orchestrator.trace.compare.params')} diffs={diff.params} testId="compare-params" />
      {result.content === 'forbidden' ? (
        <Alert status="information" data-testid="compare-content-forbidden">
          <AlertTitle>{t('agent_orchestrator.trace.compare.contentForbiddenTitle')}</AlertTitle>
          <AlertDescription>{t('agent_orchestrator.trace.compare.contentForbidden')}</AlertDescription>
        </Alert>
      ) : !hasContentDiff ? (
        <p className="text-sm text-muted-foreground" data-testid="compare-content-unavailable">
          {t('agent_orchestrator.trace.compare.contentUnavailable')}
        </p>
      ) : (
        <>
          {diff.systemPrompt ? <TextDiffSection diff={diff.systemPrompt} /> : null}
          {diff.messages ? (
            <JsonDiffSection
              title={t('agent_orchestrator.trace.compare.messages')}
              diff={diff.messages}
              testId="compare-messages"
            />
          ) : null}
          {diff.tools ? (
            <JsonDiffSection title={t('agent_orchestrator.trace.compare.tools')} diff={diff.tools} testId="compare-tools" />
          ) : null}
        </>
      )}
    </div>
  )
}

function withRerunSource(subject: CompareSubject, candidates: CompareCandidate[]): CompareCandidate[] {
  const sourceId = subject.rerunOfRunId
  if (!sourceId || candidates.some((candidate) => candidate.id === sourceId)) return candidates
  return [{ id: sourceId, createdAt: null, status: null, label: candidateLabel({ id: sourceId, externalRunId: null }) }, ...candidates]
}

export function RunCompareDialog({ open, onOpenChange, run, spans }: RunCompareDialogProps) {
  const t = useT()
  const [candidates, setCandidates] = React.useState<CompareCandidate[] | null>(null)
  const [candidatesError, setCandidatesError] = React.useState(false)
  const [targetId, setTargetId] = React.useState<string | null>(null)
  const [step, setStep] = React.useState(0)
  const [state, setState] = React.useState<CompareState>({ status: 'idle' })
  const requestRef = React.useRef(0)

  const runId = run.id
  const agentId = run.agentId
  const createdAt = run.createdAt
  const rerunOfRunId = run.rerunOfRunId ?? null

  React.useEffect(() => {
    if (!open) return
    let cancelled = false
    const subject: CompareSubject = { id: runId, agentId, createdAt, rerunOfRunId }
    setCandidatesError(false)
    apiCall<{ items?: unknown[] }>(buildCompareCandidatesUrl(subject), undefined, { fallback: null }).then(
      (call) => {
        if (cancelled) return
        if (!call.ok) setCandidatesError(true)
        const runs = (call.ok && Array.isArray(call.result?.items) ? call.result.items : [])
          .map((item) => (item && typeof item === 'object' ? mapRun(item as Record<string, unknown>) : null))
          .filter((item): item is RunView => item !== null)
        const previous = previousRunCandidates(subject, runs)
        setCandidates(withRerunSource(subject, previous))
        setTargetId((current) => current ?? pickDefaultCompareTarget(subject, previous))
      },
      () => {
        if (cancelled) return
        setCandidatesError(true)
        setCandidates(withRerunSource(subject, []))
        setTargetId((current) => current ?? pickDefaultCompareTarget(subject, []))
      },
    )
    return () => {
      cancelled = true
    }
  }, [open, runId, agentId, createdAt, rerunOfRunId])

  const recompute = React.useCallback(
    (target: string | null, stepIndex: number) => {
      if (!target) return
      const requestId = requestRef.current + 1
      requestRef.current = requestId
      setState({ status: 'loading' })
      apiCall<unknown>(buildCompareUrl(runId, target, stepIndex), undefined, { fallback: null }).then(
        (call) => {
          if (requestRef.current !== requestId) return
          const result = call.ok ? parseRunCompareResult(call.result) : null
          setState(result ? { status: 'ok', result } : { status: 'error' })
        },
        () => {
          if (requestRef.current === requestId) setState({ status: 'error' })
        },
      )
    },
    [runId],
  )

  React.useEffect(() => {
    if (open && targetId) recompute(targetId, step)
  }, [open, targetId, step, recompute])

  const stepCount = Math.max(
    1,
    countLlmSteps(spans),
    state.status === 'ok' ? Math.max(state.result.left.llmStepCount, state.result.right.llmStepCount) : 0,
  )
  const stepOptions = [...Array(stepCount).keys()]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="xl"
        data-testid="run-compare-dialog"
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault()
            recompute(targetId, step)
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('agent_orchestrator.trace.compare.title')}</DialogTitle>
          <DialogDescription>{t('agent_orchestrator.trace.compare.description')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs font-medium text-muted-foreground">
            {t('agent_orchestrator.trace.compare.target')}
            <Select
              value={targetId ?? undefined}
              onValueChange={(value) => setTargetId(value)}
              disabled={!candidates || candidates.length === 0}
            >
              <SelectTrigger aria-label={t('agent_orchestrator.trace.compare.target')} data-testid="compare-target">
                <SelectValue placeholder={t('agent_orchestrator.trace.compare.targetPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {(candidates ?? []).map((candidate) => (
                  <SelectItem key={candidate.id} value={candidate.id}>
                    {candidate.id === rerunOfRunId
                      ? t('agent_orchestrator.trace.compare.rerunOf', undefined, { label: candidate.label })
                      : candidate.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            {t('agent_orchestrator.trace.compare.step')}
            <Select value={String(step)} onValueChange={(value) => setStep(Number(value))}>
              <SelectTrigger aria-label={t('agent_orchestrator.trace.compare.step')} data-testid="compare-step">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {stepOptions.map((option) => (
                  <SelectItem key={option} value={String(option)}>
                    {t('agent_orchestrator.trace.compare.stepOption', undefined, { step: option + 1 })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        </div>
        {candidatesError ? <ErrorMessage label={t('agent_orchestrator.trace.compare.candidatesError')} /> : null}
        {candidates !== null && !targetId ? (
          <p className="text-sm text-muted-foreground" data-testid="compare-no-target">
            {t('agent_orchestrator.trace.compare.noTarget')}
          </p>
        ) : null}
        {state.status === 'loading' ? <LoadingMessage label={t('agent_orchestrator.trace.compare.loading')} /> : null}
        {state.status === 'error' ? <ErrorMessage label={t('agent_orchestrator.trace.compare.error')} /> : null}
        {state.status === 'ok' ? <CompareResultView result={state.result} /> : null}
        <DialogFooter
          leading={
            <span className="text-xs text-muted-foreground">
              <KbdShortcut keys={['⌘', 'Enter']} /> <Kbd>Esc</Kbd>
            </span>
          }
        >
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('agent_orchestrator.trace.compare.close')}
          </Button>
          <Button
            type="button"
            onClick={() => recompute(targetId, step)}
            disabled={!targetId || state.status === 'loading'}
          >
            {t('agent_orchestrator.trace.compare.recompute')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default RunCompareDialog
