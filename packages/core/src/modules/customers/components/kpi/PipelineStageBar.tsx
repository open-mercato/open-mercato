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
}

function resolveStageColor(stage: string | null, stageDictionary: DictionaryMap): string | null {
  if (!stage) return null
  const entry = stageDictionary[stage]
  return entry?.color ?? null
}

function resolveStageLabel(stage: string | null, stageDictionary: DictionaryMap, unassignedLabel: string): string {
  if (!stage) return unassignedLabel
  return stageDictionary[stage]?.label ?? unassignedLabel
}

export function PipelineStageBar({ stages, stageDictionary, unassignedLabel }: PipelineStageBarProps) {
  const segments = React.useMemo(
    () => stages.filter((entry) => entry.count > 0),
    [stages],
  )

  if (segments.length === 0) return null

  return (
    <div className="space-y-2">
      <div className="flex h-2 w-full gap-1 overflow-hidden rounded-full">
        {segments.map((entry, index) => {
          const color = resolveStageColor(entry.stage, stageDictionary)
          return (
            <span
              key={entry.stage ?? `unassigned-${index}`}
              className={cn('h-full rounded-full', color ? null : 'bg-muted')}
              style={{ flexGrow: entry.count, ...(color ? { backgroundColor: color } : {}) }}
              aria-hidden
            />
          )
        })}
      </div>
      <ul className="flex flex-wrap gap-x-3 gap-y-1">
        {segments.map((entry, index) => {
          const color = resolveStageColor(entry.stage, stageDictionary)
          const label = resolveStageLabel(entry.stage, stageDictionary, unassignedLabel)
          return (
            <li
              key={entry.stage ?? `unassigned-legend-${index}`}
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
            >
              <span
                className={cn('inline-block h-2 w-2 rounded-full border border-border', color ? null : 'bg-muted')}
                style={color ? { backgroundColor: color } : undefined}
                aria-hidden
              />
              <span>{label}</span>
              <span className="font-medium text-foreground">{entry.count}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export default PipelineStageBar
