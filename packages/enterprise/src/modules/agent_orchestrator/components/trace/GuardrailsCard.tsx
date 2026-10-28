"use client"

import * as React from 'react'
import { ChevronRight, ShieldAlert, ShieldCheck } from 'lucide-react'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import { JsonDisplay } from '@open-mercato/ui/backend/JsonDisplay'
import { CollapsibleSection } from '@open-mercato/ui/backend/SectionHeader'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { GuardrailCheckView, IntegrityOutcomeView } from '../types'
import { guardrailKindLabelKey } from '../guardrailEvidence'
import { InspectorCard } from './InspectorCard'
import { diffStructures, type StructuralChangeKind } from './structuralDiff'

/**
 * Guardrails — the run's persisted AgentGuardrailCheck verdicts (all checks,
 * passed and tripped) with i18n kind labels, integrity rule ids and a "holds
 * approval" marker, each expandable to its redacted evidence + set version.
 * When integrity changed the output, "Model output vs returned output" lazily
 * fetches the pre-repair artifact and shows a read-only structural diff.
 */
const GUARDRAIL_RESULT_VARIANT: Record<GuardrailCheckView['result'], StatusBadgeVariant> = {
  pass: 'success',
  warn: 'warning',
  block: 'error',
}

const INTEGRITY_OUTCOME_VARIANT: Record<IntegrityOutcomeView, StatusBadgeVariant> = {
  clean: 'success',
  repaired: 'info',
  flagged: 'warning',
  not_applicable: 'neutral',
  needs_review: 'warning',
}

const CHANGE_VARIANT: Record<StructuralChangeKind, StatusBadgeVariant> = {
  added: 'success',
  removed: 'error',
  changed: 'warning',
}

function compactValue(value: unknown): string {
  if (value === undefined) return '—'
  try {
    const text = JSON.stringify(value) ?? String(value)
    return text.length > 120 ? `${text.slice(0, 117)}...` : text
  } catch {
    return String(value)
  }
}

type RawOutputState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'loaded'; payload: unknown }

function RawOutputDiff({
  runId,
  rawOutputKey,
  returnedOutput,
}: {
  runId: string
  rawOutputKey: string
  returnedOutput: unknown
}) {
  const t = useT()
  const [state, setState] = React.useState<RawOutputState>({ status: 'idle' })

  const load = React.useCallback(async () => {
    setState({ status: 'loading' })
    const call = await apiCall<{ payload: unknown }>(
      `/api/agent_orchestrator/runs/${encodeURIComponent(runId)}/artifact?kind=raw_output&key=${encodeURIComponent(rawOutputKey)}`,
      undefined,
      { fallback: { payload: undefined } },
    )
    if (!call.ok) {
      setState({ status: 'error' })
      return
    }
    setState({ status: 'loaded', payload: call.result?.payload ?? null })
  }, [runId, rawOutputKey])

  const onCollapsedChange = (collapsed: boolean) => {
    if (!collapsed && (state.status === 'idle' || state.status === 'error')) void load()
  }

  const changes = React.useMemo(
    () => (state.status === 'loaded' ? diffStructures(state.payload, returnedOutput) : []),
    [state, returnedOutput],
  )

  return (
    <CollapsibleSection
      title={t('agent_orchestrator.traces.detail.integrity.rawVsFinal')}
      defaultCollapsed
      onCollapsedChange={onCollapsedChange}
      className="mt-4 border-t border-border pt-4"
    >
      {state.status === 'loading' || state.status === 'idle' ? (
        <LoadingMessage label={t('agent_orchestrator.traces.detail.integrity.rawLoading')} />
      ) : state.status === 'error' ? (
        <ErrorMessage label={t('agent_orchestrator.traces.detail.integrity.rawError')} />
      ) : changes.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('agent_orchestrator.traces.detail.integrity.noDifferences')}</p>
      ) : (
        <ul className="space-y-1.5" aria-label={t('agent_orchestrator.traces.detail.integrity.rawVsFinal')}>
          {changes.map((change) => (
            <li key={`${change.change}:${change.path}`} className="rounded-lg border border-border px-3 py-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-mono text-foreground">{change.path || '$'}</span>
                <StatusBadge variant={CHANGE_VARIANT[change.change]}>
                  {t(`agent_orchestrator.traces.detail.integrity.change.${change.change}`, change.change)}
                </StatusBadge>
              </div>
              <p className="mt-1 break-all font-mono text-muted-foreground">
                {change.change === 'added'
                  ? compactValue(change.after)
                  : change.change === 'removed'
                    ? compactValue(change.before)
                    : `${compactValue(change.before)} → ${compactValue(change.after)}`}
              </p>
            </li>
          ))}
        </ul>
      )}
    </CollapsibleSection>
  )
}

