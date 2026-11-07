"use client"

import * as React from 'react'
import { Clock, Search } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import type { SectionAction, TabEmptyStateConfig } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import { Kbd } from '@open-mercato/ui/primitives/kbd'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { ActivityTimelineFilters } from './ActivityTimelineFilters'
import { ActivityTimeline } from './ActivityTimeline'
import { resolveAuthorUserNames } from './authorUserLookup'
import type { ActivitySummary, InteractionSummary } from './types'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'

const logger = createLogger('customers')

type GuardedMutationRunner = <T>(
  operation: () => Promise<T>,
  mutationPayload?: Record<string, unknown>,
) => Promise<T>

export type ActivitiesSectionProps = {
  entityId: string | null
  entityName?: string | null
  dealId?: string | null
  useCanonicalInteractions?: boolean
  addActionLabel: string
  emptyState: TabEmptyStateConfig
  onActionChange?: (action: SectionAction | null) => void
  onLoadingChange?: (isLoading: boolean) => void
  onDataRefresh?: () => void
  dealOptions?: Array<{ id: string; label: string }>
  entityOptions?: Array<{ id: string; label: string }>
  defaultEntityId?: string | null
  runGuardedMutation?: GuardedMutationRunner
  refreshKey?: number
  onEditActivity?: (activity: InteractionSummary) => void
  /** Interaction type hidden from the timeline by default ('task' unless overridden); pass null to show every type. */
  excludeInteractionType?: string | null
  /** Sends the search term and a sort choice to the interactions API, shows the sort control and surfaces failed interaction loads as an error with retry. Callers that omit it keep the local filter over loaded rows. */
  serverHistoryControls?: boolean
}

type HistorySortMode = 'recent' | 'title-asc' | 'title-desc'

type CanonicalInteractionsResponse = { items?: InteractionSummary[]; nextCursor?: string }

const SEARCH_DEBOUNCE_MS = 300

function toDateOnly(value: string | null | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10)
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

    if (leftIsUpcoming !== rightIsUpcoming) {
      return leftIsUpcoming ? -1 : 1
    }

    if (leftIsUpcoming && rightIsUpcoming) {
      if (leftScheduled === rightScheduled) return left.id.localeCompare(right.id)
      return leftScheduled - rightScheduled
    }

    const leftTime = left.occurredAt ?? left.scheduledAt ?? null
    const rightTime = right.occurredAt ?? right.scheduledAt ?? null
    if (!leftTime || !rightTime) {
      if (leftTime !== rightTime) return leftTime ? -1 : 1
      return right.id.localeCompare(left.id)
    }
    const compare = rightTime.localeCompare(leftTime)
    if (compare !== 0) return compare
    return right.id.localeCompare(left.id)
  })
}

function sortHistoryActivities(items: InteractionSummary[], sortMode: HistorySortMode): InteractionSummary[] {
  if (sortMode === 'recent') return sortTimelineActivities(items)
  return [...items].sort((left, right) => {
    const leftTitle = (left.title ?? left.body ?? left.interactionType ?? '').toLowerCase()
    const rightTitle = (right.title ?? right.body ?? right.interactionType ?? '').toLowerCase()
    return sortMode === 'title-asc'
      ? leftTitle.localeCompare(rightTitle)
      : rightTitle.localeCompare(leftTitle)
  })
}

function matchesLoadedActivity(activity: InteractionSummary, lowercaseTerm: string): boolean {
  const haystack = [
    activity.title,
    activity.body,
    activity.authorName,
    activity.dealTitle,
    activity.interactionType,
  ]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join(' ')
    .toLowerCase()
  return haystack.includes(lowercaseTerm)
}

function dedupeActivitiesById(items: InteractionSummary[]): InteractionSummary[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
}

