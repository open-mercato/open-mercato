"use client"

import * as React from 'react'
import { Check, Loader2, Search, X } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '../../primitives/button'
import { cn } from '@open-mercato/shared/lib/utils'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('ui').child({ component: 'LookupSelect' })

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
  fetchItems?: (query: string) => Promise<LookupSelectItem[]>
  fetchOptions?: (query?: string) => Promise<LookupSelectItem[]>
  options?: LookupSelectItem[]
  minQuery?: number
  actionSlot?: React.ReactNode
  onReady?: (controls: { setQuery: (value: string) => void }) => void
  searchPlaceholder?: string
  placeholder?: string
  clearLabel?: string
  emptyLabel?: string
  loadingLabel?: string
  selectLabel?: string
  selectedLabel?: string
  minQueryHintLabel?: string
  startTypingLabel?: string
  selectedHintLabel?: (id: string) => string
  disabled?: boolean
  loading?: boolean
  defaultOpen?: boolean
}

export function LookupSelect({
  value,
  onChange,
  fetchItems,
  fetchOptions,
  options,
  minQuery = 2,
  actionSlot,
  onReady,
  placeholder,
  searchPlaceholder,
  clearLabel,
  emptyLabel,
  loadingLabel,
  selectLabel,
  selectedLabel,
  minQueryHintLabel,
  startTypingLabel,
  selectedHintLabel,
  disabled = false,
  loading: loadingProp = false,
  defaultOpen = false,
}: LookupSelectProps) {
  const t = useT()
  const resolvedSearchPlaceholder = searchPlaceholder ?? placeholder ?? t('ui.lookupSelect.searchPlaceholder', 'Search…')
  const resolvedClearLabel = clearLabel ?? t('ui.lookupSelect.clearSelection', 'Clear selection')
  const resolvedEmptyLabel = emptyLabel ?? t('ui.lookupSelect.noResults', 'No results')
  const resolvedLoadingLabel = loadingLabel ?? t('ui.lookupSelect.searching', 'Searching…')
  const resolvedSelectLabel = selectLabel ?? t('ui.lookupSelect.select', 'Select')
  const resolvedSelectedLabel = selectedLabel ?? t('ui.lookupSelect.selected', 'Selected')
  const resolvedStartTypingLabel = startTypingLabel ?? t('ui.lookupSelect.startTyping', 'Start typing to search.')
  const resolvedMinQueryHintLabel = minQueryHintLabel ?? t(
    'ui.lookupSelect.minQueryHint',
    'Type at least {minQuery} characters or paste an id to search.',
    { minQuery: String(minQuery) }
  )
  const [query, setQuery] = React.useState('')
  const [items, setItems] = React.useState<LookupSelectItem[]>(options ?? [])
  const [loading, setLoading] = React.useState(false)
  const [hasTyped, setHasTyped] = React.useState(defaultOpen)
  const [error, setError] = React.useState<string | null>(null)
  const [fetchKey, setFetchKey] = React.useState(0)
  const [activeIndex, setActiveIndex] = React.useState(-1)
  const listboxId = React.useId()
  const fetchItemsRef = React.useRef(fetchItems ?? fetchOptions)
  const setQueryRef = React.useRef(setQuery)
  const onReadyRef = React.useRef(onReady)
  const optionsWasArrayRef = React.useRef(Array.isArray(options))

  React.useEffect(() => {
    fetchItemsRef.current = fetchItems ?? fetchOptions
  }, [fetchItems, fetchOptions])

  React.useEffect(() => {
    onReadyRef.current = onReady
  }, [onReady])

  React.useEffect(() => {
    if (Array.isArray(options)) {
      optionsWasArrayRef.current = true
      setItems(options)
    } else if (optionsWasArrayRef.current) {
      optionsWasArrayRef.current = false
      setFetchKey((k) => k + 1)
    }
  }, [options])

  React.useEffect(() => {
    setQueryRef.current = setQuery
    if (onReadyRef.current) onReadyRef.current({ setQuery })
  }, [setQuery])

  const shouldSearch =
    defaultOpen || query.trim().length >= minQuery || Boolean(value && (options?.length ?? 0) > 0)

  React.useEffect(() => {
    setActiveIndex(-1)
  }, [items])

  const optionDomId = React.useCallback(
    (index: number) => `${listboxId}-option-${index}`,
    [listboxId],
  )

  const isInteractiveItem = React.useCallback(
    (item: LookupSelectItem) => !item.disabled || value === item.id,
    [value],
  )

  const moveActiveIndex = React.useCallback((direction: 1 | -1) => {
    setActiveIndex((current) => {
      if (!items.length) return -1
      let next = current
      for (let step = 0; step < items.length; step += 1) {
        next = (next + direction + items.length) % items.length
        if (isInteractiveItem(items[next])) return next
      }
      return current
    })
  }, [isInteractiveItem, items])

  React.useEffect(() => {
    if (activeIndex < 0) return
    const activeElement = typeof document !== 'undefined'
      ? document.getElementById(optionDomId(activeIndex))
      : null
    if (typeof activeElement?.scrollIntoView === 'function') {
      activeElement.scrollIntoView({ block: 'nearest' })
    }
  }, [activeIndex, optionDomId])

  const listboxVisible = shouldSearch && !disabled
  const handleInputKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!listboxVisible) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      moveActiveIndex(1)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      moveActiveIndex(-1)
      return
    }
    if (event.key === 'Enter') {
      if (activeIndex < 0 || activeIndex >= items.length) return
      const item = items[activeIndex]
      if (!isInteractiveItem(item)) return
      event.preventDefault()
      onChange(item.id)
      setActiveIndex(-1)
      return
    }
    if (event.key === 'Escape') {
      if (query.length === 0 && activeIndex < 0) return
      event.preventDefault()
      event.stopPropagation()
      setQuery('')
      setActiveIndex(-1)
    }
  }, [activeIndex, items, isInteractiveItem, listboxVisible, moveActiveIndex, onChange, query])
  React.useEffect(() => {
    if (disabled) {
      setItems(options ?? [])
      setLoading(false)
      return
    }
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    if (!shouldSearch) {
      setItems(options ?? [])
      setLoading(false)
      setError(null)
      return () => { cancelled = true }
    }
    setLoading(true)
    setError(null)
    timer = setTimeout(() => {
      const requestId = Date.now()
      const fetcher = fetchItemsRef.current
      const loader = fetcher ?? (() => Promise.resolve(options ?? []))
      loader(query.trim())
        .then((result) => {
          if (cancelled) return
          setItems(result)
        })
        .catch((err) => {
          if (cancelled) return
          logger.error('Failed to fetch lookup items', { err })
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
  }, [query, shouldSearch, fetchKey])

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            className="w-full h-10 rounded-lg border border-input bg-background pl-10 pr-3 text-sm shadow-xs transition-colors outline-none placeholder:text-muted-foreground hover:border-foreground/20 focus-visible:shadow-focus focus-visible:border-brand-violet disabled:bg-bg-disabled disabled:border-border-disabled disabled:text-muted-foreground disabled:cursor-not-allowed"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setHasTyped(true)
            }}
            onKeyDown={handleInputKeyDown}
            placeholder={resolvedSearchPlaceholder}
            disabled={disabled}
            role="combobox"
            aria-expanded={listboxVisible}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={activeIndex >= 0 ? optionDomId(activeIndex) : undefined}
          />
        </div>
        {actionSlot ? <div className="sm:self-start">{actionSlot}</div> : null}
      </div>
      {shouldSearch ? (
        <div className="space-y-2">
          {loading || loadingProp ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {resolvedLoadingLabel}
            </div>
          ) : null}
          {!loading && !loadingProp && !items.length ? (
            <p className="text-xs text-muted-foreground">{resolvedEmptyLabel}</p>
          ) : null}
          <div
            id={listboxId}
            role="listbox"
            className="flex flex-col gap-1.5 max-h-80 overflow-y-auto -mx-0.5 px-0.5 py-0.5"
          >
            {items.map((item, index) => {
              const isSelected = value === item.id
              const isInteractive = !item.disabled || isSelected
              const isActive = index === activeIndex
              return (
                <div
                  key={item.id}
                  id={optionDomId(index)}
                  className={cn(
                    'group flex items-center gap-4 rounded-xl border p-4 transition-all duration-150 focus-visible:outline-none focus-visible:shadow-focus',
                    isInteractive ? 'cursor-pointer' : 'cursor-not-allowed opacity-60',
                    isSelected
                      ? 'border-brand-violet bg-brand-violet/5 shadow-sm'
                      : 'border-input bg-card hover:border-foreground/20 hover:bg-muted/30 hover:shadow-sm',
                    isActive && !isSelected ? 'border-foreground/20 bg-muted/30 shadow-sm' : null
                  )}
                  role="option"
                  tabIndex={item.disabled ? -1 : 0}
                  onClick={() => {
                    if (!isInteractive) return
                    onChange(item.id)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      if (!isInteractive) return
                      onChange(item.id)
                    }
                  }}
                  aria-selected={isSelected}
                  aria-disabled={item.disabled && !isSelected ? true : undefined}
                  title={isSelected ? resolvedSelectedLabel : resolvedSelectLabel}
                >
                  {item.icon ? (
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden [&>svg]:size-6 [&_svg]:text-muted-foreground">
                      {item.icon}
                    </div>
                  ) : (
                    <div className={cn(
                      'flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border transition-colors',
                      isSelected
                        ? 'border-brand-violet/40 bg-brand-violet/10 text-brand-violet'
                        : 'border-input bg-muted text-muted-foreground group-hover:border-foreground/20'
                    )}>
                      <span className="text-base font-semibold uppercase">{item.title.slice(0, 1)}</span>
                    </div>
                  )}
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex items-center justify-between gap-3">
                      <div className="truncate text-sm font-semibold text-foreground">{item.title}</div>
                      {item.rightLabel ? (
                        <div className="shrink-0 text-overline font-medium uppercase tracking-wider text-muted-foreground">
                          {item.rightLabel}
                        </div>
                      ) : null}
                    </div>
                    {item.subtitle ? (
                      <div className="text-xs text-muted-foreground truncate">{item.subtitle}</div>
                    ) : null}
                    {item.description ? (
                      <div className="text-xs text-muted-foreground/70 truncate">{item.description}</div>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center justify-center">
                    {isSelected ? (
                      <Check className="size-5 text-brand-violet" aria-hidden="true" />
                    ) : (
                      <div className="size-5" aria-hidden="true" />
                    )}
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
              {resolvedClearLabel}
            </Button>
          ) : null}
        </div>
      ) : value ? (
        /*
         * The visible input is the *search box*, not a value display: once the
         * list closes it shows its placeholder again, so a selection made and
         * then collapsed left the control looking empty even though the form
         * held the id. `selectedHintLabel` existed for exactly this and was
         * never rendered.
         */
        <div
          className="flex items-center justify-between gap-3 rounded-lg border border-input bg-muted/40 px-3 py-2"
          data-testid="lookup-select-selected"
        >
          <span className="truncate text-sm font-medium text-foreground">
            {selectedHintLabel ? selectedHintLabel(value) : value}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="shrink-0 gap-1 text-sm font-normal"
            disabled={disabled}
            onClick={() => onChange(null)}
          >
            <X className="h-4 w-4" />
            {resolvedClearLabel}
          </Button>
        </div>
      ) : hasTyped ? (
        <p className="text-xs text-muted-foreground">
          {resolvedMinQueryHintLabel}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">{resolvedStartTypingLabel}</p>
      )}
      {error ? <p className="text-xs text-status-error-text" role="alert">{resolvedEmptyLabel}</p> : null}
    </div>
  )
}
