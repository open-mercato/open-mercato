'use client'

import * as React from 'react'
import { Clock3, Search } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { ErrorMessage, LoadingMessage, TabEmptyState } from '@open-mercato/ui/backend/detail'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import type { ActivitySummary, InteractionSummary } from './types'
import { ActivityCard } from './ActivityCard'

type ActivityHistorySectionProps = {
  entityId: string
  useCanonicalInteractions?: boolean
  refreshKey?: number
  onEditActivity?: (activity: InteractionSummary) => void
}

type InteractionListResponse = {
  items?: InteractionSummary[]
  nextCursor?: string
}

type InteractionCountsResponse = {
  ok?: boolean
  result?: {
    call: number
    email: number
    meeting: number
    note: number
    total: number
  }
  call?: number
  email?: number
  meeting?: number
  note?: number
  total?: number
}

const TYPE_FILTERS = [
  { value: 'call', labelKey: 'customers.timeline.filter.call', fallback: 'Call' },
  { value: 'email', labelKey: 'customers.timeline.filter.email', fallback: 'Email' },
  { value: 'meeting', labelKey: 'customers.timeline.filter.meeting', fallback: 'Meeting' },
  { value: 'note', labelKey: 'customers.timeline.filter.note', fallback: 'Note' },
] as const

function computeRangeStart(range: '7d' | '30d' | '90d'): Date {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  const days = Number.parseInt(range.replace('d', ''), 10) || 30
  date.setDate(date.getDate() - days)
  return date
}

function toTimelineTimestamp(activity: InteractionSummary): string {
  return activity.occurredAt ?? activity.scheduledAt ?? activity.createdAt
}

function normalizeLegacyActivity(activity: ActivitySummary): InteractionSummary {
  return {
    id: activity.id,
    interactionType: activity.activityType,
    title: activity.subject ?? null,
    body: activity.body ?? null,
    status: 'done',
    scheduledAt: null,
    occurredAt: activity.occurredAt ?? null,
    priority: null,
    authorUserId: activity.authorUserId ?? null,
    ownerUserId: null,
    appearanceIcon: activity.appearanceIcon ?? null,
    appearanceColor: activity.appearanceColor ?? null,
    source: 'legacy-activity',
    entityId: activity.entityId ?? null,
    dealId: activity.dealId ?? null,
    organizationId: null,
    tenantId: null,
    authorName: activity.authorName ?? null,
    authorEmail: activity.authorEmail ?? null,
    dealTitle: activity.dealTitle ?? null,
    customValues: activity.customValues ?? null,
    createdAt: activity.createdAt,
    updatedAt: activity.createdAt,
  }
}

function sortTimelineActivities(items: InteractionSummary[]): InteractionSummary[] {
  const now = Date.now()
  return [...items].sort((left, right) => {
    const leftScheduled = left.scheduledAt ? new Date(left.scheduledAt).getTime() : Number.NaN
    const rightScheduled = right.scheduledAt ? new Date(right.scheduledAt).getTime() : Number.NaN
    const leftIsPlanned = left.status === 'planned' && Number.isFinite(leftScheduled)
    const rightIsPlanned = right.status === 'planned' && Number.isFinite(rightScheduled)
    const leftIsUpcoming = leftIsPlanned && leftScheduled >= now
    const rightIsUpcoming = rightIsPlanned && rightScheduled >= now

    if (leftIsUpcoming !== rightIsUpcoming) return leftIsUpcoming ? -1 : 1
    if (leftIsUpcoming && rightIsUpcoming) return leftScheduled - rightScheduled

    const compare = toTimelineTimestamp(right).localeCompare(toTimelineTimestamp(left))
    if (compare !== 0) return compare
    return right.id.localeCompare(left.id)
  })
}

function sortActivities(items: InteractionSummary[], sortMode: 'recent' | 'title-asc' | 'title-desc') {
  if (sortMode === 'recent') return sortTimelineActivities(items)
  return [...items].sort((left, right) => {
    const leftTitle = (left.title ?? left.body ?? left.interactionType ?? '').toLowerCase()
    const rightTitle = (right.title ?? right.body ?? right.interactionType ?? '').toLowerCase()
    return sortMode === 'title-asc'
      ? leftTitle.localeCompare(rightTitle)
      : rightTitle.localeCompare(leftTitle)
  })
}

