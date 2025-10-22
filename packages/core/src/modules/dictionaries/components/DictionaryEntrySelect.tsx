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
import { DictionaryValue, renderDictionaryColor, renderDictionaryIcon } from './dictionaryAppearance'
import { AppearanceSelector, type AppearanceSelectorLabels, useAppearanceState } from './AppearanceSelector'

const DEFAULT_APPEARANCE_LABELS: AppearanceSelectorLabels = {
  colorLabel: 'Color',
  colorHelp: 'Pick a highlight color for this entry.',
  colorClearLabel: 'Remove color',
  iconLabel: 'Icon or emoji',
  iconPlaceholder: 'Type an emoji or icon token.',
  iconPickerTriggerLabel: 'Browse icons and emoji',
  iconSearchPlaceholder: 'Search icons or emojis…',
  iconSearchEmptyLabel: 'No icons match your search.',
  iconSuggestionsLabel: 'Suggestions',
  iconClearLabel: 'Remove icon',
  previewEmptyLabel: 'No appearance selected',
}

export type DictionaryOption = {
  value: string
  label: string
  color: string | null
  icon: string | null
}

export type DictionarySelectLabels = {
  placeholder: string
  addLabel: string
  addPrompt?: string
  dialogTitle: string
  valueLabel: string
  valuePlaceholder: string
  labelLabel: string
  labelPlaceholder: string
  emptyError: string
  cancelLabel: string
  saveLabel: string
  successCreateLabel?: string
  errorLoad: string
  errorSave: string
  loadingLabel: string
  manageTitle: string
}

export type DictionaryEntrySelectProps = {
  value?: string
  onChange: (value: string | undefined) => void
  fetchOptions: () => Promise<DictionaryOption[]>
  createOption?: (input: { value: string; label?: string; color?: string | null; icon?: string | null }) => Promise<DictionaryOption | null>
  labels: DictionarySelectLabels
  manageHref?: string
  selectClassName?: string
  allowInlineCreate?: boolean
  allowAppearance?: boolean
  appearanceLabels?: AppearanceSelectorLabels
  disabled?: boolean
  showLabelInput?: boolean
}

