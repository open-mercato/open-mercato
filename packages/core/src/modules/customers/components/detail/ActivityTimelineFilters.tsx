'use client'
import * as React from 'react'
import { Phone, Mail, Users, StickyNote, SlidersHorizontal } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Popover, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

const FILTER_TYPES = [
  { type: 'call', icon: Phone },
  { type: 'email', icon: Mail },
  { type: 'meeting', icon: Users },
  { type: 'note', icon: StickyNote },
] as const

type InteractionCounts = {
  call: number
  email: number
  meeting: number
  note: number
  total: number
}

interface ActivityTimelineFiltersProps {
  entityId: string | null
  activeTypes: string[]
  dateFrom: string
  dateTo: string
  onTypesChange: (types: string[]) => void
  onDateFromChange: (value: string) => void
  onDateToChange: (value: string) => void
  onReset: () => void
}

export function ActivityTimelineFilters({
  entityId,
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
  const [counts, setCounts] = React.useState<InteractionCounts | null>(null)

  React.useEffect(() => {
    if (!entityId) return
    const controller = new AbortController()
    void (async () => {
      try {
        const nextCounts = await readApiResultOrThrow<InteractionCounts>(
          `/api/customers/interactions/counts?entityId=${encodeURIComponent(entityId)}`,
          { signal: controller.signal },
        )
        setCounts(nextCounts)
      } catch {
        setCounts(null)
      }
    })()
    return () => controller.abort()
  }, [entityId])

  const handleTypeToggle = React.useCallback((type: string) => {
    if (activeTypes.includes(type)) {
      onTypesChange(activeTypes.filter((filterType) => filterType !== type))
    } else {
      onTypesChange([...activeTypes, type])
    }
  }, [activeTypes, onTypesChange])

  return (
    <div className="flex flex-col gap-3 border-b border-border/60 pb-4 md:flex-row md:items-center md:justify-between">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-overline font-bold uppercase tracking-wider text-muted-foreground">
          {t('customers.people.detail.activities.filterLabel', 'FILTER:')}
        </span>

        {FILTER_TYPES.map(({ type, icon: Icon }) => {
          const isActive = activeTypes.includes(type)
          const count = counts?.[type as keyof InteractionCounts]
          return (
            <Button
              key={type}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => handleTypeToggle(type)}
              className={cn(
                'h-7 rounded-full px-2.5 text-xs gap-1.5',
                isActive
                  ? 'border-foreground bg-background text-foreground'
                  : 'border-border bg-background text-muted-foreground',
              )}
              aria-pressed={isActive}
            >
              <Icon className="size-2.5" />
              <span className="font-semibold">{t(`customers.timeline.filter.${type}`, type)}</span>
              {typeof count === 'number' && count > 0 ? (
                <span className="rounded-full bg-muted px-1 text-overline leading-4 text-muted-foreground">
                  {count}
                </span>
              ) : null}
            </Button>
          )
        })}
      </div>

      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 rounded-[8px] px-2.5 text-xs text-muted-foreground"
          >
            <SlidersHorizontal className="size-2.5" />
            {t('customers.people.detail.activities.moreFilters', 'More')}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium">
              {t('customers.activities.filters.dateRange', 'Date range')}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={dateFrom}
                onChange={(event) => onDateFromChange(event.target.value)}
                className="h-8 w-full rounded-md border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                aria-label={t('customers.timeline.filter.from', 'From date')}
              />
              <span className="shrink-0 text-xs text-muted-foreground">—</span>
              <input
                type="date"
                value={dateTo}
                onChange={(event) => onDateToChange(event.target.value)}
                className="h-8 w-full rounded-md border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                aria-label={t('customers.timeline.filter.to', 'To date')}
              />
            </div>
          </div>

          {hasActiveFilters ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onReset}
              className="h-7 w-full text-xs"
            >
              {t('customers.activities.filters.clearAll', 'Clear filters')}
            </Button>
          ) : null}
        </PopoverContent>
      </Popover>
    </div>
  )
}
