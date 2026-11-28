"use client"

import * as React from 'react'
import { Check, ChevronDown, LayoutDashboard, Plus, Trash2 } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Popover, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'
import type { DashboardPreset } from './DashboardScreenV2'

type PresetSwitcherProps = {
  presets: DashboardPreset[]
  activePresetId: string | null
  canConfigure: boolean
  maxPresets: number
  onSelect: (id: string) => void
  onSave: (name: string) => void
  onDelete: (id: string) => void
}

export function PresetSwitcher({ presets, activePresetId, canConfigure, maxPresets, onSelect, onSave, onDelete }: PresetSwitcherProps) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState('')
  const activeName = presets.find((preset) => preset.id === activePresetId)?.name ?? t('dashboard.v2.presets.defaultView')
  const atLimit = presets.length >= maxPresets

  const save = React.useCallback(() => {
    const trimmed = name.trim()
    if (!trimmed || atLimit) return
    onSave(trimmed)
    setName('')
  }, [atLimit, name, onSave])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" aria-haspopup="menu">
          <LayoutDashboard className="size-4" />
          <span className="max-w-40 truncate">{activeName}</span>
          <ChevronDown className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2">
        <p className="px-2 pb-1 text-overline font-semibold uppercase tracking-widest text-muted-foreground">
          {t('dashboard.v2.presets.label')}
        </p>
        <div className="space-y-1" role="menu">
          {presets.length === 0 ? (
            <p className="px-2 py-1 text-sm text-muted-foreground">{t('dashboard.v2.presets.empty')}</p>
          ) : (
            presets.map((preset) => (
              <div key={preset.id} className="flex items-center gap-1">
                <Button
                  type="button"
                  variant={preset.id === activePresetId ? 'secondary' : 'ghost'}
                  size="sm"
                  role="menuitemradio"
                  aria-checked={preset.id === activePresetId}
                  className="min-w-0 flex-1 justify-start"
                  onClick={() => { onSelect(preset.id); setOpen(false) }}
                >
                  {preset.id === activePresetId ? <Check className="size-4 shrink-0" /> : <span className="size-4 shrink-0" aria-hidden="true" />}
                  <span className="truncate">{preset.name}</span>
                </Button>
                {canConfigure ? (
                  <IconButton type="button" variant="ghost" size="sm" aria-label={t('dashboard.v2.presets.delete')} onClick={() => onDelete(preset.id)}>
                    <Trash2 className="size-4" />
                  </IconButton>
                ) : null}
              </div>
            ))
          )}
        </div>
        {canConfigure ? (
          <div className="mt-2 border-t border-border pt-2">
            {atLimit ? (
              <p className="px-2 text-xs text-muted-foreground">{t('dashboard.v2.presets.limitReached')}</p>
            ) : (
              <div className="flex items-center gap-1">
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={t('dashboard.v2.presets.namePlaceholder')}
                  aria-label={t('dashboard.v2.presets.saveCurrent')}
                  onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); save() } }}
                />
                <IconButton type="button" variant="outline" aria-label={t('dashboard.v2.presets.saveCurrent')} disabled={!name.trim()} onClick={save}>
                  <Plus className="size-4" />
                </IconButton>
              </div>
            )}
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
