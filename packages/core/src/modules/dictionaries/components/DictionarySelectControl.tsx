"use client"

import * as React from 'react'
import Link from 'next/link'
import { Plus, Settings } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@open-mercato/ui/primitives/dialog'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { useT } from '@/lib/i18n/context'
import { AppearanceSelector, useAppearanceState } from './AppearanceSelector'
import { DictionaryValue, DictionaryMap } from './dictionaryAppearance'

export type DictionaryOption = {
  id: string
  value: string
  label: string
  color: string | null
  icon: string | null
}

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
  const [options, setOptions] = React.useState<DictionaryOption[]>([])
  const [loading, setLoading] = React.useState(true)
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [formValue, setFormValue] = React.useState('')
  const [formLabel, setFormLabel] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const appearance = useAppearanceState(null, null)
  const dictionaryMap = React.useMemo<DictionaryMap>(() => {
    const map: DictionaryMap = {}
    for (const option of options) {
      map[option.value] = {
        value: option.value,
        label: option.label,
        color: option.color,
        icon: option.icon,
      }
    }
    return map
  }, [options])
  const activeOption = React.useMemo(() => options.find((option) => option.value === value) ?? null, [options, value])
  const placeholderLabel = t('dictionaries.customFields.selector.placeholder', 'Select an entry')
  const manageLabel = t('dictionaries.customFields.manageLink', 'Manage dictionaries')
  const addLabel = t('dictionaries.customFields.selector.add', 'Add entry')
  const loadingLabel = t('dictionaries.config.entries.loading', 'Loading entries…')

  const loadOptions = React.useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch(`/api/dictionaries/${dictionaryId}/entries`)
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(typeof payload?.error === 'string' ? payload.error : 'Failed to load dictionary entries')
      }
      const items = Array.isArray(payload.items) ? payload.items : []
      setOptions(
        items.map((item: any) => ({
          id: String(item.id),
          value: String(item.value),
          label: typeof item.label === 'string' && item.label.length ? item.label : String(item.value),
          color: typeof item.color === 'string' ? item.color : null,
          icon: typeof item.icon === 'string' ? item.icon : null,
        })),
      )
    } catch (err) {
      console.error('Failed to load dictionary entries', err)
      flash(t('dictionaries.config.entries.error.load', 'Failed to load dictionary entries.'), 'error')
    } finally {
      setLoading(false)
    }
  }, [dictionaryId, t])

  React.useEffect(() => {
    loadOptions().catch(() => {})
  }, [loadOptions])

  const resetDialogState = React.useCallback(() => {
    setFormValue('')
    setFormLabel('')
    appearance.setColor(null)
    appearance.setIcon(null)
    setSaving(false)
  }, [appearance])

  React.useEffect(() => {
    if (!dialogOpen) {
      resetDialogState()
    }
  }, [dialogOpen, resetDialogState])

  const handleSave = React.useCallback(async () => {
    if (!formValue.trim()) {
      flash(t('dictionaries.config.entries.error.required', 'Value is required.'), 'error')
      return
    }
    setSaving(true)
    try {
      const payload = {
        value: formValue.trim(),
        label: formLabel.trim() || formValue.trim(),
        color: appearance.color,
        icon: appearance.icon,
      }
      const res = await apiFetch(`/api/dictionaries/${dictionaryId}/entries`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) {
          throw new Error(typeof json?.error === 'string' ? json.error : 'Failed to create dictionary entry')
        }
        const entry: DictionaryOption = {
          id: String(json.id),
          value: String(json.value),
          label: typeof json.label === 'string' && json.label.length ? json.label : String(json.value),
          color: typeof json.color === 'string' ? json.color : null,
          icon: typeof json.icon === 'string' ? json.icon : null,
        }
        onChange(entry.value)
        await loadOptions()
        setDialogOpen(false)
        flash(t('dictionaries.config.entries.success.create', 'Dictionary entry created.'), 'success')
      } catch (err) {
        console.error('Failed to create dictionary entry', err)
        flash(t('dictionaries.config.entries.error.save', 'Failed to save dictionary entry.'), 'error')
      } finally {
        setSaving(false)
      }
  }, [appearance, dictionaryId, formLabel, formValue, loadOptions, onChange, t])

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <select
          className={['h-9 w-full rounded border px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-70', selectClassName]
            .filter(Boolean)
            .join(' ')}
          value={value ?? ''}
          onChange={(event) => onChange(event.target.value || undefined)}
          disabled={disabled || loading}
        >
          <option value="">{placeholderLabel}</option>
          {options
            .slice()
            .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
            .map((option) => (
              <option key={option.id} value={option.value}>
                {option.label}
              </option>
            ))}
        </select>
        <div className="flex items-center gap-1">
          {allowInlineCreate ? (
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  disabled={disabled || loading}
                  title={addLabel}
                  aria-label={addLabel}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>{t('dictionaries.config.entries.dialog.addTitle', 'Add dictionary entry')}</DialogTitle>
                  <DialogDescription>
                    {t('dictionaries.customFields.selector.dialogDescription', 'Create a new entry and reuse it across records.')}
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">
                      {t('dictionaries.config.entries.dialog.valueLabel', 'Value')}
                    </label>
                    <input
                      type="text"
                      className="w-full rounded border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      value={formValue}
                      onChange={(event) => setFormValue(event.target.value)}
                      autoFocus
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">
                      {t('dictionaries.config.entries.dialog.labelLabel', 'Label')}
                    </label>
                    <input
                      type="text"
                      className="w-full rounded border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      value={formLabel}
                      onChange={(event) => setFormLabel(event.target.value)}
                      placeholder={t('dictionaries.config.entries.dialog.labelPlaceholder', 'Display name shown in UI')}
                    />
                  </div>
                  <AppearanceSelector
                    icon={appearance.icon}
                    color={appearance.color}
                    onIconChange={appearance.setIcon}
                    onColorChange={appearance.setColor}
                    labels={{
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
                    }}
                  />
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
                    {t('dictionaries.config.entries.dialog.cancel', 'Cancel')}
                  </Button>
                  <Button type="button" onClick={handleSave} disabled={saving}>
                    {saving ? <Spinner className="mr-2 h-4 w-4" /> : null}
                    {t('dictionaries.config.entries.dialog.save', 'Save')}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          ) : null}
          <Button
            asChild
            variant="ghost"
            size="icon"
            title={manageLabel}
            aria-label={manageLabel}
          >
            <Link href="/backend/config/dictionaries">
              <Settings className="h-4 w-4" />
              <span className="sr-only">{manageLabel}</span>
            </Link>
          </Button>
        </div>
      </div>
      {loading ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Spinner className="h-3.5 w-3.5" />
          {loadingLabel}
        </p>
      ) : null}
      {activeOption ? (
        <div className="text-xs text-muted-foreground">
          <DictionaryValue
            value={activeOption.value}
            map={dictionaryMap}
            className="inline-flex items-center gap-2 text-sm"
            iconWrapperClassName="inline-flex h-5 w-5 items-center justify-center rounded border border-border bg-background"
            iconClassName="h-3.5 w-3.5"
            colorClassName="h-2.5 w-2.5 rounded-full border border-border/60"
          />
        </div>
      ) : null}

    </div>
  )
}
