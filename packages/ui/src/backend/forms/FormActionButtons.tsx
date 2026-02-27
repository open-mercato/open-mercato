"use client"

import * as React from 'react'
import Link from 'next/link'
import { Trash2, Save, Loader2 } from 'lucide-react'
import { Button } from '../../primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export type FormActionButtonsProps = {
  /** Extra action buttons rendered before the standard buttons */
  extraActions?: React.ReactNode
  /** Show the delete button */
  showDelete?: boolean
  /** Callback when delete is clicked */
  onDelete?: () => void
  /** Label for the delete button */
  deleteLabel?: string
  /** Whether the delete button shows a loading spinner */
  isDeleting?: boolean
  /** URL for the cancel link */
  cancelHref?: string
  /** Label for the cancel link */
  cancelLabel?: string
  /** Submit button configuration */
  submit?: {
    /** Form ID for the submit button (needed in header to trigger form submit) */
    formId?: string
    /** Whether the form is currently submitting */
    pending?: boolean
    /** Label while idle */
    label?: string
    /** Label while saving */
    pendingLabel?: string
    /** Optional icon for idle submit state */
    icon?: React.ComponentType<{ className?: string }>
  }
  /** When true, hides all buttons */
  hidden?: boolean
}

export function FormActionButtons({
  extraActions,
  showDelete,
  onDelete,
  deleteLabel,
  isDeleting,
  cancelHref,
  cancelLabel,
  submit,
  hidden,
}: FormActionButtonsProps) {
  const t = useT()

  if (hidden) return null

  const resolvedDeleteLabel = deleteLabel ?? t('ui.forms.actions.delete')
  const resolvedCancelLabel = cancelLabel ?? t('ui.forms.actions.cancel')
  const resolvedSubmitLabel = submit?.label ?? t('ui.forms.actions.save')
  const resolvedPendingLabel = submit?.pendingLabel ?? t('ui.forms.status.saving')
  const SubmitIcon = submit?.icon ?? Save

  return (
    <div className="flex flex-wrap items-center gap-2">
      {extraActions}
      {showDelete ? (
        <Button
          type="button"
          variant="outline"
          onClick={onDelete}
          disabled={isDeleting}
          className="text-red-600 border-red-200 hover:bg-red-50 rounded"
        >
          {isDeleting ? (
            <Loader2 className="size-4 mr-2 animate-spin" />
          ) : (
            <Trash2 className="size-4 mr-2" />
          )}
          {resolvedDeleteLabel}
        </Button>
      ) : null}
      {cancelHref ? (
        <Link href={cancelHref} className="h-9 inline-flex items-center rounded border px-3 text-sm">
          {resolvedCancelLabel}
        </Link>
      ) : null}
      {submit ? (
        <Button
          type="submit"
          form={submit.formId}
          disabled={submit.pending}
        >
          {submit.pending ? <Loader2 className="size-4 mr-2 animate-spin" /> : <SubmitIcon className="size-4 mr-2" />}
          {submit.pending ? resolvedPendingLabel : resolvedSubmitLabel}
        </Button>
      ) : null}
    </div>
  )
}
