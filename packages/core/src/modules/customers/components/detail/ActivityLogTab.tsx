'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { SectionAction, TabEmptyStateConfig } from '@open-mercato/ui/backend/detail'
import type { ActivityKind } from './ActivitiesAddNewMenu'
import { ActivitiesSection } from './ActivitiesSection'
import { InlineActivityComposer } from './InlineActivityComposer'
import { PlannedActivitiesSection } from './PlannedActivitiesSection'
import type { InteractionSummary } from './types'

type GuardedMutationRunner = <T,>(
  operation: () => Promise<T>,
  mutationPayload?: Record<string, unknown>,
) => Promise<T>

export type ActivityLogTabEntityType = 'person' | 'company'

type ActivityLogTabProps = {
  /** Record kind that owns the activities; drives the composer payload and the default labels. */
  entityType?: ActivityLogTabEntityType
  entityId: string
  entityName?: string | null
  plannedActivities: InteractionSummary[]
  plannedLoadFailed?: boolean
  onRetryPlannedLoad?: () => void
  onActivityCreated?: () => void
  onScheduleRequested: () => void
  /** @deprecated The per-type "Add new" menu was replaced by the shared composer and its Schedule action (#7494); the prop is ignored. Remove after one minor cycle. */
  onAddActivity?: (kind: ActivityKind) => void
  onMarkDone?: (id: string) => void | Promise<void>
  onEditActivity: (activity: InteractionSummary) => void
  onCancelActivity?: (id: string) => void | Promise<void>
  /**
   * Guarded-mutation runner from the parent page. When provided, composer saves and
   * per-row mutations route through `useGuardedMutation` so the global injection
   * contract and retry-last-mutation context apply.
   */
  runGuardedMutation?: GuardedMutationRunner
  refreshKey?: number
  useCanonicalInteractions?: boolean
  /** @deprecated Planned rows no longer render a company subtitle (#7494); the prop is ignored. Remove after one minor cycle. */
  entityCompanyName?: string | null
  addActionLabel?: string
  emptyState?: TabEmptyStateConfig
  onActionChange?: (action: SectionAction | null) => void
}

/**
 * Shared Activities tab for person and company detail pages. It mirrors the
 * deal detail layout: inline composer, planned activities, then the filterable
 * history timeline, all scoped to the owning record.
 */
export function ActivityLogTab({
  entityType = 'company',
  entityId,
  entityName,
  plannedActivities,
  plannedLoadFailed,
  onRetryPlannedLoad,
  onActivityCreated,
  onScheduleRequested,
  onMarkDone,
  onEditActivity,
  onCancelActivity,
  runGuardedMutation,
  refreshKey = 0,
  useCanonicalInteractions = false,
  addActionLabel,
  emptyState,
  onActionChange,
}: ActivityLogTabProps) {
  const t = useT()
  const defaultAddActionLabel = entityType === 'person'
    ? t('customers.people.detail.activities.add', 'Log activity')
    : t('customers.companies.detail.activities.add', 'Log activity')
  const defaultEmptyState = React.useMemo<TabEmptyStateConfig>(() => entityType === 'person'
    ? {
      title: t('customers.people.detail.emptyState.activities.title', 'No activities logged yet'),
      actionLabel: t('customers.people.detail.emptyState.activities.action', 'Log activity'),
    }
    : {
      title: t('customers.companies.detail.emptyState.activities.title', 'No activities logged yet'),
      actionLabel: t('customers.companies.detail.emptyState.activities.action', 'Log activity'),
    }, [entityType, t])

  return (
    <div className="space-y-4">
      <InlineActivityComposer
        entityType={entityType}
        entityId={entityId}
        onActivityCreated={onActivityCreated}
        runGuardedMutation={runGuardedMutation}
        onScheduleRequested={onScheduleRequested}
        useCanonicalInteractions={useCanonicalInteractions}
      />
      <PlannedActivitiesSection
        activities={plannedActivities}
        loadFailed={plannedLoadFailed}
        onRetryLoad={onRetryPlannedLoad}
        onComplete={onMarkDone ? (interactionId) => { void onMarkDone(interactionId) } : undefined}
        onSchedule={onScheduleRequested}
        onEdit={onEditActivity}
        onCancel={onCancelActivity ? (interactionId) => { void onCancelActivity(interactionId) } : undefined}
      />
      <ActivitiesSection
        entityId={entityId}
        entityName={entityName}
        useCanonicalInteractions={useCanonicalInteractions}
        runGuardedMutation={runGuardedMutation}
        onDataRefresh={onActivityCreated}
        refreshKey={refreshKey}
        addActionLabel={addActionLabel ?? defaultAddActionLabel}
        emptyState={emptyState ?? defaultEmptyState}
        onActionChange={onActionChange}
        onEditActivity={onEditActivity}
        serverHistoryControls
      />
    </div>
  )
}

export default ActivityLogTab
