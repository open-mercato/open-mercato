'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { ComboboxInput, type ComboboxOption } from '@open-mercato/ui/backend/inputs/ComboboxInput'

type WorkflowFunctionListResponse = {
  items?: Array<{ name?: string | null; labelKey?: string | null }>
}

export type FunctionPickerProps = {
  id?: string
  value: string
  onChange: (next: string) => void
  disabled?: boolean
}

export function FunctionPicker({ id, value, onChange, disabled }: FunctionPickerProps) {
  const t = useT()
  const [lookupFailed, setLookupFailed] = React.useState(false)

  const loadFunctionSuggestions = React.useCallback(async (): Promise<ComboboxOption[]> => {
    try {
      const call = await apiCall<WorkflowFunctionListResponse>(
        '/api/workflows/functions',
        undefined,
        { fallback: { items: [] } },
      )
      if (!call.ok || !Array.isArray(call.result?.items)) {
        setLookupFailed(true)
        return []
      }
      setLookupFailed(false)
      const seen = new Set<string>()
      const options: ComboboxOption[] = []
      for (const item of call.result.items) {
        const name = typeof item?.name === 'string' ? item.name.trim() : ''
        if (name.length === 0 || seen.has(name)) continue
        seen.add(name)
        const labelKey = typeof item?.labelKey === 'string' ? item.labelKey.trim() : ''
        options.push({ value: name, label: labelKey.length > 0 ? t(labelKey) : name })
      }
      return options
    } catch {
      setLookupFailed(true)
      return []
    }
  }, [t])

  return (
    <div id={id}>
      <ComboboxInput
        value={value}
        onChange={onChange}
        placeholder={t('workflows.functionPicker.placeholder')}
        loadSuggestions={loadFunctionSuggestions}
        allowCustomValues
        disabled={disabled}
      />
      {lookupFailed ? (
        <p className="text-xs text-muted-foreground mt-1">
          {t('workflows.functionPicker.lookupUnavailable')}
        </p>
      ) : null}
    </div>
  )
}
