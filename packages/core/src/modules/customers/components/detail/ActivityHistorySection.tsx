'use client'

import * as React from 'react'
import { Clock3, Search } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { ErrorMessage, LoadingMessage, TabEmptyState } from '@open-mercato/ui/backend/detail'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import type { ActivitySummary, InteractionSummary } from './types'
import { ActivityCard } from './ActivityCard'

type GuardedMutationRunner = <T,>(
  operation: () => Promise<T>,
  mutationPayload?: Record<string, unknown>,
) => Promise<T>

type ActivityHistorySectionProps = {
  entityId: string
  useCanonicalInteractions?: boolean
  refreshKey?: number
  onEditActivity?: (activity: InteractionSummary) => void
  /** Optional guarded-mutation runner so per-row mutations route through the parent's
   * `useGuardedMutation` and emit retry-last-mutation context. */
  runMutation?: GuardedMutationRunner
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
    task: number
    total: number
  }
  call?: number
  email?: number
  meeting?: number
  note?: number
  task?: number
  total?: number
}

const TYPE_FILTERS = [
  { value: 'call', labelKey: 'customers.timeline.filter.call', fallback: 'Call' },
  { value: 'email', labelKey: 'customers.timeline.filter.email', fallback: 'Email' },
  { value: 'meeting', labelKey: 'customers.timeline.filter.meeting', fallback: 'Meeting' },
  { value: 'note', labelKey: 'customers.timeline.filter.note', fallback: 'Note' },
  { value: 'task', labelKey: 'customers.timeline.filter.task', fallback: 'Task' },
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

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: unknown }).name === 'AbortError'
  )
}