export function ActivitiesSection({
  entityId,
  entityName,
  dealId,
  useCanonicalInteractions = false,
  onActionChange,
  onLoadingChange,
  onDataRefresh,
  refreshKey = 0,
  onEditActivity,
  runGuardedMutation,
  excludeInteractionType = 'task',
  serverHistoryControls = false,
}: ActivitiesSectionProps) {
  const t = useT()
  const [filterTypes, setFilterTypes] = React.useState<string[]>([])
  const [filterDateFrom, setFilterDateFrom] = React.useState('')
  const [filterDateTo, setFilterDateTo] = React.useState('')
  const [searchTerm, setSearchTerm] = React.useState('')
  const [serverSearchTerm, setServerSearchTerm] = React.useState('')
  const [sortMode, setSortMode] = React.useState<HistorySortMode>('recent')
  const [loadFailed, setLoadFailed] = React.useState(false)
  const [activities, setActivities] = React.useState<InteractionSummary[]>([])
  const [loading, setLoading] = React.useState(false)
  const [hasMore, setHasMore] = React.useState(false)
  const [loadedPages, setLoadedPages] = React.useState(1)
  const searchInputRef = React.useRef<HTMLInputElement>(null)
  const loadSequenceRef = React.useRef(0)

  React.useEffect(() => {
    if (!entityId) return
    function handleShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === '1') {
        event.preventDefault()
        searchInputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [entityId])

  React.useEffect(() => {
    if (!serverHistoryControls) return
    const nextTerm = searchTerm.trim()
    if (nextTerm === serverSearchTerm) return
    const timeout = window.setTimeout(() => {
      setServerSearchTerm(nextTerm)
      setLoadedPages(1)
    }, SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timeout)
  }, [searchTerm, serverHistoryControls, serverSearchTerm])

  const visibleActivities = React.useMemo(() => {
    const term = serverHistoryControls ? '' : searchTerm.trim().toLowerCase()
    if (!term) return activities
    return activities.filter((activity) => matchesLoadedActivity(activity, term))
  }, [activities, searchTerm, serverHistoryControls])

  React.useEffect(() => {
    onActionChange?.(null)
    return () => onActionChange?.(null)
  }, [onActionChange])

  React.useEffect(() => {
    onLoadingChange?.(loading)
  }, [loading, onLoadingChange])

  const loadActivities = React.useCallback(async () => {
    const loadSequence = loadSequenceRef.current + 1
    loadSequenceRef.current = loadSequence
    const isStale = () => loadSequence !== loadSequenceRef.current

    setLoadFailed(false)
    if (!entityId) {
      setActivities([])
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      // Always fetch canonical interactions (new activities are always created here)
      const excludedFilterActive = excludeInteractionType ? filterTypes.includes(excludeInteractionType) : true
      const canonicalParams = new URLSearchParams({
        entityId,
        limit: '50',
        sortField: sortMode === 'recent' ? 'occurredAt' : 'title',
        sortDir: sortMode === 'title-asc' ? 'asc' : 'desc',
      })
      // Hide the configured type (tasks by default — they have their own tab)
      // from the activity timeline, but lift the exclusion when the user
      // explicitly toggled that type's chip on (mirrors
      // `ActivityHistorySection.tsx` after the #1805 fix).
      if (excludeInteractionType && !excludedFilterActive) canonicalParams.set('excludeInteractionType', excludeInteractionType)
      if (dealId) canonicalParams.set('dealId', dealId)
      if (filterTypes.length > 0) canonicalParams.set('type', filterTypes.join(','))
      if (filterDateFrom) canonicalParams.set('from', filterDateFrom)
      if (filterDateTo) canonicalParams.set('to', filterDateTo)

      const surfaceCanonicalFailure = useCanonicalInteractions || serverHistoryControls
      const fetchCanonicalPages = async (search?: string) => {
        const items: InteractionSummary[] = []
        let cursor: string | undefined
        let pageIndex = 0
        do {
          const params = new URLSearchParams(canonicalParams)
          if (search) params.set('search', search)
          if (cursor) params.set('cursor', cursor)
          const request = readApiResultOrThrow<CanonicalInteractionsResponse>(
            `/api/customers/interactions?${params.toString()}`,
          )
          const payload: CanonicalInteractionsResponse = await (surfaceCanonicalFailure
            ? request
            : request.catch(() => ({ items: [] as InteractionSummary[], nextCursor: undefined })))
          if (isStale()) return { items, hasMore: false }
          items.push(...(Array.isArray(payload?.items) ? payload.items : []))
          cursor = typeof payload?.nextCursor === 'string' ? payload.nextCursor : undefined
          pageIndex += 1
        } while (cursor && pageIndex < loadedPages)
        return { items, hasMore: Boolean(cursor) }
      }

      // The API search covers title and body. It never covers author, deal or type, so
      // the rows of the unsearched pages are matched here as well, and those pages keep
      // "Load more" able to reach such matches.
      const lowercaseSearchTerm = serverSearchTerm.toLowerCase()
      const [browsedPages, searchedPages] = await Promise.all([
        fetchCanonicalPages(),
        serverSearchTerm ? fetchCanonicalPages(serverSearchTerm) : Promise.resolve(null),
      ])
      if (isStale()) return
      const canonicalItems = searchedPages
        ? dedupeActivitiesById([
            ...searchedPages.items,
            ...browsedPages.items.filter((item) => matchesLoadedActivity(item, lowercaseSearchTerm)),
          ])
        : browsedPages.items
      const canonicalHasMore = browsedPages.hasMore || Boolean(searchedPages?.hasMore)

      if (useCanonicalInteractions) {
        setActivities(sortHistoryActivities(canonicalItems, sortMode))
        setHasMore(canonicalHasMore)
        return
      }

      // In legacy mode, also fetch legacy activities and merge with canonical.
      // Legacy fallback uses known page numbers, so request every page up front
      // and resolve them together instead of awaiting each one sequentially.
      const legacyPageNumbers = Array.from({ length: loadedPages }, (_, index) => index + 1)
      const legacyPayloads = await Promise.all(
        legacyPageNumbers.map((legacyPage) => {
          const legacyParams = new URLSearchParams({
            entityId,
            page: String(legacyPage),
            pageSize: '50',
            sortField: 'occurredAt',
            sortDir: 'desc',
          })
          if (dealId) legacyParams.set('dealId', dealId)
          return readApiResultOrThrow<{ items?: ActivitySummary[]; totalPages?: number }>(
            `/api/customers/activities?${legacyParams.toString()}`,
          ).catch(() => ({ items: [] as ActivitySummary[], totalPages: 1 }))
        }),
      )
      if (isStale()) return
      // Merge in page order so timeline ordering stays stable regardless of
      // which request settles first.
      const legacyItems: InteractionSummary[] = []
      let legacyTotalPages = 1
      for (const legacyPayload of legacyPayloads) {
        legacyItems.push(...(Array.isArray(legacyPayload?.items) ? legacyPayload.items.map(normalizeLegacyActivity) : []))
        legacyTotalPages = typeof legacyPayload?.totalPages === 'number' ? legacyPayload.totalPages : legacyTotalPages
      }
      const legacyFiltered = legacyItems.filter((entry) => {
        if (filterTypes.length > 0 && !filterTypes.includes(entry.interactionType)) return false
        const dateOnly = toDateOnly(entry.occurredAt ?? entry.scheduledAt)
        if ((filterDateFrom || filterDateTo) && !dateOnly) return false
        if (filterDateFrom && dateOnly < filterDateFrom) return false
        if (filterDateTo && dateOnly > filterDateTo) return false
        if (lowercaseSearchTerm && !matchesLoadedActivity(entry, lowercaseSearchTerm)) return false
        return true
      })

      // Merge and deduplicate by id, sort newest first
      const seen = new Set<string>()
      const merged: InteractionSummary[] = []
      for (const item of [...canonicalItems, ...legacyFiltered]) {
        if (!seen.has(item.id)) {
          seen.add(item.id)
          merged.push(item)
        }
      }
      setActivities(sortHistoryActivities(merged, sortMode))
      setHasMore(canonicalHasMore || legacyTotalPages > loadedPages)
    } catch (error) {
      if (isStale()) return
      logger.error('customers.activities.history failed', { err: error })
      getTelemetryRuntime()?.reportError(error, { module: 'customers', code: 'customers.activity_history_load_failed' })
      setLoadFailed(true)
      setActivities([])
      setHasMore(false)
    } finally {
      if (!isStale()) setLoading(false)
    }
  }, [dealId, entityId, excludeInteractionType, filterDateFrom, filterDateTo, filterTypes, loadedPages, useCanonicalInteractions, refreshKey, serverHistoryControls, serverSearchTerm, sortMode])

  React.useEffect(() => {
    setLoadedPages(1)
  }, [dealId, entityId, filterDateFrom, filterDateTo, filterTypes, useCanonicalInteractions])

  const handleMarkDone = React.useCallback(async (activityId: string) => {
    try {
      const operation = () =>
        apiCallOrThrow('/api/customers/interactions/complete', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: activityId, occurredAt: new Date().toISOString() }),
        })
      if (runGuardedMutation) {
        await runGuardedMutation(operation, {
          id: activityId,
          status: 'done',
          operation: 'completeActivity',
        })
      } else {
        await operation()
      }
      flash(t('customers.activities.actions.markDoneSuccess', 'Activity marked done'), 'success')
      await loadActivities()
    } catch (err) {
      logger.warn('Mark done failed', { component: 'ActivitiesSection', activityId, err })
      flash(t('customers.activities.actions.markDoneError', 'Could not mark activity as done'), 'error')
      return
    }
    try {
      await Promise.resolve(onDataRefresh?.())
    } catch (err) {
      logger.warn('Parent refresh after mark done failed', { component: 'ActivitiesSection', activityId, err })
    }
  }, [loadActivities, onDataRefresh, runGuardedMutation, t])

  const resolvedUserIdsRef = React.useRef(new Set<string>())

  // Resolve missing author names from user IDs
  React.useEffect(() => {
    loadActivities()
      .then(() => { resolvedUserIdsRef.current = new Set() })
      .catch((err) => logger.warn('loadActivities failed', { component: 'ActivitiesSection', err }))
  }, [loadActivities])

  React.useEffect(() => {
    const unresolvedIds = new Set<string>()
    for (const a of activities) {
      if (a.authorUserId && !a.authorName && !resolvedUserIdsRef.current.has(a.authorUserId)) {
        unresolvedIds.add(a.authorUserId)
      }
    }
    if (unresolvedIds.size === 0) return

    const controller = new AbortController()
    resolveAuthorUserNames([...unresolvedIds], controller.signal)
      .then(({ names: nameMap, resolvedIds }) => {
        if (controller.signal.aborted) return
        // Only ids the server actually answered for are remembered. Marking an id whose request
        // failed — or one the server silently dropped past its `?ids=` cap — would leave that
        // author blank for the life of the component, even though the next attempt would work.
        for (const uid of resolvedIds) resolvedUserIdsRef.current.add(uid)
        if (nameMap.size > 0) {
          setActivities((prev) =>
            prev.map((a) => {
              if (a.authorUserId && !a.authorName && nameMap.has(a.authorUserId)) {
                return { ...a, authorName: nameMap.get(a.authorUserId) ?? null }
              }
              return a
            }),
          )
        }
      })
      .catch((err) => logger.warn('resolve author names failed', { component: 'ActivitiesSection', err }))
    return () => controller.abort()
  }, [activities])

  const totalCount = activities.length
  const visibleCount = visibleActivities.length

  return (
    <div className="flex flex-col gap-3.5 rounded-[10px] border border-border bg-card pt-4 pb-[18px] px-[18px]">
      <div className="flex items-center gap-2">
        <Clock className="size-[15px] text-muted-foreground" />
        <h3 className="text-[13px] font-semibold text-foreground">
          {entityName
            ? t('customers.timeline.history.title', 'Interaction history with {{name}}', { name: entityName })
            : t('customers.timeline.history.titleGeneric', 'Interaction history')}
        </h3>
      </div>

      <label className="relative flex items-center">
        <Search className="pointer-events-none absolute left-2.5 size-5 text-muted-foreground" aria-hidden />
        <input
          ref={searchInputRef}
          type="search"
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          placeholder={t('customers.timeline.history.searchPlaceholder', 'Search...')}
          aria-label={t('customers.timeline.history.searchAriaLabel', 'Search interaction history')}
          className="h-9 w-full rounded-[10px] border border-border bg-card pl-9 pr-14 text-sm text-foreground shadow-xs placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden"
        />
        <Kbd className="pointer-events-none absolute right-2 hidden text-[11px] uppercase tracking-[0.48px] sm:inline-flex">
          ⌘1
        </Kbd>
      </label>

      <ActivityTimelineFilters
        entityId={entityId}
        activeTypes={filterTypes}
        dateFrom={filterDateFrom}
        dateTo={filterDateTo}
        onTypesChange={setFilterTypes}
        onDateFromChange={setFilterDateFrom}
        onDateToChange={setFilterDateTo}
        onReset={() => {
          setFilterTypes([])
          setFilterDateFrom('')
          setFilterDateTo('')
        }}
        sortControl={serverHistoryControls ? (
          <Select
            value={sortMode}
            onValueChange={(value) => {
              setSortMode(value as HistorySortMode)
              setLoadedPages(1)
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
        ) : undefined}
      />

      {loading && totalCount === 0 ? (
        <div className="rounded-lg border border-dashed border-border/70 px-4 py-8 text-sm text-muted-foreground">
          {t('customers.people.detail.activities.loading', 'Loading activities…')}
        </div>
      ) : loadFailed ? (
        <ErrorMessage
          label={t('customers.activities.loadFailed', 'Failed to load activities.')}
          action={(
            <Button type="button" variant="outline" size="sm" onClick={() => { void loadActivities() }}>
              {t('customers.activities.retry', 'Retry')}
            </Button>
          )}
        />
      ) : (
        <>
          <ActivityTimeline
            activities={visibleActivities}
            onEdit={onEditActivity}
            onMarkDone={handleMarkDone}
          />
          {totalCount > 0 || hasMore ? (
            <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-3">
              <span className="text-xs text-muted-foreground">
                {searchTerm.trim()
                  ? t('customers.activities.seeMatching', 'Showing {visible} of {total} activities', {
                      visible: visibleCount,
                      total: totalCount,
                    })
                  : t('customers.activities.seeAll', 'See all {count} activities', { count: totalCount })}
              </span>
              {hasMore ? (
                <Button type="button" variant="link" size="sm" onClick={() => setLoadedPages((value) => value + 1)}>
                  {t('customers.activities.loadMore', 'Load more')}
                </Button>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}

export default ActivitiesSection
