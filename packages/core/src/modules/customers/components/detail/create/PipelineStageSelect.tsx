"use client"

import * as React from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import type { PipelineStageOption } from './useDealPipelines'

export type PipelineStageSelectProps = {
  id?: string
  stages: PipelineStageOption[]
  value?: string | null
  onChange: (id: string) => void
  disabled?: boolean
  placeholder: string
  formatCount: (position: number, total: number) => string
}

export function PipelineStageSelect({
  id,
  stages,
  value,
  onChange,
  disabled = false,
  placeholder,
  formatCount,
}: PipelineStageSelectProps) {
  const selectedIndex = React.useMemo(
    () => (value ? stages.findIndex((stage) => stage.id === value) : -1),
    [stages, value],
  )
  const selectedStage = selectedIndex >= 0 ? stages[selectedIndex] : null

  return (
    <Select
      value={typeof value === 'string' && value ? value : undefined}
      onValueChange={(next) => onChange(next ?? '')}
      disabled={disabled || !stages.length}
    >
      <SelectTrigger id={id} size="default">
        <SelectValue placeholder={placeholder}>
          {selectedStage ? (
            <span className="flex min-w-0 items-center gap-2 truncate">
              <span className="truncate">{selectedStage.label}</span>
              <span className="text-muted-foreground">
                {formatCount(selectedIndex + 1, stages.length)}
              </span>
            </span>
          ) : null}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {stages.map((stage, index) => (
          <SelectItem key={stage.id} value={stage.id}>
            <span className="truncate">{stage.label}</span>
            <span className="text-muted-foreground">
              {formatCount(index + 1, stages.length)}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export default PipelineStageSelect