function matchesSearch(activity: InteractionSummary, query: string): boolean {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return true
  const haystack = [
    activity.title,
    activity.body,
    activity.authorName,
    activity.authorEmail,
    activity.customer?.displayName,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return haystack.includes(normalized)
}

function isWithinRange(activity: InteractionSummary, start: Date): boolean {
  const timestamp = new Date(toTimelineTimestamp(activity))
  if (Number.isNaN(timestamp.getTime())) return false
  return timestamp >= start
}

export function ActivityHistorySection({
  entityId,
  useCanonicalInteractions = false,
  refreshKey = 0,
  onEditActivity,
}: ActivityHistorySectionProps) {
  const t = useT()
  const [searchInput, setSearchInput] = React.useState('')
  const [search, setSearch] = React.useState('')
  const [activeTypes, setActiveTypes] = React.useState<string[]>(['call', 'email'])
  const [dateRange, setDateRange] = React.useState<'7d' | '30d' | '90d'>('30d')
  const [sortMode, setSortMode] = React.useState<'recent' | 'title-asc' | 'title-desc'>('recent')
  const [activities, setActivities] = React.useState<InteractionSummary[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [counts, setCounts] = React.useState<Record<string, number>>({ call: 0, email: 0, meeting: 0, note: 0, total: 0 })
  const [hasMore, setHasMore] = React.useState(false)
  const [showAll, setShowAll] = React.useState(false)

  React.useEffect(() => {
    const timeout = window.setTimeout(() => setSearch(searchInput.trim()), 300)
    return () => window.clearTimeout(timeout)
  }, [searchInput])

  React.useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        const payload = await readApiResultOrThrow<InteractionCountsResponse>(
          `/api/customers/interactions/counts?entityId=${encodeURIComponent(entityId)}&status=done`,
          { signal: controller.signal },
        )
        const result = payload.result ?? payload
        setCounts({
          call: result.call ?? 0,
          email: result.email ?? 0,
          meeting: result.meeting ?? 0,
          note: result.note ?? 0,
          total: result.total ?? 0,
        })
      } catch {
        setCounts({ call: 0, email: 0, meeting: 0, note: 0, total: 0 })
      }
    })()
    return () => controller.abort()
  }, [entityId, refreshKey])

  const loadHistory = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const rangeStart = computeRangeStart(dateRange).toISOString()
      const pageSize = showAll ? 100 : 20
      const canonicalItems: InteractionSummary[] = []
      let nextCursor: string | undefined
      let firstPageHasMore = false

      do {
        const params = new URLSearchParams({
          entityId,
          status: 'done',
          excludeInteractionType: 'task',
          limit: String(pageSize),
          from: rangeStart,
        })
        if (activeTypes.length > 0) params.set('type', activeTypes.join(','))
        if (search) params.set('search', search)
        if (sortMode === 'recent') {
          params.set('sortField', 'occurredAt')
          params.set('sortDir', 'desc')
        } else {
          params.set('sortField', 'title')
          params.set('sortDir', sortMode === 'title-asc' ? 'asc' : 'desc')
        }
        if (nextCursor) params.set('cursor', nextCursor)

        const response = await readApiResultOrThrow<InteractionListResponse>(
          `/api/customers/interactions?${params.toString()}`,
        )
        const pageItems = Array.isArray(response.items) ? response.items : []
        canonicalItems.push(...pageItems)
        nextCursor = response.nextCursor
        if (!firstPageHasMore) firstPageHasMore = Boolean(response.nextCursor)
      } while (showAll && nextCursor && canonicalItems.length < 200)

      let combined = canonicalItems

      if (!useCanonicalInteractions) {
        const legacyPayload = await readApiResultOrThrow<{ items?: ActivitySummary[] }>(
          `/api/customers/activities?entityId=${encodeURIComponent(entityId)}&pageSize=${showAll ? '100' : '20'}&sortField=occurredAt&sortDir=desc`,
        ).catch(() => ({ items: [] as ActivitySummary[] }))
        const legacyItems = Array.isArray(legacyPayload.items) ? legacyPayload.items.map(normalizeLegacyActivity) : []
        const rangeStartDate = computeRangeStart(dateRange)
        const filteredLegacy = legacyItems.filter((item) => {
          if (activeTypes.length > 0 && !activeTypes.includes(item.interactionType)) return false
          if (!matchesSearch(item, search)) return false
          return isWithinRange(item, rangeStartDate)
        })
        const deduped = new Map<string, InteractionSummary>()
        ;[...canonicalItems, ...filteredLegacy].forEach((item) => {
          if (!deduped.has(item.id)) deduped.set(item.id, item)
        })
        combined = Array.from(deduped.values())
      }

      setActivities(sortActivities(combined, sortMode))
      setHasMore(firstPageHasMore)
    } catch (loadError) {
      console.error('customers.activityLog.history failed', loadError)
      setActivities([])
      setHasMore(false)
      setError(t('customers.activityLog.error', 'Failed to load activity history'))
    } finally {
      setLoading(false)
    }
  }, [activeTypes, dateRange, entityId, search, showAll, sortMode, t, useCanonicalInteractions])

  React.useEffect(() => {
    void loadHistory()
  }, [loadHistory, refreshKey])

  const filteredLabel = activeTypes.length > 0
    ? activeTypes.map((type) => t(`customers.timeline.filter.${type}`, type)).join(', ')
    : t('customers.timeline.filter.all', 'All')

  const handleTypeToggle = React.useCallback((type: string) => {
    setShowAll(false)
    setActiveTypes((current) => (
      current.includes(type)
        ? current.filter((entry) => entry !== type)
        : [...current, type]
    ))
  }, [])

  const handleSeeAll = React.useCallback(() => {
    setShowAll(true)
    setSearchInput('')
    setSearch('')
    setActiveTypes([])
    setDateRange('90d')
    setSortMode('recent')
  }, [])

  return (
    <div className="rounded-xl border bg-card">
      <div className="flex items-center gap-2 border-b px-5 py-4">
        <Clock3 className="size-4 text-muted-foreground" />
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-foreground">
            {t('customers.activityLog.title', 'Activity history')}
          </h3>
          <p className="text-xs text-muted-foreground">
            {t('customers.timeline.history.filtered', 'filtered: {{types}} · {{count}} results', {
              types: filteredLabel,
              count: activities.length,
            })}
          </p>
        </div>
      </div>

      <div className="space-y-4 px-5 py-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="relative w-full max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(event) => {
                setShowAll(false)
                setSearchInput(event.target.value)
              }}
              placeholder={t('customers.activityLog.searchPlaceholder', 'Search by title, note, or author')}
              className="h-9 pl-9"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {t('customers.changelog.filter', 'Filter')}:
            </span>
            {TYPE_FILTERS.map((filter) => {
              const isActive = activeTypes.includes(filter.value)
              return (
                <Button
                  key={filter.value}
                  type="button"
                  variant={isActive ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => handleTypeToggle(filter.value)}
                  className="h-auto rounded-full px-2.5 py-1 text-[10px]"
                >
                  {t(filter.labelKey, filter.fallback)}
                  <span className={isActive ? 'ml-1 text-primary-foreground/80' : 'ml-1 text-muted-foreground'}>
                    {counts[filter.value] ?? 0}
                  </span>
                </Button>
              )
            })}

            <select
              value={dateRange}
              onChange={(event) => {
                setShowAll(false)
                setDateRange(event.target.value as '7d' | '30d' | '90d')
              }}
              className="h-8 rounded-[10px] border bg-background px-3 text-xs outline-none ring-offset-background focus:ring-2 focus:ring-ring"
            >
              <option value="7d">{t('customers.changelog.last7days', 'Last 7 days')}</option>
              <option value="30d">{t('customers.changelog.last30days', 'Last 30 days')}</option>
              <option value="90d">{t('customers.changelog.last90days', 'Last 90 days')}</option>
            </select>

            <select
              value={sortMode}
              onChange={(event) => {
                setShowAll(false)
                setSortMode(event.target.value as 'recent' | 'title-asc' | 'title-desc')
              }}
              className="h-8 rounded-[10px] border bg-background px-3 text-xs outline-none ring-offset-background focus:ring-2 focus:ring-ring"
            >
              <option value="recent">{t('customers.activityLog.sort.recent', 'Sort: newest')}</option>
              <option value="title-asc">{t('customers.activityLog.sort.titleAsc', 'Sort: Name A-Z')}</option>
              <option value="title-desc">{t('customers.activityLog.sort.titleDesc', 'Sort: Name Z-A')}</option>
            </select>
          </div>
        </div>

        {loading && activities.length === 0 ? (
          <LoadingMessage label={t('customers.people.detail.activities.loading', 'Loading activities…')} className="min-h-[220px] justify-center" />
        ) : error ? (
          <ErrorMessage label={error} />
        ) : activities.length === 0 ? (
          <TabEmptyState
            title={t('customers.timeline.empty', 'No activities match the current filters.')}
            description={t('customers.activityLog.emptyDescription', 'Try broadening the date range or removing some filters.')}
          />
        ) : (
          <div className="space-y-4">
            {activities.map((activity, index) => {
              const currentYear = new Date(toTimelineTimestamp(activity)).getFullYear()
              const previousYear = index > 0 ? new Date(toTimelineTimestamp(activities[index - 1])).getFullYear() : null
              const showYearSeparator = previousYear !== null && currentYear !== previousYear
              return (
                <React.Fragment key={activity.id}>
                  {showYearSeparator ? (
                    <div className="flex items-center gap-3 py-1">
                      <div className="h-px flex-1 bg-border" />
                      <span className="text-[11px] font-semibold text-muted-foreground">· {currentYear} ·</span>
                      <div className="h-px flex-1 bg-border" />
                    </div>
                  ) : null}
                  <ActivityCard activity={activity} onOpen={onEditActivity} />
                </React.Fragment>
              )
            })}

            {hasMore && !showAll ? (
              <div className="pt-2 text-center">
                <Button type="button" variant="link" size="sm" onClick={handleSeeAll} className="text-sm">
                  {t('customers.timeline.history.seeAll', 'See all {{count}} activities', { count: counts.total || activities.length })}
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}

export default ActivityHistorySection
