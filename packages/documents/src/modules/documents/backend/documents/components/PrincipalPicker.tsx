"use client"

import * as React from 'react'
import { Search, X } from 'lucide-react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'

type PrincipalType = 'user' | 'role'

type PrincipalOption = {
  id: string
  label: string
  primary: string
  secondary: string | null
}

type PrincipalListPayload = {
  items?: unknown[]
  total?: unknown
  totalPages?: unknown
}

type PrincipalPickerProps = {
  principalType: PrincipalType
  value: string | null
  onChange: (id: string | null, label: string | null) => void
  disabled?: boolean
  id?: string
}

const PAGE_SIZE = 20
const DEBOUNCE_MS = 250

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null
}

function readString(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim().length > 0) return value
  }
  return null
}

function readPositiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function normalizeUser(value: unknown): PrincipalOption | null {
  const record = readRecord(value)
  if (!record) return null
  const id = readString(record, 'id')
  const email = readString(record, 'email')
  const name = readString(record, 'name')
  const primary = name ?? email
  if (!id || !primary) return null
  const secondary = name && email && email !== name ? email : null
  return {
    id,
    label: secondary ? `${primary} (${secondary})` : primary,
    primary,
    secondary,
  }
}

function normalizeRole(value: unknown): PrincipalOption | null {
  const record = readRecord(value)
  if (!record) return null
  const id = readString(record, 'id')
  const name = readString(record, 'name')
  if (!id || !name) return null
  return {
    id,
    label: name,
    primary: name,
    secondary: null,
  }
}

function readPrincipalPage(payload: PrincipalListPayload | null, principalType: PrincipalType, page: number) {
  const record = readRecord(payload)
  const rawItems = Array.isArray(record?.items) ? record.items : []
  const items = rawItems
    .slice(0, PAGE_SIZE)
    .map(principalType === 'user' ? normalizeUser : normalizeRole)
    .filter((item): item is PrincipalOption => item !== null)
  const total = readPositiveNumber(record?.total) ?? items.length
  const resolvedTotalPages =
    readPositiveNumber(record?.totalPages) ??
    (total > 0 ? Math.ceil(total / PAGE_SIZE) : 1)
  return {
    items,
    total,
    totalPages: Math.max(1, resolvedTotalPages, page),
  }
}

function buildPrincipalUrl(principalType: PrincipalType, query: string, page: number): string {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(PAGE_SIZE),
  })
  if (query.length > 0) params.set('search', query)
  const resource = principalType === 'user' ? 'users' : 'roles'
  return `/api/auth/${resource}?${params.toString()}`
}

function mergeOptions(current: PrincipalOption[], next: PrincipalOption[]): PrincipalOption[] {
  const merged = new Map(current.map((item) => [item.id, item]))
  next.forEach((item) => merged.set(item.id, item))
  return Array.from(merged.values())
}

