"use client"
import * as React from 'react'
import { Button } from '../primitives/button'
import { FilterDef, FilterOverlay, FilterValues } from './FilterOverlay'

export type FilterBarProps = {
  searchValue?: string
  onSearchChange?: (v: string) => void
  searchPlaceholder?: string
  filters?: FilterDef[]
  values?: FilterValues
  onApply?: (values: FilterValues) => void
  onClear?: () => void
  className?: string
}

export function FilterBar({ searchValue, onSearchChange, searchPlaceholder = 'Search', filters = [], values = {}, onApply, onClear, className }: FilterBarProps) {
  const [open, setOpen] = React.useState(false)
  const activeCount = React.useMemo(() => Object.values(values).filter((v) => v != null && v !== '' && !(Array.isArray(v) && v.length === 0)).length, [values])

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className ?? ''}`}>
      {onSearchChange && (
        <div className="relative w-full sm:w-[240px]">
          <input
            value={searchValue ?? ''}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className="h-9 w-full rounded border pl-8 pr-2"
          />
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground">🔍</span>
        </div>
      )}
      {filters.length > 0 && (
        <Button variant="outline" className="h-9" onClick={() => setOpen(true)}>
          Filters{activeCount ? ` ${activeCount}` : ''}
        </Button>
      )}

      <FilterOverlay
        title="Filters"
        filters={filters}
        initialValues={values}
        open={open}
        onOpenChange={setOpen}
        onApply={(v) => onApply?.(v)}
        onClear={onClear}
      />
    </div>
  )
}

export type { FilterDef, FilterValues } from './FilterOverlay'

