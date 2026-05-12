// packages/ui/src/backend/filters/QuickFilters.tsx
'use client'
import * as React from 'react'
import { Clock, Filter, type LucideIcon } from 'lucide-react'
import { Button } from '../../primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { AdvancedFilterTree } from '@open-mercato/shared/lib/query/advanced-filter-tree'

export type FilterPreset = {
  id: string
  labelKey: string
  iconName?: string
  requiresUser?: boolean
  build: (ctx: { userId: string; now: Date }) => AdvancedFilterTree
}

const ICONS: Record<string, LucideIcon> = { clock: Clock, filter: Filter }

export type QuickFiltersProps = {
  presets: FilterPreset[]
  userId: string
  onApply: (tree: AdvancedFilterTree, preset: FilterPreset) => void
}

export function QuickFilters({ presets, userId, onApply }: QuickFiltersProps) {
  const t = useT()
  const availablePresets = React.useMemo(
    () => presets.filter((preset) => !preset.requiresUser || userId.trim().length > 0),
    [presets, userId],
  )
  if (!availablePresets.length) return null
  return (
    <div className="flex flex-col gap-2">
      <div className="text-overline font-medium uppercase tracking-widest text-muted-foreground">
        {t('ui.advancedFilter.quickFilters.heading', 'Quick filters')}
      </div>
      <div className="flex flex-wrap gap-2">
        {availablePresets.map((p) => {
          const Icon = p.iconName ? ICONS[p.iconName] ?? Filter : Filter
          return (
            <Button
              key={p.id}
              type="button"
              variant="outline"
              size="sm"
              className="rounded-full h-8 px-3 gap-1.5"
              onClick={() => onApply(p.build({ userId, now: new Date() }), p)}
            >
              <Icon className="size-3.5 text-muted-foreground" />
              {t(p.labelKey, p.labelKey)}
            </Button>
          )
        })}
      </div>
      {/* Footer hint mirrors the Figma SPEC-048 empty state — explains that
          presets apply immediately and remain editable. */}
      <p className="text-xs text-muted-foreground">
        {t('ui.advancedFilter.quickFilters.hint', 'Click a quick filter to apply it instantly. Editable after applying.')}
      </p>
    </div>
  )
}
