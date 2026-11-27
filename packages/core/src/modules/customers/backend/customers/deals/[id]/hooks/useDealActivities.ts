import {
  usePlannedActivities,
  type LoadPlannedActivitiesOptions,
  type UsePlannedActivitiesResult,
} from '../../../../../components/detail/hooks/usePlannedActivities'
import type { GuardedMutationRunner } from './types'

export type { LoadPlannedActivitiesOptions }

type UseDealActivitiesOptions = {
  dealId: string
  runMutationWithContext: GuardedMutationRunner
}

export type UseDealActivitiesResult = UsePlannedActivitiesResult

export function useDealActivities({
  dealId,
  runMutationWithContext,
}: UseDealActivitiesOptions): UseDealActivitiesResult {
  return usePlannedActivities({
    scope: { dealId },
    runMutationWithContext,
    logContext: 'customers.deals.detail',
  })
}
