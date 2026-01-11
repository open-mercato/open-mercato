"use client"

import * as React from 'react'
import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { resolveTodoApiPath } from '../utils'
import type { TodoLinkSummary } from '../types'
import { generateTempId } from '@open-mercato/core/modules/customers/lib/detailHelpers'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'

const DEFAULT_TODO_SOURCE = 'example:todo'

type CustomerTodoRow = {
  id: string
  todoId: string
  todoSource: string
  todoTitle: string | null
  todoIsDone: boolean | null
  todoPriority: number | null
  todoSeverity: string | null
  todoDescription: string | null
  todoDueAt: string | null
  todoCustomValues: Record<string, unknown> | null
  todoOrganizationId: string | null
  organizationId: string
  tenantId: string
  createdAt: string
}

type CustomerTodosResponse = {
  items: CustomerTodoRow[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export type TaskFormPayload = {
  base: {
    title: string
    is_done?: boolean
  }
  custom: Record<string, unknown>
}

export type UsePersonTasksOptions = {
  entityId: string | null
  initialTasks?: TodoLinkSummary[]
  pageSize?: number
}

export type UsePersonTasksResult = {
  tasks: TodoLinkSummary[]
  isInitialLoading: boolean
  isLoadingMore: boolean
  isMutating: boolean
  hasMore: boolean
  loadMore: () => Promise<void>
  refresh: () => Promise<void>
  createTask: (payload: TaskFormPayload) => Promise<void>
  updateTask: (task: TodoLinkSummary, payload: TaskFormPayload) => Promise<void>
  toggleTask: (task: TodoLinkSummary, nextIsDone: boolean) => Promise<void>
  unlinkTask: (task: TodoLinkSummary) => Promise<void>
  pendingTaskId: string | null
  totalCount: number
  error: string | null
}

function mapRowToSummary(row: CustomerTodoRow): TodoLinkSummary {
  return {
    id: row.id,
    todoId: row.todoId,
    todoSource: row.todoSource || DEFAULT_TODO_SOURCE,
    createdAt: row.createdAt,
    title: row.todoTitle ?? null,
    isDone: row.todoIsDone ?? null,
    priority: row.todoPriority ?? null,
    severity: row.todoSeverity ?? null,
    description: row.todoDescription ?? null,
    dueAt: row.todoDueAt ?? null,
    todoOrganizationId: row.todoOrganizationId ?? null,
    customValues: row.todoCustomValues ?? null,
  }
}

function mergeUnique(existing: TodoLinkSummary[], incoming: TodoLinkSummary[]): TodoLinkSummary[] {
  if (!existing.length) return incoming
  if (!incoming.length) return existing
  const byId = new Map<string, TodoLinkSummary>()
  const result: TodoLinkSummary[] = []
  for (const item of existing) {
    byId.set(item.id, item)
    result.push(item)
  }
  for (const item of incoming) {
    if (byId.has(item.id)) {
      const index = result.findIndex((entry) => entry.id === item.id)
      if (index !== -1) result[index] = item
    } else {
      byId.set(item.id, item)
      result.push(item)
    }
  }
  return result
}

function normalizeBoolean(value: unknown): boolean | undefined {
  if (value === null || value === undefined) return undefined
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const parsed = parseBooleanToken(value)
    return parsed === null ? undefined : parsed
  }
  return undefined
}

function normalizeNumber(value: unknown): number | null | undefined {
  if (value === null || value === undefined || value === '') return undefined
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed.length) return undefined
    const parsed = Number(trimmed)
    if (!Number.isNaN(parsed)) return parsed
  }
  return null
}

function normalizeString(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return undefined
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length ? trimmed : null
  }
  return String(value)
}

