"use client"

import * as React from 'react'
import { X } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '../../primitives/button'
import { IconButton } from '../../primitives/icon-button'

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
  // Options to hydrate the option map up front (typically the linked entity's
  // display fields, already present in a record-detail payload). Merged with
  // `suggestions` so a pre-selected value renders its label without interaction.
  seedOptions?: ComboboxOption[]
  loadSuggestions?: (query?: string) => Promise<Array<string | ComboboxOption>>
  // Eagerly resolve a pre-selected `value` to a human label when it is not
  // covered by `suggestions`/`seedOptions`/`loadSuggestions` results. Runs once
  // per value, before any user interaction. May be sync or async.
  resolveLabel?: (value: string) => string | Promise<string>
  resolveDescription?: (value: string) => string | null | undefined
  autoFocus?: boolean
  disabled?: boolean
  allowCustomValues?: boolean
  clearable?: boolean
  clearLabel?: string
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

function areOptionsEqual(a: ComboboxOption[], b: ComboboxOption[]): boolean {
  if (a.length !== b.length) return false
  return a.every((option, index) => {
    const next = b[index]
    return option.value === next.value
      && option.label === next.label
      && (option.description ?? null) === (next.description ?? null)
  })
}

export function ComboboxInput({
  value,
  onChange,
  placeholder,
  suggestions,
  seedOptions,
  loadSuggestions,
  resolveLabel,
  resolveDescription,
  autoFocus,
  disabled = false,
  allowCustomValues = true,
  clearable = false,
  clearLabel,
}: ComboboxInputProps) {
  const t = useT()
  const resolvedPlaceholder = placeholder ?? t('ui.inputs.comboboxInput.placeholder', 'Type to search...')
  const loadingLabel = t('ui.inputs.comboboxInput.loading', 'Loading suggestions…')
  const resolvedClearLabel = clearLabel ?? t('ui.inputs.comboboxInput.clear', 'Clear value')
  const blurCloseDelayMs = 250
  const blurCloseMaxDelayMs = 1000
  const [input, setInput] = React.useState('')
  const [asyncOptions, setAsyncOptions] = React.useState<ComboboxOption[]>([])
  const [resolvedOptions, setResolvedOptions] = React.useState<ComboboxOption[]>([])
  const [loading, setLoading] = React.useState(false)
  const [touched, setTouched] = React.useState(false)
  const [showSuggestions, setShowSuggestions] = React.useState(false)
  const [selectedIndex, setSelectedIndex] = React.useState(-1)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const loadingRef = React.useRef(false)
  const blurCloseTimerRef = React.useRef<number | null>(null)
  const blurClosePendingRef = React.useRef(false)
  const suppressOpenOnFocusRef = React.useRef(Boolean(autoFocus && !disabled))
  const eagerFallbackLoadedValueRef = React.useRef<string | null>(null)

  const staticOptions = React.useMemo(
    () => normalizeOptions([...(seedOptions ?? []), ...(suggestions ?? [])]),
    [seedOptions, suggestions]
  )

  // Single pass over all option sources to build both coverage sets at once.
  // knownLabelValues: values with a genuine label (not a self-mapping placeholder) —
  //   used to decide whether eager resolution still needs to run.
  // coveredOptionValues: all values present in any source (even self-mapped).
  const { knownLabelValues, coveredOptionValues } = React.useMemo(() => {
    const known = new Set<string>()
    const covered = new Set<string>()
    for (const opt of [...staticOptions, ...asyncOptions, ...resolvedOptions]) {
      covered.add(opt.value)
      if (opt.label && opt.label !== opt.value) known.add(opt.value)
    }
    return { knownLabelValues: known, coveredOptionValues: covered }
  }, [staticOptions, asyncOptions, resolvedOptions])

  const optionMap = React.useMemo(() => {
    const map = new Map<string, ComboboxOption>()
    const register = (option: ComboboxOption) => {
      const existing = map.get(option.value)
      // Prefer an entry that carries a real label over a self-mapping placeholder.
      if (!existing || (existing.label === existing.value && option.label !== option.value)) {
        map.set(option.value, option)
      }
    }
    staticOptions.forEach(register)
    asyncOptions.forEach(register)
    resolvedOptions.forEach(register)
    if (value) {
      const existing = map.get(value)
      if (!existing) {
        map.set(value, {
          value,
          label: value,
          description: resolveDescription?.(value) ?? null,
        })
      }
    }
    return map
  }, [asyncOptions, resolvedOptions, resolveDescription, staticOptions, value])

  const availableOptions = React.useMemo(() => {
    return Array.from(optionMap.values())
  }, [optionMap])

  React.useEffect(() => {
    loadingRef.current = loading
  }, [loading])

  const clearBlurCloseTimer = React.useCallback(() => {
    if (blurCloseTimerRef.current === null) return
    window.clearTimeout(blurCloseTimerRef.current)
    blurCloseTimerRef.current = null
  }, [])

  const resetBlurCloseState = React.useCallback(() => {
    blurClosePendingRef.current = false
    clearBlurCloseTimer()
  }, [clearBlurCloseTimer])

  React.useEffect(() => resetBlurCloseState, [resetBlurCloseState])

  const filteredSuggestions = React.useMemo(() => {
    const query = input.toLowerCase().trim()
    if (!query) return availableOptions
    return availableOptions.filter((option) => {
      const labelMatch = option.label.toLowerCase().includes(query)
      const descMatch = option.description?.toLowerCase().includes(query)
      return labelMatch || Boolean(descMatch)
    })
  }, [availableOptions, input])

  React.useEffect(() => {
    if (!loadSuggestions || !touched || disabled) return
    const query = input.trim()
    let cancelled = false
    const handle = window.setTimeout(() => {
      setLoading(true)
      Promise.resolve()
        .then(() => loadSuggestions(query))
        .then((items) => {
          if (!cancelled) {
            const normalized = normalizeOptions(items)
            setAsyncOptions((prev) => areOptionsEqual(prev, normalized) ? prev : normalized)
          }
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 200)
    return () => {
      cancelled = true
      window.clearTimeout(handle)
    }
  }, [disabled, input, loadSuggestions, touched])

  // Eagerly resolve a pre-selected value to its label without requiring the user
  // to focus the field. Runs once per value when it is not already covered.
  const eagerResolveLabel = typeof resolveLabel === 'function' ? resolveLabel : undefined
  React.useEffect(() => {
    if (!value || disabled) return
    let cancelled = false
    const apply = (label?: string | null, description?: string | null) => {
      const clean = typeof label === 'string' ? label.trim() : ''
      if (cancelled || !clean || clean === value) return
      setResolvedOptions((prev) => {
        if (prev.some((option) => option.value === value && option.label === clean)) return prev
        return [...prev.filter((option) => option.value !== value), { value, label: clean, description: description ?? null }]
      })
    }
    if (eagerResolveLabel) {
      if (knownLabelValues.has(value)) return
      Promise.resolve()
        .then(() => eagerResolveLabel(value))
        .then((label) => apply(label, resolveDescription?.(value)))
        .catch(() => {})
      return () => { cancelled = true }
    }
    if (coveredOptionValues.has(value)) return
    if (eagerFallbackLoadedValueRef.current === value) return
    eagerFallbackLoadedValueRef.current = value
    // Fallback: pull the first page of async suggestions so a remount that lost
    // its option cache can still recover the label without user interaction.
    // Note: if the loader is paginated and the value falls outside the first page,
    // the fallback silently fails and the raw value remains visible.
    if (loadSuggestions) {
      setLoading(true)
      Promise.resolve()
        .then(() => loadSuggestions())
        .then((items) => {
          if (cancelled) return
          const normalized = normalizeOptions(items)
          setAsyncOptions((prev) => areOptionsEqual(prev, normalized) ? prev : normalized)
        })
        .catch(() => {})
        .finally(() => { if (!cancelled) setLoading(false) })
    }
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps — resolveDescription intentionally excluded:
  // including it would re-run the effect on every render when the prop is an inline function
  }, [value, disabled, knownLabelValues, coveredOptionValues, eagerResolveLabel, loadSuggestions])

  // Sync input with value when value changes externally and input is not focused.
  React.useEffect(() => {
    if (document.activeElement !== inputRef.current) {
      const option = optionMap.get(value)
      setInput(option?.label ?? value ?? '')
    }
  }, [value, optionMap])

  const selectValue = React.useCallback(
    (nextValue: string) => {
      if (disabled) return
      resetBlurCloseState()
      const trimmed = nextValue.trim()
      onChange(trimmed)
      const option = optionMap.get(trimmed)
      setInput(option?.label ?? trimmed)
      setShowSuggestions(false)
      setSelectedIndex(-1)
    },
    [disabled, onChange, optionMap, resetBlurCloseState]
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
      if (clearable && raw.trim() === '') {
        selectValue('')
        return
      }
      const option = findOptionForInput(raw)
      if (option) {
        selectValue(option.value)
        return
      }
      if (!allowCustomValues) {
        // Revert to the current value's label — but only if we actually know it.
        // Baking the raw value back in while eager resolution is still pending
        // would freeze a placeholder (e.g. a UUID) into the visible input.
        setShowSuggestions(false)
        const currentOption = optionMap.get(value)
        if (currentOption && currentOption.label !== currentOption.value) {
          setInput(currentOption.label)
        } else if (!value) {
          setInput('')
        }
        return
      }
      selectValue(raw)
    },
    [allowCustomValues, clearable, disabled, findOptionForInput, optionMap, selectValue, value]
  )

  const handleClear = React.useCallback(() => {
    if (disabled) return
    selectValue('')
    inputRef.current?.focus()
  }, [disabled, selectValue])

  const closeAfterBlur = React.useCallback(() => {
    blurCloseTimerRef.current = null
    if (disabled) return
    blurClosePendingRef.current = false
    confirmSelection(input)
    setShowSuggestions(false)
    setSelectedIndex(-1)
  }, [confirmSelection, disabled, input])

  const attemptBlurClose = React.useCallback(() => {
    blurCloseTimerRef.current = null
    if (disabled) return
    if (loadingRef.current) {
      blurCloseTimerRef.current = window.setTimeout(closeAfterBlur, blurCloseMaxDelayMs)
      return
    }
    closeAfterBlur()
  }, [blurCloseMaxDelayMs, closeAfterBlur, disabled])

  React.useEffect(() => {
    if (!blurClosePendingRef.current) return
    if (loading) return
    clearBlurCloseTimer()
    closeAfterBlur()
  }, [clearBlurCloseTimer, closeAfterBlur, loading])

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

  const showClearButton = clearable && !disabled && (value !== '' || input !== '')

  return (
    <div className="relative w-full">
      {/* Use raw <input> here instead of the DS Input primitive: ComboboxInput's
          focus / suggestions-popup interplay relies on the trigger being a plain
          input element. The DS wrapper introduces a <div> that desyncs autocomplete
          on this specific surface. Keeps the rest of the form on Input primitive. */}
      <input
        ref={inputRef}
        type="text"
        className={[
          'w-full h-9 rounded-md border border-input bg-background px-3 text-sm shadow-xs transition-colors outline-none placeholder:text-muted-foreground focus-visible:shadow-focus focus-visible:border-foreground disabled:bg-bg-disabled disabled:border-border-disabled disabled:text-muted-foreground disabled:cursor-not-allowed',
          showClearButton ? 'pr-9' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        value={input}
        placeholder={resolvedPlaceholder}
        autoFocus={autoFocus}
        data-crud-focus-target=""
        disabled={disabled}
        onFocus={() => {
          setTouched(true)
          if (suppressOpenOnFocusRef.current) {
            suppressOpenOnFocusRef.current = false
            return
          }
          resetBlurCloseState()
          if (loadSuggestions && availableOptions.length === 0) {
            setLoading(true)
          }
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
          // Delay closing so clicks on the popup can resolve first. If async
          // suggestions are still loading, keep the dropdown open instead of
          // closing before the first payload arrives.
          blurClosePendingRef.current = true
          clearBlurCloseTimer()
          if (loadingRef.current) {
            blurCloseTimerRef.current = window.setTimeout(closeAfterBlur, blurCloseMaxDelayMs)
            return
          }
          blurCloseTimerRef.current = window.setTimeout(attemptBlurClose, blurCloseDelayMs)
        }}
      />

      {showClearButton ? (
        <IconButton
          type="button"
          variant="ghost"
          size="xs"
          aria-label={resolvedClearLabel}
          className="absolute right-1 top-1/2 -translate-y-1/2"
          onMouseDown={(event) => event.preventDefault()}
          onClick={handleClear}
        >
          <X className="size-3" />
        </IconButton>
      ) : null}

      {showSuggestions && !disabled && (loading || filteredSuggestions.length > 0) && (
        <div className="absolute z-popover w-full mt-1 rounded-md border border-input bg-popover p-2 shadow-md max-h-48 sm:max-h-60 overflow-auto">
          {loading && touched ? (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">{loadingLabel}</div>
          ) : (
            <div className="flex flex-col gap-1">
              {filteredSuggestions.map((option, index) => (
                <Button
                  key={option.value}
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={[
                    'w-full h-auto justify-start font-normal text-left flex flex-col items-start rounded-lg p-2',
                    index === selectedIndex ? 'bg-muted' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    resetBlurCloseState()
                    selectValue(option.value)
                  }}
                  onMouseEnter={() => setSelectedIndex(index)}
                >
                  <span className="font-medium text-foreground">{option.label}</span>
                  {option.description ? (
                    <span className="text-xs text-muted-foreground">{option.description}</span>
                  ) : null}
                </Button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
