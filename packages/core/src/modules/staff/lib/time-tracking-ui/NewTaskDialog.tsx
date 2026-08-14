"use client"

import * as React from 'react'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { BoardStatus } from './kanbanBoardData'

export const NEW_TASK_MUTATION_CONTEXT_ID = 'staff.time_tracking.board.newTask'

/**
 * "Nowe zadanie" (screen 6 page head → screen 7).
 *
 * The column quick-add covers "type a title into the column I am looking at"; this
 * covers the page-level button, which has no column to inherit, so it asks for the one
 * thing the column would have supplied — the status. It creates the task and hands the
 * id back so the caller can open the drawer on it, which is where the mockup's arrow
 * points.
 */
export function NewTaskDialog({
  open,
  onOpenChange,
  timeProjectId,
  statuses,
  assigneeStaffMemberId,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  timeProjectId: string
  statuses: readonly BoardStatus[]
  assigneeStaffMemberId: string | null
  onCreated: (taskId: string | null) => void
}): React.ReactElement {
  const t = useT()
  const [title, setTitle] = React.useState('')
  const [statusId, setStatusId] = React.useState<string | null>(null)
  const [isSaving, setIsSaving] = React.useState(false)

  const defaultStatusId = React.useMemo(() => {
    const preferred = statuses.find((status) => status.isDefault) ?? statuses[0] ?? null
    return preferred?.id ?? null
  }, [statuses])

  React.useEffect(() => {
    if (!open) return
    setTitle('')
    setStatusId(defaultStatusId)
  }, [defaultStatusId, open])

  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: NEW_TASK_MUTATION_CONTEXT_ID,
    blockedMessage: t('staff.time_tracking.board.newTask.error', 'Could not create the task.'),
  })

  const submit = React.useCallback(async () => {
    const trimmed = title.trim()
    if (!trimmed || !statusId || isSaving) return
    setIsSaving(true)
    try {
      const created = await runMutation({
        operation: () =>
          apiCallOrThrow<Record<string, unknown>>(
            '/api/staff/timesheets/tasks',
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                timeProjectId,
                taskStatusId: statusId,
                title: trimmed,
                assigneeStaffMemberId,
              }),
            },
            { errorMessage: t('staff.time_tracking.board.newTask.error', 'Could not create the task.') },
          ),
        context: {
          formId: NEW_TASK_MUTATION_CONTEXT_ID,
          resourceKind: 'staff.timesheets.task',
          resourceId: timeProjectId,
          retryLastMutation,
        },
      })
      onOpenChange(false)
      onCreated(typeof created?.result?.id === 'string' ? created.result.id : null)
    } catch (error) {
      if (surfaceRecordConflict(error, t)) return
      flash(
        error instanceof Error && error.message
          ? error.message
          : t('staff.time_tracking.board.newTask.error', 'Could not create the task.'),
        'error',
      )
    } finally {
      setIsSaving(false)
    }
  }, [
    assigneeStaffMemberId,
    isSaving,
    onCreated,
    onOpenChange,
    retryLastMutation,
    runMutation,
    statusId,
    t,
    timeProjectId,
    title,
  ])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        data-testid="board-new-task-dialog"
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault()
            void submit()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('staff.time_tracking.board.newTask.title', 'New task')}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="board-new-task-title">
              {t('staff.time_tracking.board.newTask.titleLabel', 'Task title')}
            </Label>
            <Input
              id="board-new-task-title"
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) {
                  event.preventDefault()
                  void submit()
                }
              }}
              placeholder={t('staff.time_tracking.board.quickAdd.placeholder', 'Task title')}
              data-testid="board-new-task-title"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="board-new-task-status">
              {t('staff.time_tracking.board.newTask.status', 'Status')}
            </Label>
            <Select value={statusId ?? undefined} onValueChange={(next) => setStatusId(next)}>
              <SelectTrigger id="board-new-task-status" data-testid="board-new-task-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {statuses.map((status) => (
                  <SelectItem key={status.id} value={status.id}>
                    {status.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('staff.time_tracking.board.newTask.cancel', 'Cancel')}
          </Button>
          <Button
            type="button"
            disabled={isSaving || title.trim().length === 0 || !statusId}
            onClick={() => void submit()}
            data-testid="board-new-task-submit"
          >
            {t('staff.time_tracking.board.newTask.submit', 'Create task')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default NewTaskDialog
