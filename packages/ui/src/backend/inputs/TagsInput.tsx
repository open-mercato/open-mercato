"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '../../primitives/button'
import { IconButton } from '../../primitives/icon-button'

export type TagsInputOption = {
  value: string
  label: string
  description?: string | null
}

export type TagsInputProps = {
  value: string[]
  onChange: (next: string[]) => void
  placeholder?: string
  suggestions?: Array<string | TagsInputOption>
  loadSuggestions?: (query?: string) => Promise<Array<string | TagsInputOption>>
  selectedOptions?: TagsInputOption[]
  resolveLabel?: (value: string) => string
  resolveDescription?: (value: string) => string | null | undefined
  autoFocus?: boolean
  disabled?: boolean
  allowCustomValues?: boolean
}

function normalizeOptions(input?: Array<string | TagsInputOption>): TagsInputOption[] {
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
    .filter((option): option is TagsInputOption => !!option)
}

export function TagsInput({
  value,
  onChange,
  placeholder,
  suggestions,
  loadSuggestions,
  selectedOptions,
  resolveLabel,
  resolveDescription,
  autoFocus,
  disabled = false,
  allowCustomValues = true,
}: TagsInputProps) {
  const t = useT()
  const [input, setInput] = React.useState('')
  const [asyncOptions, setAsyncOptions] = React.useState<TagsInputOption[]>([])
  const [loading, setLoading] = React.useState(false)
  const [touched, setTouched] = React.useState(false)

  const staticOptions = React.useMemo(() => normalizeOptions(suggestions), [suggestions])
  const selectedOptionList = React.useMemo(
    () => normalizeOptions(selectedOptions),
    [selectedOptions]
  )

  const optionMap = React.useMemo(() => {
    const map = new Map<string, TagsInputOption>()
    const register = (option: TagsInputOption) => {
      if (!map.has(option.value)) {
        map.set(option.value, option)
      }
    }
    staticOptions.forEach(register)
    asyncOptions.forEach(register)
    selectedOptionList.forEach(register)
    value.forEach((val) => {
      if (map.has(val)) return
      map.set(val, {
        value: val,
        label: resolveLabel?.(val) ?? val,
        description: resolveDescription?.(val) ?? null,
      })
    })
    return map
  }, [asyncOptions, resolveDescription, resolveLabel, selectedOptionList, staticOptions, value])

  const availableOptions = React.useMemo(() => {
    return Array.from(optionMap.values()).filter((option) => !value.includes(option.value))
  }, [optionMap, value])

  const filteredSuggestions = React.useMemo(() => {
    const query = input.toLowerCase().trim()
    if (!query) return availableOptions.slice(0, 8)
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

  const addValue = React.useCallback(
    (nextValue: string) => {
      if (disabled) return
      const trimmed = nextValue.trim()
      if (!trimmed) return
      if (value.includes(trimmed)) return
      onChange([...value, trimmed])
    },
    [disabled, onChange, value]
  )

  const findOptionForInput = React.useCallback(
    (raw: string): TagsInputOption | null => {
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

  const addTag = React.useCallback(
    (raw: string) => {
      if (disabled) return
      const option = findOptionForInput(raw)
      if (option) {
        addValue(option.value)
        return
      }
      if (!allowCustomValues) return
      addValue(raw)
    },
    [addValue, allowCustomValues, disabled, findOptionForInput]
  )

  const removeTag = React.useCallback(
    (tag: string) => {
      if (disabled) return
      onChange(value.filter((candidate) => candidate !== tag))
    },
    [disabled, onChange, value]
  )

  return (
    <div
      className={[
        'w-full rounded border px-2 py-1',
        disabled ? 'bg-muted text-muted-foreground/80 cursor-not-allowed' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      aria-disabled={disabled || undefined}
    >
      <div className="flex flex-wrap gap-1">
        {value.map((tag) => {
          const option = optionMap.get(tag)
          const label = option?.label ?? tag
          const description = option?.description
          return (
            <span key={tag} className="inline-flex items-center gap-2 rounded-sm bg-muted px-2 py-0.5 text-xs">
              <span className="flex flex-col items-start leading-tight">
                <span className="whitespace-nowrap">{label}</span>
                {description ? (
                  <span className="text-[10px] text-muted-foreground">{description}</span>
                ) : null}
              </span>
              <IconButton
                type="button"
                variant="ghost"
                size="xs"
                className="opacity-60 hover:opacity-100"
                onClick={() => removeTag(tag)}
                disabled={disabled}
              >
                ×
              </IconButton>
            </span>
          )
        })}
        <input
          className="flex-1 min-w-[80px] sm:min-w-[120px] border-0 py-1 text-sm outline-none disabled:bg-transparent"
          value={input}
          placeholder={placeholder || t('ui.inputs.tagsInput.placeholder', 'Add tag and press Enter')}
          autoFocus={autoFocus}
          data-crud-focus-target=""
          disabled={disabled}
          onFocus={() => setTouched(true)}
          onChange={(event) => {
            setTouched(true)
            setInput(event.target.value)
          }}
          onKeyDown={(event) => {
            if (disabled) return
            if (event.key === 'Enter' || event.key === ',') {
              event.preventDefault()
              addTag(input)
              setInput('')
            } else if (event.key === 'Backspace' && input === '' && value.length > 0) {
              removeTag(value[value.length - 1])
            }
          }}
          onBlur={() => {
            if (disabled) return
            addTag(input)
            setInput('')
          }}
        />
        {loading && touched ? (
          <div className="basis-full mt-1 text-xs text-muted-foreground">Loading suggestions…</div>
        ) : null}
        {!loading && filteredSuggestions.length ? (
          <div className="basis-full mt-1 flex flex-col gap-1">
            {filteredSuggestions.map((option) => (
              <Button
                key={option.value}
                type="button"
                variant="ghost"
                size="sm"
                className="w-full justify-start font-normal flex flex-col items-start text-xs px-1.5 py-1"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => addValue(option.value)}
              >
                <span>{option.label}</span>
                {option.description ? (
                  <span className="text-[10px] text-muted-foreground">{option.description}</span>
                ) : null}
              </Button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}
