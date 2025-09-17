"use client"
import * as React from 'react'
import { Button } from '../primitives/button'
import { FilterDef, FilterOverlay, FilterValues } from './FilterOverlay'

export type FilterBarProps = {
  searchValue?: string
  onSearchChange?: (v: string) => void
  searchPlaceholder?: string
  searchAlign?: 'left' | 'right'
  filters?: FilterDef[]
  values?: FilterValues
  onApply?: (values: FilterValues) => void
  onClear?: () => void
  className?: string
}

export function FilterBar({ searchValue, onSearchChange, searchPlaceholder = 'Search', searchAlign = 'left', filters = [], values = {}, onApply, onClear, className }: FilterBarProps) {
  const [open, setOpen] = React.useState(false)
  const activeCount = React.useMemo(() => {
    const isActive = (v: any) => {
      if (v == null) return false
      if (typeof v === 'string') return v.trim() !== ''
      if (Array.isArray(v)) return v.length > 0
      if (typeof v === 'object') return Object.values(v).some((x) => x != null && x !== '')
      return Boolean(v)
    }
    return Object.values(values).filter(isActive).length
  }, [values])

  return (
    <div className={`flex flex-col gap-2 ${className ?? ''}`}>
      <div className="flex flex-wrap items-center gap-2 w-full">
        {filters.length > 0 && (
          <Button variant="outline" className="h-9" onClick={() => setOpen(true)}>
            Filters{activeCount ? ` ${activeCount}` : ''}
          </Button>
        )}
        {onSearchChange && (
          <div className={`relative w-full sm:w-[240px] ${searchAlign === 'right' ? 'ml-auto' : ''}`}>
            <input
              value={searchValue ?? ''}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={searchPlaceholder}
              className="h-9 w-full rounded border pl-8 pr-2"
            />
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground">🔍</span>
          </div>
        )}
      </div>
      {/* Active filter chips */}
      {filters.length > 0 && activeCount > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          {filters.map((f) => {
            const v = (values as any)[f.id]
            if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) return null
            const toLabel = (val: any) => {
              if (f.type === 'select' && f.options) {
                const o = f.options.find((o) => o.value === val)
                return o ? o.label : String(val)
              }
              if (typeof val === 'object' && val.from == null && val.to == null) return null
              if (typeof val === 'object') return `${val.from ?? ''}${val.to ? ` → ${val.to}` : ''}`.trim()
              if (val === true) return 'Yes'
              if (val === false) return 'No'
              return String(val)
            }
            const removeValue = (val?: any) => {
              const next = { ...(values || {}) }
              if (Array.isArray(v) && val !== undefined) next[f.id] = v.filter((x: any) => x !== val)
              else delete (next as any)[f.id]
              onApply?.(next)
            }
            if (Array.isArray(v)) {
              return v.map((item) => (
                <Button key={`${f.id}:${item}`} size="sm" variant="outline" onClick={() => removeValue(item)}>
                  {f.label}: {toLabel(item)} ×
                </Button>
              ))
            }
            const label = toLabel(v)
            if (!label) return null
            return (
              <Button key={f.id} size="sm" variant="outline" onClick={() => removeValue()}>
                {f.label}: {label} ×
              </Button>
            )
          })}
        </div>
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
