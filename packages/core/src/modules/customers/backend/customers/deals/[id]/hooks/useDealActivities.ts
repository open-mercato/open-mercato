import * as React from 'react'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { InteractionSummary } from '../../../../../components/detail/types'
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
  const t = useT()
  const [plannedActivities, setPlannedActivities] = React.useState<InteractionSummary[]>([])
  const [activityRefreshKey, setActivityRefreshKey] = React.useState(0)

  const loadPlannedActivities = React.useCallback(async () => {
    if (!dealId) return
    try {
      const result = await readApiResultOrThrow<{ items?: InteractionSummary[] }>(
        `/api/customers/interactions?dealId=${encodeURIComponent(dealId)}&status=planned&excludeInteractionType=task&limit=100&sortField=scheduledAt&sortDir=asc`,
      )
      setPlannedActivities(Array.isArray(result.items) ? result.items : [])
    } catch {
      setPlannedActivities([])
    }
  }, [dealId])

  const handleActivityCreated = React.useCallback(async () => {
    setActivityRefreshKey((value) => value + 1)
    await loadPlannedActivities()
  }, [loadPlannedActivities])

  const handleMarkDone = React.useCallback(
    async (interactionId: string) => {
      try {
        await runMutationWithContext(
          () =>
            apiCallOrThrow('/api/customers/interactions/complete', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ id: interactionId, occurredAt: new Date().toISOString() }),
            }),
          { id: interactionId, status: 'done', operation: 'completeActivity' },
        )
        flash(t('customers.timeline.planned.completed', 'Activity completed'), 'success')
        await handleActivityCreated()
      } catch {
        flash(t('customers.timeline.planned.error', 'Failed to complete activity'), 'error')
      }
    },
    [handleActivityCreated, runMutationWithContext, t],
  )

  const handleCancelActivity = React.useCallback(
    async (interactionId: string) => {
      try {
        await runMutationWithContext(
          () =>
            apiCallOrThrow('/api/customers/interactions', {
              method: 'PUT',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ id: interactionId, status: 'canceled' }),
            }),
          { id: interactionId, status: 'canceled', operation: 'cancelActivity' },
        )
        flash(t('customers.timeline.planned.canceled', 'Activity canceled'), 'success')
        await handleActivityCreated()
      } catch {
        flash(t('customers.timeline.planned.cancelError', 'Failed to cancel activity'), 'error')
      }
    },
    [handleActivityCreated, runMutationWithContext, t],
  )

  return {
    plannedActivities,
    activityRefreshKey,
    loadPlannedActivities,
    handleActivityCreated,
    handleMarkDone,
    handleCancelActivity,
  }
}
