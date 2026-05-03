"use client"

import * as React from 'react'
import { Clock, Search } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import type { SectionAction, TabEmptyStateConfig } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import { Kbd } from '@open-mercato/ui/primitives/kbd'
import { ActivityTimelineFilters } from './ActivityTimelineFilters'
import { ActivityTimeline } from './ActivityTimeline'
import type { ActivitySummary, InteractionSummary } from './types'

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
}

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

    const leftTime = left.occurredAt ?? left.createdAt
    const rightTime = right.occurredAt ?? right.createdAt
    const compare = rightTime.localeCompare(leftTime)
    if (compare !== 0) return compare
    return right.id.localeCompare(left.id)
  })
}

export function ActivitiesSection({
  entityId,
  entityName,
  dealId,
  useCanonicalInteractions = false,
  onActionChange,
  onLoadingChange,
  refreshKey = 0,
  onEditActivity,
}: ActivitiesSectionProps) {
  const t = useT()
  const [filterTypes, setFilterTypes] = React.useState<string[]>([])
  const [filterDateFrom, setFilterDateFrom] = React.useState('')
  const [filterDateTo, setFilterDateTo] = React.useState('')
  const [searchTerm, setSearchTerm] = React.useState('')
  const [activities, setActivities] = React.useState<InteractionSummary[]>([])
  const [loading, setLoading] = React.useState(false)
  const [hasMore, setHasMore] = React.useState(false)
  const [loadedPages, setLoadedPages] = React.useState(1)
  const searchInputRef = React.useRef<HTMLInputElement>(null)

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

  const visibleActivities = React.useMemo(() => {
    const term = searchTerm.trim().toLowerCase()
    if (!term) return activities
    return activities.filter((activity) => {
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
      return haystack.includes(term)
    })
  }, [activities, searchTerm])

  React.useEffect(() => {
    onActionChange?.(null)
    return () => onActionChange?.(null)
  }, [onActionChange])

  React.useEffect(() => {
    onLoadingChange?.(loading)
  }, [loading, onLoadingChange])

  const loadActivities = React.useCallback(async () => {
    if (!entityId) {
      setActivities([])
      return
    }

    setLoading(true)
    try {
      // Always fetch canonical interactions (new activities are always created here)
      const canonicalParams = new URLSearchParams({
        entityId,
        limit: '50',
        sortField: 'occurredAt',
        sortDir: 'desc',
        excludeInteractionType: 'task',
      })
      if (dealId) canonicalParams.set('dealId', dealId)
      if (filterTypes.length > 0) canonicalParams.set('type', filterTypes.join(','))
      if (filterDateFrom) canonicalParams.set('from', filterDateFrom)
      if (filterDateTo) canonicalParams.set('to', filterDateTo)

      const canonicalItems: InteractionSummary[] = []
      let canonicalCursor: string | undefined
      let canonicalHasMore = false
      let pageIndex = 0
      do {
        const params = new URLSearchParams(canonicalParams)
        if (canonicalCursor) params.set('cursor', canonicalCursor)
        const canonicalPayload = await readApiResultOrThrow<{ items?: InteractionSummary[]; nextCursor?: string }>(
          `/api/customers/interactions?${params.toString()}`,
        ).catch(() => ({ items: [] as InteractionSummary[], nextCursor: undefined }))
        canonicalItems.push(...(Array.isArray(canonicalPayload?.items) ? canonicalPayload.items : []))
        canonicalCursor = typeof canonicalPayload?.nextCursor === 'string' ? canonicalPayload.nextCursor : undefined
        canonicalHasMore = Boolean(canonicalCursor)
        pageIndex += 1
      } while (canonicalCursor && pageIndex < loadedPages)

      if (useCanonicalInteractions) {
        setActivities(sortTimelineActivities(canonicalItems))
        setHasMore(canonicalHasMore)
        return
      }

      // In legacy mode, also fetch legacy activities and merge with canonical
      const legacyItems: InteractionSummary[] = []
      let legacyTotalPages = 1
      for (let legacyPage = 1; legacyPage <= loadedPages; legacyPage += 1) {
        const legacyParams = new URLSearchParams({
          entityId,
          page: String(legacyPage),
          pageSize: '50',
          sortField: 'occurredAt',
          sortDir: 'desc',
        })
        if (dealId) legacyParams.set('dealId', dealId)
        const legacyPayload = await readApiResultOrThrow<{ items?: ActivitySummary[]; totalPages?: number }>(
          `/api/customers/activities?${legacyParams.toString()}`,
        ).catch(() => ({ items: [] as ActivitySummary[], totalPages: 1 }))
        legacyItems.push(...(Array.isArray(legacyPayload?.items) ? legacyPayload.items.map(normalizeLegacyActivity) : []))
        legacyTotalPages = typeof legacyPayload?.totalPages === 'number' ? legacyPayload.totalPages : legacyTotalPages
      }
      const legacyFiltered = legacyItems.filter((entry) => {
        if (filterTypes.length > 0 && !filterTypes.includes(entry.interactionType)) return false
        const dateOnly = toDateOnly(entry.occurredAt ?? entry.createdAt)
        if (filterDateFrom && dateOnly < filterDateFrom) return false
        if (filterDateTo && dateOnly > filterDateTo) return false
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
      setActivities(sortTimelineActivities(merged))
      setHasMore(canonicalHasMore || legacyTotalPages > loadedPages)
    } catch (error) {
      console.error('customers.activities.history failed', error)
      flash(t('customers.activities.loadFailed', 'Failed to load activities.'), 'error')
      setActivities([])
      setHasMore(false)
    } finally {
      setLoading(false)
    }
  }, [dealId, entityId, filterDateFrom, filterDateTo, filterTypes, loadedPages, useCanonicalInteractions, refreshKey, t])

  React.useEffect(() => {
    setLoadedPages(1)
  }, [dealId, entityId, filterDateFrom, filterDateTo, filterTypes, useCanonicalInteractions])

  const resolvedUserIdsRef = React.useRef(new Set<string>())

  // Resolve missing author names from user IDs
  React.useEffect(() => {
    loadActivities()
      .then(() => { resolvedUserIdsRef.current = new Set() })
      .catch((err) => console.warn('[ActivitiesSection] loadActivities failed', err))
  }, [loadActivities])

  React.useEffect(() => {
    const unresolvedIds = new Set<string>()
    for (const a of activities) {
      if (a.authorUserId && !a.authorName && !resolvedUserIdsRef.current.has(a.authorUserId)) {
        unresolvedIds.add(a.authorUserId)
      }
    }
    if (unresolvedIds.size === 0) return

    for (const uid of unresolvedIds) resolvedUserIdsRef.current.add(uid)

    const controller = new AbortController()
    readApiResultOrThrow<{ items?: Array<Record<string, unknown>> }>(
      `/api/auth/users?ids=${[...unresolvedIds].join(',')}`,
      { signal: controller.signal },
    )
      .then((data) => {
        const users = Array.isArray(data?.items) ? data.items : []
        const nameMap = new Map<string, string>()
        for (const user of users) {
          const userId = typeof user.id === 'string' ? user.id : null
          const name = typeof user.display_name === 'string' && user.display_name.trim()
            ? user.display_name.trim()
            : typeof user.email === 'string'
              ? user.email
              : null
          if (userId && name) nameMap.set(userId, name)
        }
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
      .catch((err) => console.warn('[ActivitiesSection] resolve author names failed', err))
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
      />

      {loading && totalCount === 0 ? (
        <div className="rounded-lg border border-dashed border-border/70 px-4 py-8 text-sm text-muted-foreground">
          {t('customers.people.detail.activities.loading', 'Loading activities…')}
        </div>
      ) : (
        <>
          <ActivityTimeline activities={visibleActivities} onEdit={onEditActivity} />
          {totalCount > 0 ? (
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
