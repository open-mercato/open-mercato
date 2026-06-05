"use client"

import * as React from 'react'
import { Flag } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectTriggerLeading,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import type { PipelineOption } from './useDealPipelines'

export type PipelineSelectProps = {
  id?: string
  pipelines: PipelineOption[]
  value?: string | null
  onChange: (id: string) => void
  disabled?: boolean
  placeholder: string
}

export function PipelineSelect({
  id,
  pipelines,
  value,
  onChange,
  disabled = false,
  placeholder,
}: PipelineSelectProps) {
  return (
    <Select
      value={typeof value === 'string' && value ? value : undefined}
      onValueChange={(next) => onChange(next ?? '')}
      disabled={disabled}
    >
      <SelectTrigger id={id} size="default">
        <SelectTriggerLeading>
          <Flag className="size-4 text-muted-foreground" aria-hidden="true" />
        </SelectTriggerLeading>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {pipelines.map((pipeline) => (
          <SelectItem key={pipeline.id} value={pipeline.id}>
            {pipeline.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export default PipelineSelect
