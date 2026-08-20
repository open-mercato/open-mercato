"use client"

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import {
  readItems,
  readString,
  readTotal,
  sortByPosition,
  toBoardStatus,
  type BoardApiRow,
  type BoardStatus,
} from './kanbanBoardData'

/**
 * The lookups every board surface needs — statuses, the caller's own staff member,
 * assignee names and tag labels — behind one set of query keys.
 *
 * They live here rather than inside `KanbanBoard` so the filter chips, the flat list
 * view and the board all read the *same* react-query entries. Two components asking for
 * the project's statuses must not produce two requests, and a status renamed in one
 * place must not stay stale in another.
 */

export const BOARD_QUERY_ROOT = ['staff', 'time-tracking', 'board'] as const

export const BOARD_PAGE_SIZE = 50
export const BOARD_DIRECTORY_PAGE_SIZE = 100

export type BoardSelf = {
  id: string
  displayName: string | null
}

export type BoardTagOption = {
  id: string
  label: string
}

export function boardStatusesQueryKey(scopeVersion: number, timeProjectId: string) {
  return [...BOARD_QUERY_ROOT, 'statuses', `scope:${scopeVersion}`, `project:${timeProjectId}`]
}

export function boardColumnQueryKey(
  scopeVersion: number,
  timeProjectId: string,
  statusId: string,
  pages: number,
  filterKey: string,
) {
  return [
    ...BOARD_QUERY_ROOT,
    'column',
    `scope:${scopeVersion}`,
    `project:${timeProjectId}`,
    `status:${statusId}`,
    `pages:${pages}`,
    `filters:${filterKey}`,
  ]
}

export function boardSelfQueryKey(scopeVersion: number) {
  return [...BOARD_QUERY_ROOT, 'self', `scope:${scopeVersion}`]
}

export type TaskPageResult = { items: BoardApiRow[]; total: number }

/**
 * Pulls up to `maxPages` pages of the tasks list, stopping as soon as the server has
 * nothing more to give. Shared by the column queries and the flat list so both agree on
 * what "one more page" means.
 */
export async function fetchTaskPages(
  params: (page: number) => string,
  maxPages: number,
): Promise<TaskPageResult> {
  const items: BoardApiRow[] = []
  let total = 0
  for (let page = 1; page <= maxPages; page += 1) {
    const call = await apiCall<Record<string, unknown>>(`/api/staff/timesheets/tasks?${params(page)}`)
    if (!call.ok) throw new Error('[internal] task page request failed')
    const pageItems = readItems(call.result)
    total = readTotal(call.result, items.length + pageItems.length)
    items.push(...pageItems)
    if (pageItems.length < BOARD_PAGE_SIZE || items.length >= total) break
  }
  return { items, total }
}

export function useBoardStatuses(timeProjectId: string) {
  const scopeVersion = useOrganizationScopeVersion()
  return useQuery<BoardStatus[]>({
    queryKey: boardStatusesQueryKey(scopeVersion, timeProjectId),
    staleTime: 30_000,
    queryFn: async () => {
      const call = await apiCall<Record<string, unknown>>(
        `/api/staff/timesheets/task-statuses?timeProjectId=${encodeURIComponent(timeProjectId)}&page=1&pageSize=${BOARD_DIRECTORY_PAGE_SIZE}&sortField=position&sortDir=asc`,
      )
      if (!call.ok) throw new Error('[internal] task-statuses request failed')
      const statuses = readItems(call.result)
        .map(toBoardStatus)
        .filter((status): status is BoardStatus => status !== null)
      return sortByPosition(statuses)
    },
  })
}

/**
 * The caller's own staff member — the identity behind "Przypisane do mnie" and the
 * avatar the chip draws.
 */
export function useBoardSelf() {
  const scopeVersion = useOrganizationScopeVersion()
  return useQuery<BoardSelf | null>({
    queryKey: boardSelfQueryKey(scopeVersion),
    staleTime: 300_000,
    queryFn: async () => {
      const call = await apiCall<{ member?: { id?: string | null; displayName?: string | null } | null }>(
        '/api/staff/team-members/self',
      )
      if (!call.ok) return null
      const id = call.result?.member?.id ?? null
      if (!id) return null
      return { id, displayName: call.result?.member?.displayName ?? null }
    },
  })
}

