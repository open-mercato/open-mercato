'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { ComboboxInput, type ComboboxOption } from '@open-mercato/ui/backend/inputs/ComboboxInput'

type WorkflowSafeCommandListResponse = {
  items?: Array<{ commandId?: string | null }>
}

export type CommandPickerProps = {
  id?: string
  value: string
  onChange: (next: string) => void
  disabled?: boolean
}

export function CommandPicker({ id, value, onChange, disabled }: CommandPickerProps) {
  const t = useT()
  const [lookupFailed, setLookupFailed] = React.useState(false)

  const loadCommandSuggestions = React.useCallback(async (): Promise<ComboboxOption[]> => {
    try {
      const call = await apiCall<WorkflowSafeCommandListResponse>(
        '/api/workflows/commands',
        undefined,
        { fallback: { items: [] } },
      )
      if (!call.ok || !Array.isArray(call.result?.items)) {
        setLookupFailed(true)
        return []
      }
      setLookupFailed(false)
      const commandIds = call.result.items
        .map((item) => (typeof item?.commandId === 'string' ? item.commandId.trim() : ''))
        .filter((commandId) => commandId.length > 0)
      return Array.from(new Set(commandIds)).map((commandId) => ({ value: commandId, label: commandId }))
    } catch {
      setLookupFailed(true)
      return []
    }
  }, [])

  return (
    <div id={id}>
      <ComboboxInput
        value={value}
        onChange={onChange}
        placeholder={t('workflows.commandPicker.placeholder')}
        loadSuggestions={loadCommandSuggestions}
        allowCustomValues
        disabled={disabled}
      />
      {lookupFailed ? (
        <p className="text-xs text-muted-foreground mt-1">
          {t('workflows.commandPicker.lookupUnavailable')}
        </p>
      ) : null}
    </div>
  )
}
