"use client"

import * as React from 'react'
import { Ellipsis } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { ICON_LIBRARY, type IconOption, renderDictionaryColor, renderDictionaryIcon } from './dictionaryAppearance'

export type AppearanceSelectorLabels = {
  colorLabel: string
  colorHelp?: string
  colorClearLabel: string
  iconLabel: string
  iconPlaceholder: string
  iconPickerTriggerLabel: string
  iconSearchPlaceholder: string
  iconSearchEmptyLabel: string
  iconSuggestionsLabel: string
  iconClearLabel: string
  previewEmptyLabel: string
}

type AppearanceSelectorProps = {
  icon: string | null | undefined
  color: string | null | undefined
  onIconChange: (next: string | null) => void
  onColorChange: (next: string | null) => void
  labels: AppearanceSelectorLabels
  disabled?: boolean
  iconSuggestions?: IconOption[]
  iconLibrary?: IconOption[]
  className?: string
}

const ICON_PICKER_LIMIT = 240

export function AppearanceSelector({
  icon,
  color,
  onIconChange,
  onColorChange,
  labels,
  disabled = false,
  iconSuggestions = [],
  iconLibrary,
  className,
}: AppearanceSelectorProps) {
  const normalizedIcon = icon ?? ''
  const normalizedColor = color ?? '#000000'
  const hasAppearance = Boolean(icon) || Boolean(color)
  const iconOptions = React.useMemo(() => (iconLibrary && iconLibrary.length ? iconLibrary : ICON_LIBRARY), [iconLibrary])
  const [pickerOpen, setPickerOpen] = React.useState(false)
  const [iconSearch, setIconSearch] = React.useState('')
  const pickerContainerRef = React.useRef<HTMLDivElement | null>(null)
  const searchInputRef = React.useRef<HTMLInputElement | null>(null)

  const closePicker = React.useCallback(() => {
    setPickerOpen(false)
    setIconSearch('')
  }, [])

  const handleIconSelection = React.useCallback(
    (next: string) => {
      onIconChange(next)
      closePicker()
    },
    [closePicker, onIconChange]
  )

  React.useEffect(() => {
    if (!pickerOpen) return
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (pickerContainerRef.current?.contains(target)) return
      closePicker()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closePicker()
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [closePicker, pickerOpen])

  React.useEffect(() => {
    if (!pickerOpen) return
    const frame = window.requestAnimationFrame(() => {
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [pickerOpen])

  React.useEffect(() => {
    if (!disabled) return
    closePicker()
  }, [closePicker, disabled])

  const filteredIcons = React.useMemo(() => {
    const term = iconSearch.trim().toLowerCase()
    if (!term) {
      return iconOptions.slice(0, ICON_PICKER_LIMIT)
    }
    const matches = iconOptions.filter((option) => {
      const haystack = [option.label, option.value, ...(option.keywords ?? [])].join(' ').toLowerCase()
      return haystack.includes(term)
    })
    return matches.slice(0, ICON_PICKER_LIMIT)
  }, [iconOptions, iconSearch])

  return (
    <div className={['space-y-4', className].filter(Boolean).join(' ')}>
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm font-medium">
          {labels.colorLabel}
          {labels.colorHelp ? <span className="text-xs font-normal text-muted-foreground">{labels.colorHelp}</span> : null}
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="color"
            value={normalizedColor}
            onChange={(event) => onColorChange(event.target.value)}
            disabled={disabled}
            className="h-10 w-12 cursor-pointer rounded border border-border bg-background"
            aria-label={labels.colorLabel}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onColorChange(null)}
            disabled={disabled || !color}
          >
            {labels.colorClearLabel}
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">{labels.iconLabel}</label>
        <div ref={pickerContainerRef} className="relative">
          <div className="flex gap-2">
            <input
              type="text"
              value={normalizedIcon}
              onChange={(event) => onIconChange(event.target.value)}
              placeholder={labels.iconPlaceholder}
              className="flex-1 rounded border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              disabled={disabled}
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => setPickerOpen((prev) => !prev)}
              aria-label={labels.iconPickerTriggerLabel}
              aria-expanded={pickerOpen}
              aria-haspopup="dialog"
              disabled={disabled}
            >
              <Ellipsis className="h-4 w-4" />
            </Button>
          </div>
          {pickerOpen ? (
            <div className="absolute left-0 right-0 top-full z-50 mt-2 rounded-md border border-border bg-popover p-3 shadow-lg">
              <div className="space-y-3">
                <input
                  ref={searchInputRef}
                  type="search"
                  value={iconSearch}
                  onChange={(event) => setIconSearch(event.target.value)}
                  placeholder={labels.iconSearchPlaceholder}
                  aria-label={labels.iconSearchPlaceholder}
                  className="w-full rounded border border-border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  autoComplete="off"
                />
                <div className="max-h-64 overflow-y-auto pr-1">
                  {filteredIcons.length ? (
                    <div className="grid grid-cols-6 gap-2 sm:grid-cols-8">
                      {filteredIcons.map((option) => {
                        const isSelected = normalizedIcon === option.value
                        return (
                          <button
                            key={option.value}
                            type="button"
                            className={`flex h-9 w-9 items-center justify-center rounded border text-sm transition ${
                              isSelected
                                ? 'border-primary bg-primary/10 text-primary'
                                : 'border-border hover:border-primary'
                            }`}
                            onClick={() => handleIconSelection(option.value)}
                            title={option.label}
                            aria-label={option.label}
                            aria-pressed={isSelected}
                          >
                            {renderDictionaryIcon(option.value, 'h-4 w-4')}
                          </button>
                        )
                      })}
                    </div>
                  ) : (
                    <p className="py-6 text-center text-sm text-muted-foreground">{labels.iconSearchEmptyLabel}</p>
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <div className="inline-flex items-center gap-2 rounded border border-dashed px-2 py-1">
            {renderDictionaryIcon(icon, 'h-4 w-4')}
            {renderDictionaryColor(color, 'h-4 w-4 rounded-sm')}
          </div>
          <span>{hasAppearance ? '' : labels.previewEmptyLabel}</span>
        </div>
        {iconSuggestions.length ? (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {labels.iconSuggestionsLabel}
            </p>
            <div className="flex flex-wrap gap-2">
              {iconSuggestions.map((suggestion) => {
                const isSelected = normalizedIcon === suggestion.value
                return (
                  <button
                    key={suggestion.value}
                    type="button"
                    className={`flex h-8 w-8 items-center justify-center rounded border text-sm transition ${
                      isSelected ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary'
                    }`}
                    onClick={() => handleIconSelection(suggestion.value)}
                    title={suggestion.label}
                    aria-label={suggestion.label}
                    aria-pressed={isSelected}
                    disabled={disabled}
                  >
                    {renderDictionaryIcon(suggestion.value, 'h-4 w-4')}
                  </button>
                )
              })}
            </div>
          </div>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            onIconChange(null)
            closePicker()
          }}
          disabled={disabled || !icon}
        >
          {labels.iconClearLabel}
        </Button>
      </div>
    </div>
  )
}
