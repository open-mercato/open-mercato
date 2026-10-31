"use client"

import * as React from 'react'
import { Search, X } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

export type StaffTeamOption = {
  id: string
  label: string
  name: string
}

type StaffTeamRecord = {
  id?: string | null
  name?: string | null
}

type StaffTeamsResponse = {
  items?: StaffTeamRecord[]
}

type CachedTeamLabel = {
  label: string
  status: 'ok' | 'forbidden' | 'error'
}

export type TeamLabelLookupResult = {
  label: string
  status: CachedTeamLabel['status']
}

export type TeamSearchResult =
  | { status: 'ok'; options: StaffTeamOption[] }
  | { status: 'forbidden'; options: [] }
  | { status: 'error'; options: [] }

type TeamSelectProps = {
  id?: string
  value: string | null | undefined
  onChange: (value: string | null) => void
  nullable?: boolean
  disabled?: boolean
  placeholder?: string
}

const MAX_LABEL_LOOKUPS = 25
const teamLabelCache = new Map<string, CachedTeamLabel>()
const pendingTeamLabelLookups = new Map<string, Promise<TeamLabelLookupResult>>()

function cleanText(value: string | null | undefined): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed.length > 0 ? trimmed : null
}

function normalizeValue(value: string | null | undefined): string | null {
  return cleanText(value)
}

function normalizeTeamRecord(record: StaffTeamRecord): StaffTeamOption | null {
  const id = cleanText(record.id)
  const name = cleanText(record.name)
  if (!id || !name) return null
  return { id, name, label: name }
}

function cacheTeamOption(option: StaffTeamOption): void {
  teamLabelCache.set(option.id, { label: option.label, status: 'ok' })
}

function cacheFallback(id: string, status: 'forbidden' | 'error'): TeamLabelLookupResult {
  const result = { label: id, status }
  teamLabelCache.set(id, result)
  return result
}

function inaccessibleStatus(status: number | undefined): boolean {
  return status === 403 || status === 404
}

export async function searchStaffTeams(query: string): Promise<TeamSearchResult> {
  const params = new URLSearchParams()
  params.set('page', '1')
  params.set('pageSize', '25')
  const trimmed = query.trim()
  params.set('search', trimmed)

  const call = await apiCall<StaffTeamsResponse>(`/api/staff/teams?${params.toString()}`)
  if (inaccessibleStatus(call.status)) return { status: 'forbidden', options: [] }
  if (!call.ok || !call.result) return { status: 'error', options: [] }

  const options = (call.result.items ?? [])
    .map(normalizeTeamRecord)
    .filter((option): option is StaffTeamOption => option !== null)
  options.forEach(cacheTeamOption)
  return { status: 'ok', options }
}

export async function lookupTeamLabel(id: string): Promise<TeamLabelLookupResult> {
  const normalizedId = id.trim()
  const cached = teamLabelCache.get(normalizedId)
  if (cached) return cached

  const pending = pendingTeamLabelLookups.get(normalizedId)
  if (pending) return pending

  const request = (async (): Promise<TeamLabelLookupResult> => {
    const params = new URLSearchParams()
    params.set('ids', normalizedId)
    params.set('page', '1')
    params.set('pageSize', '1')

    const call = await apiCall<StaffTeamsResponse>(`/api/staff/teams?${params.toString()}`)
    if (inaccessibleStatus(call.status)) return cacheFallback(normalizedId, 'forbidden')
    if (!call.ok || !call.result) return cacheFallback(normalizedId, 'error')

    const option = (call.result.items ?? [])
      .map(normalizeTeamRecord)
      .find((item): item is StaffTeamOption => item?.id === normalizedId)
    if (!option) return cacheFallback(normalizedId, 'error')

    cacheTeamOption(option)
    return { label: option.label, status: 'ok' }
  })().finally(() => {
    pendingTeamLabelLookups.delete(normalizedId)
  })

  pendingTeamLabelLookups.set(normalizedId, request)
  return request
}

