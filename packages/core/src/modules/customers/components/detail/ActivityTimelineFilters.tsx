'use client'
import * as React from 'react'
import { Phone, Mail, Handshake, StickyNote } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'

const FILTER_TYPES = [
  { type: 'call', icon: Phone },
  { type: 'email', icon: Mail },
  { type: 'meeting', icon: Handshake },
  { type: 'note', icon: StickyNote },
] as const

interface ActivityTimelineFiltersProps {
  activeTypes: string[]
  dateFrom: string
  dateTo: string
  onTypesChange: (types: string[]) => void
  onDateFromChange: (value: string) => void
  onDateToChange: (value: string) => void
  onReset: () => void
}

export function ActivityTimelineFilters({
  activeTypes,
  dateFrom,
  dateTo,
  onTypesChange,
  onDateFromChange,
  onDateToChange,
  onReset,
}: ActivityTimelineFiltersProps) {
  const t = useT()
  const hasActiveFilters = activeTypes.length > 0 || dateFrom || dateTo

  const handleTypeToggle = React.useCallback((type: string) => {
    if (activeTypes.includes(type)) {
      onTypesChange(activeTypes.filter((filterType) => filterType !== type))
    } else {
      onTypesChange([...activeTypes, type])
    }
  }, [activeTypes, onTypesChange])

  return (
    <div className="flex flex-wrap items-center gap-2">
      {FILTER_TYPES.map(({ type, icon: Icon }) => {
        const isActive = activeTypes.includes(type)
        return (
          <Button
            key={type}
            type="button"
            variant={isActive ? 'default' : 'outline'}
            size="sm"
            onClick={() => handleTypeToggle(type)}
            className="h-7 gap-1 text-xs"
            aria-pressed={isActive}
          >
            <Icon className="size-3" />
            {t(`customers.timeline.filter.${type}`, type)}
          </Button>
        )
      })}

      <Button
        type="button"
        variant={!hasActiveFilters ? 'default' : 'ghost'}
        size="sm"
        onClick={onReset}
        className="h-7 text-xs"
      >
        {t('customers.timeline.filter.all', 'All')}
      </Button>

      <div className="ml-auto flex items-center gap-2">
        <input
          type="date"
          value={dateFrom}
          onChange={(event) => onDateFromChange(event.target.value)}
          className="h-7 rounded-md border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          aria-label={t('customers.timeline.filter.from', 'From date')}
        />
        <span className="text-xs text-muted-foreground">—</span>
        <input
          type="date"
          value={dateTo}
          onChange={(event) => onDateToChange(event.target.value)}
          className="h-7 rounded-md border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          aria-label={t('customers.timeline.filter.to', 'To date')}
        />
      </div>
    </div>
  )
}
