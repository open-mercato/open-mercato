"use client"

import * as React from 'react'
import type { StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import type { CaseChange, SuiteRunComparison } from '../lib/eval/regression/compareSuiteRuns'
import type { EvalTrend } from '../lib/eval/regression/buildEvalTrend'
import type { CaseRunStatusSummary } from '../lib/eval/report/suiteAggregation'

export type { CaseChange, SuiteRunComparison, EvalTrend, CaseRunStatusSummary }

const HASH_PREFIX = 'sha256:'
const SHORT_HASH_LENGTH = 12

export const caseChangeVariant: Record<CaseChange, StatusBadgeVariant> = {
  regressed: 'error',
  fixed: 'success',
  changed: 'warning',
  added: 'info',
  removed: 'neutral',
  unchanged: 'neutral',
}

export const caseStatusVariant: Record<CaseRunStatusSummary, StatusBadgeVariant> = {
  passed: 'success',
  failed: 'error',
  error: 'warning',
  skipped: 'neutral',
  absent: 'neutral',
}

export function shortDatasetKey(value: string | null): string | null {
  if (!value) return null
  if (!value.startsWith(HASH_PREFIX)) return value
  return `${HASH_PREFIX}${value.slice(HASH_PREFIX.length, HASH_PREFIX.length + SHORT_HASH_LENGTH)}`
}

export function compareRunsHref(baseId: string, headId: string): string {
  return `/backend/eval-runs/compare?base=${encodeURIComponent(baseId)}&head=${encodeURIComponent(headId)}`
}

/** Pass-rate delta (0..1) as signed whole points, e.g. "-20 pts". */
export function DeltaPoints({ value }: { value: number | null }) {
  const t = useT()
  if (value === null) return <span className="text-sm text-muted-foreground">—</span>
  const points = Math.round(value * 100)
  return (
    <span
      className={cn(
        'text-sm font-medium tabular-nums',
        points < 0 ? 'text-status-error-text' : points > 0 ? 'text-status-success-text' : 'text-muted-foreground',
      )}
    >
      {`${points > 0 ? '+' : ''}${points} ${t('agent_orchestrator.agentDetail.evaluation.summary.points', 'pts')}`}
    </span>
  )
}

export function AgentVersionsLabel({ versions }: { versions: Array<string | null> }) {
  const t = useT()
  if (!versions.length) {
    return <span className="text-xs text-muted-foreground">{t('agent_orchestrator.evalRegression.version.none')}</span>
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {versions.map((version) => (
        <span
          key={version ?? 'unknown'}
          className="rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground"
        >
          {version ?? t('agent_orchestrator.evalRegression.version.unknown')}
        </span>
      ))}
      {versions.length > 1 ? (
        <span className="text-xs text-status-warning-text">{t('agent_orchestrator.evalRegression.version.mixed')}</span>
      ) : null}
    </span>
  )
}