export function useTeamLabels(ids: readonly string[]): Record<string, string> {
  const idsKey = React.useMemo(() => {
    const unique = Array.from(new Set(
      ids
        .map((id) => id.trim())
        .filter((id) => id.length > 0),
    ))
    return unique.slice(0, MAX_LABEL_LOOKUPS).join('|')
  }, [ids])

  const [labels, setLabels] = React.useState<Record<string, string>>({})

  React.useEffect(() => {
    const normalizedIds = idsKey ? idsKey.split('|') : []
    if (normalizedIds.length === 0) {
      setLabels({})
      return
    }

    const nextLabels: Record<string, string> = {}
    const missing: string[] = []
    for (const id of normalizedIds) {
      const cached = teamLabelCache.get(id)
      nextLabels[id] = cached?.label ?? id
      if (!cached) missing.push(id)
    }
    setLabels(nextLabels)

    if (missing.length === 0) return

    let cancelled = false
    Promise.all(missing.map((id) => lookupTeamLabel(id)))
      .then(() => {
        if (cancelled) return
        setLabels((current) => {
          const updated = { ...current }
          for (const id of normalizedIds) {
            updated[id] = teamLabelCache.get(id)?.label ?? id
          }
          return updated
        })
      })
      .catch(() => {
        if (cancelled) return
        setLabels((current) => {
          const updated = { ...current }
          for (const id of missing) updated[id] = id
          return updated
        })
      })

    return () => {
      cancelled = true
    }
  }, [idsKey])

  return labels
}

