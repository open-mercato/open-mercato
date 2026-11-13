'use client'

import * as React from 'react'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { TERMINAL_INTERACTION_STATUS_LIST } from '../../../lib/interactionStatus'
import type { InteractionSummary } from '../types'
import { useInteractionMutations, type GuardedMutationRunner } from './useInteractionMutations'

const logger = createLogger('customers')

/** Which record owns the planned list: a deal (its linked interactions) or a person/company. */
export type PlannedActivitiesScope = { dealId: string } | { entityId: string }

export type LoadPlannedActivitiesOptions = {
  cache?: boolean
}

export type UsePlannedActivitiesOptions = {
  scope: PlannedActivitiesScope
  runMutationWithContext: GuardedMutationRunner
  logContext: string
  /** Runs after a planned activity was created, completed or cancelled (page counts, header, …). */
  onAfterChange?: () => void | Promise<void>
}

export type UsePlannedActivitiesResult = {
  plannedActivities: InteractionSummary[]
  /** The last read failed. `plannedActivities` then still holds what the last good read returned. */
  plannedLoadFailed: boolean
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

export function plannedActivitiesUrl(scope: PlannedActivitiesScope): string {
  const scopeParam = 'dealId' in scope
    ? `dealId=${encodeURIComponent(scope.dealId)}`
    : `entityId=${encodeURIComponent(scope.entityId)}`
  const excludedStatuses = TERMINAL_INTERACTION_STATUS_LIST.map(encodeURIComponent).join(',')
  return `/api/customers/interactions?${scopeParam}&excludeStatus=${excludedStatuses}&excludeInteractionType=task&limit=100&sortField=scheduledAt&sortDir=asc`
}

function fetchPlannedActivities(url: string, useCache: boolean): Promise<InteractionSummary[]> {
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

/**
 * Open (non-terminal, non-task) activities of one record plus the shared complete/cancel
 * mutations and the refresh key the history timeline listens to. Deal, person
 * and company detail pages all drive the same activity layout through it.
 */
export function usePlannedActivities({
  scope,
  runMutationWithContext,
  logContext,
  onAfterChange,
}: UsePlannedActivitiesOptions): UsePlannedActivitiesResult {
  const [plannedActivities, setPlannedActivities] = React.useState<InteractionSummary[]>([])
  const [plannedLoadFailed, setPlannedLoadFailed] = React.useState(false)
  const [activityRefreshKey, setActivityRefreshKey] = React.useState(0)
  const latestLoadRef = React.useRef(0)
  const scopeId = 'dealId' in scope ? scope.dealId : scope.entityId
  const scopeKind = 'dealId' in scope ? 'dealId' : 'entityId'
  const url = React.useMemo(
    () => (scopeId ? plannedActivitiesUrl(scopeKind === 'dealId' ? { dealId: scopeId } : { entityId: scopeId }) : null),
    [scopeId, scopeKind],
  )

  React.useEffect(() => {
    latestLoadRef.current += 1
    setPlannedActivities([])
    setPlannedLoadFailed(false)
  }, [url])

  const loadPlannedActivities = React.useCallback(async (options: LoadPlannedActivitiesOptions = {}) => {
    if (!url) return
    const loadId = ++latestLoadRef.current
    try {
      const items = await fetchPlannedActivities(url, options.cache === true)
      if (loadId !== latestLoadRef.current) return
      setPlannedActivities(items)
      setPlannedLoadFailed(false)
    } catch (err) {
      if (loadId !== latestLoadRef.current) return
      logger.error('load planned activities failed', { component: logContext, err })
      getTelemetryRuntime()?.reportError(err, { module: 'customers', code: 'customers.planned_activities_load_failed' })
      setPlannedLoadFailed(true)
    }
  }, [logContext, url])

  const handleActivityCreated = React.useCallback(async () => {
    setActivityRefreshKey((value) => value + 1)
    await loadPlannedActivities()
    await onAfterChange?.()
  }, [loadPlannedActivities, onAfterChange])

  const { completeInteraction, cancelInteraction } = useInteractionMutations({
    runMutationWithContext,
    onAfterChange: handleActivityCreated,
    logContext,
  })

  const versionOf = React.useCallback(
    (interactionId: string) => plannedActivities.find((activity) => activity.id === interactionId)?.updatedAt ?? null,
    [plannedActivities],
  )
  const handleMarkDone = React.useCallback(
    (interactionId: string) => completeInteraction(interactionId, versionOf(interactionId)),
    [completeInteraction, versionOf],
  )
  const handleCancelActivity = React.useCallback(
    (interactionId: string) => cancelInteraction(interactionId, versionOf(interactionId)),
    [cancelInteraction, versionOf],
  )

  return {
    plannedActivities,
    plannedLoadFailed,
    activityRefreshKey,
    loadPlannedActivities,
    handleActivityCreated,
    handleMarkDone,
    handleCancelActivity,
  }
}
