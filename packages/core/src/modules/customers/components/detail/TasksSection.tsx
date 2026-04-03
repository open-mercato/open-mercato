"use client"

import * as React from 'react'
import Link from 'next/link'
import { Loader2, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { LoadingMessage, TabEmptyState } from '@open-mercato/ui/backend/detail'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { InteractionSummary, SectionAction, TabEmptyStateConfig, TodoLinkSummary, Translator } from './types'
import { createTranslatorWithFallback } from '@open-mercato/shared/lib/i18n/translate'
import { formatDate, resolveTodoHref } from './utils'
import { formatDateTime } from '@open-mercato/shared/lib/time'
import { TimelineItemHeader } from './TimelineItemHeader'
import { TaskDialog } from './TaskDialog'
import { usePersonTasks, type TaskFormPayload } from './hooks/usePersonTasks'
import { useInteractions, type InteractionCreatePayload } from './hooks/useInteractions'
import { mapInteractionRecordToTodoSummary } from '../../lib/interactionCompatibility'

type GuardedMutationRunner = <T>(
  operation: () => Promise<T>,
  mutationPayload?: Record<string, unknown>,
) => Promise<T>

type TasksSectionProps = {
  entityId: string | null
  initialTasks: TodoLinkSummary[]
  emptyLabel: string
  addActionLabel: string
  emptyState: TabEmptyStateConfig
  onActionChange?: (action: SectionAction | null) => void
  onLoadingChange?: (isLoading: boolean) => void
  onDataRefresh?: () => void
  translator?: Translator
  entityName?: string | null
  dialogContextKey?: string
  dialogContextFallback?: string
  /** When true, use the canonical interactions API instead of the legacy todos API. */
  useCanonicalInteractions?: boolean
  runGuardedMutation?: GuardedMutationRunner
}

const RESERVED_TASK_CUSTOM_KEYS = new Set(['priority', 'description', 'due_at', 'dueAt'])

function toTimestamp(value: string | null | undefined): number | null {
  if (!value) return null
  const timestamp = new Date(value).getTime()
  return Number.isNaN(timestamp) ? null : timestamp
}

function sortTaskSummaries(tasks: TodoLinkSummary[]): TodoLinkSummary[] {
  return [...tasks].sort((left, right) => {
    const leftDue = toTimestamp(left.dueAt)
    const rightDue = toTimestamp(right.dueAt)
    if (leftDue !== null || rightDue !== null) {
      if (leftDue === null) return 1
      if (rightDue === null) return -1
      if (leftDue !== rightDue) return leftDue - rightDue
    }
    const leftCreated = toTimestamp(left.createdAt) ?? 0
    const rightCreated = toTimestamp(right.createdAt) ?? 0
    if (leftCreated !== rightCreated) return rightCreated - leftCreated
    return left.id.localeCompare(right.id)
  })
}

function buildInitialFormValues(task: TodoLinkSummary | null): Record<string, unknown> | undefined {
  if (!task) return undefined
  const values: Record<string, unknown> = {
    title: task.title ?? '',
    is_done: task.isDone ?? false,
    description: task.description ?? '',
    priority: task.priority ?? '',
    scheduledAt: task.dueAt ?? '',
  }
  if (task.customValues) {
    for (const [key, value] of Object.entries(task.customValues)) {
      if (RESERVED_TASK_CUSTOM_KEYS.has(key)) continue
      const formKey = `cf_${key}`
      if (values[formKey] === undefined) values[formKey] = value
    }
  }
  return values
}

export function TasksSection({
  entityId,
  initialTasks,
  emptyLabel,
  addActionLabel,
  emptyState,
  onActionChange,
  onLoadingChange,
  onDataRefresh,
  translator,
  entityName,
  dialogContextKey,
  dialogContextFallback,
  useCanonicalInteractions = false,
  runGuardedMutation,
}: TasksSectionProps) {
  const tHook = useT()
  const fallbackTranslator = React.useMemo<Translator>(() => createTranslatorWithFallback(tHook), [tHook])
  const t: Translator = React.useMemo(() => translator ?? fallbackTranslator, [translator, fallbackTranslator])
  const runWriteMutation = React.useCallback(
    async <T,>(operation: () => Promise<T>, mutationPayload?: Record<string, unknown>): Promise<T> => {
      if (!runGuardedMutation) {
        return operation()
      }
      return runGuardedMutation(operation, mutationPayload)
    },
    [runGuardedMutation],
  )

  // Legacy path: usePersonTasks (default)
  const legacyResult = usePersonTasks({ entityId, initialTasks })

  // Canonical path: useInteractions with planned-status filter
  const canonicalResult = useInteractions({
    entityId: useCanonicalInteractions ? entityId : null,
    typeFilter: 'task',
  })

  // Map canonical interactions to the TodoLinkSummary shape used by the rendering below
  const canonicalTasks = React.useMemo<TodoLinkSummary[]>(
    () => (useCanonicalInteractions ? canonicalResult.interactions.map(mapInteractionRecordToTodoSummary) : []),
    [useCanonicalInteractions, canonicalResult.interactions],
  )

  const canonicalCreateTask = React.useCallback(
    async (payload: TaskFormPayload) => {
      if (!entityId) throw new Error('Task creation requires an entity id')
      const interactionPayload: InteractionCreatePayload = {
        entityId,
        interactionType: 'task',
        title: payload.base.title,
        status: payload.base.is_done ? 'done' : 'planned',
        priority: payload.base.priority ?? null,
        body: payload.base.description ?? null,
        scheduledAt: payload.base.scheduledAt ?? null,
        customValues: payload.custom,
      }
      await canonicalResult.createInteraction(interactionPayload)
    },
    [canonicalResult, entityId],
  )

  const canonicalUpdateTask = React.useCallback(
    async (task: TodoLinkSummary, payload: TaskFormPayload) => {
      await canonicalResult.updateInteraction(task.todoId, {
        title: payload.base.title,
        status: payload.base.is_done ? 'done' : 'planned',
        priority: payload.base.priority ?? null,
        body: payload.base.description ?? null,
        scheduledAt: payload.base.scheduledAt ?? null,
        customValues: payload.custom,
      })
    },
    [canonicalResult],
  )

  const canonicalToggleTask = React.useCallback(
    async (task: TodoLinkSummary, nextIsDone: boolean) => {
      if (nextIsDone) {
        await canonicalResult.completeInteraction(task.todoId)
      } else {
        // Reopen: set status back to planned via update
        await canonicalResult.updateInteraction(task.todoId, { status: 'planned' })
      }
    },
    [canonicalResult],
  )

  const canonicalUnlinkTask = React.useCallback(
    async (task: TodoLinkSummary) => {
      await canonicalResult.deleteInteraction(task.todoId)
    },
    [canonicalResult],
  )

  // Unified interface: pick the active data source based on the flag
  const tasks = useCanonicalInteractions ? canonicalTasks : legacyResult.tasks
  const isInitialLoading = useCanonicalInteractions ? canonicalResult.isInitialLoading : legacyResult.isInitialLoading
  const isLoadingMore = useCanonicalInteractions ? canonicalResult.isLoadingMore : legacyResult.isLoadingMore
  const isMutating = useCanonicalInteractions ? canonicalResult.isMutating : legacyResult.isMutating
  const hasMore = useCanonicalInteractions ? canonicalResult.hasMore : legacyResult.hasMore
  const loadMore = useCanonicalInteractions ? canonicalResult.loadMore : legacyResult.loadMore
  const refresh = useCanonicalInteractions ? canonicalResult.refresh : legacyResult.refresh
  const createTask = useCanonicalInteractions ? canonicalCreateTask : legacyResult.createTask
  const updateTask = useCanonicalInteractions ? canonicalUpdateTask : legacyResult.updateTask
  const toggleTask = useCanonicalInteractions ? canonicalToggleTask : legacyResult.toggleTask
  const unlinkTask = useCanonicalInteractions ? canonicalUnlinkTask : legacyResult.unlinkTask
  const pendingTaskId = useCanonicalInteractions ? canonicalResult.pendingId : legacyResult.pendingTaskId
  const error = useCanonicalInteractions ? canonicalResult.error : legacyResult.error
  const sortedTasks = React.useMemo(() => sortTaskSummaries(tasks), [tasks])

  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [dialogMode, setDialogMode] = React.useState<'create' | 'edit'>('create')
  const [editingTask, setEditingTask] = React.useState<TodoLinkSummary | null>(null)
  const sentinelRef = React.useRef<HTMLDivElement | null>(null)

  const dialogContextMessage = React.useMemo(() => {
    if (!dialogContextKey || !entityName) return undefined
    return t(dialogContextKey, dialogContextFallback ?? 'This task will be linked to {{name}}', { name: entityName })
  }, [dialogContextFallback, dialogContextKey, entityName, t])

  const openCreateDialog = React.useCallback(() => {
    setEditingTask(null)
    setDialogMode('create')
    setDialogOpen(true)
  }, [])

  const openEditDialog = React.useCallback((task: TodoLinkSummary) => {
    setEditingTask(task)
    setDialogMode('edit')
    setDialogOpen(true)
  }, [])

  const closeDialog = React.useCallback(() => {
    setDialogOpen(false)
    setEditingTask(null)
  }, [])

  React.useEffect(() => {
    if (!onActionChange) return
    if (!entityId) {
      onActionChange(null)
      return
    }
    onActionChange({
      label: addActionLabel,
      onClick: openCreateDialog,
      disabled: isMutating,
    })
    return () => {
      onActionChange(null)
    }
  }, [addActionLabel, entityId, isMutating, onActionChange, openCreateDialog])

  React.useEffect(() => {
    if (!onLoadingChange) return
    onLoadingChange(isInitialLoading || isMutating)
  }, [isInitialLoading, isMutating, onLoadingChange])

  React.useEffect(() => {
    if (!hasMore) return
    if (typeof IntersectionObserver === 'undefined') return
    const el = sentinelRef.current
    if (!el) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          loadMore().catch(() => {})
        }
      },
      { rootMargin: '200px 0px 200px 0px' },
    )
    observer.observe(el)
    return () => {
      observer.disconnect()
    }
  }, [hasMore, loadMore])

  const handleCreate = React.useCallback(
    async (payload: TaskFormPayload) => {
      try {
        await runWriteMutation(
          () => createTask(payload),
          {
            entityId,
            title: payload.base.title,
            isDone: payload.base.is_done ?? undefined,
          },
        )
        flash(t('customers.people.detail.tasks.createSuccess', 'Task created'), 'success')
        await Promise.resolve(onDataRefresh?.())
      } catch (err) {
        const message = err instanceof Error ? err.message : t('customers.people.detail.tasks.error', 'Failed to create task')
        flash(message, 'error')
        throw err
      }
    },
    [createTask, entityId, onDataRefresh, runWriteMutation, t],
  )

  const handleUpdate = React.useCallback(
    async (task: TodoLinkSummary, payload: TaskFormPayload) => {
      try {
        await runWriteMutation(
          () => updateTask(task, payload),
          {
            id: task.id,
            todoId: task.todoId,
            title: payload.base.title,
            isDone: payload.base.is_done ?? undefined,
          },
        )
        flash(t('customers.people.detail.tasks.updateSuccess', 'Task updated'), 'success')
        await Promise.resolve(onDataRefresh?.())
      } catch (err) {
        const message =
          err instanceof Error ? err.message : t('customers.people.detail.tasks.updateError', 'Failed to update task')
        flash(message, 'error')
        throw err
      }
    },
    [onDataRefresh, runWriteMutation, t, updateTask],
  )

  const handleToggle = React.useCallback(
    async (task: TodoLinkSummary, nextIsDone: boolean) => {
      try {
        await runWriteMutation(
          () => toggleTask(task, nextIsDone),
          {
            id: task.id,
            todoId: task.todoId,
            isDone: nextIsDone,
          },
        )
        flash(
          nextIsDone
            ? t('customers.people.detail.tasks.completeSuccess', 'Task marked as done')
            : t('customers.people.detail.tasks.reopenSuccess', 'Task reopened'),
          'success',
        )
        await Promise.resolve(onDataRefresh?.())
      } catch (err) {
        const message =
          err instanceof Error ? err.message : t('customers.people.detail.tasks.toggleError', 'Failed to update task status')
        flash(message, 'error')
      }
    },
    [onDataRefresh, runWriteMutation, t, toggleTask],
  )

  const handleDelete = React.useCallback(
    async (task: TodoLinkSummary) => {
      try {
        await runWriteMutation(
          () => unlinkTask(task),
          {
            id: task.id,
            todoId: task.todoId,
          },
        )
        flash(t('customers.people.detail.tasks.deleteSuccess', 'Task removed'), 'success')
        await Promise.resolve(onDataRefresh?.())
        await refresh()
      } catch (err) {
        const message =
          err instanceof Error ? err.message : t('customers.people.detail.tasks.deleteError', 'Failed to remove task')
        flash(message, 'error')
      }
    },
    [onDataRefresh, refresh, runWriteMutation, t, unlinkTask],
  )

  const handleCancel = React.useCallback(
    async (task: TodoLinkSummary) => {
      if (!useCanonicalInteractions) return
      try {
        await runWriteMutation(
          () => canonicalResult.cancelInteraction(task.todoId),
          { id: task.todoId },
        )
        flash(t('customers.people.detail.tasks.cancelSuccess', 'Task canceled'), 'success')
        await Promise.resolve(onDataRefresh?.())
      } catch (err) {
        const message =
          err instanceof Error ? err.message : t('customers.people.detail.tasks.cancelError', 'Failed to cancel task')
        flash(message, 'error')
      }
    },
    [canonicalResult, onDataRefresh, runWriteMutation, t, useCanonicalInteractions],
  )

  const renderTaskMeta = React.useCallback(
    (task: TodoLinkSummary) => {
      const meta: string[] = []
      if (task.status === 'canceled') {
        meta.push(t('customers.people.detail.tasks.status.canceled', 'Canceled'))
      }
      if (typeof task.priority === 'number') {
        meta.push(t('customers.people.detail.tasks.priorityLabel', 'Priority {{priority}}', { priority: task.priority }))
      }
      if (task.severity) {
        meta.push(
          t(
            `customers.people.detail.tasks.severity.${task.severity}`,
            task.severity.charAt(0).toUpperCase() + task.severity.slice(1),
          ),
        )
      }
      if (task.dueAt) {
        const dueLabel =
          formatDate(task.dueAt) ??
          formatDateTime(task.dueAt) ??
          t('customers.people.detail.tasks.dueLabel', 'Due {{date}}', { date: task.dueAt })
        meta.push(t('customers.people.detail.tasks.dueLabel', 'Due {{date}}', { date: dueLabel }))
      }
      return meta
    },
    [t],
  )

  const handleDialogSubmit = React.useCallback(
    async (payload: TaskFormPayload) => {
      if (dialogMode === 'edit' && editingTask) {
        await handleUpdate(editingTask, payload)
      } else {
        await handleCreate(payload)
      }
    },
    [dialogMode, editingTask, handleCreate, handleUpdate],
  )

  const hasTasks = sortedTasks.length > 0

  return (
    <div className="mt-0 space-y-6">
      <div className="space-y-4">
        {isInitialLoading ? (
          <LoadingMessage
            label={t('customers.people.detail.tasks.loading', 'Loading tasks…')}
            className="border-0 bg-transparent p-0 py-8 justify-center"
          />
        ) : null}

        {!isInitialLoading && !hasTasks ? (
          <TabEmptyState
            title={emptyState.title}
            action={{
              label: emptyState.actionLabel,
              onClick: openCreateDialog,
              disabled: isMutating || !entityId,
            }}
          />
        ) : null}

        {!isInitialLoading && hasTasks ? (
          <div className="space-y-4">
            {error ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            ) : null}
            {sortedTasks.map((task) => {
              const todoHref = resolveTodoHref(task.todoSource, task.todoId)
              const createdLabel = formatDateTime(task.createdAt) ?? emptyLabel
              const meta = renderTaskMeta(task)
              const title = task.title ?? t('customers.people.detail.tasks.untitled', 'Untitled task')
              const isDone = task.isDone === true
              const isCanceled = task.status === 'canceled'
              const checkboxId = `person-task-${task.id}`
              const isPendingToggle = pendingTaskId === task.todoId
              return (
                <article key={task.id} className="group space-y-3 rounded-lg border bg-card p-4 transition hover:border-border/80">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <TimelineItemHeader
                      title={
                        <span className="inline-flex items-center gap-2">
                          <input
                            id={checkboxId}
                            type="checkbox"
                            checked={isDone}
                            onChange={(event) => {
                              const next = event.target.checked
                              void handleToggle(task, next)
                            }}
                            disabled={isMutating || isPendingToggle || isCanceled}
                            className="h-4 w-4 rounded border"
                          />
                          <span
                            className={cn(
                              'text-sm font-semibold',
                              isDone ? 'line-through text-muted-foreground' : undefined,
                              isCanceled ? 'text-muted-foreground' : undefined,
                            )}
                          >
                            {title}
                          </span>
                        </span>
                      }
                      timestamp={task.createdAt}
                      fallbackTimestampLabel={createdLabel}
                    />
                    <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                      <IconButton
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => openEditDialog(task)}
                        disabled={isMutating}
                        aria-label={t('ui.actions.edit', 'Edit')}
                      >
                        {isMutating && editingTask?.id === task.id && dialogMode === 'edit' ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Pencil className="h-4 w-4" />
                        )}
                      </IconButton>
                      <IconButton
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(task)}
                        disabled={isMutating}
                        aria-label={t('ui.actions.delete', 'Delete')}
                      >
                        {isMutating ? <Loader2 className="h-4 w-4 animate-spin text-destructive" /> : <Trash2 className="h-4 w-4" />}
                      </IconButton>
                    </div>
                  </div>
                  {meta.length ? (
                    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      {meta.map((entry) => (
                        <span key={`${task.id}-${entry}`} className="rounded bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
                          {entry}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {task.description ? (
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">{task.description}</p>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    {useCanonicalInteractions && !isDone && !isCanceled ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-auto px-0 text-xs font-medium text-muted-foreground hover:bg-transparent hover:text-foreground"
                        onClick={() => void handleCancel(task)}
                        disabled={isMutating || isPendingToggle}
                      >
                        {t('customers.people.detail.tasks.cancelAction', 'Cancel task')}
                      </Button>
                    ) : null}
                    {todoHref ? (
                      <Link href={todoHref} className="text-primary hover:underline">
                        {t('customers.people.detail.tasks.openTask', 'Open task')}
                      </Link>
                    ) : null}
                  </div>
                </article>
              )
            })}
            <div ref={sentinelRef} />
            {hasMore ? (
              <div className="flex justify-center">
                <Button type="button" variant="outline" size="sm" onClick={() => loadMore().catch(() => {})} disabled={isLoadingMore}>
                  {isLoadingMore ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {t('customers.people.detail.tasks.loadingMore', 'Loading…')}
                    </>
                  ) : (
                    t('customers.people.detail.tasks.loadMore', 'Load more')
                  )}
                </Button>
              </div>
            ) : null}
            {isLoadingMore ? (
              <div className="flex justify-center text-xs text-muted-foreground">
                <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                {t('customers.people.detail.tasks.loadingMore', 'Loading…')}
              </div>
            ) : null}
            <div className="flex justify-center">
              <Button asChild variant="outline" size="sm">
                <Link href="/backend/customer-tasks">
                  {t('customers.people.detail.tasks.viewAll', 'View all tasks')}
                </Link>
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      <TaskDialog
        open={dialogOpen}
        mode={dialogMode}
        onOpenChange={(next) => {
          if (!next) closeDialog()
          else setDialogOpen(true)
        }}
        initialValues={buildInitialFormValues(editingTask)}
        onSubmit={handleDialogSubmit}
        isSubmitting={isMutating}
        contextMessage={dialogContextMessage}
      />
    </div>
  )
}

export default TasksSection
