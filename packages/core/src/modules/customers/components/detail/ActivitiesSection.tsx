"use client"

import * as React from 'react'
import { Clock } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import type { SectionAction, TabEmptyStateConfig } from '@open-mercato/ui/backend/detail'
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
  const [activities, setActivities] = React.useState<InteractionSummary[]>([])
  const [loading, setLoading] = React.useState(false)

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

      const canonicalPayload = await readApiResultOrThrow<{ items?: InteractionSummary[] }>(
        `/api/customers/interactions?${canonicalParams.toString()}`,
      ).catch(() => ({ items: [] as InteractionSummary[] }))
      const canonicalItems = Array.isArray(canonicalPayload?.items) ? canonicalPayload.items : []

      if (useCanonicalInteractions) {
        setActivities(sortTimelineActivities(canonicalItems))
        return
      }

      // In legacy mode, also fetch legacy activities and merge with canonical
      const legacyParams = new URLSearchParams({
        entityId,
        pageSize: '50',
        sortField: 'occurredAt',
        sortDir: 'desc',
      })
      if (dealId) legacyParams.set('dealId', dealId)
      const legacyPayload = await readApiResultOrThrow<{ items?: ActivitySummary[] }>(
        `/api/customers/activities?${legacyParams.toString()}`,
      ).catch(() => ({ items: [] as ActivitySummary[] }))
      const legacyItems = Array.isArray(legacyPayload?.items) ? legacyPayload.items.map(normalizeLegacyActivity) : []
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
    } catch (error) {
      console.error('customers.activities.history failed', error)
      setActivities([])
    } finally {
      setLoading(false)
    }
  }, [dealId, entityId, filterDateFrom, filterDateTo, filterTypes, useCanonicalInteractions, refreshKey])

  const resolvedUserIdsRef = React.useRef(new Set<string>())

  // Resolve missing author names from user IDs
  React.useEffect(() => {
    loadActivities()
      .then(() => { resolvedUserIdsRef.current = new Set() })
      .catch(() => {})
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
      .catch(() => {})
    return () => controller.abort()
  }, [activities])

  return (
    <div className="rounded-[18px] border border-border/70 bg-card p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Clock className="size-4 text-muted-foreground" />
          <h3 className="text-base font-semibold text-foreground">
            {entityName
              ? t('customers.timeline.history.title', 'Interaction history with {{name}}', { name: entityName })
              : t('customers.timeline.history.titleGeneric', 'Interaction history')}
          </h3>
        </div>
      </div>

      <div className="mb-4">
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
      </div>

      {loading && activities.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/70 px-4 py-8 text-sm text-muted-foreground">
          {t('customers.people.detail.activities.loading', 'Loading activities…')}
        </div>
      ) : (
        <>
          <ActivityTimeline activities={activities} onEdit={onEditActivity} />
          {activities.length > 0 && (
            <div className="border-t px-5 py-3">
              <span className="text-xs text-muted-foreground">
                {t('customers.activities.seeAll', 'See all {count} activities', { count: activities.length })}
              </span>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default ActivitiesSection
