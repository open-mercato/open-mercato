'use client'

import { InlineActivityComposer } from './InlineActivityComposer'
import { PlannedActivitiesSection } from './PlannedActivitiesSection'
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
  onMarkDone: (id: string) => void
  onEditActivity: (activity: InteractionSummary) => void
  onCancelActivity: (id: string) => void
  runGuardedMutation?: GuardedMutationRunner
  refreshKey?: number
  useCanonicalInteractions?: boolean
}

export function ActivityLogTab({
  entityId,
  plannedActivities,
  onActivityCreated,
  onScheduleRequested,
  onMarkDone,
  onEditActivity,
  onCancelActivity,
  runGuardedMutation,
  refreshKey = 0,
  useCanonicalInteractions = false,
}: ActivityLogTabProps) {
  return (
    <div className="space-y-4">
      <InlineActivityComposer
        entityType="company"
        entityId={entityId}
        onActivityCreated={onActivityCreated}
        runGuardedMutation={runGuardedMutation}
        onScheduleRequested={onScheduleRequested}
        useCanonicalInteractions={useCanonicalInteractions}
      />

      <PlannedActivitiesSection
        activities={plannedActivities}
        onComplete={onMarkDone}
        onSchedule={onScheduleRequested}
        onEdit={onEditActivity}
        onCancel={onCancelActivity}
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