export function TeamSelect({
  id,
  value,
  onChange,
  nullable = false,
  disabled = false,
  placeholder,
}: TeamSelectProps) {
  const t = useT()
  const normalizedValue = normalizeValue(value)
  const labels = useTeamLabels(normalizedValue ? [normalizedValue] : [])
  const selectedLabel = normalizedValue ? labels[normalizedValue] ?? normalizedValue : ''
  const resolvedPlaceholder = placeholder ?? t('incidents.teamSelect.searchPlaceholder', 'Search teams')
  const loadingLabel = t('incidents.teamSelect.loading', 'Searching teams...')
  const noResultsLabel = t('incidents.teamSelect.noResults', 'No matching teams')
  const clearLabel = t('incidents.teamSelect.clear', 'Clear team')
  const fallbackPlaceholder = t('incidents.teamSelect.fallbackPlaceholder', 'Team UUID')
  const listboxId = React.useId()
  const inputRef = React.useRef<HTMLInputElement>(null)
  const blurTimerRef = React.useRef<number | null>(null)
  const [query, setQuery] = React.useState('')
  const [open, setOpen] = React.useState(false)
  const [options, setOptions] = React.useState<StaffTeamOption[]>([])
  const [loading, setLoading] = React.useState(false)
  const [fallbackMode, setFallbackMode] = React.useState(false)
  const [highlightedIndex, setHighlightedIndex] = React.useState(-1)

  React.useEffect(() => () => {
    if (blurTimerRef.current !== null) window.clearTimeout(blurTimerRef.current)
  }, [])

  React.useEffect(() => {
    if (!normalizedValue || fallbackMode) return
    let cancelled = false
    lookupTeamLabel(normalizedValue)
      .then((result) => {
        if (!cancelled && result.status !== 'ok') setFallbackMode(true)
      })
      .catch(() => {
        if (!cancelled) setFallbackMode(true)
      })
    return () => {
      cancelled = true
    }
  }, [fallbackMode, normalizedValue])

  React.useEffect(() => {
    if (!open || disabled || fallbackMode) return

    let cancelled = false
    setLoading(true)
    const timer = window.setTimeout(() => {
      searchStaffTeams(query)
        .then((result) => {
          if (cancelled) return
          if (result.status !== 'ok') {
            setFallbackMode(true)
            return
          }
          setOptions(result.options)
          setHighlightedIndex(result.options.length > 0 ? 0 : -1)
        })
        .catch(() => {
          if (!cancelled) setFallbackMode(true)
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 300)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [disabled, fallbackMode, open, query])

  const selectOption = React.useCallback((option: StaffTeamOption) => {
    onChange(option.id)
    setQuery('')
    setOpen(false)
    setHighlightedIndex(-1)
  }, [onChange])

  const handleClear = React.useCallback(() => {
    if (!nullable || disabled) return
    onChange(null)
    setQuery('')
    setOpen(false)
    setHighlightedIndex(-1)
    inputRef.current?.focus()
  }, [disabled, nullable, onChange])

  const handleKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled || fallbackMode) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      setHighlightedIndex((current) => {
        if (options.length === 0) return -1
        return current < options.length - 1 ? current + 1 : 0
      })
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setOpen(true)
      setHighlightedIndex((current) => {
        if (options.length === 0) return -1
        return current > 0 ? current - 1 : options.length - 1
      })
      return
    }
    if (event.key === 'Enter') {
      if (!open) return
      event.preventDefault()
      const option = highlightedIndex >= 0 ? options[highlightedIndex] : null
      if (option) selectOption(option)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
      setQuery('')
      setHighlightedIndex(-1)
    }
  }, [disabled, fallbackMode, highlightedIndex, open, options, selectOption])

  if (fallbackMode) {
    return (
      <Input
        id={id}
        ref={inputRef}
        value={normalizedValue ?? ''}
        onChange={(event) => {
          const next = event.currentTarget.value
          onChange(next.trim().length > 0 ? next : nullable ? null : '')
        }}
        placeholder={placeholder ?? fallbackPlaceholder}
        disabled={disabled}
      />
    )
  }

  const displayValue = open ? query : selectedLabel
  const showClear = nullable && !disabled && Boolean(normalizedValue)
  const showDropdown = open && !disabled

  return (
    <div className="relative w-full">
      <Input
        id={id}
        ref={inputRef}
        value={displayValue}
        onFocus={() => {
          if (blurTimerRef.current !== null) {
            window.clearTimeout(blurTimerRef.current)
            blurTimerRef.current = null
          }
          setQuery('')
          setOpen(true)
          setHighlightedIndex(-1)
        }}
        onBlur={() => {
          blurTimerRef.current = window.setTimeout(() => {
            setOpen(false)
            setQuery('')
            setHighlightedIndex(-1)
          }, 150)
        }}
        onChange={(event) => {
          setQuery(event.currentTarget.value)
          setOpen(true)
          setHighlightedIndex(-1)
        }}
        onKeyDown={handleKeyDown}
        placeholder={resolvedPlaceholder}
        disabled={disabled}
        role="combobox"
        aria-expanded={showDropdown}
        aria-controls={showDropdown ? listboxId : undefined}
        aria-autocomplete="list"
        leftIcon={<Search aria-hidden="true" />}
        inputClassName={showClear ? 'pr-8' : undefined}
      />
      {showClear ? (
        <IconButton
          type="button"
          variant="ghost"
          size="xs"
          aria-label={clearLabel}
          className="absolute right-1 top-1/2 -translate-y-1/2"
          onMouseDown={(event) => event.preventDefault()}
          onClick={handleClear}
        >
          <X className="size-3" aria-hidden="true" />
        </IconButton>
      ) : null}

      {showDropdown ? (
        <div
          id={listboxId}
          role="listbox"
          className="absolute z-popover mt-1 max-h-60 w-full overflow-auto rounded-md border border-input bg-popover p-2 shadow-lg"
        >
          {loading ? (
            <div className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground">
              <Spinner size="sm" />
              <span>{loadingLabel}</span>
            </div>
          ) : options.length === 0 ? (
            <p className="px-2 py-2 text-xs text-muted-foreground">{noResultsLabel}</p>
          ) : (
            <div className="flex flex-col gap-1">
              {options.map((option, index) => (
                <Button
                  key={option.id}
                  type="button"
                  variant="ghost"
                  size="sm"
                  role="option"
                  aria-selected={index === highlightedIndex}
                  className={cn(
                    'h-auto w-full flex-col items-start justify-start rounded-md p-2 text-left font-normal',
                    index === highlightedIndex ? 'bg-muted' : '',
                  )}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  onClick={() => selectOption(option)}
                >
                  <span className="truncate text-sm font-medium text-foreground" title={option.label}>{option.label}</span>
                </Button>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
