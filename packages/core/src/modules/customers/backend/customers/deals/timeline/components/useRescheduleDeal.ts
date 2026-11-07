"use client"

import * as React from 'react'
import { useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query'
import { apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { translateWithFallback } from '@open-mercato/shared/lib/i18n/translate'
import { bucketIndexFor, compareDateKeys, toUtcDateKey } from '../../../../../lib/dealsTimeline'
import type {
  DealTimelineCell,
  DealTimelineItem,
  DealTimelineResponse,
} from '../../../../../lib/dealsTimelineTypes'

export const TIMELINE_QUERY_ROOT = ['customers', 'deals', 'timeline'] as const

export type TimelineDealLocation = {
  laneKey: string
  column: number
  position: number
}

export function compareTimelineItems(left: DealTimelineItem, right: DealTimelineItem): number {
  const leftDate = toUtcDateKey(left.expectedCloseAt) ?? ''
  const rightDate = toUtcDateKey(right.expectedCloseAt) ?? ''
  const byDate = compareDateKeys(leftDate, rightDate)
  if (byDate !== 0) return byDate
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
}

export function findTimelineDeal(
  data: DealTimelineResponse | null | undefined,
  dealId: string,
): (TimelineDealLocation & { item: DealTimelineItem }) | null {
  if (!data) return null
  for (const lane of data.lanes) {
    for (const cell of lane.cells) {
      const position = cell.items.findIndex((item) => item.id === dealId)
      if (position >= 0) {
        return { laneKey: lane.key, column: cell.column, position, item: cell.items[position] }
      }
    }
  }
  return null
}

function adjustCell(cells: DealTimelineCell[], column: number, update: (cell: DealTimelineCell) => DealTimelineCell): DealTimelineCell[] {
  return cells.map((cell) => (cell.column === column ? update(cell) : cell))
}

export function moveDealInTimeline(
  data: DealTimelineResponse,
  dealId: string,
  expectedCloseAt: string,
): DealTimelineResponse {
  const source = findTimelineDeal(data, dealId)
  if (!source) return data
  const movedItem: DealTimelineItem = { ...source.item, expectedCloseAt }
  const targetColumn = bucketIndexFor(expectedCloseAt, data.columns)
  if (targetColumn === source.column) {
    const lanes = data.lanes.map((lane) =>
      lane.key !== source.laneKey
        ? lane
        : {
            ...lane,
            cells: adjustCell(lane.cells, source.column, (cell) => ({
              ...cell,
              items: cell.items.map((item) => (item.id === dealId ? movedItem : item)).sort(compareTimelineItems),
            })),
          },
    )
    return { ...data, lanes }
  }
  const lanes = data.lanes.map((lane) => {
    if (lane.key !== source.laneKey) return lane
    let cells = adjustCell(lane.cells, source.column, (cell) => ({
      ...cell,
      total: Math.max(0, cell.total - 1),
      items: cell.items.filter((item) => item.id !== dealId),
    }))
    if (targetColumn >= 0) {
      const hasTarget = cells.some((cell) => cell.column === targetColumn)
      if (!hasTarget) cells = [...cells, { column: targetColumn, total: 0, partial: false, items: [] }]
      cells = adjustCell(cells, targetColumn, (cell) => ({
        ...cell,
        total: cell.total + 1,
        items: [...cell.items, movedItem].sort(compareTimelineItems),
      }))
      cells = cells.slice().sort((left, right) => left.column - right.column)
    }
    return { ...lane, cells, total: targetColumn >= 0 ? lane.total : Math.max(0, lane.total - 1) }
  })
  const columns = data.columns.map((column) => {
    if (column.index === source.column) return { ...column, total: Math.max(0, column.total - 1) }
    if (column.index === targetColumn) return { ...column, total: column.total + 1 }
    return column
  })
  return { ...data, lanes, columns }
}

export function restoreDealInTimeline(
  data: DealTimelineResponse,
  original: TimelineDealLocation & { item: DealTimelineItem },
): DealTimelineResponse {
  if (findTimelineDeal(data, original.item.id)) {
    const restored = moveDealInTimeline(data, original.item.id, original.item.expectedCloseAt ?? '')
    const lanes = restored.lanes.map((lane) =>
      lane.key !== original.laneKey
        ? lane
        : {
            ...lane,
            cells: lane.cells.map((cell) => ({
              ...cell,
              items: cell.items.map((entry) => (entry.id === original.item.id ? original.item : entry)),
            })),
          },
    )
    return { ...restored, lanes }
  }
  if (!data.lanes.some((lane) => lane.key === original.laneKey)) return data
  const lanes = data.lanes.map((lane) => {
    if (lane.key !== original.laneKey) return lane
    const hasCell = lane.cells.some((cell) => cell.column === original.column)
    const cells = (hasCell ? lane.cells : [...lane.cells, { column: original.column, total: 0, partial: false, items: [] }])
      .map((cell) =>
        cell.column === original.column
          ? { ...cell, total: cell.total + 1, items: [...cell.items, original.item].sort(compareTimelineItems) }
          : cell,
      )
      .sort((left, right) => left.column - right.column)
    return { ...lane, cells, total: lane.total + 1 }
  })
  const columns = data.columns.map((column) =>
    column.index === original.column ? { ...column, total: column.total + 1 } : column,
  )
  return { ...data, lanes, columns }
}

export type RescheduleRequest = {
  item: Pick<DealTimelineItem, 'id' | 'updatedAt'>
  expectedCloseAt: string
}

export type RescheduleOutcome = 'success' | 'conflict' | 'error'

export type RescheduleDeps = {
  queryKey: QueryKey
  getData: (key: QueryKey) => DealTimelineResponse | undefined
  setData: (key: QueryKey, data: DealTimelineResponse | undefined) => void
  cancel?: (key: QueryKey) => Promise<void>
  send: (request: RescheduleRequest) => Promise<unknown>
  isConflict: (error: unknown) => boolean
  onError: (error: unknown) => void
}

export async function runReschedule(deps: RescheduleDeps, request: RescheduleRequest): Promise<RescheduleOutcome> {
  if (deps.cancel) await deps.cancel(deps.queryKey)
  const snapshot = deps.getData(deps.queryKey)
  const original = findTimelineDeal(snapshot, request.item.id)
  if (snapshot) deps.setData(deps.queryKey, moveDealInTimeline(snapshot, request.item.id, request.expectedCloseAt))
  try {
    await deps.send(request)
    return 'success'
  } catch (error) {
    const current = deps.getData(deps.queryKey)
    if (current && original) deps.setData(deps.queryKey, restoreDealInTimeline(current, original))
    if (deps.isConflict(error)) return 'conflict'
    deps.onError(error)
    return 'error'
  }
}

type RescheduleMutationContext = {
  formId: string
  resourceKind: string
  resourceId: string
  retryLastMutation: () => Promise<boolean>
}

const RESCHEDULE_CONTEXT_ID = 'customers-deals-timeline:reschedule'

export function writeTimelineCacheLocally(
  queryClient: QueryClient,
  key: QueryKey,
  data: DealTimelineResponse | undefined,
): void {
  const updatedAt = queryClient.getQueryState(key)?.dataUpdatedAt
  queryClient.setQueryData(key, data, updatedAt ? { updatedAt } : undefined)
}

export function useRescheduleDeal(queryKey: QueryKey) {
  const t = useT()
  const queryClient = useQueryClient()
  const { runMutation, retryLastMutation } = useGuardedMutation<RescheduleMutationContext>({
    contextId: RESCHEDULE_CONTEXT_ID,
    blockedMessage: translateWithFallback(t, 'ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  return React.useCallback(
    async (
      request: RescheduleRequest,
      options?: { onSettled?: (outcome: RescheduleOutcome) => void },
    ): Promise<RescheduleOutcome> => {
      const errorMessage = translateWithFallback(
        t,
        'customers.deals.timeline.reschedule.error',
        'Could not change the close date.',
      )
      const outcome = await runReschedule(
        {
          queryKey,
          getData: (key) => queryClient.getQueryData<DealTimelineResponse>(key),
          setData: (key, data) => writeTimelineCacheLocally(queryClient, key, data),
          cancel: (key) => queryClient.cancelQueries({ queryKey: key }),
          send: ({ item, expectedCloseAt }) =>
            runMutation({
              operation: () =>
                withScopedApiRequestHeaders(buildOptimisticLockHeader(item.updatedAt), () =>
                  apiCallOrThrow(
                    '/api/customers/deals',
                    {
                      method: 'PUT',
                      headers: { 'content-type': 'application/json' },
                      body: JSON.stringify({ id: item.id, expectedCloseAt }),
                    },
                    { errorMessage },
                  ),
                ),
              context: {
                formId: RESCHEDULE_CONTEXT_ID,
                resourceKind: 'customers.deal',
                resourceId: item.id,
                retryLastMutation,
              },
              mutationPayload: { id: item.id, expectedCloseAt },
            }),
          isConflict: (error) => surfaceRecordConflict(error, t),
          onError: (error) => {
            const message = error instanceof Error && error.message ? error.message : errorMessage
            flash(message, 'error')
          },
        },
        request,
      )
      options?.onSettled?.(outcome)
      await queryClient.invalidateQueries({ queryKey: TIMELINE_QUERY_ROOT })
      return outcome
    },
    [queryClient, queryKey, retryLastMutation, runMutation, t],
  )
}
