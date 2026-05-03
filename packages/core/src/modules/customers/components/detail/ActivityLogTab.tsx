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
  onActivityCreated: () => void
  onScheduleRequested: () => void
  onAddActivity?: (kind: ActivityKind) => void
  onMarkDone: (id: string) => void
  onEditActivity: (activity: InteractionSummary) => void
  onCancelActivity: (id: string) => void
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
  refreshKey = 0,
  useCanonicalInteractions = false,
  entityCompanyName,
}: ActivityLogTabProps) {
  const handleAddNew = (kind: ActivityKind) => {
    if (onAddActivity) onAddActivity(kind)
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
      />
    </div>
  )
}

export default ActivityLogTab
