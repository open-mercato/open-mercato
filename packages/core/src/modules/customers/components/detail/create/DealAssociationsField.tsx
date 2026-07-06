"use client"

import * as React from 'react'
import { Building2, X } from 'lucide-react'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { SearchInput } from '@open-mercato/ui/primitives/search-input'
import { useDealAssociationLookups } from '../DealForm'

type AssociationOption = {
  id: string
  label: string
  subtitle?: string | null
}

export type DealAssociationsFieldProps = {
  id?: string
  kind: 'people' | 'companies'
  value: string[]
  onChange: (next: string[]) => void
  disabled?: boolean
  labels: {
    placeholder: string
    empty: string
    loading: string
    noResults: string
    remove: string
    error: string
  }
}

function sanitizeIdList(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const set = new Set<string>()
  input.forEach((candidate) => {
    if (typeof candidate !== 'string') return
    const trimmed = candidate.trim()
    if (!trimmed.length) return
    set.add(trimmed)
  })
  return Array.from(set)
}

export function DealAssociationsField({
  id,
  kind,
  value,
  onChange,
  disabled = false,
  labels,
}: DealAssociationsFieldProps) {
  const lookups = useDealAssociationLookups()
  const search = kind === 'people' ? lookups.searchPeople : lookups.searchCompanies
  const fetchByIds = kind === 'people' ? lookups.fetchPeopleByIds : lookups.fetchCompaniesByIds

  const [input, setInput] = React.useState('')
  const [suggestions, setSuggestions] = React.useState<AssociationOption[]>([])
  const [cache, setCache] = React.useState<Map<string, AssociationOption>>(() => new Map())
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const normalizedValue = React.useMemo(() => sanitizeIdList(value), [value])

  React.useEffect(() => {
    if (!normalizedValue.length) return
    const missing = normalizedValue.filter((id) => !cache.has(id))
    if (!missing.length) return
    let cancelled = false
    ;(async () => {
      try {
        const entries = await fetchByIds(missing)
        if (cancelled) return
        setCache((prev) => {
          const next = new Map(prev)
          entries.forEach((entry) => {
            if (entry?.id) next.set(entry.id, entry)
          })
          return next
        })
      } catch {
        if (!cancelled) setError(labels.error)
      }
    })().catch(() => {
      // The inner try/catch already surfaces failures via setError; this guards the IIFE promise only.
    })
    return () => {
      cancelled = true
    }
  }, [cache, fetchByIds, labels.error, normalizedValue])

  React.useEffect(() => {
    const query = input.trim()
    // Only query once the operator starts typing. Searching on an empty string
    // returns the first page of *every* person/company in the tenant — useless as
    // a suggestion list and a performance trap at scale (thousands of records).
    if (disabled || query.length === 0) {
      setLoading(false)
      setSuggestions([])
      return
    }
    let cancelled = false
    const handler = window.setTimeout(async () => {
      setLoading(true)
      try {
        const results = await search(query)
        if (cancelled) return
        setSuggestions(results)
        setCache((prev) => {
          const next = new Map(prev)
          results.forEach((entry) => {
            if (entry?.id) next.set(entry.id, entry)
          })
          return next
        })
        setError(null)
      } catch {
        if (!cancelled) {
          setError(labels.error)
          setSuggestions([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 200)
    return () => {
      cancelled = true
      window.clearTimeout(handler)
    }
  }, [disabled, input, labels.error, search])

  const filteredSuggestions = React.useMemo(
    () => suggestions.filter((option) => !normalizedValue.includes(option.id)),
    [normalizedValue, suggestions],
  )

  const selectedOptions = React.useMemo(
    () => normalizedValue.map((id) => cache.get(id) ?? { id, label: id }),
    [cache, normalizedValue],
  )

  const addOption = React.useCallback(
    (option: AssociationOption) => {
      if (!option?.id) return
      if (normalizedValue.includes(option.id)) return
      onChange([...normalizedValue, option.id])
      setCache((prev) => {
        const next = new Map(prev)
        next.set(option.id, option)
        return next
      })
      setInput('')
      setSuggestions([])
    },
    [normalizedValue, onChange],
  )

  const removeOption = React.useCallback(
    (id: string) => {
      onChange(normalizedValue.filter((candidate) => candidate !== id))
    },
    [normalizedValue, onChange],
  )

  const renderLeading = React.useCallback(
    (option: AssociationOption) =>
      kind === 'people' ? (
        <Avatar label={option.label} size="xs" />
      ) : (
        <Building2 className="size-3.5 text-muted-foreground" aria-hidden="true" />
      ),
    [kind],
  )

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 rounded-md border border-input bg-background p-2">
        {selectedOptions.length ? (
          <div className="flex flex-wrap gap-2">
            {selectedOptions.map((option) => (
              <span
                key={option.id}
                className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs text-foreground"
              >
                {renderLeading(option)}
                <span className="truncate">{option.label}</span>
                <IconButton
                  type="button"
                  variant="ghost"
                  size="xs"
                  aria-label={`${labels.remove} ${option.label}`}
                  onClick={() => removeOption(option.id)}
                  disabled={disabled}
                >
                  <X className="size-3" />
                </IconButton>
              </span>
            ))}
          </div>
        ) : null}
        <SearchInput
          id={id}
          size="default"
          value={input}
          onChange={setInput}
          placeholder={labels.placeholder}
          disabled={disabled}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              const nextOption = filteredSuggestions[0]
              if (nextOption) addOption(nextOption)
            } else if (event.key === 'Backspace' && !input.length && normalizedValue.length) {
              removeOption(normalizedValue[normalizedValue.length - 1])
            }
          }}
        />
      </div>
      {loading ? <div className="text-xs text-muted-foreground">{labels.loading}</div> : null}
      {!loading && input.trim().length > 0 && filteredSuggestions.length ? (
        <div className="flex max-h-72 flex-col gap-1 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-md">
          {filteredSuggestions.slice(0, 8).map((option) => (
            <Button
              key={option.id}
              type="button"
              variant="ghost"
              size="sm"
              className="h-auto justify-start px-2 py-1 text-left font-normal"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => addOption(option)}
              disabled={disabled}
              aria-label={option.label}
            >
              {renderLeading(option)}
              <span className="flex min-w-0 flex-col items-start">
                <span className="truncate text-sm">{option.label}</span>
                {option.subtitle ? (
                  <span className="truncate text-xs text-muted-foreground">{option.subtitle}</span>
                ) : null}
              </span>
            </Button>
          ))}
        </div>
      ) : null}
      {!loading && input.trim().length > 0 && !filteredSuggestions.length ? (
        <div className="text-xs text-muted-foreground">{labels.noResults}</div>
      ) : null}
      {error ? <div className="text-xs text-status-error-text">{error}</div> : null}
    </div>
  )
}

export default DealAssociationsField
