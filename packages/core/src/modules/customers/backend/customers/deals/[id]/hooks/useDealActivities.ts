import * as React from 'react'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import type { InteractionSummary } from '../../../../../components/detail/types'
import { useInteractionMutations } from '../../../../../components/detail/hooks/useInteractionMutations'
import type { GuardedMutationRunner } from './types'

type LoadPlannedActivitiesOptions = {
  cache?: boolean
}

type UseDealActivitiesOptions = {
  dealId: string
  runMutationWithContext: GuardedMutationRunner
}

type UseDealActivitiesResult = {
  plannedActivities: InteractionSummary[]
  activityRefreshKey: number
  loadPlannedActivities: (options?: LoadPlannedActivitiesOptions) => Promise<void>
  handleActivityCreated: () => Promise<void>
  handleMarkDone: (interactionId: string) => Promise<void>
  handleCancelActivity: (interactionId: string) => Promise<void>
}

type PlannedActivitiesCacheEntry = {
  promise: Promise<InteractionSummary[]>
}

const plannedActivitiesCache = new Map<string, PlannedActivitiesCacheEntry>()

function fetchPlannedActivities(dealId: string, useCache: boolean): Promise<InteractionSummary[]> {
  const url = `/api/customers/interactions?dealId=${encodeURIComponent(dealId)}&status=planned&excludeInteractionType=task&limit=100&sortField=scheduledAt&sortDir=asc`
  const cached = plannedActivitiesCache.get(url)
  if (useCache && cached) return cached.promise
  const entry: PlannedActivitiesCacheEntry = {
    promise: readApiResultOrThrow<{ items?: InteractionSummary[] }>(url)
      .then((result) => (Array.isArray(result.items) ? result.items : [])),
  }
  if (useCache) plannedActivitiesCache.set(url, entry)
  return entry.promise.finally(() => {
    if (plannedActivitiesCache.get(url) === entry) plannedActivitiesCache.delete(url)
  })
}

export function useDealActivities({
  dealId,
  runMutationWithContext,
}: UseDealActivitiesOptions): UseDealActivitiesResult {
  const [plannedActivities, setPlannedActivities] = React.useState<InteractionSummary[]>([])
  const [activityRefreshKey, setActivityRefreshKey] = React.useState(0)

  const loadPlannedActivities = React.useCallback(async (options: LoadPlannedActivitiesOptions = {}) => {
    if (!dealId) return
    try {
      const items = await fetchPlannedActivities(dealId, options.cache === true)
      setPlannedActivities(items)
    } catch (err) {
      console.warn('[customers.deals.detail] load planned activities failed', err)
      setPlannedActivities([])
    }
  }, [dealId])

  const handleActivityCreated = React.useCallback(async () => {
    setActivityRefreshKey((value) => value + 1)
    await loadPlannedActivities()
  }, [loadPlannedActivities])

  const { completeInteraction, cancelInteraction } = useInteractionMutations({
    runMutationWithContext,
    onAfterChange: handleActivityCreated,
    logContext: 'customers.deals.detail',
  })

  return {
    plannedActivities,
    activityRefreshKey,
    loadPlannedActivities,
    handleActivityCreated,
    handleMarkDone: completeInteraction,
    handleCancelActivity: cancelInteraction,
  }
}
