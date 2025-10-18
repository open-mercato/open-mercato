"use client"

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { renderDictionaryColor, renderDictionaryIcon } from './dictionaryAppearance'

export type AppearanceSelectorLabels = {
  colorLabel: string
  colorHelp?: string
  colorClearLabel: string
  iconLabel: string
  iconPlaceholder: string
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
  iconSuggestions?: Array<{ value: string; label: string }>
  className?: string
}

export function AppearanceSelector({
  icon,
  color,
  onIconChange,
  onColorChange,
  labels,
  disabled = false,
  iconSuggestions = [],
  className,
}: AppearanceSelectorProps) {
  const normalizedIcon = icon ?? ''
  const normalizedColor = color ?? '#000000'
  const hasAppearance = Boolean(icon) || Boolean(color)

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
        <input
          type="text"
          value={normalizedIcon}
          onChange={(event) => onIconChange(event.target.value)}
          placeholder={labels.iconPlaceholder}
          className="w-full rounded border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          disabled={disabled}
        />
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
                    onClick={() => onIconChange(suggestion.value)}
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
          onClick={() => onIconChange(null)}
          disabled={disabled || !icon}
        >
          {labels.iconClearLabel}
        </Button>
      </div>
    </div>
  )
}
