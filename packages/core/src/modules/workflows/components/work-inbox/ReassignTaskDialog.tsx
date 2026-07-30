'use client'

/**
 * Move a task to another assignee or role queue (`POST /tasks/[id]/reassign`).
 *
 * This is the remedy §6.4 names for every act refusal an administrator can hit:
 * administration widens seeing and never acting, so taking the row is the
 * supported way to work on somebody else's task, and the row a definition
 * authored with no assignee, no queue and no claim is rescuable ONLY through
 * here.
 *
 * The endpoint's gate is VISIBILITY, not ownership — deliberately, or the
 * owner-less task would be unrescuable by definition — so this dialog is offered
 * on the strength of the server's `canReassign`, never on who owns the row.
 *
 * Free-text assignee and role fields mirror the Studio's own task inspector
 * (`workflows.tasks.inspector.when.reassignTo`); the platform has no shared user
 * picker to reuse yet.
 *
 * A rail rather than a modal: this is a secondary FORM filled against the task
 * it moves, and the reviewer reads the task body to decide who should own it.
 * Keyboard contract unchanged — Cmd/Ctrl+Enter submits, Escape cancels.
 */

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@open-mercato/ui/primitives/drawer'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Kbd, KbdShortcut } from '@open-mercato/ui/primitives/kbd'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export type ReassignTaskTarget = {
  assignedTo: string | null
  assignedToRoles: string[] | null
  reason: string | null
}

export type ReassignTaskDialogProps = {
  open: boolean
  submitting: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (target: ReassignTaskTarget) => void
}

function splitRoles(value: string): string[] {
  return value
    .split(',')
    .map((role) => role.trim())
    .filter((role) => role.length > 0)
}

export function ReassignTaskDialog({
  open,
  submitting,
  onOpenChange,
  onSubmit,
}: ReassignTaskDialogProps) {
  const t = useT()
  const [assignedTo, setAssignedTo] = React.useState('')
  const [roles, setRoles] = React.useState('')
  const [reason, setReason] = React.useState('')
  const [targetMissing, setTargetMissing] = React.useState(false)

  React.useEffect(() => {
    if (open) return
    setAssignedTo('')
    setRoles('')
    setReason('')
    setTargetMissing(false)
  }, [open])

  const handleSubmit = React.useCallback(() => {
    const assignee = assignedTo.trim()
    const roleNames = splitRoles(roles)
    // The server refuses a body naming neither (`reassignUserTaskSchema`), so
    // saying so here costs the operator one fewer round trip.
    if (!assignee && roleNames.length === 0) {
      setTargetMissing(true)
      return
    }
    setTargetMissing(false)
    onSubmit({
      assignedTo: assignee.length > 0 ? assignee : null,
      assignedToRoles: roleNames.length > 0 ? roleNames : null,
      reason: reason.trim().length > 0 ? reason.trim() : null,
    })
  }, [assignedTo, onSubmit, reason, roles])

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        data-testid="task-reassign-dialog"
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault()
            handleSubmit()
          }
        }}
        closeAriaLabel={t('workflows.tasks.detail.reassign.close')}
      >
        <DrawerHeader>
          <DrawerTitle>{t('workflows.tasks.detail.reassign.title')}</DrawerTitle>
          <DrawerDescription>
            {t('workflows.tasks.detail.reassign.description')}
          </DrawerDescription>
        </DrawerHeader>

        <DrawerBody className="space-y-4 py-2">
          <div className="space-y-1">
            <Label htmlFor="task-reassign-assignee">
              {t('workflows.tasks.detail.reassign.assigneeLabel')}
            </Label>
            <Input
              id="task-reassign-assignee"
              data-testid="task-reassign-assignee"
              value={assignedTo}
              onChange={(event) => setAssignedTo(event.target.value)}
              placeholder={t('workflows.tasks.detail.reassign.assigneePlaceholder')}
              autoComplete="off"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="task-reassign-roles">
              {t('workflows.tasks.detail.reassign.rolesLabel')}
            </Label>
            <Input
              id="task-reassign-roles"
              data-testid="task-reassign-roles"
              value={roles}
              onChange={(event) => setRoles(event.target.value)}
              placeholder={t('workflows.tasks.detail.reassign.rolesPlaceholder')}
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              {t('workflows.tasks.detail.reassign.rolesHelp')}
            </p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="task-reassign-reason">
              {t('workflows.tasks.detail.reassign.reasonLabel')}
            </Label>
            <Textarea
              id="task-reassign-reason"
              data-testid="task-reassign-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              placeholder={t('workflows.tasks.detail.reassign.reasonPlaceholder')}
            />
            <p className="text-xs text-muted-foreground">
              {t('workflows.tasks.detail.reassign.reasonHelp')}
            </p>
          </div>

          {targetMissing ? (
            <p
              role="alert"
              data-testid="task-reassign-target-required"
              className="text-sm text-status-error-text"
            >
              {t('workflows.tasks.detail.reassign.targetRequired')}
            </p>
          ) : null}
        </DrawerBody>

        <DrawerFooter
          leading={(
            <span className="hidden text-xs text-muted-foreground sm:inline-flex sm:items-center sm:gap-1">
              <KbdShortcut keys={['⌘', 'Enter']} />
              <span>{t('workflows.tasks.detail.reassign.submitHint')}</span>
              <Kbd>Esc</Kbd>
              <span>{t('workflows.tasks.detail.reassign.cancelHint')}</span>
            </span>
          )}
        >
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            data-testid="task-reassign-submit"
            disabled={submitting}
            onClick={handleSubmit}
          >
            {t('workflows.tasks.actions.reassign')}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
