"use client"

import * as React from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { useT } from '@/lib/i18n/context'
import { AppearanceSelector, useAppearanceState } from './AppearanceSelector'

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
      setOptions((prev) => [...prev, entry])
      onChange(entry.value)
      setDialogOpen(false)
      setFormValue('')
      setFormLabel('')
      appearance.setColor(null)
      appearance.setIcon(null)
      flash(t('dictionaries.config.entries.success.create', 'Dictionary entry created.'), 'success')
    } catch (err) {
      console.error('Failed to create dictionary entry', err)
      flash(t('dictionaries.config.entries.error.save', 'Failed to save dictionary entry.'), 'error')
    } finally {
      setSaving(false)
    }
  }, [appearance, dictionaryId, formLabel, formValue, onChange, t])

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <select
          className={['flex-1 rounded border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary', selectClassName]
            .filter(Boolean)
            .join(' ')}
          value={value ?? ''}
          onChange={(event) => onChange(event.target.value || undefined)}
          disabled={disabled || loading}
        >
          <option value="">{t('dictionaries.config.entries.dialog.labelPlaceholder', 'Display name shown in UI')}</option>
          {options
            .slice()
            .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
            .map((option) => (
              <option key={option.id} value={option.value}>
                {option.label}
              </option>
            ))}
        </select>
        {allowInlineCreate ? (
          <Button type="button" variant="outline" onClick={() => setDialogOpen(true)} disabled={disabled}>
            <Plus className="mr-2 h-4 w-4" />
            {t('dictionaries.config.entries.actions.add', 'Add entry')}
          </Button>
        ) : null}
      </div>
      {loading ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Spinner className="h-3.5 w-3.5" />
          {t('dictionaries.config.entries.loading', 'Loading entries…')}
        </p>
      ) : null}

      <Dialog open={dialogOpen} onOpenChange={(open) => (!open ? setDialogOpen(false) : undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('dictionaries.config.entries.dialog.addTitle', 'Add dictionary entry')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('dictionaries.config.entries.dialog.valueLabel', 'Value')}</label>
              <input
                type="text"
                className="w-full rounded border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                value={formValue}
                onChange={(event) => setFormValue(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('dictionaries.config.entries.dialog.labelLabel', 'Label')}</label>
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
            <Button type="button" variant="ghost" onClick={() => setDialogOpen(false)} disabled={saving}>
              {t('dictionaries.config.entries.dialog.cancel', 'Cancel')}
            </Button>
            <Button type="button" onClick={handleSave} disabled={saving}>
              {saving ? <Spinner className="mr-2 h-4 w-4" /> : null}
              {t('dictionaries.config.entries.dialog.save', 'Save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