export function usePersonTasks({
  entityId,
  initialTasks = [],
  pageSize = 20,
}: UsePersonTasksOptions): UsePersonTasksResult {
  const [tasks, setTasks] = React.useState<TodoLinkSummary[]>(initialTasks)
  const [pageInfo, setPageInfo] = React.useState<{ page: number; totalPages: number; total: number }>({
    page: 1,
    totalPages: 1,
    total: initialTasks.length,
  })
  const [isInitialLoading, setIsInitialLoading] = React.useState<boolean>(() => Boolean(entityId))
  const [isLoadingMore, setIsLoadingMore] = React.useState(false)
  const [isMutating, setIsMutating] = React.useState(false)
  const [pendingTaskId, setPendingTaskId] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const mapResponse = React.useCallback((payload: CustomerTodosResponse) => {
    const mapped = Array.isArray(payload.items) ? payload.items.map(mapRowToSummary) : []
    setPageInfo({
      page: payload.page ?? 1,
      totalPages: payload.totalPages ?? 1,
      total: payload.total ?? mapped.length,
    })
    setError(null)
    return mapped
  }, [])

  const fetchPage = React.useCallback(
    async (page: number): Promise<CustomerTodosResponse> => {
      if (!entityId) {
        return {
          items: [],
          total: 0,
          page: 1,
          pageSize,
          totalPages: 1,
        }
      }
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        entityId,
      })
      return readApiResultOrThrow<CustomerTodosResponse>(
        `/api/customers/todos?${params.toString()}`,
        undefined,
        { errorMessage: 'Failed to load tasks.' },
      )
    },
    [entityId, pageSize],
  )

  const refresh = React.useCallback(async () => {
    if (!entityId) {
      setTasks([])
      setPageInfo({ page: 1, totalPages: 1, total: 0 })
      return
    }
    setIsInitialLoading(true)
    try {
      const payload = await fetchPage(1)
      const mapped = mapResponse(payload)
      setTasks(mapped)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load tasks.'
      setError(message)
      throw err
    } finally {
      setIsInitialLoading(false)
    }
  }, [entityId, fetchPage, mapResponse])

  const loadMore = React.useCallback(async () => {
    if (!entityId) return
    if (isLoadingMore) return
    if (pageInfo.page >= pageInfo.totalPages) return
    setIsLoadingMore(true)
    try {
      const payload = await fetchPage(pageInfo.page + 1)
      const mapped = mapResponse(payload)
      setTasks((prev) => mergeUnique(prev, mapped))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load tasks.'
      setError(message)
      throw err
    } finally {
      setIsLoadingMore(false)
    }
  }, [entityId, fetchPage, isLoadingMore, mapResponse, pageInfo.page, pageInfo.totalPages])

  React.useEffect(() => {
    if (!entityId) {
      setTasks([])
      setPageInfo({ page: 1, totalPages: 1, total: 0 })
      setError(null)
      setIsInitialLoading(false)
      return
    }
    setTasks(initialTasks)
    setPageInfo({
      page: 1,
      totalPages: 1,
      total: initialTasks.length,
    })
    setError(null)
    let cancelled = false
    setIsInitialLoading(true)
    fetchPage(1)
      .then((payload) => {
        if (cancelled) return
        const mapped = mapResponse(payload)
        setTasks(mapped)
      })
      .catch((err) => {
        if (cancelled) return
        const message = err instanceof Error ? err.message : 'Failed to load tasks.'
        setError(message)
      })
      .finally(() => {
        if (!cancelled) setIsInitialLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [entityId, initialTasks, fetchPage, mapResponse])

  const createTask = React.useCallback(
    async ({ base, custom }: TaskFormPayload) => {
      if (!entityId) throw new Error('Task creation requires an entity id')
      setIsMutating(true)
      try {
        const payload: Record<string, unknown> = {
          entityId,
          title: base.title,
        }
        const normalizedDone = normalizeBoolean(base.is_done)
        if (normalizedDone !== undefined) payload.isDone = normalizedDone
        if (Object.keys(custom).length) payload.todoCustom = custom

        const response = await apiCallOrThrow<{ linkId?: string; todoId?: string }>(
          '/api/customers/todos',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          },
          { errorMessage: 'Failed to create task.' },
        )
        const body = response.result ?? {}
        const linkId = typeof body.linkId === 'string' && body.linkId.length ? body.linkId : generateTempId()
        const todoId = typeof body.todoId === 'string' && body.todoId.length ? body.todoId : generateTempId()
        const createdAt = new Date().toISOString()
        const customValues = Object.keys(custom).length ? { ...custom } : null
        const priority = normalizeNumber(custom.priority)
        const severity = normalizeString(custom.severity) ?? null
        const description = normalizeString(custom.description) ?? null
        const newTask: TodoLinkSummary = {
          id: linkId,
          todoId,
          todoSource: DEFAULT_TODO_SOURCE,
          createdAt,
          title: base.title,
          isDone: normalizedDone ?? false,
          priority: priority === undefined ? null : priority,
          severity,
          description,
          dueAt: normalizeString(custom.due_at) ?? normalizeString(custom.dueAt) ?? null,
          todoOrganizationId: null,
          customValues,
        }
        setTasks((prev) => [newTask, ...prev])
        setPageInfo((prev) => ({
          page: 1,
          totalPages: prev.totalPages,
          total: prev.total + 1,
        }))
        await refresh()
      } finally {
        setIsMutating(false)
      }
    },
    [entityId, refresh],
  )

  const updateTask = React.useCallback(
    async (task: TodoLinkSummary, { base, custom }: TaskFormPayload) => {
      if (!task.todoId) throw new Error('Task is missing todo id')
      const apiPath = resolveTodoApiPath(task.todoSource || DEFAULT_TODO_SOURCE)
      if (!apiPath) throw new Error('Unsupported task source')
      setIsMutating(true)
      try {
        const body: Record<string, unknown> = {
          id: task.todoId,
        }
        if (typeof base.title === 'string' && base.title.trim().length) {
          body.title = base.title.trim()
        }
        const normalizedDone = normalizeBoolean(base.is_done)
        if (normalizedDone !== undefined) body.is_done = normalizedDone
        if (Object.keys(custom).length) {
          body.customFields = custom
        }
        await apiCallOrThrow(
          apiPath,
          {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          },
          { errorMessage: 'Failed to update task.' },
        )
        setTasks((prev) =>
          prev.map((item) => {
            if (item.id !== task.id) return item
            const nextCustomValues = { ...(item.customValues ?? {}) }
            for (const [key, value] of Object.entries(custom)) {
              nextCustomValues[key] = value === undefined ? null : value
            }
            return {
              ...item,
              title: typeof base.title === 'string' && base.title.trim().length ? base.title.trim() : item.title,
              isDone: normalizedDone !== undefined ? normalizedDone : item.isDone,
              priority: normalizeNumber(custom.priority) ?? (custom.priority === undefined ? item.priority ?? null : null),
              severity: normalizeString(custom.severity) ?? (custom.severity === undefined ? item.severity ?? null : null),
              description:
                normalizeString(custom.description) ?? (custom.description === undefined ? item.description ?? null : null),
              dueAt:
                normalizeString(custom.due_at) ??
                normalizeString(custom.dueAt) ??
                (custom.due_at === undefined && custom.dueAt === undefined ? item.dueAt ?? null : null),
              customValues: Object.keys(nextCustomValues).length ? nextCustomValues : null,
            }
          }),
        )
      } finally {
        setIsMutating(false)
      }
    },
    [],
  )

  const toggleTask = React.useCallback(
    async (task: TodoLinkSummary, nextIsDone: boolean) => {
      if (!task.todoId) {
        throw new Error('Task is missing todo id')
      }
      const apiPath = resolveTodoApiPath(task.todoSource || DEFAULT_TODO_SOURCE)
      if (!apiPath) {
        throw new Error('Unsupported task source')
      }
      setPendingTaskId(task.todoId)
      try {
        await updateTask(task, { base: { title: task.title ?? '', is_done: nextIsDone }, custom: {} })
      } finally {
        setPendingTaskId(null)
      }
    },
    [updateTask],
  )

  const unlinkTask = React.useCallback(
    async (task: TodoLinkSummary) => {
      if (!task.id) throw new Error('Task link id missing')
      setIsMutating(true)
    try {
      await apiCallOrThrow(
        '/api/customers/todos',
        {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: task.id }),
        },
        { errorMessage: 'Failed to remove task.' },
      )
        setTasks((prev) => prev.filter((item) => item.id !== task.id))
        setPageInfo((prev) => ({
          page: prev.page,
          totalPages: prev.totalPages,
          total: Math.max(0, prev.total - 1),
        }))
      } finally {
        setIsMutating(false)
      }
    },
    [],
  )

  const hasMore = entityId != null && pageInfo.page < pageInfo.totalPages

  return {
    tasks,
    isInitialLoading,
    isLoadingMore,
    isMutating,
    hasMore,
    loadMore,
    refresh,
    createTask,
    updateTask,
    toggleTask,
    unlinkTask,
    pendingTaskId,
    totalCount: pageInfo.total,
    error,
  }
}
