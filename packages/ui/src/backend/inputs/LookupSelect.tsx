"use client"

import * as React from 'react'
import { Loader2, Search, X } from 'lucide-react'
import { Button } from '../../primitives/button'
import { cn } from '@/lib/utils'

export type LookupSelectItem = {
  id: string
  title: string
  subtitle?: string | null
  badge?: string | null
  icon?: React.ReactNode
  disabled?: boolean
  rightLabel?: string | null
  description?: string | null
}

type LookupSelectProps = {
  value: string | null
  onChange: (next: string | null) => void
  fetchItems: (query: string) => Promise<LookupSelectItem[]>
  minQuery?: number
  actionSlot?: React.ReactNode
  onReady?: (controls: { setQuery: (value: string) => void }) => void
  searchPlaceholder?: string
  clearLabel?: string
  emptyLabel?: string
  loadingLabel?: string
  selectedHintLabel?: (id: string) => string
}

export function LookupSelect({
  value,
  onChange,
  fetchItems,
  minQuery = 2,
  actionSlot,
  onReady,
  searchPlaceholder = 'Search…',
  clearLabel = 'Clear selection',
  emptyLabel = 'No results',
  loadingLabel = 'Searching…',
  selectedHintLabel,
}: LookupSelectProps) {
  const [query, setQuery] = React.useState('')
  const [items, setItems] = React.useState<LookupSelectItem[]>([])
  const [loading, setLoading] = React.useState(false)
  const [hasTyped, setHasTyped] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const fetchItemsRef = React.useRef(fetchItems)
  const setQueryRef = React.useRef(setQuery)

  React.useEffect(() => {
    fetchItemsRef.current = fetchItems
  }, [fetchItems])

  React.useEffect(() => {
    setQueryRef.current = setQuery
    if (onReady) onReady({ setQuery })
  }, [onReady, setQuery])

  const shouldSearch = query.trim().length >= minQuery
  React.useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    if (!shouldSearch) {
      setItems([])
      setLoading(false)
      setError(null)
      return () => { cancelled = true }
    }
    setLoading(true)
    setError(null)
    timer = setTimeout(() => {
      const requestId = Date.now()
      fetchItemsRef.current(query.trim())
        .then((result) => {
          if (cancelled) return
          setItems(result)
        })
        .catch((err) => {
          if (cancelled) return
          console.error('LookupSelect.fetchItems', err)
          setError('error')
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
      return requestId
    }, 220)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [query, shouldSearch])

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            className="w-full rounded border pl-8 pr-2 py-2 text-sm"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setHasTyped(true)
            }}
            placeholder={searchPlaceholder}
          />
        </div>
        {actionSlot ? <div className="sm:self-start">{actionSlot}</div> : null}
      </div>
      {shouldSearch ? (
        <div className="space-y-2">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {loadingLabel}
            </div>
          ) : null}
          {!loading && !items.length ? (
            <p className="text-xs text-muted-foreground">{emptyLabel}</p>
          ) : null}
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {items.map((item) => {
              const isSelected = value === item.id
              const handleSelect = () => {
                if (item.disabled && !isSelected) return
                onChange(item.id)
              }
              return (
                <div
                  key={item.id}
                  className={cn(
                    'flex gap-3 rounded border bg-card p-3 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary',
                    isSelected ? 'border-primary/70 bg-primary/5' : 'hover:border-primary/50'
                  )}
                  role="button"
                  tabIndex={item.disabled ? -1 : 0}
                  onClick={handleSelect}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      handleSelect()
                    }
                  }}
                  aria-pressed={isSelected}
                >
                  <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded border bg-muted">
                    {item.icon ?? <span className="text-muted-foreground">•</span>}
                  </div>
                  <div className="flex flex-1 flex-col gap-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{item.title}</div>
                        {item.subtitle ? (
                          <div className="text-xs text-muted-foreground truncate">{item.subtitle}</div>
                        ) : null}
                        {item.description ? (
                          <div className="text-xs text-muted-foreground truncate">{item.description}</div>
                        ) : null}
                      </div>
                      {item.rightLabel ? (
                        <div className="text-xs font-medium text-muted-foreground">{item.rightLabel}</div>
                      ) : null}
                    </div>
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        variant={isSelected ? 'secondary' : 'outline'}
                        size="sm"
                        onClick={(event) => {
                          event.stopPropagation()
                          handleSelect()
                        }}
                        disabled={item.disabled && !isSelected}
                      >
                        {isSelected ? 'Selected' : 'Select'}
                      </Button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          {value ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-fit gap-1 text-sm font-normal"
              onClick={() => onChange(null)}
            >
              <X className="h-4 w-4" />
              {clearLabel}
            </Button>
          ) : null}
        </div>
      ) : hasTyped ? (
        <p className="text-xs text-muted-foreground">
          {`Type at least ${minQuery} characters or paste an id to search.`}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">Start typing to search.</p>
      )}
      {error ? <p className="text-xs text-destructive">{emptyLabel}</p> : null}
    </div>
  )
}
