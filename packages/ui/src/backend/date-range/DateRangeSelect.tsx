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

export type DateRangeSelectProps = {
  value: DateRangePreset
  onChange: (value: DateRangePreset) => void
  id?: string
  label?: string
  className?: string
}

export function DateRangeSelect({
  value,
  onChange,
  id = 'date-range-select',
  label,
  className = '',
}: DateRangeSelectProps) {
  const t = useT()

  return (
    <div className={`space-y-1.5 ${className}`}>
      {label && (
        <label
          htmlFor={id}
          className="text-xs font-semibold uppercase text-muted-foreground"
        >
          {label}
        </label>
      )}
      <Select value={value} onValueChange={(next) => onChange(next as DateRangePreset)}>
        <SelectTrigger id={id} size="sm">
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
    </div>
  )
}

export default DateRangeSelect