export function GuardrailsCard({
  checks,
  runId,
  integrityOutcome = null,
  rawOutputKey = null,
  returnedOutput = null,
}: {
  checks: GuardrailCheckView[]
  runId: string
  integrityOutcome?: IntegrityOutcomeView | null
  rawOutputKey?: string | null
  returnedOutput?: unknown
}) {
  const t = useT()
  const [openId, setOpenId] = React.useState<string | null>(null)
  const passedCount = checks.filter((check) => check.result === 'pass').length
  const rawOutputUnavailable = !rawOutputKey && checks.some((check) => check.rawOutputStatus === 'storage_unavailable')
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
      {integrityOutcome ? (
        <div className="mb-3 flex items-center justify-between gap-2 text-xs">
          <span className="text-muted-foreground">{t('agent_orchestrator.traces.detail.integrity.outcomeLabel')}</span>
          <StatusBadge variant={INTEGRITY_OUTCOME_VARIANT[integrityOutcome]}>
            {t(`agent_orchestrator.traces.detail.integrity.outcome.${integrityOutcome}`, integrityOutcome)}
          </StatusBadge>
        </div>
      ) : null}
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
                  className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-left transition-colors enabled:hover:bg-muted/40"
                >
                  {check.result === 'pass' ? (
                    <ShieldCheck className="size-4 shrink-0 text-status-success-text" />
                  ) : (
                    <ShieldAlert
                      className={`size-4 shrink-0 ${check.result === 'block' ? 'text-status-error-text' : 'text-status-warning-text'}`}
                    />
                  )}
                  <span className="min-w-24 flex-1 truncate text-xs font-medium text-foreground" title={check.kind}>
                    {t(guardrailKindLabelKey(check.kind), check.kind)}
                  </span>
                  {check.ruleId ? (
                    <span
                      className="max-w-32 shrink truncate rounded-md border border-border px-1.5 py-0.5 font-mono text-xs text-muted-foreground"
                      title={t('agent_orchestrator.traces.detail.integrity.ruleId', undefined, { ruleId: check.ruleId })}
                    >
                      {check.ruleId}
                    </span>
                  ) : null}
                  <span className="shrink-0 rounded-md border border-border bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                    {t(`agent_orchestrator.traces.detail.guardrailPhase.${check.phase}`, check.phase)}
                  </span>
                  {check.holdsAutoApproval ? (
                    <StatusBadge variant="warning">{t('agent_orchestrator.traces.detail.integrity.holdsApproval')}</StatusBadge>
                  ) : null}
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
                    {check.dropped > 0 || check.repaired > 0 ? (
                      <p className="text-xs text-muted-foreground">
                        {t('agent_orchestrator.traces.detail.integrity.counts', undefined, {
                          dropped: check.dropped,
                          repaired: check.repaired,
                        })}
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
      {rawOutputKey ? (
        <RawOutputDiff runId={runId} rawOutputKey={rawOutputKey} returnedOutput={returnedOutput} />
      ) : rawOutputUnavailable ? (
        <p className="mt-4 border-t border-border pt-4 text-xs text-muted-foreground">
          {t('agent_orchestrator.traces.detail.integrity.rawUnavailable')}
        </p>
      ) : null}
    </InspectorCard>
  )
}
