'use client'

import * as React from 'react'
import { ComboboxInput } from './ComboboxInput'
import { TagsInput } from './TagsInput'
import type { LookupOption, LookupSource } from './lookupSources'

function useLookupLabels(source: LookupSource, ids: readonly string[]) {
  const [options, setOptions] = React.useState<Record<string, LookupOption>>({})
  const requested = React.useRef(new Set<string>())

  const register = React.useCallback((next: readonly LookupOption[]) => {
    if (next.length === 0) return
    setOptions((previous) => {
      const merged = { ...previous }
      for (const option of next) merged[option.value] = option
      return merged
    })
  }, [])

  const idsKey = ids.join(',')
  React.useEffect(() => {
    const missing = idsKey
      .split(',')
      .filter((id) => id.length > 0 && !requested.current.has(id))
    if (missing.length === 0) return
    for (const id of missing) requested.current.add(id)
    let cancelled = false
    void source.resolve(missing).then((resolved) => {
      if (!cancelled) register(resolved)
    })
    return () => {
      cancelled = true
    }
  }, [idsKey, register, source])

  const search = React.useCallback(
    async (query?: string) => {
      const found = await source.search(query)
      register(found)
      return found
    },
    [register, source],
  )

  return { options, search }
}

type LookupMultiPickerProps = {
  source: LookupSource
  value: string[]
  onChange: (next: string[]) => void
  placeholder?: string
  disabled?: boolean
}

export function LookupMultiPicker({ source, value, onChange, placeholder, disabled }: LookupMultiPickerProps) {
  const { options, search } = useLookupLabels(source, value)
  const suggestions = React.useMemo(() => Object.values(options), [options])
  return (
    <TagsInput
      value={value}
      onChange={onChange}
      suggestions={suggestions}
      loadSuggestions={search}
      allowCustomValues={false}
      closeSuggestionsOnSelect
      resolveLabel={(id) => options[id]?.label ?? id}
      resolveDescription={(id) => options[id]?.description ?? null}
      placeholder={placeholder}
      disabled={disabled}
    />
  )
}

type LookupSinglePickerProps = {
  source: LookupSource
  value: string
  onChange: (next: string) => void
  placeholder?: string
  disabled?: boolean
  clearable?: boolean
}

export function LookupSinglePicker({
  source,
  value,
  onChange,
  placeholder,
  disabled,
  clearable,
}: LookupSinglePickerProps) {
  const resolveLabel = React.useCallback(
    async (id: string) => {
      const [option] = await source.resolve([id])
      return option?.label ?? id
    },
    [source],
  )
  return (
    <ComboboxInput
      value={value}
      onChange={onChange}
      allowCustomValues={false}
      clearable={clearable}
      placeholder={placeholder}
      disabled={disabled}
      loadSuggestions={source.search}
      resolveLabel={resolveLabel}
    />
  )
}

export function useLookupLabelMap(source: LookupSource, ids: readonly string[]): Record<string, string> {
  const { options } = useLookupLabels(source, ids)
  return React.useMemo(() => {
    const labels: Record<string, string> = {}
    for (const [id, option] of Object.entries(options)) labels[id] = option.label
    return labels
  }, [options])
}
