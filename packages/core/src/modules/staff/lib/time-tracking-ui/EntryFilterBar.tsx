"use client"

import * as React from 'react'
import { X } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import type { FilterValues } from '@open-mercato/ui/backend/FilterOverlay'

/**
 * Presets and applied-filter chips for the time-entry list.
 *
 * `QuickFilters` and `ActiveFilterChips` in `packages/ui/src/backend/filters/`
 * do exactly this job, but both are typed against `AdvancedFilterTree`, and this
 * list is driven by flat `FilterValues` that map straight onto query parameters.
 * Adopting them wholesale would mean migrating the entries route to a serialised
 * filter tree — a much larger change than the one this is, and one that touches
 * the API contract rather than the page.
 *
 * So this is deliberately the small local version, shaped to slot into
 * `DataTable`'s own `activeFilterChips` prop, which takes any node precisely so a
 * page can bring its own. The empty state is the shared `FilteredEmptyResults`,
 * wired through `filterAwareEmptyState` — no local copy of that.
 */

export type EntryFilterPreset = {
  id: string
  label: string
  /** Returns the values this preset applies, merged over the current period. */
  build: (ctx: { staffMemberId: string | null; today: string }) => FilterValues
}

export type AppliedFilterChip = {
  id: string
  label: string
  value: string
}

export type EntryFilterBarProps = {
  presets: EntryFilterPreset[]
  activePresetId: string | null
  onApplyPreset: (preset: EntryFilterPreset) => void
  disabled?: boolean
}

export function EntryFilterPresets({
  presets,
  activePresetId,
  onApplyPreset,
  disabled,
}: EntryFilterBarProps) {
  if (presets.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="entry-filter-presets">
      {presets.map((preset) => {
        const active = preset.id === activePresetId
        return (
          <Button
            key={preset.id}
            type="button"
            size="sm"
            variant={active ? 'default' : 'outline'}
            disabled={disabled}
            className="h-7 rounded-full px-3 text-xs"
            aria-pressed={active}
            onClick={() => onApplyPreset(preset)}
            data-testid={`entry-filter-preset-${preset.id}`}
          >
            {preset.label}
          </Button>
        )
      })}
    </div>
  )
}

export type EntryFilterChipsProps = {
  chips: AppliedFilterChip[]
  onRemove: (id: string) => void
  onClearAll: () => void
  clearAllLabel: string
  removeLabel: (label: string) => string
}

export function EntryFilterChips({
  chips,
  onRemove,
  onClearAll,
  clearAllLabel,
  removeLabel,
}: EntryFilterChipsProps) {
  if (chips.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="entry-filter-chips">
      {chips.map((chip) => (
        <span
          key={chip.id}
          className="inline-flex h-6 items-center gap-1.5 rounded-sm border border-status-info-border bg-status-info-bg py-0 pl-2 pr-1 text-xs text-status-info-text"
        >
          <span className="text-status-info-text/80">{chip.label}</span>
          <b className="font-semibold">{chip.value}</b>
          <button
            type="button"
            aria-label={removeLabel(chip.label)}
            className="inline-flex size-4 items-center justify-center rounded-sm opacity-70 hover:opacity-100"
            onClick={() => onRemove(chip.id)}
            data-testid={`entry-filter-chip-remove-${chip.id}`}
          >
            <X className="size-3" aria-hidden="true" />
          </button>
        </span>
      ))}
      <button
        type="button"
        className="text-xs text-muted-foreground underline underline-offset-2"
        onClick={onClearAll}
        data-testid="entry-filter-chips-clear"
      >
        {clearAllLabel}
      </button>
    </div>
  )
}

/**
 * Which preset, if any, the current values correspond to.
 *
 * Compared on the keys the preset sets rather than on the whole object, so a
 * preset stays lit when the reader narrows further — "Mine, this week" plus a
 * project is still "Mine, this week", and un-lighting it there would suggest the
 * preset had been turned off.
 */
export function matchActivePreset(
  values: FilterValues,
  presets: EntryFilterPreset[],
  ctx: { staffMemberId: string | null; today: string },
): string | null {
  for (const preset of presets) {
    const built = preset.build(ctx)
    const keys = Object.keys(built)
    if (keys.length === 0) continue
    const matches = keys.every((key) => JSON.stringify(values[key]) === JSON.stringify(built[key]))
    if (matches) return preset.id
  }
  return null
}
