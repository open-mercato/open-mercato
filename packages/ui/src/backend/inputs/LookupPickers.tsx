'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { ComboboxInput } from './ComboboxInput'
import { TagsInput } from './TagsInput'
import {
  resolveLookupFailureReason,
  type LookupLoadFailureReason,
  type LookupOption,
  type LookupSource,
} from './lookupSources'

function LookupFailureMessage({ failure }: { failure: LookupLoadFailureReason | null }) {
  const t = useT()
  if (!failure) return null
  return (
    <p className="mt-1 text-xs text-status-error-text" role="alert" data-testid="lookup-picker-failure">
      {failure === 'forbidden'
        ? t('ui.inputs.lookupPicker.forbidden', 'You do not have permission to load these options.')
        : t('ui.inputs.lookupPicker.loadFailed', 'Could not load options. Try again.')}
    </p>
  )
}

function useLookupFailure() {
  const [failure, setFailure] = React.useState<LookupLoadFailureReason | null>(null)
  const guard = React.useCallback(async <TValue,>(run: () => Promise<TValue>, fallback: TValue): Promise<TValue> => {
    try {
      const value = await run()
      setFailure(null)
      return value
    } catch (error) {
      setFailure(resolveLookupFailureReason(error))
      return fallback
    }
  }, [])
  return { failure, setFailure, guard }
}

function useLookupLabels(source: LookupSource, ids: readonly string[]) {
  const [options, setOptions] = React.useState<Record<string, LookupOption>>({})
  const { failure, setFailure, guard } = useLookupFailure()
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
    let settled = false
    const release = () => {
      for (const id of missing) requested.current.delete(id)
    }
    void source.resolve(missing).then(
      (resolved) => {
        settled = true
        if (cancelled) return
        register(resolved)
        setFailure(null)
      },
      (error: unknown) => {
        settled = true
        if (cancelled) return
        release()
        setFailure(resolveLookupFailureReason(error))
      },
    )
    return () => {
      cancelled = true
      if (!settled) release()
    }
  }, [idsKey, register, setFailure, source])

  const search = React.useCallback(
    (query?: string) =>
      guard(async () => {
        const found = await source.search(query)
        register(found)
        return found
      }, []),
    [guard, register, source],
  )

  return { options, search, failure }
}

type LookupMultiPickerProps = {
  source: LookupSource
  value: string[]
  onChange: (next: string[]) => void
  placeholder?: string
  disabled?: boolean
}

export function LookupMultiPicker({ source, value, onChange, placeholder, disabled }: LookupMultiPickerProps) {
  const { options, search, failure } = useLookupLabels(source, value)
  const suggestions = React.useMemo(() => Object.values(options), [options])
  return (
    <div>
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
      <LookupFailureMessage failure={failure} />
    </div>
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
  const { failure, guard } = useLookupFailure()
  const resolveLabel = React.useCallback(
    (id: string) =>
      guard(async () => {
        const [option] = await source.resolve([id])
        return option?.label ?? id
      }, id),
    [guard, source],
  )
  const search = React.useCallback((query?: string) => guard(() => source.search(query), []), [guard, source])
  return (
    <div>
      <ComboboxInput
        value={value}
        onChange={onChange}
        allowCustomValues={false}
        clearable={clearable}
        placeholder={placeholder}
        disabled={disabled}
        loadSuggestions={search}
        resolveLabel={resolveLabel}
      />
      <LookupFailureMessage failure={failure} />
    </div>
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
