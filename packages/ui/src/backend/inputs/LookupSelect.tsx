"use client"

import * as React from 'react'
import { Check, Loader2, Search, X } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '../../primitives/button'
import { IconButton } from '../../primitives/icon-button'
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

function keepSelectedItem(
  result: LookupSelectItem[],
  selected: LookupSelectItem | null,
  value: string | null,
): LookupSelectItem[] {
  if (!value || !selected || selected.id !== value) return result
  if (result.some((item) => item.id === value)) return result
  return [selected, ...result]
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
  const resolvedChangeLabel = t('ui.lookupSelect.change', 'Change')
  const resolvedMinQueryHintLabel = minQueryHintLabel ?? t(
    'ui.lookupSelect.minQueryHint',
    'Type at least {minQuery} characters or paste an id to search.',
    { minQuery: String(minQuery) }
  )
  const [query, setQuery] = React.useState('')
  const [items, setItems] = React.useState<LookupSelectItem[]>(options ?? [])
  const [loading, setLoading] = React.useState(false)
  // Escape collapses the list without clearing the selection. Derived state is not
  // enough here: Escape empties the query but the fetched `items` linger, so the
  // list would stay open and the collapsed summary — the branch that keeps a raw
  // record id out of the DOM (TC-EUDR-013) — would never render.
  // A value that is already there when the lookup mounts (hydrated, or seeded by the host,
  // e.g. the deal owner defaulting to the current user) is a finished selection: it starts
  // collapsed on the summary instead of an open list with one row checked (#5109).
  // `defaultOpen` keeps the list on screen regardless (pickers that browse a short list).
  const [collapsed, setCollapsed] = React.useState(() => Boolean(value) && !defaultOpen)
  const [hasTyped, setHasTyped] = React.useState(defaultOpen)
  const [error, setError] = React.useState<string | null>(null)
  const [fetchKey, setFetchKey] = React.useState(0)
  const [activeIndex, setActiveIndex] = React.useState(-1)
  const [selectedItem, setSelectedItem] = React.useState<LookupSelectItem | null>(null)
  const listboxId = React.useId()
  const fetchItemsRef = React.useRef(fetchItems ?? fetchOptions)
  const setQueryRef = React.useRef(setQuery)
  const onReadyRef = React.useRef(onReady)
  const optionsWasArrayRef = React.useRef(Array.isArray(options))
  const valueRef = React.useRef(value)
  const selectedItemRef = React.useRef<LookupSelectItem | null>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const pendingCommitRef = React.useRef<string | null>(null)
  const changeButtonRef = React.useRef<HTMLButtonElement>(null)
  const focusSummaryRef = React.useRef(false)

  React.useEffect(() => {
    fetchItemsRef.current = fetchItems ?? fetchOptions
  }, [fetchItems, fetchOptions])

  React.useEffect(() => {
    valueRef.current = value
  }, [value])

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

  // A set `value` keeps the lookup live: the list (or, once collapsed after a
  // pick, the summary) is where the selection, its checkmark and the clear control
  // render, so a selection is never invisible. This used to also require an
  // `options` prop, which left every caller that resolves its selection through
  // `fetchItems` blind whenever minQuery kept the list shut.
  const shouldSearch = defaultOpen || query.trim().length >= minQuery || Boolean(value)

  React.useEffect(() => {
    setActiveIndex(-1)
  }, [items])

  const optionDomId = React.useCallback(
    (index: number) => `${listboxId}-option-${index}`,
    [listboxId],
  )

  const isInteractiveItem = React.useCallback(
    (item: LookupSelectItem) => !disabled && (!item.disabled || value === item.id),
    [disabled, value],
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

  const listboxVisible = shouldSearch && !disabled && !collapsed

  const finishSelection = React.useCallback(() => {
    pendingCommitRef.current = null
    focusSummaryRef.current = true
    setCollapsed(true)
    setQuery('')
    setHasTyped(false)
    setActiveIndex(-1)
  }, [])

  // Picking a result ends the interaction (#6196): the list closes and the collapsed
  // summary takes over, but only once the parent has adopted the id. A host that keeps
  // `value` at null and collects picks itself (multi-add pickers) keeps browsing.
  const commitSelection = React.useCallback((item: LookupSelectItem) => {
    selectedItemRef.current = item
    setSelectedItem(item)
    if (valueRef.current === item.id) {
      finishSelection()
      return
    }
    pendingCommitRef.current = item.id
    onChange(item.id)
  }, [finishSelection, onChange])

  React.useEffect(() => {
    if (pendingCommitRef.current) {
      if (value === pendingCommitRef.current) finishSelection()
      else if (value) pendingCommitRef.current = null
      return
    }
    // The host adopted a value the user never picked here (seeded after mount): treat it
    // like a finished pick as long as the user is not mid-search.
    if (value && !hasTyped && query.length === 0) setCollapsed(true)
  }, [finishSelection, hasTyped, query, value])

  // The search box is not in the DOM while the summary row stands in for it, so the focus
  // moves once the box has mounted again.
  const focusAfterReopenRef = React.useRef(false)
  const reopenList = React.useCallback(() => {
    focusAfterReopenRef.current = true
    focusSummaryRef.current = false
    setCollapsed(false)
  }, [])
  const clearSelection = React.useCallback(() => {
    focusAfterReopenRef.current = true
    focusSummaryRef.current = false
    onChange(null)
  }, [onChange])

  // With nothing selected there is no summary to collapse onto, so the browse list comes back.
  React.useEffect(() => {
    if (!value) setCollapsed(false)
  }, [value])

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
      commitSelection(item)
      return
    }
    if (event.key === 'Escape') {
      if (query.length === 0 && activeIndex < 0) return
      event.preventDefault()
      event.stopPropagation()
      setQuery('')
      setActiveIndex(-1)
      focusSummaryRef.current = Boolean(value)
      setCollapsed(true)
    }
  }, [activeIndex, commitSelection, items, isInteractiveItem, listboxVisible, moveActiveIndex, query, value])
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
      const trimmedQuery = query.trim()
      loader(trimmedQuery)
        .then((result) => {
          if (cancelled) return
          // A set `value` opens the list with an empty query, and that browse
          // fetch returns an arbitrary first page. Without this the stored
          // selection vanished from the list whenever it fell outside that page,
          // while the form still held its id. A typed query stays a pure search.
          setItems(
            trimmedQuery
              ? result
              : keepSelectedItem(result, selectedItemRef.current, valueRef.current),
          )
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

  React.useEffect(() => {
    if (!value) {
      selectedItemRef.current = null
      setSelectedItem(null)
      return
    }
    const match = items.find((item) => item.id === value)
    if (match) {
      selectedItemRef.current = match
      setSelectedItem(match)
    }
  }, [items, value])

  /*
   * The collapsed summary needs a label it can trust: the consumer's
   * `selectedHintLabel` when it resolves to a name, otherwise the title of the
   * item that was actually fetched or picked. A resolver that falls back to the
   * id (`known.get(id) ?? id`) or embeds it ("Selected customer: <id>") is
   * treated as unresolved — a record id must never reach the DOM as a label.
   * With neither (a hydrated value whose lookup returned nothing) there is no
   * summary, so consumers rendering their own label never get a second one.
   */
  const collapsedSelectionLabel = React.useMemo(() => {
    if (!value) return null
    const hinted = selectedHintLabel?.(value)
    if (hinted && hinted !== value && !hinted.includes(value)) return hinted
    const fetchedTitle = selectedItem && selectedItem.id === value ? selectedItem.title : null
    return fetchedTitle && fetchedTitle !== value ? fetchedTitle : null
  }, [selectedHintLabel, selectedItem, value])
  const collapsedSelectionSubtitle = selectedItem && selectedItem.id === value ? selectedItem.subtitle ?? null : null
  // Once collapsed on a resolved selection the summary row IS the control: the search box
  // comes back only when the user asks to change the pick, so the field stays one row tall
  // and fits a narrow column (#5109).
  const showSummaryOnly = collapsed && Boolean(collapsedSelectionLabel)

  // The search box and the summary row replace each other, so whichever held the focus is
  // gone from the DOM: keyboard users continue on the control that took its place.
  React.useEffect(() => {
    if (showSummaryOnly) {
      if (!focusSummaryRef.current) return
      focusSummaryRef.current = false
      changeButtonRef.current?.focus()
      return
    }
    if (!focusAfterReopenRef.current) return
    focusAfterReopenRef.current = false
    inputRef.current?.focus()
  }, [showSummaryOnly])

  return (
    <div className="space-y-3">
      {showSummaryOnly ? null : (
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            ref={inputRef}
            className="w-full h-9 rounded-lg border border-input bg-background pl-10 pr-3 text-sm shadow-xs transition-colors outline-none placeholder:text-muted-foreground hover:border-foreground/20 focus-visible:shadow-focus focus-visible:border-foreground disabled:bg-bg-disabled disabled:border-border-disabled disabled:text-muted-foreground disabled:cursor-not-allowed"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setHasTyped(true)
              setCollapsed(false)
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
        {actionSlot && !disabled ? <div className="sm:self-start">{actionSlot}</div> : null}
      </div>
      )}
      {/*
       * `shouldSearch` decides whether to FETCH; this decides whether to RENDER a
       * list. They differ for a set value whose lookup comes back empty: develop's
       * #5248 work needs the list (and its selected option) whenever items exist,
       * while the collapsed summary — which keeps a selection visible after the
       * search box reverts to its placeholder, and keeps a raw record id out of the
       * DOM (TC-EUDR-013) — is only reachable when they do not. Falling through on
       * an empty result satisfies both. A non-empty query still renders the list so
       * its spinner and empty-state are reachable while the user is searching.
       */}
      {shouldSearch && !collapsed && (items.length > 0 || query.trim().length > 0) ? (
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
              const isInteractive = isInteractiveItem(item)
              const isActive = index === activeIndex
              return (
                <div
                  key={item.id}
                  id={optionDomId(index)}
                  className={cn(
                    'group flex items-center gap-3 rounded-lg border px-3 py-2 transition-all duration-150 focus-visible:outline-none focus-visible:shadow-focus',
                    isInteractive ? 'cursor-pointer' : 'cursor-not-allowed opacity-60',
                    isSelected
                      ? 'border-accent-indigo bg-accent-indigo/5'
                      : 'border-input bg-card hover:border-foreground/20 hover:bg-muted/30',
                    isActive && !isSelected ? 'border-foreground/20 bg-muted/30 shadow-sm' : null
                  )}
                  role="option"
                  tabIndex={isInteractive ? 0 : -1}
                  onClick={() => {
                    if (!isInteractive) return
                    commitSelection(item)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      if (!isInteractive) return
                      commitSelection(item)
                    }
                  }}
                  aria-selected={isSelected}
                  aria-disabled={isInteractive ? undefined : true}
                  title={isSelected ? resolvedSelectedLabel : isInteractive ? resolvedSelectLabel : undefined}
                >
                  {item.icon ? (
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden [&>svg]:size-5 [&_svg]:text-muted-foreground">
                      {item.icon}
                    </div>
                  ) : (
                    <div className={cn(
                      'flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md border transition-colors',
                      isSelected
                        ? 'border-accent-indigo/40 bg-accent-indigo/10 text-accent-indigo'
                        : 'border-input bg-muted text-muted-foreground group-hover:border-foreground/20'
                    )}>
                      <span className="text-sm font-medium uppercase">{item.title.slice(0, 1)}</span>
                    </div>
                  )}
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex items-center justify-between gap-3">
                      <div className="truncate text-sm font-medium text-foreground">{item.title}</div>
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
                  <div className="flex shrink-0 items-center justify-center gap-1.5">
                    {isSelected ? (
                      <>
                        <span className="text-xs font-medium text-foreground">{resolvedSelectedLabel}</span>
                        <Check className="size-4 text-accent-indigo" aria-hidden="true" />
                      </>
                    ) : (
                      <div className="size-5" aria-hidden="true" />
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          {value && !disabled ? (
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
      ) : collapsedSelectionLabel ? (
        /*
         * The selection as a single row: the name is the control that reopens the
         * search (Change), the icon clears. No second search box above it.
         */
        <div
          className={cn(
            'flex h-9 items-center gap-1 rounded-lg border border-accent-indigo bg-accent-indigo/5 pl-1 pr-1',
            disabled && 'border-border-disabled bg-bg-disabled',
          )}
          data-testid="lookup-select-selected"
        >
          {disabled ? (
            <span className="flex h-7 min-w-0 flex-1 items-center gap-2 px-2 text-muted-foreground">
              <Check className="size-4 shrink-0" aria-hidden="true" />
              <span className="truncate text-sm">{collapsedSelectionLabel}</span>
              {collapsedSelectionSubtitle ? (
                <span className="hidden truncate text-xs sm:inline">{collapsedSelectionSubtitle}</span>
              ) : null}
            </span>
          ) : (
            <Button
              ref={changeButtonRef}
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 min-w-0 flex-1 justify-start gap-2 px-2 text-left font-normal hover:bg-accent-indigo/10 hover:text-accent-indigo"
              onClick={reopenList}
              aria-label={resolvedChangeLabel}
              title={resolvedChangeLabel}
            >
              <Check className="size-4 shrink-0 text-accent-indigo" aria-hidden="true" />
              <span className="truncate text-sm text-foreground">{collapsedSelectionLabel}</span>
              {collapsedSelectionSubtitle ? (
                <span className="hidden truncate text-xs text-muted-foreground sm:inline">{collapsedSelectionSubtitle}</span>
              ) : null}
            </Button>
          )}
          {disabled ? null : (
            <IconButton
              type="button"
              variant="ghost"
              size="sm"
              className="shrink-0 text-muted-foreground hover:bg-accent-indigo/10 hover:text-accent-indigo"
              onClick={clearSelection}
              aria-label={resolvedClearLabel}
              title={resolvedClearLabel}
            >
              <X className="size-4" aria-hidden="true" />
            </IconButton>
          )}
        </div>
      ) : hasTyped ? (
        <p className="text-xs text-muted-foreground">
          {resolvedMinQueryHintLabel}
        </p>
      ) : startTypingLabel ? (
        <p className="text-xs text-muted-foreground">{startTypingLabel}</p>
      ) : null}
      {error ? <p className="text-xs text-status-error-text" role="alert">{resolvedEmptyLabel}</p> : null}
    </div>
  )
}
