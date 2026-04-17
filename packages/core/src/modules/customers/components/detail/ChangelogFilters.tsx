'use client'

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Popover, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'
import { Check, ChevronDown, Download, Search } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type FilterOption = {
  value: string
  label: string
}

type ChangelogFiltersProps = {
  dateRange: '7d' | '30d' | '90d'
  fieldNames: string[]
  actorUserIds: string[]
  actionTypes: string[]
  fieldOptions: FilterOption[]
  userOptions: FilterOption[]
  actionOptions: FilterOption[]
  exportDisabled?: boolean
  onDateRangeChange: (value: '7d' | '30d' | '90d') => void
  onFieldNamesChange: (value: string[]) => void
  onActorUserIdsChange: (value: string[]) => void
  onActionTypesChange: (value: string[]) => void
  onExport: () => void
}

type FilterPopoverProps = {
  allLabel: string
  options: FilterOption[]
  values: string[]
  triggerLabel: string
  onChange: (value: string[]) => void
}

function FilterPopover({ allLabel, options, values, triggerLabel, onChange }: FilterPopoverProps) {
  const t = useT()
  const [search, setSearch] = React.useState('')
  const filteredOptions = React.useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase()
    if (!normalizedSearch) return options
    return options.filter((option) => option.label.toLowerCase().includes(normalizedSearch))
  }, [options, search])
  const valuesSet = React.useMemo(() => new Set(values), [values])

  const toggleValue = React.useCallback((value: string) => {
    if (valuesSet.has(value)) {
      onChange(values.filter((entry) => entry !== value))
      return
    }
    onChange([...values, value])
  }, [onChange, values, valuesSet])

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-8 justify-between gap-2 rounded-[10px] px-3 text-xs">
          <span className="truncate">{triggerLabel}</span>
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-3 p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('customers.changelog.filters.search', 'Search')}
            className="h-8 pl-8 text-xs"
          />
        </div>

        <div className="max-h-64 space-y-1 overflow-y-auto">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange([])}
            className="h-auto w-full justify-start px-2 py-1.5 text-xs"
          >
            {values.length === 0 ? <Check className="mr-2 size-3.5 text-foreground" /> : <span className="mr-5" />}
            {allLabel}
          </Button>
          {filteredOptions.map((option) => (
            <Button
              key={option.value}
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => toggleValue(option.value)}
              className="h-auto w-full justify-start px-2 py-1.5 text-xs"
            >
              {valuesSet.has(option.value) ? <Check className="mr-2 size-3.5 text-foreground" /> : <span className="mr-5" />}
              <span className="truncate">{option.label}</span>
            </Button>
          ))}
          {filteredOptions.length === 0 ? (
            <div className="px-2 py-3 text-xs text-muted-foreground">
              {t('customers.changelog.filters.empty', 'No matching options')}
            </div>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function ChangelogFilters({
  dateRange,
  fieldNames,
  actorUserIds,
  actionTypes,
  fieldOptions,
  userOptions,
  actionOptions,
  exportDisabled = false,
  onDateRangeChange,
  onFieldNamesChange,
  onActorUserIdsChange,
  onActionTypesChange,
  onExport,
}: ChangelogFiltersProps) {
  const t = useT()

  const describeSelection = React.useCallback((allLabel: string, options: FilterOption[], values: string[]) => {
    if (values.length === 0) return allLabel
    if (values.length === 1) return options.find((option) => option.value === values[0])?.label ?? allLabel
    return t('customers.changelog.filters.selectedCount', '{{count}} selected', { count: values.length })
  }, [t])

  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-overline font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {t('customers.changelog.filter', 'Filter')}:
        </span>
        <FilterPopover
          allLabel={t('customers.changelog.allFields', 'All fields')}
          options={fieldOptions}
          values={fieldNames}
          triggerLabel={describeSelection(t('customers.changelog.allFields', 'All fields'), fieldOptions, fieldNames)}
          onChange={onFieldNamesChange}
        />
        <FilterPopover
          allLabel={t('customers.changelog.allUsers', 'All users')}
          options={userOptions}
          values={actorUserIds}
          triggerLabel={describeSelection(t('customers.changelog.allUsers', 'All users'), userOptions, actorUserIds)}
          onChange={onActorUserIdsChange}
        />
        <FilterPopover
          allLabel={t('customers.changelog.allActions', 'All actions')}
          options={actionOptions}
          values={actionTypes}
          triggerLabel={describeSelection(t('customers.changelog.allActions', 'All actions'), actionOptions, actionTypes)}
          onChange={onActionTypesChange}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <select
            value={dateRange}
            onChange={(event) => onDateRangeChange(event.target.value as '7d' | '30d' | '90d')}
            className="h-8 min-w-32 appearance-none rounded-[10px] border bg-background pl-3 pr-8 text-xs text-foreground outline-none ring-offset-background focus:ring-2 focus:ring-ring"
          >
            <option value="7d">{t('customers.changelog.last7days', 'Last 7 days')}</option>
            <option value="30d">{t('customers.changelog.last30days', 'Last 30 days')}</option>
            <option value="90d">{t('customers.changelog.last90days', 'Last 90 days')}</option>
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onExport}
          disabled={exportDisabled}
          className="h-8 rounded-[10px] px-3 text-xs"
        >
          <Download className="mr-1.5 size-3.5" />
          {t('customers.changelog.exportCsv', 'Export CSV')}
        </Button>
      </div>
    </div>
  )
}

export default ChangelogFilters
