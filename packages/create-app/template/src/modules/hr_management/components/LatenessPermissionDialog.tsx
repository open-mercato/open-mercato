"use client"

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import {
  ATTENDANCE_APPROVAL_ENTITY_TYPE,
  findPendingApprovalRequest,
  submitAttendanceForApproval,
} from '../lib/attendancePermission'

const LABEL_CLASS = 'text-sm font-medium text-foreground'

type WorkflowOption = { id: string; name: string }

export type LatenessPermissionDialogProps = {
  /** `null` keeps the dialog closed; the record it is about is carried alongside. */
  target: { id: string; date?: string | null; employeeLabel?: string | null } | null
  onOpenChange: (open: boolean) => void
  onSubmitted: () => void
}

/** Workflow options for the select: active definitions declared for attendance records. */
async function loadActiveWorkflows(): Promise<WorkflowOption[]> {
  try {
    const data = await fetchCrudList<WorkflowOption>('hr_management/approval-workflows', {
      isActive: true,
      entityType: ATTENDANCE_APPROVAL_ENTITY_TYPE,
      pageSize: 50,
    })
    return (data?.items ?? []).map((row) => ({ id: row.id, name: row.name }))
  } catch {
    return []
  }
}

/**
 * Asks a manager to excuse one recorded lateness.
 *
 * The dialog discovers an open request itself when it opens: the answer only matters for the record
 * the operator is acting on, and it decides what the dialog can offer at all — a second request for
 * the same record would be approved twice against nothing.
 */
export function LatenessPermissionDialog({ target, onOpenChange, onSubmitted }: LatenessPermissionDialogProps) {
  const t = useT()
  const open = target !== null
  const [workflows, setWorkflows] = React.useState<WorkflowOption[]>([])
  const [workflowId, setWorkflowId] = React.useState('')
  const [pendingRequestId, setPendingRequestId] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open || !target) return
    let cancelled = false
    setWorkflowId('')
    setPendingRequestId(null)
    setError(null)
    setLoading(true)
    void (async () => {
      try {
        const [options, existingRequestId] = await Promise.all([
          loadActiveWorkflows(),
          findPendingApprovalRequest(target.id),
        ])
        if (cancelled) return
        setWorkflows(options)
        setPendingRequestId(existingRequestId)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [open, target])

  const submitDisabled = submitting || loading || workflowId.length === 0 || pendingRequestId !== null

  const submit = React.useCallback(() => {
    if (submitDisabled || !target) return
    setSubmitting(true)
    setError(null)
    void (async () => {
      try {
        await submitAttendanceForApproval(workflowId, target.id)
        onSubmitted()
      } catch (caught: unknown) {
        setError(caught instanceof Error && caught.message
          ? caught.message
          : t('hr_management.attendance.permission.error', 'Could not request a permission.'))
      } finally {
        setSubmitting(false)
      }
    })()
  }, [submitDisabled, target, workflowId, onSubmitted, t])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !submitDisabled) {
            event.preventDefault()
            submit()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('hr_management.attendance.permission.title', 'Request a lateness permission')}</DialogTitle>
          <DialogDescription>
            {target?.date
              ? t('hr_management.attendance.permission.description', 'Ask a manager to excuse the lateness recorded on {date}.', { date: String(target.date).slice(0, 10) })
              : t('hr_management.attendance.permission.descriptionNoDate', 'Ask a manager to excuse this recorded lateness.')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {target?.employeeLabel ? (
            <p className="text-sm text-muted-foreground">
              {t('hr_management.attendance.permission.employee', 'Employee: {employee}', { employee: target.employeeLabel })}
            </p>
          ) : null}

          {pendingRequestId ? (
            <p className="text-sm text-muted-foreground">
              {t('hr_management.attendance.permission.pending', 'A permission for this record is already waiting for a decision.')}
            </p>
          ) : loading ? (
            <p className="text-sm text-muted-foreground">
              {t('hr_management.attendance.permission.loading', 'Checking the record…')}
            </p>
          ) : workflows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t('hr_management.attendance.permission.noWorkflows', 'No active approval workflow is declared for attendance records yet.')}
            </p>
          ) : (
            <label className="flex flex-col gap-1">
              <span className={LABEL_CLASS}>{t('hr_management.attendance.form.fields.workflow', 'Approval workflow')}</span>
              <select
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={workflowId}
                onChange={(event) => setWorkflowId(event.target.value)}
              >
                <option value="">{t('hr_management.attendance.permission.workflowNone', 'Select a workflow')}</option>
                {workflows.map((workflow) => (
                  <option key={workflow.id} value={workflow.id}>{workflow.name}</option>
                ))}
              </select>
            </label>
          )}

          {error ? <p className="text-sm text-status-error-text">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>
            {t('hr_management.attendance.permission.cancel', 'Cancel')}
          </Button>
          <Button type="button" disabled={submitDisabled} onClick={submit}>
            {submitting
              ? t('hr_management.attendance.permission.submitting', 'Sending…')
              : t('hr_management.attendance.permission.submit', 'Send for approval')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
