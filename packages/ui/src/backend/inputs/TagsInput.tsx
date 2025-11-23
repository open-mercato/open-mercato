"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export type TagsInputProps = {
  value: string[]
  onChange: (next: string[]) => void
  placeholder?: string
  suggestions?: string[]
  loadSuggestions?: (query?: string) => Promise<string[]>
  autoFocus?: boolean
}

export function TagsInput({
  value,
  onChange,
  placeholder,
  suggestions,
  loadSuggestions,
  autoFocus,
}: TagsInputProps) {
  const t = useT()
  const [input, setInput] = React.useState('')
  const [asyncSuggestions, setAsyncSuggestions] = React.useState<string[] | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [touched, setTouched] = React.useState(false)

  const addTag = React.useCallback(
    (raw: string) => {
      const next = raw.trim()
      if (!next) return
      if (!value.includes(next)) onChange([...value, next])
    },
    [onChange, value]
  )

  const removeTag = React.useCallback(
    (tag: string) => {
      onChange(value.filter((candidate) => candidate !== tag))
    },
    [onChange, value]
  )

  React.useEffect(() => {
    if (!loadSuggestions || !touched) return
    const query = input.trim()
    let cancelled = false
    const handle = window.setTimeout(async () => {
      setLoading(true)
      try {
        const items = await loadSuggestions(query)
        if (!cancelled) setAsyncSuggestions(items)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 200)
    return () => {
      cancelled = true
      window.clearTimeout(handle)
    }
  }, [input, loadSuggestions, touched])

  const mergedSuggestions = React.useMemo(() => {
    const base = asyncSuggestions ?? suggestions ?? []
    const unique = Array.from(new Set(base))
    const available = unique.filter((tag) => !value.includes(tag))
    const query = input.toLowerCase().trim()
    return query
      ? available.filter((tag) => tag.toLowerCase().includes(query))
      : available.slice(0, 8)
  }, [asyncSuggestions, suggestions, value, input])

  return (
    <div className="w-full rounded border px-2 py-1">
      <div className="flex flex-wrap gap-1">
        {value.map((tag) => (
          <span key={tag} className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs">
            {tag}
            <button
              type="button"
              className="opacity-60 transition-opacity hover:opacity-100"
              onClick={() => removeTag(tag)}
            >
              ×
            </button>
          </span>
        ))}
        <input
          className="flex-1 min-w-[120px] border-0 py-1 text-sm outline-none"
          value={input}
          placeholder={placeholder || t('ui.inputs.tagsInput.placeholder', 'Add tag and press Enter')}
          autoFocus={autoFocus}
          data-crud-focus-target=""
          onFocus={() => setTouched(true)}
          onChange={(event) => {
            setTouched(true)
            setInput(event.target.value)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ',') {
              event.preventDefault()
              addTag(input)
              setInput('')
            } else if (event.key === 'Backspace' && input === '' && value.length > 0) {
              removeTag(value[value.length - 1])
            }
          }}
          onBlur={() => {
            addTag(input)
            setInput('')
          }}
        />
        {loading && touched ? (
          <div className="basis-full mt-1 text-xs text-muted-foreground">Loading suggestions…</div>
        ) : null}
        {!loading && mergedSuggestions.length ? (
          <div className="basis-full mt-1 flex flex-wrap gap-1">
            {mergedSuggestions.map((tag) => (
              <button
                key={tag}
                type="button"
                className="rounded border px-1.5 py-0.5 text-xs transition hover:bg-muted"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => addTag(tag)}
              >
                {tag}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}
