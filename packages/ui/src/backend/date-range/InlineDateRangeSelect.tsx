"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../primitives/select'
import { DATE_RANGE_OPTIONS, type DateRangePreset } from './dateRanges'

export type InlineDateRangeSelectProps = {
  value: DateRangePreset
  onChange: (value: DateRangePreset) => void
  className?: string
}

export function InlineDateRangeSelect({
  value,
  onChange,
  className = '',
}: InlineDateRangeSelectProps) {
  const t = useT()

  const currentOption = DATE_RANGE_OPTIONS.find((opt) => opt.value === value)
  const displayLabel = currentOption
    ? t(currentOption.labelKey, currentOption.value.replace(/_/g, ' '))
    : value.replace(/_/g, ' ')

  return (
    <Select value={value} onValueChange={(next) => onChange(next as DateRangePreset)}>
      <SelectTrigger size="sm" className={className} title={displayLabel}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {DATE_RANGE_OPTIONS.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {t(option.labelKey, option.value.replace(/_/g, ' '))}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export default InlineDateRangeSelect
