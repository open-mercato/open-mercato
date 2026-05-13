"use client"
import * as React from 'react'
import { ListFilter } from 'lucide-react'
import { Button } from '../primitives/button'
import { SearchInput } from '../primitives/search-input'
import { FilterDef, FilterOverlay, FilterValues } from './FilterOverlay'
import { useT } from '@open-mercato/shared/lib/i18n/context'

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
  leadingItems?: React.ReactNode
  trailingItems?: React.ReactNode
  /**
   * Items rendered immediately after the search input on the same row.
   * Intended for compact, icon-sized triggers (AI assistants, saved view
   * shortcuts). Stays adjacent to the search input regardless of
   * `searchAlign` and is suppressed when no search input is rendered.
   */
  searchTrailing?: React.ReactNode
  layout?: 'stacked' | 'inline'
  filtersExtraContent?: React.ReactNode
}

export function FilterBar({
  searchValue,
  onSearchChange,
  searchPlaceholder,
  searchAlign = 'left',
  filters = [],
  values = {},
  onApply,
  onClear,
  className,
  leadingItems,
  trailingItems,
  searchTrailing,
  layout = 'stacked',
  filtersExtraContent,
}: FilterBarProps) {
  const t = useT()
  const resolvedSearchPlaceholder = searchPlaceholder ?? t('ui.filterBar.searchPlaceholder', 'Search')
  const [open, setOpen] = React.useState(false)
  const [searchDraft, setSearchDraft] = React.useState(searchValue ?? '')
  const lastAppliedSearchRef = React.useRef(searchValue ?? '')

  React.useEffect(() => {
    const next = searchValue ?? ''
    lastAppliedSearchRef.current = next
    setSearchDraft((prev) => (prev === next ? prev : next))
  }, [searchValue])

  React.useEffect(() => {
    if (!onSearchChange) return
    const handle = window.setTimeout(() => {
      if (lastAppliedSearchRef.current === searchDraft) return
      lastAppliedSearchRef.current = searchDraft
      onSearchChange(searchDraft)
    }, 1000)
    return () => {
      window.clearTimeout(handle)
    }
  }, [searchDraft, onSearchChange])

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

  const containerClass = `flex flex-col ${layout === 'inline' ? 'gap-1 sm:gap-2' : 'gap-2'} w-full`
  const searchBlock = onSearchChange ? (
    <div className={`flex items-center gap-2 ${searchAlign === 'right' ? 'sm:ml-auto' : ''}`}>
      <div className="w-full sm:w-72 lg:w-80">
        <SearchInput
          value={searchDraft}
          onChange={setSearchDraft}
          placeholder={resolvedSearchPlaceholder}
          suppressHydrationWarning
        />
      </div>
      {searchTrailing ? (
        <div className="flex items-center gap-1">{searchTrailing}</div>
      ) : null}
    </div>
  ) : null
  const controls = (
    <div className={`flex flex-wrap items-center gap-2 ${searchAlign === 'left' && searchBlock ? 'sm:ml-auto' : ''}`}>
      {filters.length > 0 && (
        <Button variant="outline" onClick={() => setOpen(true)}>
          <ListFilter aria-hidden="true" className="size-4 opacity-80" />
          {activeCount
            ? t('ui.filterBar.filtersWithCount', 'Filters {count}', { count: activeCount })
            : t('ui.filterBar.filters', 'Filters')
          }
        </Button>
      )}
      {leadingItems}
      {trailingItems}
    </div>
  )

  return (
    <div className={`${containerClass} ${className ?? ''}`}>
      <div className="flex flex-wrap items-center gap-2 w-full">
        {searchAlign === 'left' ? searchBlock : null}
        {controls}
        {searchAlign === 'right' ? searchBlock : null}
      </div>
      {/* Active filter chips */}
      {filters.length > 0 && activeCount > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          {filters.map((f) => {
            const v = (values as any)[f.id]
            if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) return null
            const toLabel = (val: any) => {
              if (typeof f.formatValue === 'function' && (typeof val === 'string' || typeof val === 'number')) {
                const formatted = f.formatValue(String(val))
                if (formatted) return formatted
              }
              if (f.type === 'select' && f.options) {
                const o = f.options.find((o) => o.value === val)
                return o ? o.label : String(val)
              }
              if (typeof val === 'object' && val.from == null && val.to == null) return null
              if (typeof val === 'object') {
                const from = val.from ?? ''
                const to = val.to ? ` → ${val.to}` : ''
                return `${from}${to}`.trim()
              }
              if (val === true) return t('common.yes', 'Yes')
              if (val === false) return t('common.no', 'No')
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
                <Button key={`${f.id}:${item}`} size="sm" variant="outline" className="max-w-[calc(100vw-4rem)] truncate" onClick={() => removeValue(item)}>
                  {f.label}: {toLabel(item)} ×
                </Button>
              ))
            }
            const label = toLabel(v)
            if (!label) return null
            return (
              <Button key={f.id} size="sm" variant="outline" className="max-w-[calc(100vw-4rem)] truncate" onClick={() => removeValue()}>
                {f.label}: {label} ×
              </Button>
            )
          })}
        </div>
      )}
      <FilterOverlay
        title={t('ui.filterOverlay.title', 'Filters')}
        filters={filters}
        initialValues={values}
        open={open}
        onOpenChange={setOpen}
        onApply={(v) => onApply?.(v)}
        onClear={onClear}
        extraContent={filtersExtraContent}
      />
    </div>
  )
}

export type { FilterDef, FilterValues } from './FilterOverlay'
