"use client"

import * as React from 'react'
import { CheckCircle2, AlertCircle, ArrowUpRight } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { Button } from '@open-mercato/ui/primitives/button'
import { Badge } from '@open-mercato/ui/primitives/badge'
import type { TodoLinkSummary } from '../../formConfig'

function isOverdue(dueAt: string | null | undefined): boolean {
  if (!dueAt) return false
  return new Date(dueAt) < new Date()
}

function priorityLabel(priority: number | null | undefined): { label: string; variant: 'destructive' | 'default' | 'secondary' | 'muted' } {
  if (priority === null || priority === undefined) return { label: 'None', variant: 'muted' }
  if (priority >= 3) return { label: 'High', variant: 'destructive' }
  if (priority === 2) return { label: 'Medium', variant: 'default' }
  return { label: 'Low', variant: 'secondary' }
}

type TranslateFnWithParams = (key: string, fallback?: string, params?: Record<string, string | number>) => string

export function OpenTasksWidget({
  tasks,
  currentUserId,
  t,
  onViewAll,
}: {
  tasks: TodoLinkSummary[]
  currentUserId?: string | null
  t: TranslateFnWithParams
  onViewAll: () => void
}) {
  const [taskFilter, setTaskFilter] = React.useState<'all' | 'mine' | 'overdue'>('all')
  const overdueTasks = tasks.filter((task) => isOverdue(task.dueAt))
  const mineTasks = currentUserId
    ? tasks.filter((task) => {
        const assignee = (task as Record<string, unknown>).assignedToUserId ?? (task as Record<string, unknown>).createdByUserId
        return assignee === currentUserId
      })
    : tasks

  const filteredTasks = taskFilter === 'overdue'
    ? overdueTasks
    : taskFilter === 'mine'
      ? mineTasks
      : tasks

  const filterTabs: Array<{ key: 'all' | 'mine' | 'overdue'; label: string; count: number }> = [
    { key: 'all', label: t('customers.tasks.filters.all', 'All'), count: tasks.length },
    { key: 'mine', label: t('customers.tasks.filters.mine', 'Mine'), count: mineTasks.length },
    { key: 'overdue', label: t('customers.tasks.filters.overdue', 'Overdue'), count: overdueTasks.length },
  ]

  return (
    <div className="rounded-lg border bg-card p-5">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <CheckCircle2 className="size-4" />
          {t('customers.companies.dashboard.openTasks', 'Open tasks')}
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
            {tasks.length}
          </span>
        </h3>
        <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={onViewAll}>
          + {t('customers.companies.dashboard.newTask', 'New task')}
        </Button>
      </div>
      <div className="mt-2 flex items-center gap-1">
        {filterTabs.map((tab) => (
          <Button
            key={tab.key}
            type="button"
            variant={taskFilter === tab.key ? 'default' : 'outline'}
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => setTaskFilter(tab.key)}
          >
            {tab.label}
            <span className="ml-1 rounded-full bg-muted/50 px-1 text-overline">{tab.count}</span>
          </Button>
        ))}
      </div>
      <div className="mt-3 divide-y">
        {filteredTasks.slice(0, 4).map((task) => {
          const overdue = isOverdue(task.dueAt)
          const prio = priorityLabel(task.priority)
          return (
            <div key={task.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-foreground">{task.title || '—'}</p>
                {task.dueAt && (
                  <p className={cn('mt-0.5 text-xs', overdue ? 'text-destructive' : 'text-muted-foreground')}>
                    {overdue && <AlertCircle className="mr-1 inline size-3" />}
                    {overdue
                      ? t('customers.companies.dashboard.overdueBy', 'Overdue by {{days}} days', { days: Math.ceil((Date.now() - new Date(task.dueAt).getTime()) / 86_400_000) })
                      : t('customers.companies.dashboard.dueOn', 'Due: {{date}}', { date: new Date(task.dueAt).toLocaleDateString() })
                    }
                  </p>
                )}
              </div>
              <Badge variant={prio.variant} className="shrink-0 text-xs">{prio.label}</Badge>
              <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" />
            </div>
          )
        })}
        {filteredTasks.length === 0 && (
          <p className="py-3 text-sm text-muted-foreground">{t('customers.companies.dashboard.noTasks', 'No open tasks')}</p>
        )}
      </div>
    </div>
  )
}
