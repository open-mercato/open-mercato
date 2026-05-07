'use client'
import * as React from 'react'
import { Phone, Mail, Users, StickyNote, ListTodo, SlidersHorizontal } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Popover, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

const FILTER_TYPES = [
  { type: 'note', icon: StickyNote },
  { type: 'call', icon: Phone },
  { type: 'meeting', icon: Users },
  { type: 'email', icon: Mail },
  { type: 'task', icon: ListTodo },
] as const

type InteractionCounts = {
  call: number
  email: number
  meeting: number
  note: number
  task: number
  total: number
}

type InteractionCountsResponse = {
  ok?: boolean
  result?: InteractionCounts
} & Partial<InteractionCounts>

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

const CHIP_BASE = 'inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium transition-colors'
const CHIP_INACTIVE = 'border border-border bg-card text-muted-foreground hover:bg-accent/40'
const CHIP_ACTIVE = 'border border-status-info-border bg-status-info-bg text-status-info-text'

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
  const allActive = activeTypes.length === 0
  const [counts, setCounts] = React.useState<InteractionCounts | null>(null)

  React.useEffect(() => {
    if (!entityId) return
    const controller = new AbortController()
    void (async () => {
      try {
        const payload = await readApiResultOrThrow<InteractionCountsResponse>(
          `/api/customers/interactions/counts?entityId=${encodeURIComponent(entityId)}`,
          { signal: controller.signal },
        )
        // Endpoint envelope is `{ ok, result: {...counts} }`. Some legacy fixtures
        // return the counts at the top level — fall back to that shape so the chip
        // badges keep working in either case.
        const source = (payload.result ?? payload) as Partial<InteractionCounts>
        setCounts({
          call: source.call ?? 0,
          email: source.email ?? 0,
          meeting: source.meeting ?? 0,
          note: source.note ?? 0,
          task: source.task ?? 0,
          total: source.total ?? 0,
        })
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

  const handleSelectAll = React.useCallback(() => {
    onTypesChange([])
  }, [onTypesChange])

  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div className="flex flex-wrap items-center gap-2.5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleSelectAll}
          aria-pressed={allActive}
          className={cn(CHIP_BASE, allActive ? CHIP_ACTIVE : CHIP_INACTIVE)}
        >
          <span>{t('customers.timeline.filter.all', 'All Activities')}</span>
        </Button>

        {FILTER_TYPES.map(({ type, icon: Icon }) => {
          const isActive = activeTypes.includes(type)
          const count = counts?.[type as keyof InteractionCounts]
          const hasCount = typeof count === 'number' && count > 0
          return (
            <Button
              key={type}
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => handleTypeToggle(type)}
              aria-pressed={isActive}
              className={cn(CHIP_BASE, isActive ? CHIP_ACTIVE : CHIP_INACTIVE)}
            >
              <Icon className="size-[18px] shrink-0" />
              <span>
                {t(`customers.timeline.filter.${type}`, type)}
                {hasCount ? ` ${count}` : ''}
              </span>
            </Button>
          )
        })}
      </div>

      <Popover>
        <PopoverTrigger asChild>
          <IconButton
            type="button"
            variant="outline"
            size="sm"
            className="size-7 rounded-md text-muted-foreground"
            aria-label={t('customers.people.detail.activities.moreFilters', 'More filters')}
          >
            <SlidersHorizontal className="size-3.5" />
          </IconButton>
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