export function DictionaryEntrySelect({
  value,
  onChange,
  fetchOptions,
  createOption,
  labels,
  manageHref,
  selectClassName,
  allowInlineCreate = true,
  allowAppearance = false,
  appearanceLabels,
  disabled: disabledProp = false,
  showLabelInput = true,
}: DictionaryEntrySelectProps) {
  const [options, setOptions] = React.useState<DictionaryOption[]>([])
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [newValue, setNewValue] = React.useState('')
  const [newLabel, setNewLabel] = React.useState('')
  const [formError, setFormError] = React.useState<string | null>(null)
  const appearance = useAppearanceState(null, null)

  const loadOptions = React.useCallback(async () => {
    setLoading(true)
    try {
      const items = await fetchOptions()
      setOptions(items.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })))
    } catch (err) {
      console.error('DictionaryEntrySelect.fetchOptions failed', err)
      flash(labels.errorLoad, 'error')
      setOptions([])
    } finally {
      setLoading(false)
    }
  }, [fetchOptions, labels.errorLoad])

  React.useEffect(() => {
    loadOptions().catch(() => {})
  }, [loadOptions])

  const resetDialogState = React.useCallback(() => {
    setNewValue('')
    setNewLabel('')
    setFormError(null)
    appearance.setColor(null)
    appearance.setIcon(null)
    setSaving(false)
  }, [appearance])

  React.useEffect(() => {
    if (!dialogOpen) resetDialogState()
  }, [dialogOpen, resetDialogState])

  const activeOption = React.useMemo(
    () => options.find((option) => option.value === value) ?? null,
    [options, value],
  )

  const handleCreate = React.useCallback(async () => {
    if (!createOption) return
    const trimmedValue = newValue.trim()
    if (!trimmedValue.length) {
      setFormError(labels.emptyError)
      return
    }
    setSaving(true)
    try {
      const payload = await createOption({
        value: trimmedValue,
        label: showLabelInput ? newLabel.trim() || undefined : undefined,
        color: allowAppearance && appearance.color ? appearance.color : undefined,
        icon: allowAppearance && appearance.icon ? appearance.icon : undefined,
      })
      if (!payload) throw new Error('createOption did not return an entry')
      setOptions((previous) => {
        const map = new Map(previous.map((option) => [option.value, option]))
        map.set(payload.value, {
          value: payload.value,
          label: payload.label,
          color: payload.color ?? null,
          icon: payload.icon ?? null,
        })
        return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
      })
      await loadOptions()
      onChange(payload.value)
      setDialogOpen(false)
      if (labels.successCreateLabel) {
        flash(labels.successCreateLabel, 'success')
      }
    } catch (err) {
      console.error('DictionaryEntrySelect.createOption failed', err)
      flash(labels.errorSave, 'error')
    } finally {
      setSaving(false)
    }
  }, [
    allowAppearance,
    appearance.color,
    appearance.icon,
    createOption,
    labels.emptyError,
    labels.errorSave,
    labels.successCreateLabel,
    loadOptions,
    newLabel,
    newValue,
    onChange,
  ])

  const handleDialogKeyDown = React.useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (!saving) {
          setDialogOpen(false)
        }
        return
      }
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        if (!saving && newValue.trim().length) {
          handleCreate().catch(() => {})
        } else if (!saving && !newValue.trim().length) {
          setFormError(labels.emptyError)
        }
      }
    },
    [handleCreate, labels.emptyError, newValue, saving],
  )

  const shortcutHint = React.useMemo(() => {
    if (typeof navigator === 'undefined') return 'Cmd/Ctrl+Enter'
    return /Mac|iPhone|iPad|iPod/.test(navigator.platform) ? 'Cmd+Enter' : 'Ctrl+Enter'
  }, [])

  const disabled = disabledProp || loading || saving
  const manageLink = manageHref ?? '/backend/config/dictionaries'

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <select
          className={[
            'h-9 w-full rounded border px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-70',
            selectClassName,
          ]
            .filter(Boolean)
            .join(' ')}
          value={value ?? ''}
          onChange={(event) => onChange(event.target.value ? event.target.value : undefined)}
          disabled={disabled}
        >
          <option value="">{labels.placeholder}</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-1">
          {allowInlineCreate && createOption ? (
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  disabled={disabled}
                  title={labels.addLabel}
                  aria-label={labels.addLabel}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md" onKeyDown={handleDialogKeyDown}>
                <DialogHeader>
                  <DialogTitle>{labels.dialogTitle}</DialogTitle>
                  {labels.addPrompt ? <DialogDescription>{labels.addPrompt}</DialogDescription> : null}
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">{labels.valueLabel}</label>
                    <input
                      type="text"
                      className="w-full rounded border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      value={newValue}
                      onChange={(event) => {
                        setNewValue(event.target.value)
                        if (formError) setFormError(null)
                      }}
                      placeholder={labels.valuePlaceholder}
                      autoFocus
                      disabled={saving}
                    />
                  </div>
                  {showLabelInput ? (
                    <div className="space-y-2">
                      <label className="text-sm font-medium">{labels.labelLabel}</label>
                      <input
                        type="text"
                        className="w-full rounded border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        value={newLabel}
                        onChange={(event) => setNewLabel(event.target.value)}
                        placeholder={labels.labelPlaceholder}
                        disabled={saving}
                      />
                    </div>
                  ) : null}
                  {allowAppearance ? (
                    <AppearanceSelector
                      icon={appearance.icon}
                      color={appearance.color}
                      onIconChange={appearance.setIcon}
                      onColorChange={appearance.setColor}
                      labels={appearanceLabels ?? DEFAULT_APPEARANCE_LABELS}
                    />
                  ) : null}
                  {formError ? <p className="text-sm text-red-600">{formError}</p> : null}
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
                    {labels.cancelLabel}
                  </Button>
                  <Button type="button" onClick={handleCreate} disabled={saving || !newValue.trim()}>
                    {saving ? <Spinner className="mr-2 h-4 w-4" /> : null}
                    <span>{labels.saveLabel}</span>
                    {!saving ? (
                      <span className="ml-2 text-xs text-muted-foreground">{`(${shortcutHint})`}</span>
                    ) : null}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          ) : null}
          <Button asChild variant="ghost" size="icon" title={labels.manageTitle} aria-label={labels.manageTitle}>
            <Link href={manageLink}>
              <Settings className="h-4 w-4" />
              <span className="sr-only">{labels.manageTitle}</span>
            </Link>
          </Button>
        </div>
      </div>
      {activeOption ? (
        activeOption.icon || activeOption.color ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-2 rounded border border-dashed px-2 py-1">
              {renderDictionaryIcon(activeOption.icon, 'h-4 w-4')}
              {renderDictionaryColor(activeOption.color, 'h-4 w-4 rounded-sm')}
            </span>
            {activeOption.color ? <span>{activeOption.color}</span> : null}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">
            <DictionaryValue
              value={activeOption.value}
              map={Object.fromEntries(options.map((option) => [option.value, option]))}
              className="inline-flex items-center gap-2 text-sm"
              iconWrapperClassName="inline-flex h-5 w-5 items-center justify-center rounded border border-border bg-background"
              iconClassName="h-3.5 w-3.5"
              colorClassName="h-2.5 w-2.5 rounded-full border border-border/60"
            />
          </div>
        )
      ) : null}
      {loading ? <div className="text-xs text-muted-foreground">{labels.loadingLabel}</div> : null}
    </div>
  )
}
