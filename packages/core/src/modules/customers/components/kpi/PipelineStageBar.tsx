"use client"

import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'
import type { DictionaryMap } from '@open-mercato/core/modules/dictionaries/components/dictionaryAppearance'

export type PipelineStageDatum = {
  stage: string | null
  count: number
  value: number
}

export type PipelineStageBarProps = {
  stages: PipelineStageDatum[]
  stageDictionary: DictionaryMap
  unassignedLabel: string
  /** Value shown on each row. Without it rows show no value and bars follow the deal count. */
  formatValue?: (value: number) => string
  /** Count shown on each row; defaults to the plain number. */
  formatCount?: (count: number) => string
  /** Rows shown before the remaining stages collapse into one `otherLabel` row. */
  maxRows?: number
  /** Label for the collapsed row, e.g. "3 other stages". */
  otherLabel?: (hiddenCount: number) => string
}

export type StageSegment = {
  key: string
  label: string
  color: string | null
  count: number
  value: number
  unassigned: boolean
}

const DEFAULT_MAX_ROWS = 5
const MIN_BAR_PERCENT = 2
const formatPlainCount = (count: number) => String(count)

// One cool ramp, darkest for the largest share, so the rows read as a scale
// rather than a mix of unrelated dictionary colours.
const STAGE_RAMP = [
  'var(--chart-indigo)',
  'var(--chart-violet)',
  'var(--chart-blue)',
  'var(--chart-cyan)',
  'var(--chart-teal)',
]

export function stageRampColor(rank: number): string {
  return STAGE_RAMP[Math.min(rank, STAGE_RAMP.length - 1)]!
}

function humanizeStageKey(stage: string): string {
  const spaced = stage.replace(/[_-]+/g, ' ').trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

// Named stages keep their dictionary label; a stage that only exists on a pipeline
// still shows its own name. Rows are ordered by pipeline value, the metric this
// breakdown explains, and coloured by that rank on one ramp. Deals without any
// stage collapse into one neutral "unassigned" row at the end.
export function buildStageSegments(
  stages: PipelineStageDatum[],
  stageDictionary: DictionaryMap,
  unassignedLabel: string,
): StageSegment[] {
  const named: StageSegment[] = []
  let unassignedCount = 0
  let unassignedValue = 0
  for (const entry of stages) {
    if (entry.count <= 0) continue
    const stage = entry.stage?.trim() ?? ''
    if (!stage) {
      unassignedCount += entry.count
      unassignedValue += entry.value
      continue
    }
    const dictionaryEntry = stageDictionary[stage]
    named.push({
      key: stage,
      label: dictionaryEntry?.label ?? humanizeStageKey(stage),
      color: null,
      count: entry.count,
      value: entry.value,
      unassigned: false,
    })
  }
  named.sort((left, right) => right.value - left.value || right.count - left.count || left.label.localeCompare(right.label))
  named.forEach((segment, rank) => { segment.color = stageRampColor(rank) })
  if (unassignedCount > 0) {
    named.push({ key: '__unassigned__', label: unassignedLabel, color: null, count: unassignedCount, value: unassignedValue, unassigned: true })
  }
  return named
}

function collapseRows(segments: StageSegment[], maxRows: number, otherLabel?: (hiddenCount: number) => string): StageSegment[] {
  if (segments.length <= maxRows || !otherLabel) return segments
  const visible = segments.slice(0, maxRows - 1)
  const hidden = segments.slice(maxRows - 1)
  return [
    ...visible,
    {
      key: '__other__',
      label: otherLabel(hidden.length),
      color: null,
      count: hidden.reduce((sum, segment) => sum + segment.count, 0),
      value: hidden.reduce((sum, segment) => sum + segment.value, 0),
      unassigned: true,
    },
  ]
}

export function PipelineStageBar({
  stages,
  stageDictionary,
  unassignedLabel,
  formatValue,
  formatCount = formatPlainCount,
  maxRows = DEFAULT_MAX_ROWS,
  otherLabel,
}: PipelineStageBarProps) {
  const rows = React.useMemo(
    () => collapseRows(buildStageSegments(stages, stageDictionary, unassignedLabel), maxRows, otherLabel),
    [stages, stageDictionary, unassignedLabel, maxRows, otherLabel],
  )

  if (rows.length === 0) return null

  const measure = (row: StageSegment) => Math.max(formatValue ? row.value : row.count, 0)
  const total = rows.reduce((sum, row) => sum + measure(row), 0)

  return (
    <ul className="space-y-2.5">
      {rows.map((row) => {
        const share = total > 0 ? (measure(row) / total) * 100 : 0
        const width = share > 0 ? Math.max(share, MIN_BAR_PERCENT) : 0
        return (
          <li key={row.key} className="space-y-1">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                <span
                  className={cn('inline-block size-2 shrink-0 rounded-full', row.color ? null : 'bg-border')}
                  style={row.color ? { backgroundColor: row.color } : undefined}
                  aria-hidden
                />
                <span className={cn('truncate', row.unassigned ? 'text-muted-foreground' : 'text-foreground')}>{row.label}</span>
              </span>
              {formatValue ? (
                <span className="shrink-0 font-medium tabular-nums text-foreground">{formatValue(row.value)}</span>
              ) : null}
            </div>
            <div className="flex items-center justify-between gap-3 pl-4">
              <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
                <span
                  className={cn('block h-full rounded-full', row.color ? null : 'bg-border')}
                  style={{ width: `${width}%`, ...(row.color ? { backgroundColor: row.color } : {}) }}
                />
              </span>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatCount(row.count)}</span>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

export default PipelineStageBar
