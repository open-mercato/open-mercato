'use client'

import * as React from 'react'
import { AlertTriangle, Lock } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { ComboboxInput, type ComboboxOption } from '@open-mercato/ui/backend/inputs/ComboboxInput'

type WorkflowSafeCommandListResponse = {
  items?: Array<{
    commandId?: string | null
    labelKey?: string | null
    enabled?: boolean | null
  }>
}

type CommandCandidate = {
  commandId: string
  labelKey: string | null
  enabled: boolean
}

export type CommandPickerProps = {
  id?: string
  value: string
  onChange: (next: string) => void
  disabled?: boolean
}

function toCandidates(items: WorkflowSafeCommandListResponse['items']): CommandCandidate[] {
  if (!Array.isArray(items)) return []
  const seen = new Set<string>()
  const candidates: CommandCandidate[] = []
  for (const item of items) {
    const commandId = typeof item?.commandId === 'string' ? item.commandId.trim() : ''
    if (!commandId || seen.has(commandId)) continue
    seen.add(commandId)
    candidates.push({
      commandId,
      labelKey: typeof item?.labelKey === 'string' && item.labelKey ? item.labelKey : null,
      // Absent means an older server that predates tenant enablement; treating
      // it as enabled keeps this picker working against one instead of
      // declaring every command unavailable.
      enabled: item?.enabled !== false,
    })
  }
  return candidates
}

/**
 * The UPDATE_ENTITY command field.
 *
 * The picker offers ONLY commands this tenant has enabled, because offering one
 * it has not is how an author ships a workflow that fails on its first run —
 * this module's recurring bug class. The disabled candidates are still shown,
 * below the field, with the reason and the remedy: the field accepts free text,
 * so silently dropping them would replace a runtime failure with an
 * unanswerable "why is `catalog.products.update` not in the list?".
 */
export function CommandPicker({ id, value, onChange, disabled }: CommandPickerProps) {
  const t = useT()
  const [lookupFailed, setLookupFailed] = React.useState(false)
  const [candidates, setCandidates] = React.useState<CommandCandidate[]>([])

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
      const loaded = toCandidates(call.result.items)
      setCandidates(loaded)
      return loaded
        .filter((candidate) => candidate.enabled)
        .map((candidate) => {
          const label = candidate.labelKey ? t(candidate.labelKey, candidate.commandId) : candidate.commandId
          return {
            value: candidate.commandId,
            label,
            // The id is the secondary line ONLY when the label is not already
            // the id — repeating it would render the same string twice.
            description: label === candidate.commandId ? null : candidate.commandId,
          }
        })
    } catch {
      setLookupFailed(true)
      return []
    }
  }, [t])

  const unavailable = React.useMemo(
    () => candidates.filter((candidate) => !candidate.enabled),
    [candidates],
  )

  const selected = React.useMemo(
    () => candidates.find((candidate) => candidate.commandId === value.trim()) ?? null,
    [candidates, value],
  )

  const selectedIsUnavailable = Boolean(value.trim()) && candidates.length > 0 && !selected?.enabled

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
      {selectedIsUnavailable ? (
        <p className="text-xs text-status-warning-text mt-1 flex items-start gap-1">
          <AlertTriangle className="size-3.5 shrink-0 mt-0.5" aria-hidden="true" />
          <span>
            <span className="sr-only">{t('workflows.commandPicker.warningLabel')} </span>
            {selected
              ? t('workflows.commandPicker.selectedDisabled')
              : t('workflows.commandPicker.selectedUnknown')}
          </span>
        </p>
      ) : null}
      {unavailable.length > 0 ? (
        <div className="mt-2 rounded-md border border-border bg-muted/40 p-2">
          <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
            <Lock className="size-3.5 shrink-0" aria-hidden="true" />
            {t('workflows.commandPicker.unavailableTitle')}
          </p>
          <ul className="mt-1 space-y-0.5">
            {unavailable.map((candidate) => (
              <li key={candidate.commandId} className="text-xs text-muted-foreground">
                <span className="font-mono">{candidate.commandId}</span>
                {candidate.labelKey ? (
                  <span> — {t(candidate.labelKey, candidate.commandId)}</span>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-muted-foreground">
            {t('workflows.commandPicker.unavailableHint')}
          </p>
        </div>
      ) : null}
    </div>
  )
}
