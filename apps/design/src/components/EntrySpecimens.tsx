'use client'

import * as React from 'react'
import { Bell, Check, ChevronDown, Copy, FileText, Pencil, Search, Settings, Trash2, UserRound, X } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { ChartLegendDot, type ChartLegendColor } from '@open-mercato/ui/primitives/chart-legend'
import { Kbd } from '@open-mercato/ui/primitives/kbd'

const SURFACE = 'rounded-lg border border-border bg-popover text-popover-foreground shadow-md'
const ROW = 'flex min-h-8 items-center gap-2 rounded-md px-2 py-1 text-sm'

function Lines({ count = 3 }: { count?: number }) {
  return (
    <span className="flex flex-col gap-2">
      {Array.from({ length: count }, (_, index) => (
        <span key={index} className={`h-2 rounded-full bg-muted ${index === count - 1 ? 'w-1/2' : 'w-full'}`} />
      ))}
    </span>
  )
}

function Screen({ children }: { children: React.ReactNode }) {
  return <div className="flex h-32 w-full max-w-xs overflow-hidden rounded-lg border border-border bg-foreground/10">{children}</div>
}

function DialogSpecimen() {
  const t = useT()
  return (
    <div className={`flex w-full max-w-xs flex-col gap-4 p-4 ${SURFACE}`}>
      <div className="flex flex-col gap-1">
        <span className="flex items-center justify-between gap-2 text-sm text-foreground">
          {t('design.thumb.dialogTitle')}
          <X className="size-4 text-muted-foreground" />
        </span>
        <span className="text-xs text-muted-foreground">{t('design.thumb.dialogBody')}</span>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="outline">{t('design.thumb.cancel')}</Button>
        <Button type="button" size="sm">{t('design.thumb.confirm')}</Button>
      </div>
    </div>
  )
}

function DrawerSpecimen() {
  const t = useT()
  return (
    <Screen>
      <span className="flex-1" />
      <div className="flex w-3/5 flex-col border-l border-border bg-card">
        <span className="flex items-center justify-between border-b border-border px-3 py-2 text-xs text-foreground">
          {t('design.thumb.drawerTitle')}
          <X className="size-3 text-muted-foreground" />
        </span>
        <span className="flex-1 p-3"><Lines /></span>
        <span className="flex justify-end gap-2 border-t border-border px-3 py-2">
          <span className="h-5 w-12 rounded-md border border-input" />
          <span className="h-5 w-12 rounded-md bg-primary" />
        </span>
      </div>
    </Screen>
  )
}

function SheetSpecimen() {
  const t = useT()
  return (
    <Screen>
      <div className="flex w-2/5 flex-col gap-3 border-r border-border bg-card p-3">
        <span className="text-xs text-foreground">{t('design.thumb.sheetTitle')}</span>
        <Lines count={4} />
      </div>
      <span className="flex-1" />
    </Screen>
  )
}

function PopoverSpecimen() {
  const t = useT()
  return (
    <div className="flex flex-col items-center gap-2">
      <Button type="button" size="sm" variant="outline">{t('design.thumb.popoverTrigger')}<ChevronDown /></Button>
      <div className={`flex w-56 flex-col gap-3 p-3 ${SURFACE}`}>
        <span className="text-xs text-foreground">{t('design.thumb.popoverTitle')}</span>
        <Lines count={2} />
      </div>
    </div>
  )
}

function TooltipSpecimen() {
  const t = useT()
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="relative rounded-sm bg-foreground px-3 py-2 text-sm leading-5 text-background shadow-md">
        {t('design.thumb.tooltip')}
        <span className="absolute -bottom-1 left-1/2 size-2 -translate-x-1/2 rotate-45 bg-foreground" />
      </span>
      <Button type="button" size="sm" variant="outline" className="mt-1"><Copy />{t('design.thumb.copy')}</Button>
    </div>
  )
}

function CommandMenuSpecimen() {
  const t = useT()
  const items = [
    { id: 'new', icon: FileText, label: t('design.thumb.commandNew'), keys: 'N' },
    { id: 'people', icon: UserRound, label: t('design.thumb.commandPeople'), keys: 'P' },
    { id: 'settings', icon: Settings, label: t('design.thumb.commandSettings'), keys: ',' },
  ]
  return (
    <div className={`flex w-full max-w-xs flex-col ${SURFACE}`}>
      <span className="flex items-center gap-2 border-b border-border px-3 py-2 text-sm text-muted-foreground">
        <Search className="size-4" />{t('design.thumb.commandSearch')}
      </span>
      <span className="flex flex-col p-1">
        {items.map(({ id, icon: Icon, label, keys }, index) => (
          <span key={id} className={`${ROW} ${index === 0 ? 'bg-muted text-foreground' : 'text-foreground'}`}>
            <Icon className="size-4 text-muted-foreground" />
            <span className="flex-1">{label}</span>
            <Kbd>{keys}</Kbd>
          </span>
        ))}
      </span>
    </div>
  )
}

