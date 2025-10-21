"use client"

import * as React from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@/lib/i18n/context'
import { cn } from '@/lib/utils'
import type { SectionAction, TabEmptyState, TodoLinkSummary, Translator } from './types'
import { formatDate, formatDateTime, resolveTodoHref } from './utils'

export type TasksSectionProps = {
  tasks: TodoLinkSummary[]
  onCreate: (payload: { title: string; isDone: boolean }) => Promise<void>
  isSubmitting: boolean
  emptyLabel: string
  addActionLabel: string
  emptyState: TabEmptyState
  onActionChange?: (action: SectionAction | null) => void
  onToggle: (task: TodoLinkSummary, nextIsDone: boolean) => Promise<void>
  pendingTaskId: string | null
  translator?: Translator
}

type TaskDraft = {
  title: string
  isDone: boolean
}

export function TasksSection({
  tasks,
  onCreate,
  isSubmitting,
  emptyLabel,
  addActionLabel,
  emptyState,
  onActionChange,
  onToggle,
  pendingTaskId,
  translator,
}: TasksSectionProps) {
  const tHook = useT()
  const t: Translator = React.useMemo(
    () => translator ?? ((key, fallback) => {
      const value = tHook(key)
      return value === key && fallback ? fallback : value
    }),
    [translator, tHook],
  )
  const [open, setOpen] = React.useState(false)
  const [draft, setDraft] = React.useState<TaskDraft>({ title: '', isDone: false })
  const [visibleCount, setVisibleCount] = React.useState(() => Math.min(5, tasks.length))

  const openDialog = React.useCallback(() => setOpen(true), [])

  React.useEffect(() => {
    if (!onActionChange) return
    onActionChange({
      label: addActionLabel,
      onClick: openDialog,
      disabled: isSubmitting,
    })
    return () => onActionChange(null)
  }, [addActionLabel, isSubmitting, onActionChange, openDialog])

  React.useEffect(() => {
    setVisibleCount((prev) => {
      if (!tasks.length) return 0
      const baseline = Math.min(5, tasks.length)
      if (prev === 0) return baseline
      return Math.min(Math.max(prev, baseline), tasks.length)
    })
  }, [tasks.length])

  const handleLoadMore = React.useCallback(() => {
    setVisibleCount((prev) => Math.min(prev + 5, tasks.length))
  }, [tasks.length])

  const visibleTasks = React.useMemo(() => {
    if (!visibleCount) return []
    return tasks.slice(0, visibleCount)
  }, [tasks, visibleCount])

  const submitDraft = React.useCallback(async () => {
    if (isSubmitting) return
    const trimmedTitle = draft.title.trim()
    if (!trimmedTitle) {
      flash(t('customers.people.detail.tasks.titleRequired', 'Task name is required.'), 'error')
      return
    }
    await onCreate({ title: trimmedTitle, isDone: draft.isDone })
    setDraft({ title: '', isDone: false })
    setOpen(false)
  }, [draft.isDone, draft.title, isSubmitting, onCreate, t])

  const handleSubmit = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      await submitDraft()
    },
    [submitDraft],
  )

  return (
    <div className="mt-4 space-y-6">
      <div className="space-y-4">
        {visibleTasks.length === 0 ? (
          <EmptyState
            title={emptyState.title}
            action={{
              label: emptyState.actionLabel,
              onClick: openDialog,
              disabled: isSubmitting,
            }}
          />
        ) : (
          visibleTasks.map((task) => {
            const todoHref = resolveTodoHref(task.todoSource, task.todoId)
            const createdLabel = formatDateTime(task.createdAt) ?? emptyLabel
            const dueLabel = task.dueAt ? formatDate(task.dueAt) ?? formatDateTime(task.dueAt) ?? null : null
            const priorityLabel =
              typeof task.priority === 'number'
                ? t('customers.people.detail.tasks.priorityLabel', 'Priority {{priority}}', { priority: task.priority })
                : null
            const title = task.title ?? t('customers.people.detail.tasks.untitled', 'Untitled task')
            const isDone = task.isDone === true
            const checkboxId = `person-task-${task.id}`
            const isPending = pendingTaskId === task.todoId
            return (
              <article key={task.id} className="rounded-lg border bg-card p-4 text-sm shadow-xs transition hover:border-border/80">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <label htmlFor={checkboxId} className="flex cursor-pointer items-start gap-2">
                    <input
                      id={checkboxId}
                      type="checkbox"
                      checked={isDone}
                      onChange={(event) => { const next = event.target.checked; void onToggle(task, next) }}
                      disabled={isSubmitting || isPending}
                      className="mt-1 h-4 w-4 rounded border"
                    />
                    <span className={cn('text-sm font-medium', isDone ? 'line-through text-muted-foreground' : undefined)}>
                      {title}
                    </span>
                  </label>
                  <span className="text-xs text-muted-foreground">{createdLabel}</span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span>{task.todoSource}</span>
                  {priorityLabel ? <span>{priorityLabel}</span> : null}
                  {dueLabel ? <span>{t('customers.people.detail.tasks.dueLabel', 'Due {{date}}', { date: dueLabel })}</span> : null}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                  {todoHref ? (
                    <Link href={todoHref} className="text-primary hover:underline">
                      {t('customers.people.detail.tasks.openTask', 'Open task')}
                    </Link>
                  ) : null}
                </div>
              </article>
            )
          })
        )}
        {visibleCount < tasks.length ? (
          <div className="flex justify-center">
            <Button variant="outline" size="sm" onClick={handleLoadMore}>
              {t('customers.people.detail.tasks.loadMore', 'Load more')}
            </Button>
          </div>
        ) : null}
        {tasks.length > 0 ? (
          <div className="flex justify-center text-xs">
            <Link href="/backend/customers/work-plan/todos" className="text-primary hover:underline">
              {t('customers.people.detail.tasks.viewAll', 'View all tasks')}
            </Link>
          </div>
        ) : null}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('customers.people.detail.tasks.addTitle', 'Add task')}</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={handleSubmit}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                setOpen(false)
              }
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                void submitDraft()
              }
            }}
          >
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="task-title">
                {t('customers.people.detail.tasks.fields.title', 'Title')}
              </label>
              <input
                id="task-title"
                className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={draft.title}
                onChange={(event) => setDraft((prev) => ({ ...prev, title: event.target.value }))}
                required
              />
            </div>
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.isDone}
                onChange={(event) => setDraft((prev) => ({ ...prev, isDone: event.target.checked }))}
              />
              {t('customers.people.detail.tasks.fields.done', 'Mark as done')}
            </label>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isSubmitting}>
                {t('customers.people.detail.tasks.cancel', 'Cancel')}
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {t('customers.people.detail.tasks.save', 'Save task')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default TasksSection
