"use client"

import * as React from 'react'
import { MoreHorizontal, RefreshCw, RotateCcw, Settings2 } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Popover, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'
import type {
  DashboardGlobalDateRange,
  DashboardWidgetRenderContext,
} from '@open-mercato/shared/modules/dashboard/widgets'
import { DateRangePicker } from './DateRangePicker'
import { PresetSwitcher } from './PresetSwitcher'
import type { DashboardPreset } from './DashboardScreenV2'

type GreetingPeriod = 'morning' | 'afternoon' | 'evening'

export type DashboardHeaderProps = {
  context: DashboardWidgetRenderContext | null
  dateRange: DashboardGlobalDateRange
  canConfigure: boolean
  editing: boolean
  presets: DashboardPreset[]
  activePresetId: string | null
  maxPresets: number
  onSelectPreset: (id: string) => void
  onSavePreset: (name: string) => void
  onDeletePreset: (id: string) => void
  onDateRangeChange: (next: DashboardGlobalDateRange) => void
  onRefreshAll: () => void
  onResetLayout: () => void
  onToggleCustomize: () => void
}

export function getDashboardGreetingPeriod(date: Date = new Date()): GreetingPeriod {
  const hour = date.getHours()
  if (hour < 12) return 'morning'
  if (hour < 18) return 'afternoon'
  return 'evening'
}

function resolveUserDisplayName(context: DashboardWidgetRenderContext | null): string {
  return context?.userName ?? context?.userLabel ?? context?.userEmail ?? ''
}

export function DashboardHeader({
  context,
  dateRange,
  canConfigure,
  editing,
  presets,
  activePresetId,
  maxPresets,
  onSelectPreset,
  onSavePreset,
  onDeletePreset,
  onDateRangeChange,
  onRefreshAll,
  onResetLayout,
  onToggleCustomize,
}: DashboardHeaderProps) {
  const t = useT()
  const greetingPeriod = getDashboardGreetingPeriod()
  const name = resolveUserDisplayName(context)
  // The render context carries raw org/tenant UUIDs, not display names — showing them
  // would print an id to the user (the org switcher in the top bar owns that context).
  const subline = `${dateRange.from} - ${dateRange.to}`

  return (
    <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0 space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">
          {t(`dashboard.v2.greeting.${greetingPeriod}`, { name })}
        </h1>
        <p className="text-sm text-muted-foreground">{subline}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <PresetSwitcher
          presets={presets}
          activePresetId={activePresetId}
          canConfigure={canConfigure}
          maxPresets={maxPresets}
          onSelect={onSelectPreset}
          onSave={onSavePreset}
          onDelete={onDeletePreset}
        />
        <DateRangePicker value={dateRange} onChange={onDateRangeChange} />
        <Button type="button" variant="outline" onClick={onRefreshAll}>
          <RefreshCw className="size-4" />
          {t('dashboard.v2.refreshAll')}
        </Button>
        {canConfigure ? (
          <Button type="button" variant={editing ? 'secondary' : 'outline'} onClick={onToggleCustomize}>
            <Settings2 className="size-4" />
            {editing ? t('dashboard.v2.done') : t('dashboard.v2.customize')}
          </Button>
        ) : null}
        <OverflowMenu onResetLayout={onResetLayout} canConfigure={canConfigure} />
      </div>
    </header>
  )
}

function OverflowMenu({ onResetLayout, canConfigure }: { onResetLayout: () => void; canConfigure: boolean }) {
  const t = useT()
  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton type="button" variant="outline" size="lg" aria-label={t('dashboard.v2.moreOptions')}>
          <MoreHorizontal className="size-4" />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-1">
        <div className="space-y-1" role="menu">
          {canConfigure ? (
            <Button type="button" variant="ghost" size="sm" className="w-full justify-start" role="menuitem" onClick={onResetLayout}>
              <RotateCcw className="size-4" />
              {t('dashboard.v2.resetLayout')}
            </Button>
          ) : null}
          <Button asChild variant="ghost" size="sm" className="w-full justify-start" role="menuitem">
            <a href="/backend/dashboard/legacy">{t('dashboard.v2.legacyLink')}</a>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
