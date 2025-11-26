"use client"

import * as React from 'react'
import Link from 'next/link'
import { Loader2, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { cn } from '@/lib/utils'
import { useT } from '@/lib/i18n/context'
import type { SectionAction, TabEmptyState, TodoLinkSummary, Translator } from './types'
import { createTranslatorWithFallback } from '@open-mercato/shared/lib/i18n/translate'
import { formatDate, formatDateTime, resolveTodoHref } from './utils'
import { TimelineItemHeader } from './TimelineItemHeader'
import { TaskDialog } from './TaskDialog'
import { usePersonTasks, type TaskFormPayload } from './hooks/usePersonTasks'
import { LoadingMessage } from './LoadingMessage'

type TasksSectionProps = {
  entityId: string | null
  initialTasks: TodoLinkSummary[]
  emptyLabel: string
  addActionLabel: string
  emptyState: TabEmptyState
  onActionChange?: (action: SectionAction | null) => void
  onLoadingChange?: (isLoading: boolean) => void
  translator?: Translator
  entityName?: string | null
  dialogContextKey?: string
  dialogContextFallback?: string
}

function buildInitialFormValues(task: TodoLinkSummary | null): Record<string, unknown> | undefined {
  if (!task) return undefined
  const values: Record<string, unknown> = {
    title: task.title ?? '',
    is_done: task.isDone ?? false,
  }
  if (task.priority !== undefined && task.priority !== null) values.cf_priority = task.priority
  if (task.severity) values.cf_severity = task.severity
  if (task.description) values.cf_description = task.description
  if (task.dueAt) values.cf_due_at = task.dueAt
  if (task.customValues) {
    for (const [key, value] of Object.entries(task.customValues)) {
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
  translator,
  entityName,
  dialogContextKey,
  dialogContextFallback,
}: TasksSectionProps) {
  const tHook = useT()
  const fallbackTranslator = React.useMemo<Translator>(() => createTranslatorWithFallback(tHook), [tHook])
  const t: Translator = React.useMemo(() => translator ?? fallbackTranslator, [translator, fallbackTranslator])

  const {
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
    error,
  } = usePersonTasks({ entityId, initialTasks })

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
        await createTask(payload)
        flash(t('customers.people.detail.tasks.createSuccess', 'Task created'), 'success')
      } catch (err) {
        const message = err instanceof Error ? err.message : t('customers.people.detail.tasks.error', 'Failed to create task')
        flash(message, 'error')
        throw err
      }
    },
    [createTask, t],
  )

  const handleUpdate = React.useCallback(
    async (task: TodoLinkSummary, payload: TaskFormPayload) => {
      try {
        await updateTask(task, payload)
        flash(t('customers.people.detail.tasks.updateSuccess', 'Task updated'), 'success')
      } catch (err) {
        const message =
          err instanceof Error ? err.message : t('customers.people.detail.tasks.updateError', 'Failed to update task')
        flash(message, 'error')
        throw err
      }
    },
    [t, updateTask],
  )

  const handleToggle = React.useCallback(
    async (task: TodoLinkSummary, nextIsDone: boolean) => {
      try {
        await toggleTask(task, nextIsDone)
        flash(
          nextIsDone
            ? t('customers.people.detail.tasks.completeSuccess', 'Task marked as done')
            : t('customers.people.detail.tasks.reopenSuccess', 'Task reopened'),
          'success',
        )
      } catch (err) {
        const message =
          err instanceof Error ? err.message : t('customers.people.detail.tasks.toggleError', 'Failed to update task status')
        flash(message, 'error')
      }
    },
    [t, toggleTask],
  )

  const handleDelete = React.useCallback(
    async (task: TodoLinkSummary) => {
      try {
        await unlinkTask(task)
        flash(t('customers.people.detail.tasks.deleteSuccess', 'Task removed'), 'success')
        await refresh()
      } catch (err) {
        const message =
          err instanceof Error ? err.message : t('customers.people.detail.tasks.deleteError', 'Failed to remove task')
        flash(message, 'error')
      }
    },
    [refresh, t, unlinkTask],
  )

  const renderTaskMeta = React.useCallback(
    (task: TodoLinkSummary) => {
      const meta: string[] = []
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

  const hasTasks = tasks.length > 0

  return (
    <div className="mt-0 space-y-6">
      <div className="space-y-4">
        {isInitialLoading ? (
          <LoadingMessage
            label={t('customers.people.detail.tasks.loading', 'Loading tasks…')}
            className="border-0 bg-transparent p-0 py-8"
          />
        ) : null}

        {!isInitialLoading && !hasTasks ? (
          <EmptyState
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
            {tasks.map((task) => {
              const todoHref = resolveTodoHref(task.todoSource, task.todoId)
              const createdLabel = formatDateTime(task.createdAt) ?? emptyLabel
              const meta = renderTaskMeta(task)
              const title = task.title ?? t('customers.people.detail.tasks.untitled', 'Untitled task')
              const isDone = task.isDone === true
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
                            disabled={isMutating || isPendingToggle}
                            className="h-4 w-4 rounded border"
                          />
                          <span className={cn('text-sm font-semibold', isDone ? 'line-through text-muted-foreground' : undefined)}>
                            {title}
                          </span>
                        </span>
                      }
                      timestamp={task.createdAt}
                      fallbackTimestampLabel={createdLabel}
                    />
                    <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => openEditDialog(task)}
                        disabled={isMutating}
                      >
                        {isMutating && editingTask?.id === task.id && dialogMode === 'edit' ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Pencil className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(task)}
                        disabled={isMutating}
                      >
                        {isMutating ? <Loader2 className="h-4 w-4 animate-spin text-destructive" /> : <Trash2 className="h-4 w-4" />}
                      </Button>
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
                <Button variant="outline" size="sm" onClick={() => loadMore().catch(() => {})} disabled={isLoadingMore}>
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
                <Link href="/backend/customer-tasks" target="_blank" rel="noreferrer">
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
