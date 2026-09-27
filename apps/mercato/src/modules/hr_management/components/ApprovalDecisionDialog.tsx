"use client"

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { loadHrUserOptions, type HrUserOption } from './userOptions'

export type ApprovalDecisionAction = 'approve' | 'reject' | 'reassign' | 'cancel'

const TITLE_FALLBACKS: Record<ApprovalDecisionAction, string> = {
  approve: 'Approve request',
  reject: 'Reject request',
  reassign: 'Hand the step to another approver',
  cancel: 'Cancel request',
}

/**
 * A rejection and a cancellation both leave the target record untouched, and the comment is the
 * only thing the requester ever sees — so those two require one. An approval does not: demanding
 * a reason for a decision that needs none is how approval fatigue starts.
 */
const COMMENT_REQUIRED: Record<ApprovalDecisionAction, boolean> = {
  approve: false,
  reject: true,
  reassign: false,
  cancel: true,
}

const LABEL_CLASS = 'text-sm font-medium text-foreground'
const SEARCH_DEBOUNCE_MS = 250

export type ApprovalDecisionDialogProps = {
  /** `null` keeps the dialog closed; the action also decides the copy and the payload. */
  action: ApprovalDecisionAction | null
  /** What the request is about, shown so the operator confirms the right record. */
  targetLabel?: string | null
  stepLabel?: string | null
  pending: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (input: { comment: string; approverUserId?: string }) => void | Promise<void>
}

/**
 * Collects the one thing an approval action needs beyond the request id: a comment, and for a
 * reassignment the user the step moves to. The route rejects a reassignment without a target, so
 * the confirm button stays disabled rather than letting the server explain it.
 */
export function ApprovalDecisionDialog({
  action,
  targetLabel,
  stepLabel,
  pending,
  onOpenChange,
  onConfirm,
}: ApprovalDecisionDialogProps) {
  const t = useT()
  const open = action !== null
  const [comment, setComment] = React.useState('')
  const [approverUserId, setApproverUserId] = React.useState('')
  const [search, setSearch] = React.useState('')
  const [options, setOptions] = React.useState<HrUserOption[]>([])
  const [searching, setSearching] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setComment('')
    setApproverUserId('')
    setSearch('')
  }, [open, action])

  React.useEffect(() => {
    if (!open || action !== 'reassign') return
    let cancelled = false
    setSearching(true)
    const timer = setTimeout(() => {
      void (async () => {
        const loaded = await loadHrUserOptions(search)
        if (!cancelled) setOptions(loaded)
        if (!cancelled) setSearching(false)
      })()
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [open, action, search])

  const commentMissing = action !== null && COMMENT_REQUIRED[action] && comment.trim().length === 0
  const approverMissing = action === 'reassign' && approverUserId.length === 0
  const submitDisabled = pending || action === null || commentMissing || approverMissing

  const selectedApprover = React.useMemo(
    () => options.find((option) => option.value === approverUserId) ?? null,
    [options, approverUserId],
  )

  const submit = React.useCallback(() => {
    if (action === null) return
    if (COMMENT_REQUIRED[action] && comment.trim().length === 0) return
    if (action === 'reassign' && approverUserId.length === 0) return
    void onConfirm({
      comment: comment.trim(),
      ...(action === 'reassign' ? { approverUserId } : {}),
    })
  }, [action, comment, approverUserId, onConfirm])

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
          <DialogTitle>{action ? t(`hr_management.approvals.dialog.${action}.title`, TITLE_FALLBACKS[action]) : ''}</DialogTitle>
          <DialogDescription>
            {targetLabel && targetLabel.trim().length > 0
              ? t('hr_management.approvals.dialog.target', 'This decision applies to {target}.', { target: targetLabel })
              : t('hr_management.approvals.dialog.description', 'The decision is recorded in the request history.')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {stepLabel ? (
            <p className="text-sm text-muted-foreground">
              {t('hr_management.approvals.dialog.currentStep', 'Current step: {step}', { step: stepLabel })}
            </p>
          ) : null}

          {action === 'reassign' ? (
            <div className="flex flex-col gap-2">
              <label className="flex flex-col gap-1">
                <span className={LABEL_CLASS}>{t('hr_management.approvals.dialog.approver', 'New approver')}</span>
                <Input
                  value={search}
                  placeholder={t('hr_management.approvals.dialog.approverSearch', 'Search by name or email')}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              <div className="max-h-48 overflow-y-auto rounded-md border border-border">
                {searching ? (
                  <p className="px-3 py-2 text-sm text-muted-foreground">
                    {t('hr_management.approvals.dialog.searching', 'Searching…')}
                  </p>
                ) : null}
                {!searching && options.length === 0 ? (
                  <p className="px-3 py-2 text-sm text-muted-foreground">
                    {t('hr_management.approvals.dialog.noApprovers', 'No user matches this search.')}
                  </p>
                ) : null}
                {options.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`block w-full px-3 py-2 text-start text-sm hover:bg-muted ${
                      option.value === approverUserId ? 'bg-muted font-medium' : ''
                    }`}
                    onClick={() => setApproverUserId(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              {selectedApprover ? (
                <p className="text-sm text-muted-foreground">
                  {t('hr_management.approvals.dialog.approverSelected', 'Handing the step to {user}.', { user: selectedApprover.label })}
                </p>
              ) : null}
            </div>
          ) : null}

          <label className="flex flex-col gap-1">
            <span className={LABEL_CLASS}>
              {t('hr_management.approvals.dialog.comment', 'Comment')}
              {action !== null && COMMENT_REQUIRED[action] ? ' *' : ''}
            </span>
            <Textarea
              value={comment}
              rows={3}
              placeholder={t('hr_management.approvals.dialog.commentPlaceholder', 'Recorded in the request history.')}
              onChange={(event) => setComment(event.target.value)}
            />
            {commentMissing ? (
              <span className="text-xs text-status-error-text">
                {t('hr_management.approvals.dialog.commentRequired', 'A reason is required — it is what the requester sees.')}
              </span>
            ) : null}
          </label>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
            {t('hr_management.approvals.dialog.cancel', 'Cancel')}
          </Button>
          <Button
            type="button"
            variant={action === 'reject' || action === 'cancel' ? 'destructive' : 'default'}
            disabled={submitDisabled}
            onClick={submit}
          >
            {action ? t(`hr_management.approvals.dialog.${action}.confirm`, TITLE_FALLBACKS[action]) : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