export function ActivityHistorySection({
  entityId,
  useCanonicalInteractions = false,
  refreshKey = 0,
  onEditActivity,
  runMutation,
}: ActivityHistorySectionProps) {
  const t = useT()
  const [searchInput, setSearchInput] = React.useState('')
  const [search, setSearch] = React.useState('')
  const [activeTypes, setActiveTypes] = React.useState<string[]>([])
  const [dateRange, setDateRange] = React.useState<'7d' | '30d' | '90d'>('90d')
  const [sortMode, setSortMode] = React.useState<'recent' | 'title-asc' | 'title-desc'>('recent')
  const [activities, setActivities] = React.useState<InteractionSummary[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [counts, setCounts] = React.useState<Record<string, number>>({ call: 0, email: 0, meeting: 0, note: 0, task: 0, total: 0 })
  const [hasMore, setHasMore] = React.useState(false)
  const [loadedPages, setLoadedPages] = React.useState(1)
  const [localRefreshKey, setLocalRefreshKey] = React.useState(0)
  const historyRequestSeqRef = React.useRef(0)
  const handleActivityChanged = React.useCallback(() => {
    setLocalRefreshKey((current) => current + 1)
  }, [])

  React.useEffect(() => {
    const timeout = window.setTimeout(() => setSearch(searchInput.trim()), 300)
    return () => window.clearTimeout(timeout)
  }, [searchInput])

  React.useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        const payload = await readApiResultOrThrow<InteractionCountsResponse>(
          `/api/customers/interactions/counts?entityId=${encodeURIComponent(entityId)}`,
          { signal: controller.signal },
        )
        const result = payload.result ?? payload
        setCounts({
          call: result.call ?? 0,
          email: result.email ?? 0,
          meeting: result.meeting ?? 0,
          note: result.note ?? 0,
          task: result.task ?? 0,
          total: result.total ?? 0,
        })
      } catch {
        setCounts({ call: 0, email: 0, meeting: 0, note: 0, task: 0, total: 0 })
      }
    })()
    return () => controller.abort()
  }, [entityId, refreshKey, localRefreshKey])

  const loadHistory = React.useCallback(async (options: { signal: AbortSignal; requestSeq: number }) => {
    const { signal, requestSeq } = options
    const isStale = () => signal.aborted || requestSeq !== historyRequestSeqRef.current
    setLoading(true)
    setError(null)
    try {
      const rangeStart = computeRangeStart(dateRange).toISOString()
      const pageSize = 20
      const canonicalItems: InteractionSummary[] = []
      let nextCursor: string | undefined
      let firstPageHasMore = false
      let pagesLoaded = 0

      const taskFilterActive = activeTypes.includes('task')
      do {
        const params = new URLSearchParams({
          entityId,
          limit: String(pageSize),
          from: rangeStart,
        })
        if (!taskFilterActive) params.set('excludeInteractionType', 'task')
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
          { signal },
        )
        if (isStale()) return
        const pageItems = Array.isArray(response.items) ? response.items : []
        canonicalItems.push(...pageItems)
        nextCursor = response.nextCursor
        if (!firstPageHasMore) firstPageHasMore = Boolean(response.nextCursor)
        pagesLoaded += 1
      } while (nextCursor && pagesLoaded < loadedPages)

      let combined = canonicalItems

      if (!useCanonicalInteractions) {
        const legacyItems: InteractionSummary[] = []
        let legacyTotalPages = 1
        for (let legacyPage = 1; legacyPage <= loadedPages; legacyPage += 1) {
          const legacyPayload = await readApiResultOrThrow<{ items?: ActivitySummary[]; totalPages?: number }>(
            `/api/customers/activities?entityId=${encodeURIComponent(entityId)}&page=${legacyPage}&pageSize=20&sortField=occurredAt&sortDir=desc`,
            { signal },
          ).catch(() => ({ items: [] as ActivitySummary[], totalPages: 1 }))
          if (isStale()) return
          legacyItems.push(...(Array.isArray(legacyPayload.items) ? legacyPayload.items.map(normalizeLegacyActivity) : []))
          legacyTotalPages = typeof legacyPayload.totalPages === 'number' ? legacyPayload.totalPages : legacyTotalPages
          if (legacyPage >= legacyTotalPages) break
        }
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
        firstPageHasMore = firstPageHasMore || legacyTotalPages > loadedPages
      }

      if (!isStale()) {
        setActivities(sortActivities(combined, sortMode))
        setHasMore(firstPageHasMore)
      }
    } catch (loadError) {
      if (!isStale() && !isAbortError(loadError)) {
        setActivities([])
        setHasMore(false)
        setError(t('customers.activityLog.error', 'Failed to load activity history'))
      }
    } finally {
      if (!isStale()) setLoading(false)
    }
  }, [activeTypes, dateRange, entityId, loadedPages, search, sortMode, t, useCanonicalInteractions])

  React.useEffect(() => {
    const controller = new AbortController()
    const requestSeq = historyRequestSeqRef.current + 1
    historyRequestSeqRef.current = requestSeq
    void loadHistory({ signal: controller.signal, requestSeq })
    return () => controller.abort()
  }, [loadHistory, refreshKey, localRefreshKey])

  React.useEffect(() => {
    setLoadedPages(1)
  }, [activeTypes, dateRange, entityId, search, sortMode, useCanonicalInteractions])

  const filteredLabel = activeTypes.length > 0
    ? activeTypes.map((type) => t(`customers.timeline.filter.${type}`, type)).join(', ')
    : t('customers.timeline.filter.all', 'All')

  const handleTypeToggle = React.useCallback((type: string) => {
    setActiveTypes((current) => (
      current.includes(type)
        ? current.filter((entry) => entry !== type)
        : [...current, type]
    ))
  }, [])

  const handleLoadMore = React.useCallback(() => {
    setLoadedPages((current) => current + 1)
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
                setSearchInput(event.target.value)
              }}
              placeholder={t('customers.activityLog.searchPlaceholder', 'Search by title, note, or author')}
              className="h-9 pl-9"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-overline font-semibold uppercase tracking-[0.12em] text-muted-foreground">
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
                  className="h-auto rounded-full px-2.5 py-1 text-xs"
                >
                  {t(filter.labelKey, filter.fallback)}
                  <span className={isActive ? 'ml-1 text-primary-foreground/80' : 'ml-1 text-muted-foreground'}>
                    {counts[filter.value] ?? 0}
                  </span>
                </Button>
              )
            })}

            <Select
              value={dateRange}
              onValueChange={(value) => {
                setDateRange(value as '7d' | '30d' | '90d')
              }}
            >
              <SelectTrigger
                size="sm"
                aria-label={t('customers.activityLog.filters.dateRangeLabel', 'Date range')}
                className="w-auto"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7d">{t('customers.changelog.last7days', 'Last 7 days')}</SelectItem>
                <SelectItem value="30d">{t('customers.changelog.last30days', 'Last 30 days')}</SelectItem>
                <SelectItem value="90d">{t('customers.changelog.last90days', 'Last 90 days')}</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={sortMode}
              onValueChange={(value) => {
                setSortMode(value as 'recent' | 'title-asc' | 'title-desc')
              }}
            >
              <SelectTrigger
                size="sm"
                aria-label={t('customers.activityLog.filters.sortLabel', 'Sort order')}
                className="w-auto"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="recent">{t('customers.activityLog.sort.recent', 'Sort: newest')}</SelectItem>
                <SelectItem value="title-asc">{t('customers.activityLog.sort.titleAsc', 'Sort: Name A-Z')}</SelectItem>
                <SelectItem value="title-desc">{t('customers.activityLog.sort.titleDesc', 'Sort: Name Z-A')}</SelectItem>
              </SelectContent>
            </Select>
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
                      <span className="text-xs font-semibold text-muted-foreground">· {currentYear} ·</span>
                      <div className="h-px flex-1 bg-border" />
                    </div>
                  ) : null}
                  <ActivityCard
                    activity={activity}
                    onOpen={onEditActivity}
                    onChanged={handleActivityChanged}
                    runMutation={runMutation}
                  />
                </React.Fragment>
              )
            })}

            {hasMore ? (
              <div className="pt-2 text-center">
                <Button type="button" variant="link" size="sm" onClick={handleLoadMore} className="text-sm">
                  {t('customers.activities.loadMore', 'Load more')}
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
