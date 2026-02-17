"use client"

import * as React from 'react'

export type ComboboxOption = {
  value: string
  label: string
  description?: string | null
}

export type ComboboxInputProps = {
  value: string
  onChange: (next: string) => void
  placeholder?: string
  suggestions?: Array<string | ComboboxOption>
  loadSuggestions?: (query?: string) => Promise<Array<string | ComboboxOption>>
  resolveLabel?: (value: string) => string
  resolveDescription?: (value: string) => string | null | undefined
  autoFocus?: boolean
  disabled?: boolean
  allowCustomValues?: boolean
}

function normalizeOptions(input?: Array<string | ComboboxOption>): ComboboxOption[] {
  if (!Array.isArray(input)) return []
  return input
    .map((option) => {
      if (typeof option === 'string') {
        const trimmed = option.trim()
        if (!trimmed) return null
        return { value: trimmed, label: trimmed }
      }
      const value = typeof option.value === 'string' ? option.value.trim() : ''
      if (!value) return null
      return {
        value,
        label: option.label?.trim() || value,
        description: option.description ?? null,
      }
    })
    .filter((option): option is ComboboxOption => !!option)
}

export function ComboboxInput({
  value,
  onChange,
  placeholder,
  suggestions,
  loadSuggestions,
  resolveLabel,
  resolveDescription,
  autoFocus,
  disabled = false,
  allowCustomValues = true,
}: ComboboxInputProps) {
  const [input, setInput] = React.useState('')
  const [asyncOptions, setAsyncOptions] = React.useState<ComboboxOption[]>([])
  const [loading, setLoading] = React.useState(false)
  const [touched, setTouched] = React.useState(false)
  const [showSuggestions, setShowSuggestions] = React.useState(false)
  const [selectedIndex, setSelectedIndex] = React.useState(-1)
  const inputRef = React.useRef<HTMLInputElement>(null)

  const staticOptions = React.useMemo(() => normalizeOptions(suggestions), [suggestions])

  const optionMap = React.useMemo(() => {
    const map = new Map<string, ComboboxOption>()
    const register = (option: ComboboxOption) => {
      if (!map.has(option.value)) {
        map.set(option.value, option)
      }
    }
    staticOptions.forEach(register)
    asyncOptions.forEach(register)
    if (value) {
      const existing = map.get(value)
      if (!existing) {
        map.set(value, {
          value,
          label: resolveLabel?.(value) ?? value,
          description: resolveDescription?.(value) ?? null,
        })
      }
    }
    return map
  }, [asyncOptions, resolveDescription, resolveLabel, staticOptions, value])

  const availableOptions = React.useMemo(() => {
    return Array.from(optionMap.values())
  }, [optionMap])

  const filteredSuggestions = React.useMemo(() => {
    const query = input.toLowerCase().trim()
    if (!query) return availableOptions.slice(0, 8)
    return availableOptions.filter((option) => {
      const labelMatch = option.label.toLowerCase().includes(query)
      const descMatch = option.description?.toLowerCase().includes(query)
      return labelMatch || Boolean(descMatch)
    }).slice(0, 8)
  }, [availableOptions, input])

  React.useEffect(() => {
    if (!loadSuggestions || !touched || disabled) return
    const query = input.trim()
    let cancelled = false
    const handle = window.setTimeout(async () => {
      setLoading(true)
      try {
        const items = await loadSuggestions(query)
        if (!cancelled) {
          setAsyncOptions(normalizeOptions(items))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 200)
    return () => {
      cancelled = true
      window.clearTimeout(handle)
    }
  }, [disabled, input, loadSuggestions, touched])

  // Sync input with value when value changes externally and input is not focused
  React.useEffect(() => {
    if (document.activeElement !== inputRef.current) {
      const option = optionMap.get(value)
      setInput(option?.label ?? value ?? '')
    }
  }, [value, optionMap])

  const selectValue = React.useCallback(
    (nextValue: string) => {
      if (disabled) return
      const trimmed = nextValue.trim()
      onChange(trimmed)
      const option = optionMap.get(trimmed)
      setInput(option?.label ?? trimmed)
      setShowSuggestions(false)
      setSelectedIndex(-1)
    },
    [disabled, onChange, optionMap]
  )

  const findOptionForInput = React.useCallback(
    (raw: string): ComboboxOption | null => {
      const query = raw.trim().toLowerCase()
      if (!query) return null
      for (const option of optionMap.values()) {
        if (option.value === raw.trim()) return option
        if (option.label.toLowerCase() === query) return option
      }
      return null
    },
    [optionMap]
  )

  const confirmSelection = React.useCallback(
    (raw: string) => {
      if (disabled) return
      const option = findOptionForInput(raw)
      if (option) {
        selectValue(option.value)
        return
      }
      if (!allowCustomValues) {
        // Revert to current value if custom values not allowed
        const currentOption = optionMap.get(value)
        setInput(currentOption?.label ?? value ?? '')
        setShowSuggestions(false)
        return
      }
      selectValue(raw)
    },
    [allowCustomValues, disabled, findOptionForInput, optionMap, selectValue, value]
  )

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (disabled) return

      if (event.key === 'ArrowDown') {
        event.preventDefault()
        if (!showSuggestions) {
          setShowSuggestions(true)
          setSelectedIndex(0)
        } else {
          setSelectedIndex((prev) => Math.min(prev + 1, filteredSuggestions.length - 1))
        }
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        setSelectedIndex((prev) => Math.max(prev - 1, -1))
      } else if (event.key === 'Enter') {
        event.preventDefault()
        if (selectedIndex >= 0 && filteredSuggestions[selectedIndex]) {
          selectValue(filteredSuggestions[selectedIndex].value)
        } else {
          confirmSelection(input)
        }
      } else if (event.key === 'Escape') {
        event.preventDefault()
        setShowSuggestions(false)
        setSelectedIndex(-1)
      }
    },
    [confirmSelection, disabled, filteredSuggestions, input, selectValue, selectedIndex, showSuggestions]
  )

  return (
    <div className="relative w-full">
      <input
        ref={inputRef}
        type="text"
        className="w-full h-9 rounded border px-2 text-sm disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed"
        value={input}
        placeholder={placeholder || 'Type to search...'}
        autoFocus={autoFocus}
        data-crud-focus-target=""
        disabled={disabled}
        onFocus={() => {
          setTouched(true)
          setShowSuggestions(true)
        }}
        onChange={(event) => {
          setTouched(true)
          setInput(event.target.value)
          setShowSuggestions(true)
          setSelectedIndex(-1)
        }}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          // Delay to allow click on suggestions
          setTimeout(() => {
            if (disabled) return
            confirmSelection(input)
          }, 200)
        }}
      />

      {showSuggestions && !disabled && (loading || filteredSuggestions.length > 0) && (
        <div className="absolute z-50 w-full mt-1 rounded border bg-popover shadow-lg max-h-48 sm:max-h-60 overflow-auto">
          {loading && touched ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">Loading suggestions…</div>
          ) : (
            filteredSuggestions.map((option, index) => (
              <button
                key={option.value}
                type="button"
                className={[
                  'w-full flex flex-col items-start px-3 py-2 text-sm transition text-left',
                  index === selectedIndex ? 'bg-accent' : 'hover:bg-muted',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectValue(option.value)}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                <span className="font-medium">{option.label}</span>
                {option.description ? (
                  <span className="text-xs text-muted-foreground">{option.description}</span>
                ) : null}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