export function PrincipalPicker({
  principalType,
  value,
  onChange,
  disabled = false,
  id,
}: PrincipalPickerProps) {
  const t = useT()
  const generatedId = React.useId()
  const inputId = id ?? `documents-principal-picker-${generatedId}`
  const listId = `${inputId}-list`
  const containerRef = React.useRef<HTMLDivElement>(null)
  const requestSequenceRef = React.useRef(0)

  const [searchValue, setSearchValue] = React.useState('')
  const [selectedLabel, setSelectedLabel] = React.useState<string | null>(null)
  const [manualValue, setManualValue] = React.useState(value ?? '')
  const [items, setItems] = React.useState<PrincipalOption[]>([])
  const [open, setOpen] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [loadingMore, setLoadingMore] = React.useState(false)
  const [unavailable, setUnavailable] = React.useState(false)
  const [hasFetched, setHasFetched] = React.useState(false)
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [activeIndex, setActiveIndex] = React.useState(-1)

  React.useEffect(() => {
    requestSequenceRef.current += 1
    setSearchValue('')
    setSelectedLabel(null)
    setManualValue('')
    setItems([])
    setOpen(false)
    setLoading(false)
    setLoadingMore(false)
    setUnavailable(false)
    setHasFetched(false)
    setPage(1)
    setTotal(0)
    setTotalPages(1)
    setActiveIndex(-1)
  }, [principalType])

  React.useEffect(() => {
    if (value) {
      if (unavailable) setManualValue(value)
      return
    }
    setSearchValue('')
    setSelectedLabel(null)
    setManualValue('')
    setItems([])
    setOpen(false)
    setHasFetched(false)
    setActiveIndex(-1)
  }, [unavailable, value])

  const enterUnavailableMode = React.useCallback(() => {
    requestSequenceRef.current += 1
    setUnavailable(true)
    setOpen(false)
    setItems([])
    setLoading(false)
    setLoadingMore(false)
    setHasFetched(false)
    setSearchValue('')
    setSelectedLabel(null)
    setManualValue(value ?? '')
    setActiveIndex(-1)
  }, [value])

  const fetchPage = React.useCallback(async (query: string, nextPage: number, append: boolean) => {
    const requestId = append ? requestSequenceRef.current : requestSequenceRef.current + 1
    requestSequenceRef.current = requestId

    if (append) {
      setLoadingMore(true)
    } else {
      setLoading(true)
      setHasFetched(false)
    }

    try {
      const call = await apiCall<PrincipalListPayload>(
        buildPrincipalUrl(principalType, query, nextPage),
        undefined,
        { fallback: { items: [], total: 0, totalPages: 1 } },
      )
      if (requestSequenceRef.current !== requestId) return
      if (!call.ok) {
        enterUnavailableMode()
        return
      }
      const pageResult = readPrincipalPage(call.result, principalType, nextPage)
      setItems((current) => append ? mergeOptions(current, pageResult.items) : pageResult.items)
      setPage(nextPage)
      setTotal(pageResult.total)
      setTotalPages(pageResult.totalPages)
      setHasFetched(true)
      setOpen(true)
      if (!append) setActiveIndex(pageResult.items.length > 0 ? 0 : -1)
      else if (pageResult.items.length > 0) setActiveIndex((current) => current < 0 ? 0 : current)
    } catch {
      if (requestSequenceRef.current === requestId) enterUnavailableMode()
    } finally {
      if (requestSequenceRef.current !== requestId) return
      if (append) setLoadingMore(false)
      else setLoading(false)
    }
  }, [enterUnavailableMode, principalType])

  React.useEffect(() => {
    if (disabled || unavailable || !open || selectedLabel) return
    const query = searchValue.trim()
    const timer = window.setTimeout(() => {
      void fetchPage(query, 1, false)
    }, DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [disabled, fetchPage, open, searchValue, selectedLabel, unavailable])

  const selectOption = React.useCallback((option: PrincipalOption) => {
    setSelectedLabel(option.label)
    setSearchValue('')
    setItems([])
    setOpen(false)
    setHasFetched(false)
    setActiveIndex(-1)
    onChange(option.id, option.label)
  }, [onChange])

  const clearSelection = React.useCallback(() => {
    setSearchValue('')
    setSelectedLabel(null)
    setManualValue('')
    setItems([])
    setOpen(false)
    setHasFetched(false)
    setActiveIndex(-1)
    onChange(null, null)
  }, [onChange])

  const handleManualChange = React.useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.target.value
    setManualValue(nextValue)
    onChange(nextValue.length > 0 ? nextValue : null, nextValue.length > 0 ? nextValue : null)
  }, [onChange])

  const handleSearchChange = React.useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.target.value
    if (selectedLabel || value) onChange(null, null)
    setSelectedLabel(null)
    setSearchValue(nextValue)
    setOpen(true)
  }, [onChange, selectedLabel, value])

  const handleLoadMore = React.useCallback(() => {
    if (loading || loadingMore || page >= totalPages) return
    void fetchPage(searchValue.trim(), page + 1, true)
  }, [fetchPage, loading, loadingMore, page, searchValue, totalPages])

  const handleKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') return
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      return
    }
    if (!open || items.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((current) => Math.min(current + 1, items.length - 1))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((current) => Math.max(current - 1, 0))
      return
    }
    if (event.key === 'Enter') {
      const activeItem = items[activeIndex]
      if (!activeItem) return
      event.preventDefault()
      selectOption(activeItem)
    }
  }, [activeIndex, items, open, selectOption])

  const displayValue = selectedLabel ?? (value && searchValue.length === 0 ? value : searchValue)
  const placeholder =
    principalType === 'user'
      ? t('documents.share.picker.searchUser')
      : t('documents.share.picker.searchRole')
  const canLoadMore = page < totalPages
  const hasText = unavailable ? manualValue.length > 0 : displayValue.length > 0

  return (
    <div
      ref={containerRef}
      className="relative space-y-1"
      onBlur={(event) => {
        const nextTarget = event.relatedTarget
        if (nextTarget instanceof Node && containerRef.current?.contains(nextTarget)) return
        setOpen(false)
      }}
      onKeyDown={handleKeyDown}
    >
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
        <Input
          id={inputId}
          className="w-full"
          value={unavailable ? manualValue : displayValue}
          onChange={unavailable ? handleManualChange : handleSearchChange}
          onFocus={() => {
            if (!unavailable && !selectedLabel) setOpen(true)
          }}
          placeholder={placeholder}
          disabled={disabled}
          leftIcon={unavailable ? undefined : <Search />}
          role={unavailable ? undefined : 'combobox'}
          aria-expanded={unavailable ? undefined : open}
          aria-controls={unavailable ? undefined : listId}
          aria-autocomplete={unavailable ? undefined : 'list'}
          aria-activedescendant={!unavailable && activeIndex >= 0 ? `${listId}-option-${activeIndex}` : undefined}
        />
        </div>
        {hasText ? (
          <IconButton
            type="button"
            variant="ghost"
            className="shrink-0"
            aria-label={t('documents.share.picker.clear')}
            onClick={clearSelection}
            disabled={disabled}
          >
            <X aria-hidden="true" />
          </IconButton>
        ) : null}
      </div>

      {unavailable ? (
        <p className="text-xs text-muted-foreground">{t('documents.share.picker.unavailable')}</p>
      ) : null}

      {open && !unavailable ? (
        <div
          id={listId}
          role="listbox"
          className="absolute z-popover mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg"
        >
          {loading ? (
            <div className="px-3 py-2 text-sm text-muted-foreground">
              {t('documents.share.picker.loading')}
            </div>
          ) : null}

          {!loading && hasFetched && items.length === 0 ? (
            <div className="px-3 py-2 text-sm text-muted-foreground">
              {t('documents.share.picker.noMatches')}
            </div>
          ) : null}

          {!loading && items.length > 0 ? (
            <div className="space-y-1">
              {items.map((item, index) => (
                <Button
                  id={`${listId}-option-${index}`}
                  key={item.id}
                  type="button"
                  variant="ghost"
                  role="option"
                  aria-selected={index === activeIndex}
                  className={cn(
                    'h-auto w-full justify-start px-3 py-2 text-left',
                    index === activeIndex ? 'bg-accent text-accent-foreground' : null,
                  )}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectOption(item)}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{item.primary}</span>
                    {item.secondary ? (
                      <span className="block truncate text-xs text-muted-foreground">{item.secondary}</span>
                    ) : null}
                  </span>
                </Button>
              ))}
            </div>
          ) : null}

          {!loading && hasFetched ? (
            <div className="border-t border-border px-2 py-2">
              {total > 0 ? (
                <p className="mb-2 text-xs text-muted-foreground">
                  {t('documents.share.picker.showing', { count: items.length, total })}
                </p>
              ) : null}
              {canLoadMore ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="w-full"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                >
                  {loadingMore ? t('documents.share.picker.loading') : t('documents.share.picker.loadMore')}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
