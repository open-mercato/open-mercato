"use client"

import * as React from 'react'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { useT } from '@/lib/i18n/context'
import { DictionaryEntrySelect } from './DictionaryEntrySelect'

type DictionarySelectControlProps = {
  dictionaryId: string
  value?: string | null
  onChange: (value: string | undefined) => void
  allowInlineCreate?: boolean
  selectClassName?: string
  disabled?: boolean
}

export function DictionarySelectControl({
  dictionaryId,
  value,
  onChange,
  allowInlineCreate = true,
  selectClassName,
  disabled = false,
}: DictionarySelectControlProps) {
  const t = useT()
  const [inlineCreateEnabled, setInlineCreateEnabled] = React.useState<boolean>(allowInlineCreate)

  React.useEffect(() => {
    let cancelled = false
    async function evaluateInlineCreate() {
      if (!allowInlineCreate) {
        setInlineCreateEnabled(false)
        return
      }
      try {
        const res = await apiFetch(`/api/dictionaries/${dictionaryId}`)
        const json = await res.json().catch(() => ({}))
        if (cancelled) return
        if (res.ok && json && json.isInherited === true) {
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
  }, [allowInlineCreate, dictionaryId])

  const effectiveAllowInlineCreate = allowInlineCreate && inlineCreateEnabled

  const fetchOptions = React.useCallback(async () => {
    const res = await apiFetch(`/api/dictionaries/${dictionaryId}/entries`)
    const payload = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(typeof payload?.error === 'string' ? payload.error : 'Failed to load dictionary entries')
    }
    const items = Array.isArray(payload.items) ? payload.items : []
    return items.map((item: any) => ({
      value: String(item.value),
      label: typeof item.label === 'string' && item.label.length ? item.label : String(item.value),
      color: typeof item.color === 'string' ? item.color : null,
      icon: typeof item.icon === 'string' ? item.icon : null,
    }))
  }, [dictionaryId])

  const createOption = React.useCallback(
    async (input: { value: string; label?: string; color?: string | null; icon?: string | null }) => {
      const res = await apiFetch(`/api/dictionaries/${dictionaryId}/entries`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          value: input.value,
          label: input.label ?? input.value,
          color: input.color,
          icon: input.icon,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(typeof json?.error === 'string' ? json.error : 'Failed to create dictionary entry')
      }
      return {
        value: String(json.value),
        label: typeof json.label === 'string' && json.label.length ? json.label : String(json.value),
        color: typeof json.color === 'string' ? json.color : null,
        icon: typeof json.icon === 'string' ? json.icon : null,
      }
    },
    [dictionaryId],
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