function DropdownSpecimen() {
  const t = useT()
  const options = [t('design.sample.warehouse'), t('design.thumb.optionNorth'), t('design.thumb.optionSouth')]
  return (
    <div className={`flex w-56 flex-col ${SURFACE}`}>
      <span className="flex items-center gap-2 border-b border-border px-3 py-2 text-sm text-muted-foreground">
        <Search className="size-4" />{t('design.thumb.dropdownSearch')}
      </span>
      <span className="flex flex-col p-1">
        {options.map((option, index) => (
          <span key={option} className={`${ROW} ${index === 0 ? 'bg-muted' : ''} text-foreground`}>
            <span className="flex-1">{option}</span>
            {index === 0 ? <Check className="size-4" /> : null}
          </span>
        ))}
      </span>
    </div>
  )
}

function DropdownMenuSpecimen() {
  const t = useT()
  return (
    <div className={`flex w-52 flex-col p-1 ${SURFACE}`}>
      <span className={`${ROW} bg-muted text-foreground`}><Pencil className="size-4 text-muted-foreground" /><span className="flex-1">{t('design.thumb.menuEdit')}</span><Kbd>E</Kbd></span>
      <span className={`${ROW} text-foreground`}><Copy className="size-4 text-muted-foreground" /><span className="flex-1">{t('design.thumb.menuDuplicate')}</span><Kbd>D</Kbd></span>
      <span className="my-1 h-px bg-border" />
      <span className={`${ROW} text-status-error-text`}><Trash2 className="size-4" /><span className="flex-1">{t('design.thumb.menuDelete')}</span></span>
    </div>
  )
}

function NotificationPanelSpecimen() {
  const t = useT()
  return (
    <Screen>
      <span className="flex-1" />
      <div className="flex w-3/5 flex-col border-l border-border bg-card">
        <span className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs text-foreground">
          <Bell className="size-3" />{t('design.thumb.notifications')}
        </span>
        {[0, 1].map((index) => (
          <span key={index} className="flex items-start gap-2 border-b border-border px-3 py-2">
            <span className={`mt-1 size-2 shrink-0 rounded-full ${index === 0 ? 'bg-primary' : 'bg-muted'}`} />
            <span className="flex-1"><Lines count={2} /></span>
          </span>
        ))}
      </div>
    </Screen>
  )
}

function ChartLegendDotSpecimen() {
  const colors: ChartLegendColor[] = ['blue', 'orange', 'green', 'purple', 'pink', 'teal']
  return (
    <div className="flex flex-col items-center gap-4">
      {([16, 20] as const).map((size) => (
        <span key={size} className="flex items-center gap-3">
          {colors.map((color) => <ChartLegendDot key={color} color={color} size={size} />)}
        </span>
      ))}
    </div>
  )
}

const SPECIMENS: Record<string, React.ComponentType> = {
  dialog: DialogSpecimen,
  drawer: DrawerSpecimen,
  sheet: SheetSpecimen,
  popover: PopoverSpecimen,
  tooltip: TooltipSpecimen,
  'command-menu': CommandMenuSpecimen,
  dropdown: DropdownSpecimen,
  'dropdown-menu': DropdownMenuSpecimen,
  'notification-panel': NotificationPanelSpecimen,
  'chart-legend-dot': ChartLegendDotSpecimen,
}

export const thumbnailVariantIds: Readonly<Record<string, string>> = {
  'ai-controls': 'navigation-items',
  'rating-bar': 'star-selected',
  'step-indicator': 'horizontal',
  'phone-number-field': 'placeholder',
  'marketing-widgets': 'total-visitors',
}

export const wideThumbnailIds: ReadonlySet<string> = new Set(['active-filter-chips', 'filter-bar', 'form-header', 'step-indicator'])

export const firstExampleOnlyIds: ReadonlySet<string> = new Set(['phone-number-field'])

export function entrySpecimen(entryId: string): React.ReactElement | null {
  const Specimen = SPECIMENS[entryId]
  return Specimen ? <Specimen /> : null
}
