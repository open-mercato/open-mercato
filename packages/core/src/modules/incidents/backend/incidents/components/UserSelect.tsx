"use client"

import * as React from 'react'
import { Search, X } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import {
  lookupUserLabel,
  searchAuthUsers,
  useUserLabels,
  type AuthUserOption,
} from './useUserLabels'

type UserSelectProps = {
  id?: string
  value: string | null | undefined
  onChange: (value: string | null) => void
  nullable?: boolean
  disabled?: boolean
  placeholder?: string
}

function normalizeValue(value: string | null | undefined): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed.length > 0 ? trimmed : null
}

export function UserSelect({
  id,
  value,
  onChange,
  nullable = false,
  disabled = false,
  placeholder,
}: UserSelectProps) {
  const t = useT()
  const normalizedValue = normalizeValue(value)
  const labels = useUserLabels(normalizedValue ? [normalizedValue] : [])
  const selectedLabel = normalizedValue ? labels[normalizedValue] ?? normalizedValue : ''
  const resolvedPlaceholder = placeholder ?? t('incidents.userSelect.searchPlaceholder', 'Search users')
  const loadingLabel = t('incidents.userSelect.loading', 'Searching users...')
  const noResultsLabel = t('incidents.userSelect.noResults', 'No matching users')
  const errorLabel = t('incidents.userSelect.error', 'Could not load users')
  const clearLabel = t('incidents.userSelect.clear', 'Clear user')
  const fallbackPlaceholder = t('incidents.userSelect.fallbackPlaceholder', 'User UUID')
  const listboxId = React.useId()
  const inputRef = React.useRef<HTMLInputElement>(null)
  const blurTimerRef = React.useRef<number | null>(null)
  const [query, setQuery] = React.useState('')
  const [open, setOpen] = React.useState(false)
  const [options, setOptions] = React.useState<AuthUserOption[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState(false)
  const [fallbackMode, setFallbackMode] = React.useState(false)
  const [highlightedIndex, setHighlightedIndex] = React.useState(-1)

  React.useEffect(() => () => {
    if (blurTimerRef.current !== null) window.clearTimeout(blurTimerRef.current)
  }, [])

  React.useEffect(() => {
    if (!normalizedValue || fallbackMode) return
    let cancelled = false
    lookupUserLabel(normalizedValue)
      .then((result) => {
        if (!cancelled && result.status === 'forbidden') setFallbackMode(true)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [fallbackMode, normalizedValue])

  React.useEffect(() => {
    if (!open || disabled || fallbackMode) return

    let cancelled = false
    setLoading(true)
    setError(false)
    const timer = window.setTimeout(() => {
      searchAuthUsers(query)
        .then((result) => {
          if (cancelled) return
          if (result.status === 'forbidden') {
            setFallbackMode(true)
            return
          }
          if (result.status === 'error') {
            setOptions([])
            setError(true)
            return
          }
          setOptions(result.options)
          setHighlightedIndex(result.options.length > 0 ? 0 : -1)
        })
        .catch(() => {
          if (!cancelled) {
            setOptions([])
            setError(true)
          }
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

  const selectOption = React.useCallback((option: AuthUserOption) => {
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
          ) : error ? (
            <p className="px-2 py-2 text-xs text-status-error-text" role="alert">
              {errorLabel}
            </p>
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
                  <span className="truncate text-sm font-medium text-foreground">{option.label}</span>
                </Button>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
