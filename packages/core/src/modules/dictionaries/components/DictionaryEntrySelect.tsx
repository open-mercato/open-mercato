"use client"

import * as React from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { Plus, Settings, Save } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@open-mercato/ui/primitives/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { buildHrefWithReturnTo } from '@open-mercato/shared/lib/navigation/returnTo'
import { DictionaryValue, renderDictionaryColor, renderDictionaryIcon } from './dictionaryAppearance'
import { AppearanceSelector, type AppearanceSelectorLabels, useAppearanceState } from './AppearanceSelector'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('dictionaries').child({ component: 'DictionaryEntrySelect' })

export class DictionaryOptionsUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DictionaryOptionsUnavailableError'
  }
}

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
  saveShortcutHint?: string
  successCreateLabel?: string
  errorLoad: string
  errorSave: string
  loadingLabel: string
  manageTitle: string
}

export type DictionaryEntrySelectProps = {
  id?: string
  value?: string
  onChange: (value: string | undefined) => void
  fetchOptions: () => Promise<DictionaryOption[]>
  createOption?: (input: { value: string; label?: string; color?: string | null; icon?: string | null }) => Promise<DictionaryOption | null>
  labels: DictionarySelectLabels
  manageHref?: string
  selectClassName?: string
  seedOptions?: DictionaryOption[]
  allowInlineCreate?: boolean
  allowAppearance?: boolean
  appearanceLabels?: AppearanceSelectorLabels
  disabled?: boolean
  showLabelInput?: boolean
  showManage?: boolean
  sortOptions?: 'label_asc' | 'none'
  /**
   * When false, hides the read-only appearance preview (color swatch + icon + hex)
   * rendered below the trigger for the currently-selected entry. Defaults to true to
   * preserve existing behavior; set false where the host only wants a plain select
   * (e.g. a create form that shouldn't surface dictionary styling).
   */
  showActiveAppearance?: boolean
}

export function DictionaryEntrySelect({
  id,
  value,
  onChange,
  fetchOptions,
  createOption,
  labels,
  manageHref,
  selectClassName,
  seedOptions,
  allowInlineCreate = true,
  allowAppearance = false,
  appearanceLabels,
  disabled: disabledProp = false,
  showLabelInput = true,
  showManage = true,
  sortOptions = 'label_asc',
  showActiveAppearance = true,
}: DictionaryEntrySelectProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [options, setOptions] = React.useState<DictionaryOption[]>([])
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [newValue, setNewValue] = React.useState('')
  const [newLabel, setNewLabel] = React.useState('')
  const [formError, setFormError] = React.useState<string | null>(null)
  const [unavailableMessage, setUnavailableMessage] = React.useState<string | null>(null)
  const appearance = useAppearanceState(null, null)

  const loadOptions = React.useCallback(async () => {
    setLoading(true)
    setUnavailableMessage(null)
    try {
      const items = await fetchOptions()
      setOptions(sortOptions === 'none' ? items : items.slice().sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })))
    } catch (err) {
      if (err instanceof DictionaryOptionsUnavailableError) {
        setUnavailableMessage(err.message)
        setOptions([])
      } else {
        logger.error('Failed to fetch options', { err })
        flash(labels.errorLoad, 'error')
        setOptions([])
      }
    } finally {
      setLoading(false)
    }
  }, [fetchOptions, labels.errorLoad, sortOptions])

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

  const mergedOptions = React.useMemo(() => {
    if (!Array.isArray(seedOptions) || !seedOptions.length) return options
    const merged: DictionaryOption[] = []
    const seen = new Set<string>()
    for (const option of seedOptions) {
      if (!option.value || seen.has(option.value)) continue
      seen.add(option.value)
      merged.push(option)
    }
    for (const option of options) {
      if (seen.has(option.value)) continue
      seen.add(option.value)
      merged.push(option)
    }
    return merged
  }, [options, seedOptions])

  const activeOption = React.useMemo(
    () => mergedOptions.find((option) => option.value === value) ?? null,
    [mergedOptions, value],
  )
  const displayOptions = React.useMemo(() => {
    if (!value || activeOption) return mergedOptions
    return [
      {
        value,
        label: value,
        color: null,
        icon: null,
      },
      ...mergedOptions,
    ]
  }, [activeOption, mergedOptions, value])

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
        const nextOptions = Array.from(map.values())
        return sortOptions === 'none'
          ? nextOptions
          : nextOptions.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
      })
      await loadOptions()
      onChange(payload.value)
      setDialogOpen(false)
      if (labels.successCreateLabel) {
        flash(labels.successCreateLabel, 'success')
      }
    } catch (err) {
      logger.error('Failed to create option', { err })
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
    sortOptions,
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
    const provided = typeof labels.saveShortcutHint === 'string' ? labels.saveShortcutHint.trim() : ''
    if (provided.length) return provided
    return '⌘/Ctrl + Enter'
  }, [labels.saveShortcutHint])

  const disabled = disabledProp || loading || saving || unavailableMessage !== null
  const manageLink = manageHref ?? '/backend/config/dictionaries'
  const returnTo = React.useMemo(() => {
    const query = searchParams?.toString() ?? ''
    if (!pathname) return null
    return query.length ? `${pathname}?${query}` : pathname
  }, [pathname, searchParams])
  const manageLinkWithReturnTo = React.useMemo(
    () => buildHrefWithReturnTo(manageLink, returnTo),
    [manageLink, returnTo],
  )
  const optionsKey = React.useMemo(
    () => displayOptions.map((option) => `${option.value}:${option.label}`).join('\0'),
    [displayOptions],
  )

  return (
    <div className="space-y-2">
      {unavailableMessage ? (
        <p className="text-xs text-muted-foreground">{unavailableMessage}</p>
      ) : null}
      <div className="flex items-center gap-2">
        <Select
          key={`dictionary-entry:${value ?? ''}:${optionsKey}`}
          value={value ?? ''}
          onValueChange={(next) => {
            if (!next) return
            onChange(next)
          }}
          disabled={disabled}
        >
          <SelectTrigger
            id={id}
            className={selectClassName}
            title={activeOption?.label ?? undefined}
          >
            <SelectValue placeholder={labels.placeholder}>
              {activeOption?.label}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {displayOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
                    <Input
                      type="text"
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
                      <Input
                        type="text"
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
                    {saving ? <Spinner className="mr-2 h-4 w-4" /> : <Save className="mr-2 h-4 w-4" />}
                    <span className="flex items-center gap-2">
                      <span>{labels.saveLabel}</span>
                      {!saving ? (
                        <span className="text-xs text-muted-foreground">{`(${shortcutHint})`}</span>
                      ) : null}
                    </span>
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          ) : null}
          {showManage ? (
            <Button asChild variant="ghost" size="icon" title={labels.manageTitle} aria-label={labels.manageTitle}>
              <Link href={manageLinkWithReturnTo}>
                <Settings className="h-4 w-4" />
                <span className="sr-only">{labels.manageTitle}</span>
              </Link>
            </Button>
          ) : null}
        </div>
      </div>
      {showActiveAppearance && activeOption && (activeOption.icon || activeOption.color) ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-2 rounded border border-dashed px-2 py-1">
            {activeOption.icon ? renderDictionaryIcon(activeOption.icon, 'h-4 w-4') : null}
            {activeOption.color ? renderDictionaryColor(activeOption.color, 'h-4 w-4 rounded-sm') : null}
          </span>
          {activeOption.color ? <span>{activeOption.color}</span> : null}
        </div>
      ) : null}
      {loading ? <div className="text-xs text-muted-foreground">{labels.loadingLabel}</div> : null}
    </div>
  )
}
