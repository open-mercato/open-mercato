'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { STATUS_COLORS, type WorkflowStatus, type StepRunStatus } from '../../lib/status-colors'
import { formatDurationMs } from '../../lib/run-duration'
import { buildRunGantt, type GanttBar } from '../../lib/run-gantt'
import { stepStatusLabelKey } from './RunStatusBadge'
import type { RunStepInstanceInput } from '../../lib/run-execution'

const BAR_TONES: Record<StepRunStatus, WorkflowStatus> = {
  completed: 'completed',
  active: 'in_progress',
  failed: 'failed',
  skipped: 'pending',
  paused: 'paused',
  pending: 'not_started',
}

const LANE_HEIGHT_CLASS = 'h-8'

export type RunGanttProps = {
  stepInstances: readonly RunStepInstanceInput[]
  instanceStartedAt?: string | Date | null
  instanceCompletedAt?: string | Date | null
  /** Injected by tests for determinism; production reads the clock. */
  now?: number
  onSelectStep?: (stepId: string) => void
  selectedStepId?: string | null
}

function BarRow({
  bar,
  label,
  selected,
  onSelect,
}: {
  bar: GanttBar
  label: string
  selected: boolean
  onSelect?: () => void
}) {
  const colors = STATUS_COLORS[BAR_TONES[bar.status]]
  // A zero-width bar is a real measurement (a step that took under a
  // millisecond), not missing data — give it a visible minimum so it does not
  // disappear from the chart it is meant to explain.
  const widthPercent = Math.max(bar.widthRatio * 100, 0.6)
  const offsetPercent = Math.min(bar.offsetRatio * 100, 100 - widthPercent)

  return (
    <button
      type="button"
      onClick={onSelect}
      title={label}
      aria-label={label}
      className={`relative block w-full ${LANE_HEIGHT_CLASS} rounded ${
        selected ? 'ring-2 ring-primary' : ''
      } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary`}
    >
      <span
        className={`absolute top-1/2 flex -translate-y-1/2 items-center justify-start overflow-hidden rounded border px-1 ${colors.bg} ${colors.border} h-5`}
        style={{ left: `${offsetPercent}%`, width: `${widthPercent}%` }}
      >
        {bar.spansCollapsedWait ? (
          // Never colour-only: a collapsed bar carries its own hatch pattern.
          <span
            aria-hidden="true"
            className="absolute inset-0 opacity-40"
            style={{
              backgroundImage:
                'repeating-linear-gradient(45deg, currentColor 0, currentColor 2px, transparent 2px, transparent 6px)',
            }}
          />
        ) : null}
      </span>
    </button>
  )
}

/**
 * Clock-time Gantt for one run (spec §8.3). The axis is piecewise-linear —
 * see `lib/run-gantt.ts` for why — and every bar keeps its TRUE duration in
 * its label, so the compression never becomes a reported number.
 */
export function RunGantt({
  stepInstances,
  instanceStartedAt,
  instanceCompletedAt,
  now,
  onSelectStep,
  selectedStepId,
}: RunGanttProps) {
  const t = useT()
  const model = React.useMemo(
    () => buildRunGantt({ stepInstances, instanceStartedAt, instanceCompletedAt, now }),
    [stepInstances, instanceStartedAt, instanceCompletedAt, now]
  )

  if (model.bars.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {t('workflows.instances.run.gantt.empty', 'No step executions have been recorded for this run yet.')}
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          {t('workflows.instances.run.gantt.span', 'Wall-clock span')}: {formatDurationMs(model.totalDurationMs)}
        </span>
        <span>
          {t('workflows.instances.run.gantt.steps', 'Step executions')}: {model.bars.length}
        </span>
        {model.collapsedDurationMs > 0 ? (
          <span className="text-status-warning-text">
            {t('workflows.instances.run.gantt.collapsed', 'Waiting time collapsed: {duration}', {
              duration: formatDurationMs(model.collapsedDurationMs),
            })}
          </span>
        ) : null}
      </div>

      <div className="overflow-x-auto">
        <div style={{ minWidth: '40rem' }}>
          {model.bars.map((bar) => {
            const durationLabel = formatDurationMs(bar.durationMs)
            const statusKey = stepStatusLabelKey(bar.status)
            const statusLabel = t(statusKey.key, statusKey.fallback)
            const label = t(
              'workflows.instances.run.gantt.barLabel',
              '{step} — {status}, {duration}',
              { step: bar.stepName, status: statusLabel, duration: durationLabel }
            )
            return (
              <div key={bar.key} className="flex items-center gap-3 border-b border-border/60 py-0.5 last:border-b-0">
                <div className="w-48 shrink-0 truncate text-xs" title={bar.stepName}>
                  <span className="text-foreground">{bar.stepName}</span>
                  {bar.branchInstanceId ? (
                    <span className="ml-1 text-muted-foreground">
                      {t('workflows.instances.run.gantt.lane', 'lane {lane}', { lane: String(bar.lane + 1) })}
                    </span>
                  ) : null}
                </div>
                <div className="min-w-0 flex-1">
                  <BarRow
                    bar={bar}
                    label={label}
                    selected={selectedStepId === bar.stepId}
                    onSelect={onSelectStep ? () => onSelectStep(bar.stepId) : undefined}
                  />
                </div>
                <div className="w-24 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                  {durationLabel}
                  {bar.running ? (
                    <span className="ml-1 text-status-info-text">
                      {t('workflows.instances.run.gantt.running', '(running)')}
                    </span>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {model.collapsedSegments.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          {t(
            'workflows.instances.run.gantt.collapsedHint',
            'Hatched bars span a collapsed waiting period. Durations shown are always the real elapsed time.'
          )}
        </p>
      ) : null}
    </div>
  )
}

export default RunGantt
