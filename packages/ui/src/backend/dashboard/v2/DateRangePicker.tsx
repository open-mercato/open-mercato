"use client"

import * as React from 'react'
import { CalendarDays } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Popover, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import {
  GLOBAL_RANGE_COMPARE_OPTIONS,
  GLOBAL_RANGE_PRESETS,
  resolveGlobalDateRange,
  type DashboardDateRangeCompare,
  type DashboardDateRangePreset,
  type DashboardGlobalDateRange,
} from './dateRange'

type DateRangePickerProps = {
  value: DashboardGlobalDateRange
  onChange: (next: DashboardGlobalDateRange) => void
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function canApplyCustomRange(from: string, to: string): boolean {
  return DATE_PATTERN.test(from) && DATE_PATTERN.test(to) && from <= to
}

export function DateRangePicker({ value, onChange }: DateRangePickerProps) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const [preset, setPreset] = React.useState<DashboardDateRangePreset>(value.preset)
  const [from, setFrom] = React.useState(value.from)
  const [to, setTo] = React.useState(value.to)
  const [compare, setCompare] = React.useState<DashboardDateRangeCompare>(value.compare)

  const resetDraft = React.useCallback(() => {
    setPreset(value.preset)
    setFrom(value.from)
    setTo(value.to)
    setCompare(value.compare)
  }, [value])

  const handleOpenChange = React.useCallback((next: boolean) => {
    if (next) resetDraft()
    if (!next) resetDraft()
    setOpen(next)
  }, [resetDraft])

  const handlePreset = React.useCallback((nextPreset: DashboardDateRangePreset) => {
    setPreset(nextPreset)
    if (nextPreset !== 'custom') {
      const resolved = resolveGlobalDateRange(nextPreset)
      setFrom(resolved.from)
      setTo(resolved.to)
    }
  }, [])

  const canApply = preset !== 'custom' || canApplyCustomRange(from, to)

  const handleApply = React.useCallback(() => {
    if (!canApply) return
    const resolved = resolveGlobalDateRange(preset, from, to)
    onChange({
      preset,
      from: resolved.from,
      to: resolved.to,
      compare,
    })
    setOpen(false)
  }, [canApply, compare, from, onChange, preset, to])

  const handleCancel = React.useCallback(() => {
    resetDraft()
    setOpen(false)
  }, [resetDraft])

  const handleKeyDown = React.useCallback((event: React.KeyboardEvent) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      handleApply()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      handleCancel()
    }
  }, [handleApply, handleCancel])

  const triggerLabel = `${t(`dashboard.v2.dateRange.preset.${value.preset}`)} ${value.from} - ${value.to}`

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" aria-haspopup="dialog">
          <CalendarDays className="size-4" />
          <span>{triggerLabel}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex max-h-[var(--radix-popover-content-available-height)] w-80 flex-col p-0 sm:w-96" onKeyDown={handleKeyDown}>
        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4">
          <div>
            <Label className="mb-2">{t('dashboard.v2.dateRange.label')}</Label>
            <div className="grid grid-cols-2 gap-1">
              {GLOBAL_RANGE_PRESETS.map((option) => (
                <Button
                  key={option}
                  type="button"
                  variant={preset === option ? 'secondary' : 'ghost'}
                  size="sm"
                  className="justify-start"
                  onClick={() => handlePreset(option)}
                >
                  {t(`dashboard.v2.dateRange.preset.${option}`)}
                </Button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="dashboard-v2-range-from">{t('dashboard.v2.dateRange.from')}</Label>
              <Input
                id="dashboard-v2-range-from"
                type="date"
                value={from}
                disabled={preset !== 'custom'}
                onChange={(event) => setFrom(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dashboard-v2-range-to">{t('dashboard.v2.dateRange.to')}</Label>
              <Input
                id="dashboard-v2-range-to"
                type="date"
                value={to}
                disabled={preset !== 'custom'}
                onChange={(event) => setTo(event.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>{t('dashboard.v2.dateRange.compareLabel')}</Label>
            <Select value={compare} onValueChange={(next) => setCompare(next as DashboardDateRangeCompare)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GLOBAL_RANGE_COMPARE_OPTIONS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {t(`dashboard.v2.dateRange.compare.${option}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-border p-3">
          <Button type="button" variant="outline" onClick={handleCancel}>
            {t('dashboard.v2.dateRange.cancel')}
          </Button>
          <Button type="button" disabled={!canApply} onClick={handleApply}>
            {t('dashboard.v2.dateRange.apply')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
