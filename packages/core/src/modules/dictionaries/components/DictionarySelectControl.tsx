"use client"

import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useQueryClient } from '@tanstack/react-query'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { DictionaryEntrySelect } from './DictionaryEntrySelect'
import {
  ensureDictionaryEntries,
  invalidateDictionaryEntries,
} from './hooks/useDictionaryEntries'

type DictionarySelectControlProps = {
  dictionaryId: string
  value?: string | null
  onChange: (value: string | undefined) => void
  allowInlineCreate?: boolean
  selectClassName?: string
  disabled?: boolean
  priorityValues?: string[]
}

export function DictionarySelectControl({
  dictionaryId,
  value,
  onChange,
  allowInlineCreate = true,
  selectClassName,
  disabled = false,
  priorityValues,
}: DictionarySelectControlProps) {
  const t = useT()
  const queryClient = useQueryClient()
  const scopeVersion = useOrganizationScopeVersion()
  const [inlineCreateEnabled, setInlineCreateEnabled] = React.useState<boolean>(allowInlineCreate)

  React.useEffect(() => {
    let cancelled = false
    async function evaluateInlineCreate() {
      if (!allowInlineCreate) {
        setInlineCreateEnabled(false)
        return
      }
      try {
        const call = await apiCall<{ isInherited?: boolean }>(`/api/dictionaries/${dictionaryId}`)
        if (cancelled) return
        if (call.ok && call.result && call.result.isInherited === true) {
          setInlineCreateEnabled(false)
          return
        }
        setInlineCreateEnabled(true)
      } catch (err) {
        console.warn('DictionarySelectControl.inlineCreate check failed', err)
        if (!cancelled) {
          setInlineCreateEnabled(allowInlineCreate)
        }
      }
    }
    evaluateInlineCreate().catch(() => {})
    return () => {
      cancelled = true
    }
  }, [allowInlineCreate, dictionaryId, scopeVersion])

  const effectiveAllowInlineCreate = allowInlineCreate && inlineCreateEnabled

  const normalizedPriority = React.useMemo(() => {
    if (!Array.isArray(priorityValues) || !priorityValues.length) return []
    const seen = new Set<string>()
    const ordered: string[] = []
    priorityValues.forEach((code) => {
      if (typeof code !== 'string') return
      const normalized = code.trim().toLowerCase()
      if (!normalized.length || seen.has(normalized)) return
      seen.add(normalized)
      ordered.push(normalized)
    })
    return ordered
  }, [priorityValues])

  const fetchOptions = React.useCallback(async () => {
    const data = await ensureDictionaryEntries(queryClient, dictionaryId, scopeVersion)
    const options = data.entries.map((entry) => ({
      value: entry.value,
      label: entry.label,
      color: entry.color ?? null,
      icon: entry.icon ?? null,
    }))
    if (!normalizedPriority.length) return options
    const byValue = new Map<string, (typeof options)[number]>()
    options.forEach((option) => {
      const key = option.value.trim().toLowerCase()
      if (!byValue.has(key)) byValue.set(key, option)
    })
    const prioritized: typeof options = []
    normalizedPriority.forEach((key) => {
      const match = byValue.get(key)
      if (match) {
        prioritized.push(match)
        byValue.delete(key)
      }
    })
    const remaining: typeof options = []
    byValue.forEach((option) => remaining.push(option))
    return [...prioritized, ...remaining]
  }, [dictionaryId, normalizedPriority, queryClient, scopeVersion])

  const createOption = React.useCallback(
    async (input: { value: string; label?: string; color?: string | null; icon?: string | null }) => {
      const call = await apiCall<Record<string, unknown>>(
        `/api/dictionaries/${dictionaryId}/entries`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            value: input.value,
            label: input.label ?? input.value,
            color: input.color,
            icon: input.icon,
          }),
        },
      )
      if (!call.ok) {
        throw new Error(
          typeof call.result?.error === 'string' ? call.result.error : 'Failed to create dictionary entry',
        )
      }
      await invalidateDictionaryEntries(queryClient, dictionaryId)
      return {
        value: String(call.result?.value ?? input.value),
        label:
          typeof call.result?.label === 'string' && call.result.label.length
            ? call.result.label
            : String(call.result?.value ?? input.value),
        color: typeof call.result?.color === 'string' ? call.result.color : null,
        icon: typeof call.result?.icon === 'string' ? call.result.icon : null,
      }
    },
    [dictionaryId, queryClient],
  )

  const labels = React.useMemo(
    () => ({
      placeholder: t('dictionaries.customFields.selector.placeholder', 'Select an entry'),
      addLabel: t('dictionaries.customFields.selector.add', 'Add entry'),
      addPrompt: t('dictionaries.customFields.selector.dialogDescription', 'Create a new entry and reuse it across records.'),
      dialogTitle: t('dictionaries.config.entries.dialog.addTitle', 'Add dictionary entry'),
      valueLabel: t('dictionaries.config.entries.dialog.valueLabel', 'Value'),
      valuePlaceholder: t('dictionaries.config.entries.dialog.valueLabel', 'Value'),
      labelLabel: t('dictionaries.config.entries.dialog.labelLabel', 'Label'),
      labelPlaceholder: t('dictionaries.config.entries.dialog.labelPlaceholder', 'Display name shown in UI'),
      emptyError: t('dictionaries.config.entries.error.required', 'Value is required.'),
      cancelLabel: t('dictionaries.config.entries.dialog.cancel', 'Cancel'),
      saveLabel: t('dictionaries.config.entries.dialog.save', 'Save'),
      saveShortcutHint: t('dictionaries.config.entries.dialog.saveShortcut', '⌘/Ctrl + Enter'),
      successCreateLabel: t('dictionaries.config.entries.success.create', 'Dictionary entry created.'),
      errorLoad: t('dictionaries.config.entries.error.load', 'Failed to load dictionary entries.'),
      errorSave: t('dictionaries.config.entries.error.save', 'Failed to save dictionary entry.'),
      loadingLabel: t('dictionaries.config.entries.loading', 'Loading entries…'),
      manageTitle: t('dictionaries.customFields.manageLink', 'Manage dictionaries'),
    }),
    [t],
  )

  const appearanceLabels = React.useMemo(
    () => ({
      colorLabel: t('dictionaries.config.entries.dialog.colorLabel', 'Color'),
      colorHelp: t('dictionaries.config.entries.dialog.colorHelp', 'Pick a highlight color for this entry.'),
      colorClearLabel: t('dictionaries.config.entries.dialog.colorClear', 'Remove color'),
      iconLabel: t('dictionaries.config.entries.dialog.iconLabel', 'Icon or emoji'),
      iconPlaceholder: t('dictionaries.config.entries.dialog.iconPlaceholder', 'Type an emoji or icon token.'),
      iconPickerTriggerLabel: t('dictionaries.config.entries.dialog.iconBrowse', 'Browse icons and emoji'),
      iconSearchPlaceholder: t('dictionaries.config.entries.dialog.iconSearchPlaceholder', 'Search icons or emojis…'),
      iconSearchEmptyLabel: t('dictionaries.config.entries.dialog.iconSearchEmpty', 'No icons match your search.'),
      iconSuggestionsLabel: t('dictionaries.config.entries.dialog.iconSuggestions', 'Suggestions'),
      iconClearLabel: t('dictionaries.config.entries.dialog.iconClear', 'Remove icon'),
      previewEmptyLabel: t('dictionaries.config.entries.dialog.previewEmpty', 'No appearance selected'),
    }),
    [t],
  )

  return (
    <DictionaryEntrySelect
      value={typeof value === 'string' ? value : undefined}
      onChange={onChange}
      fetchOptions={fetchOptions}
      createOption={effectiveAllowInlineCreate ? createOption : undefined}
      labels={labels}
      appearanceLabels={appearanceLabels}
      allowAppearance
      allowInlineCreate={effectiveAllowInlineCreate}
      selectClassName={selectClassName}
      disabled={disabled}
      manageHref="/backend/config/dictionaries"
    />
  )
}
