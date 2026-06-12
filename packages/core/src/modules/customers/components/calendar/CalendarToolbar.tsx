"use client"

import * as React from 'react'
import { format } from 'date-fns/format'
import { CalendarRange, ListFilter } from 'lucide-react'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { Calendar } from '@open-mercato/ui/primitives/calendar'
import { CheckboxField } from '@open-mercato/ui/primitives/checkbox-field'
import { Kbd } from '@open-mercato/ui/primitives/kbd'
import { Popover, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'
import { SearchInput } from '@open-mercato/ui/primitives/search-input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type {
  CalendarFiltersValue,
  CalendarRangePreset,
  CalendarToolbarProps,
} from './types'

const RANGE_PRESETS: CalendarRangePreset[] = ['thisWeek', 'next7', 'thisMonth', 'next30']

const STATUS_OPTIONS = ['planned', 'done', 'canceled'] as const

const ALL_OPTION = 'all'

const EMPTY_FILTERS: CalendarFiltersValue = { types: [], status: null, ownerUserId: null }

function formatRangeLabel(from: Date, to: Date): string {
  return `${format(from, 'MMM dd')} – ${format(to, 'MMM dd, yyyy')}`
}

export function CalendarToolbar(props: CalendarToolbarProps) {
  const {
    anchor,
    range,
    preset,
    search,
    filters,
    typeOptions,
    ownerOptions,
    onToday,
    onPresetChange,
    onAnchorChange,
    onSearchChange,
    onFiltersChange,
  } = props
  const t = useT()
  const [rangeOpen, setRangeOpen] = React.useState(false)
  const [filtersOpen, setFiltersOpen] = React.useState(false)
  const [pendingFilters, setPendingFilters] = React.useState<CalendarFiltersValue>(filters)

  const presetLabels: Record<CalendarRangePreset, string> = {
    thisWeek: t('customers.calendar.toolbar.presets.thisWeek', 'This week'),
    next7: t('customers.calendar.toolbar.presets.next7', 'Next 7 days'),
    thisMonth: t('customers.calendar.toolbar.presets.thisMonth', 'This month'),
    next30: t('customers.calendar.toolbar.presets.next30', 'Next 30 days'),
  }

  const activeFilterCount =
    filters.types.length + (filters.status ? 1 : 0) + (filters.ownerUserId ? 1 : 0)

  const handleFiltersOpenChange = (open: boolean) => {
    if (open) setPendingFilters(filters)
    setFiltersOpen(open)
  }

  const applyFilters = () => {
    onFiltersChange(pendingFilters)
    setFiltersOpen(false)
  }

  const clearFilters = () => {
    setPendingFilters(EMPTY_FILTERS)
    onFiltersChange(EMPTY_FILTERS)
    setFiltersOpen(false)
  }

  const togglePendingType = (value: string, checked: boolean) => {
    setPendingFilters((current) => ({
      ...current,
      types: checked
        ? [...current.types, value]
        : current.types.filter((entry) => entry !== value),
    }))
  }

  return (
    <div className="flex flex-wrap items-center gap-2 sm:gap-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-3">
        <Button type="button" variant="outline" onClick={onToday}>
          {t('customers.calendar.toolbar.today', 'Today')}
        </Button>
        <div className="flex min-w-0 items-center">
          <Select
            value={preset ?? ''}
            onValueChange={(value) => onPresetChange(value as CalendarRangePreset)}
          >
            <SelectTrigger
              className="hidden w-auto min-w-32 rounded-r-none sm:flex"
              aria-label={t('customers.calendar.toolbar.presetLabel', 'Date range preset')}
            >
              <SelectValue
                placeholder={t('customers.calendar.toolbar.presetPlaceholder', 'Custom range')}
              />
            </SelectTrigger>
            <SelectContent>
              {RANGE_PRESETS.map((value) => (
                <SelectItem key={value} value={value}>
                  {presetLabels[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Popover open={rangeOpen} onOpenChange={setRangeOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                className="min-w-0 text-muted-foreground sm:-ml-px sm:rounded-l-none"
              >
                <CalendarRange aria-hidden="true" />
                <span className="truncate">{formatRangeLabel(range.from, range.to)}</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-auto min-w-0 p-2">
              <Calendar
                mode="single"
                selected={anchor}
                defaultMonth={anchor}
                onSelect={(date) => {
                  if (!date) return
                  onAnchorChange(date)
                  setRangeOpen(false)
                }}
              />
            </PopoverContent>
          </Popover>
        </div>
      </div>
      <div className="flex w-full min-w-0 items-center gap-2 sm:ml-auto sm:w-auto sm:flex-none sm:gap-3">
        <div className="relative min-w-0 flex-1 sm:w-72 sm:flex-none">
          <SearchInput
            value={search}
            onChange={onSearchChange}
            placeholder={t('customers.calendar.toolbar.searchPlaceholder', 'Search…')}
            aria-label={t('customers.calendar.toolbar.searchPlaceholder', 'Search…')}
            data-calendar-search=""
          />
          {search.length === 0 ? (
            <Kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 sm:inline-flex">/</Kbd>
          ) : null}
        </div>
        <Popover open={filtersOpen} onOpenChange={handleFiltersOpenChange}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              aria-label={t('customers.calendar.toolbar.filters.label', 'Filter')}
            >
              <ListFilter aria-hidden="true" />
              <span className="hidden sm:inline">
                {t('customers.calendar.toolbar.filters.label', 'Filter')}
              </span>
              {activeFilterCount > 0 ? (
                <Badge variant="secondary" size="sm">
                  {activeFilterCount}
                </Badge>
              ) : null}
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="w-72 p-3"
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                applyFilters()
              }
            }}
          >
            <div className="flex flex-col gap-4">
              {typeOptions.length > 0 ? (
                <fieldset className="flex flex-col gap-2">
                  <legend className="pb-1 text-overline font-semibold uppercase tracking-widest text-muted-foreground">
                    {t('customers.calendar.toolbar.filters.types', 'Type')}
                  </legend>
                  {typeOptions.map((option) => (
                    <CheckboxField
                      key={option.value}
                      label={option.label}
                      size="sm"
                      checked={pendingFilters.types.includes(option.value)}
                      onCheckedChange={(checked) =>
                        togglePendingType(option.value, checked === true)
                      }
                    />
                  ))}
                </fieldset>
              ) : null}
              <div className="flex flex-col gap-1.5">
                <span className="text-overline font-semibold uppercase tracking-widest text-muted-foreground">
                  {t('customers.calendar.toolbar.filters.status', 'Status')}
                </span>
                <Select
                  value={pendingFilters.status ?? ALL_OPTION}
                  onValueChange={(value) =>
                    setPendingFilters((current) => ({
                      ...current,
                      status: value === ALL_OPTION ? null : value,
                    }))
                  }
                >
                  <SelectTrigger
                    size="sm"
                    aria-label={t('customers.calendar.toolbar.filters.status', 'Status')}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_OPTION}>
                      {t('customers.calendar.toolbar.filters.allStatuses', 'All statuses')}
                    </SelectItem>
                    {STATUS_OPTIONS.map((status) => (
                      <SelectItem key={status} value={status}>
                        {t(`customers.calendar.toolbar.filters.statuses.${status}`, status)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {ownerOptions.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  <span className="text-overline font-semibold uppercase tracking-widest text-muted-foreground">
                    {t('customers.calendar.toolbar.filters.owner', 'Owner')}
                  </span>
                  <Select
                    value={pendingFilters.ownerUserId ?? ALL_OPTION}
                    onValueChange={(value) =>
                      setPendingFilters((current) => ({
                        ...current,
                        ownerUserId: value === ALL_OPTION ? null : value,
                      }))
                    }
                  >
                    <SelectTrigger
                      size="sm"
                      aria-label={t('customers.calendar.toolbar.filters.owner', 'Owner')}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL_OPTION}>
                        {t('customers.calendar.toolbar.filters.allOwners', 'All owners')}
                      </SelectItem>
                      {ownerOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
              <div className="flex items-center justify-end gap-2 border-t pt-3">
                <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
                  {t('customers.calendar.toolbar.filters.clear', 'Clear')}
                </Button>
                <Button type="button" size="sm" onClick={applyFilters}>
                  {t('customers.calendar.toolbar.filters.apply', 'Apply')}
                </Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  )
}
