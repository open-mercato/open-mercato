import * as React from 'react'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import type { InteractionSummary } from '../../../../../components/detail/types'
import { useInteractionMutations } from '../../../../../components/detail/hooks/useInteractionMutations'
import type { GuardedMutationRunner } from './types'

type UseDealActivitiesOptions = {
  dealId: string
  runMutationWithContext: GuardedMutationRunner
}

type UseDealActivitiesResult = {
  plannedActivities: InteractionSummary[]
  activityRefreshKey: number
  loadPlannedActivities: () => Promise<void>
  handleActivityCreated: () => Promise<void>
  handleMarkDone: (interactionId: string) => Promise<void>
  handleCancelActivity: (interactionId: string) => Promise<void>
}

export function useDealActivities({
  dealId,
  runMutationWithContext,
}: UseDealActivitiesOptions): UseDealActivitiesResult {
  const [plannedActivities, setPlannedActivities] = React.useState<InteractionSummary[]>([])
  const [activityRefreshKey, setActivityRefreshKey] = React.useState(0)

  const loadPlannedActivities = React.useCallback(async () => {
    if (!dealId) return
    try {
      const result = await readApiResultOrThrow<{ items?: InteractionSummary[] }>(
        `/api/customers/interactions?dealId=${encodeURIComponent(dealId)}&status=planned&excludeInteractionType=task&limit=100&sortField=scheduledAt&sortDir=asc`,
      )
      setPlannedActivities(Array.isArray(result.items) ? result.items : [])
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