/** Display names for the assignees a surface is about to render. */
export function useAssigneeNames(assigneeIds: readonly string[]) {
  const scopeVersion = useOrganizationScopeVersion()
  const ids = React.useMemo(() => Array.from(new Set(assigneeIds)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)), [assigneeIds])
  return useQuery<Map<string, string>>({
    queryKey: [...BOARD_QUERY_ROOT, 'assignees', `scope:${scopeVersion}`, ids.join(',')],
    enabled: ids.length > 0,
    staleTime: 300_000,
    queryFn: async () => {
      const call = await apiCall<Record<string, unknown>>(
        `/api/staff/team-members?ids=${ids.map(encodeURIComponent).join(',')}&pageSize=${BOARD_DIRECTORY_PAGE_SIZE}`,
      )
      const names = new Map<string, string>()
      if (!call.ok) return names
      for (const row of readItems(call.result)) {
        const id = readString(row, 'id')
        if (!id) continue
        names.set(id, readString(row, 'display_name', 'displayName') ?? id)
      }
      return names
    },
  })
}

/** Labels for the tags a surface is about to render. */
export function useTagLabels(tagIds: readonly string[]) {
  const scopeVersion = useOrganizationScopeVersion()
  const ids = React.useMemo(() => Array.from(new Set(tagIds)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)), [tagIds])
  return useQuery<Map<string, string>>({
    queryKey: [...BOARD_QUERY_ROOT, 'tags', `scope:${scopeVersion}`, ids.join(',')],
    enabled: ids.length > 0,
    staleTime: 300_000,
    queryFn: async () => {
      const call = await apiCall<Record<string, unknown>>(
        `/api/staff/timesheets/tags?ids=${ids.map(encodeURIComponent).join(',')}&pageSize=${BOARD_DIRECTORY_PAGE_SIZE}`,
      )
      const labels = new Map<string, string>()
      if (!call.ok) return labels
      for (const row of readItems(call.result)) {
        const id = readString(row, 'id')
        if (!id) continue
        labels.set(id, readString(row, 'label') ?? id)
      }
      return labels
    },
  })
}

/** Every tag in the organization — the option list behind the "Tag" filter. */
export function useTagDirectory(enabled: boolean) {
  const scopeVersion = useOrganizationScopeVersion()
  return useQuery<BoardTagOption[]>({
    queryKey: [...BOARD_QUERY_ROOT, 'tag-directory', `scope:${scopeVersion}`],
    enabled,
    staleTime: 300_000,
    queryFn: async () => {
      const call = await apiCall<Record<string, unknown>>(
        `/api/staff/timesheets/tags?page=1&pageSize=${BOARD_DIRECTORY_PAGE_SIZE}&sortField=label&sortDir=asc`,
      )
      if (!call.ok) return []
      return readItems(call.result)
        .map((row) => {
          const id = readString(row, 'id')
          if (!id) return null
          return { id, label: readString(row, 'label') ?? id }
        })
        .filter((tag): tag is BoardTagOption => tag !== null)
    },
  })
}

/** The people who can be picked as an assignee filter. */
export function useStaffMemberDirectory(enabled: boolean) {
  const scopeVersion = useOrganizationScopeVersion()
  return useQuery<Array<{ id: string; displayName: string }>>({
    queryKey: [...BOARD_QUERY_ROOT, 'member-directory', `scope:${scopeVersion}`],
    enabled,
    staleTime: 300_000,
    queryFn: async () => {
      const call = await apiCall<Record<string, unknown>>(
        `/api/staff/team-members?page=1&pageSize=${BOARD_DIRECTORY_PAGE_SIZE}&sortField=displayName&sortDir=asc`,
      )
      if (!call.ok) return []
      return readItems(call.result)
        .map((row) => {
          const id = readString(row, 'id')
          if (!id) return null
          return { id, displayName: readString(row, 'display_name', 'displayName') ?? id }
        })
        .filter((member): member is { id: string; displayName: string } => member !== null)
    },
  })
}
