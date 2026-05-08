'use client'

import { ActivitiesCard } from './ActivitiesCard'
import type { ActivityKind } from './ActivitiesAddNewMenu'
import { ActivityHistorySection } from './ActivityHistorySection'
import type { InteractionSummary } from './types'

type GuardedMutationRunner = <T,>(
  operation: () => Promise<T>,
  mutationPayload?: Record<string, unknown>,
) => Promise<T>

type ActivityLogTabProps = {
  entityId: string
  plannedActivities: InteractionSummary[]
  /** @deprecated No longer used after the ActivitiesCard refactor. Kept optional for callers; remove after one minor cycle. */
  onActivityCreated?: () => void
  onScheduleRequested: () => void
  onAddActivity?: (kind: ActivityKind, selectedDate?: Date) => void
  /** @deprecated No longer used after the ActivitiesCard refactor. Kept optional for callers; remove after one minor cycle. */
  onMarkDone?: (id: string) => void
  onEditActivity: (activity: InteractionSummary) => void
  /** @deprecated No longer used after the ActivitiesCard refactor. Kept optional for callers; remove after one minor cycle. */
  onCancelActivity?: (id: string) => void
  /**
   * Guarded-mutation runner from the parent page. When provided, per-row mutations
   * (e.g. ActivityCard "Mark done") route through `useGuardedMutation` so the global
   * injection contract and retry-last-mutation context apply.
   */
  runGuardedMutation?: GuardedMutationRunner
  refreshKey?: number
  useCanonicalInteractions?: boolean
  /** Optional parent-entity company name; surfaces in planned event subtitles when no deal is set. */
  entityCompanyName?: string | null
}

export function ActivityLogTab({
  entityId,
  plannedActivities,
  onScheduleRequested,
  onAddActivity,
  onEditActivity,
  runGuardedMutation,
  refreshKey = 0,
  useCanonicalInteractions = false,
  entityCompanyName,
}: ActivityLogTabProps) {
  const handleAddNew = (kind: ActivityKind, selectedDate?: Date) => {
    if (onAddActivity) onAddActivity(kind, selectedDate)
    else onScheduleRequested()
  }

  return (
    <div className="space-y-4">
      <ActivitiesCard
        entityId={entityId}
        plannedActivities={plannedActivities}
        refreshKey={refreshKey}
        onAddNew={handleAddNew}
        onEditActivity={onEditActivity}
        entityCompanyName={entityCompanyName}
      />

      <ActivityHistorySection
        entityId={entityId}
        useCanonicalInteractions={useCanonicalInteractions}
        refreshKey={refreshKey}
        onEditActivity={onEditActivity}
        runMutation={runGuardedMutation}
      />
    </div>
  )
}

export default ActivityLogTab
