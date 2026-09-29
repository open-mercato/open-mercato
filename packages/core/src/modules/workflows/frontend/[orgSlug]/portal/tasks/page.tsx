'use client'

/**
 * Portal task list.
 *
 * Reads `/api/workflows/portal/tasks`, which is the authorization — this page
 * renders whatever that route returns and decides nothing itself. A row that
 * should not be here is a route bug, never a rendering bug, and keeping the
 * decision out of the browser is what makes that true.
 *
 * `usePortalAppEvent('workflows.task.portal_assigned', …)` refetches when a task
 * is addressed to this principal, so it appears without a reload. The event
 * carries an id and nothing else; the answer always comes back through the
 * authorized API.
 */

import * as React from 'react'
import Link from 'next/link'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { PortalPageHeader } from '@open-mercato/ui/portal/components/PortalPageHeader'
import { PortalCard } from '@open-mercato/ui/portal/components/PortalCard'
import { usePortalAppEvent } from '@open-mercato/ui/portal/hooks/usePortalAppEvent'

type PortalTaskRow = {
  id: string
  taskName: string
  description: string | null
  status: string
  dueDate: string | null
  createdAt: string
}

type PortalTaskListResponse = {
  ok: boolean
  tasks?: PortalTaskRow[]
  error?: string
}

const OPEN_STATUSES = ['PENDING', 'IN_PROGRESS']

type Props = { params: { orgSlug: string } }

export default function PortalTasksPage({ params }: Props) {
  const t = useT()
  const [tasks, setTasks] = React.useState<PortalTaskRow[] | null>(null)
  const [failed, setFailed] = React.useState(false)

  // Deliberately depends on NOTHING. `t` is not a dependency because the error
  // copy is translated at render, not stored — a `t` that changes identity
  // between renders would otherwise re-run the effect and refetch in a loop.
  const load = React.useCallback(async () => {
    setFailed(false)
    const { ok, result } = await apiCall<PortalTaskListResponse>('/api/workflows/portal/tasks')
    if (!ok || !result?.ok) {
      setFailed(true)
      setTasks([])
      return
    }
    setTasks(result.tasks ?? [])
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  usePortalAppEvent('workflows.task.portal_assigned', () => {
    void load()
  }, [load])

  const openTasks = React.useMemo(
    () => (tasks ?? []).filter((task) => OPEN_STATUSES.includes(task.status)),
    [tasks],
  )
  const doneTasks = React.useMemo(
    () => (tasks ?? []).filter((task) => !OPEN_STATUSES.includes(task.status)),
    [tasks],
  )

  const formatDate = (value: string | null) => {
    if (!value) return null
    return new Date(value).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  const renderRow = (task: PortalTaskRow) => {
    const due = formatDate(task.dueDate)
    const isOverdue =
      task.dueDate != null &&
      OPEN_STATUSES.includes(task.status) &&
      new Date(task.dueDate).getTime() < Date.now()

    return (
      <Link
        key={task.id}
        href={`/${params.orgSlug}/portal/tasks/${task.id}`}
        className="block rounded-lg border p-4 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="truncate font-medium">{task.taskName}</p>
            {task.description ? (
              <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{task.description}</p>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {due ? (
              // Status is never colour-only: the overdue row carries its own
              // word alongside the token.
              <Badge variant={isOverdue ? 'destructive' : 'outline'} className="text-overline">
                {isOverdue
                  ? t('workflows.portal.tasks.overdue', 'Overdue {date}', { date: due })
                  : t('workflows.portal.tasks.due', 'Due {date}', { date: due })}
              </Badge>
            ) : null}
            <Badge variant="outline" className="text-overline">
              {t(`workflows.portal.tasks.status.${task.status}`, task.status)}
            </Badge>
          </div>
        </div>
      </Link>
    )
  }

  return (
    <div className="flex flex-col gap-8">
      <PortalPageHeader
        label={t('workflows.portal.tasks.label', 'Your work')}
        title={t('workflows.portal.tasks.title', 'Tasks')}
        description={t(
          'workflows.portal.tasks.description',
          'Things we need from you to move your orders along.',
        )}
      />

      {tasks === null ? (
        <div className="flex items-center justify-center py-20">
          <Spinner />
        </div>
      ) : failed ? (
        <PortalCard>
          <p role="alert" className="text-sm text-status-error-text">
            {t('workflows.portal.tasks.loadError', 'Could not load your tasks.')}
          </p>
        </PortalCard>
      ) : openTasks.length === 0 && doneTasks.length === 0 ? (
        <EmptyState
          variant="subtle"
          size="lg"
          title={t('workflows.portal.tasks.empty.title', 'Nothing needs you right now')}
          description={t(
            'workflows.portal.tasks.empty.description',
            'When we need something from you, it will show up here.',
          )}
        />
      ) : (
        <div className="flex flex-col gap-6">
          {openTasks.length > 0 ? (
            <PortalCard>
              <h2 className="mb-4 text-base font-semibold tracking-tight">
                {t('workflows.portal.tasks.open', 'Waiting on you')}
              </h2>
              <div className="flex flex-col gap-3">{openTasks.map(renderRow)}</div>
            </PortalCard>
          ) : null}

          {doneTasks.length > 0 ? (
            <PortalCard>
              <h2 className="mb-4 text-base font-semibold tracking-tight">
                {t('workflows.portal.tasks.done', 'Completed')}
              </h2>
              <div className="flex flex-col gap-3">{doneTasks.map(renderRow)}</div>
            </PortalCard>
          ) : null}
        </div>
      )}
    </div>
  )
}
