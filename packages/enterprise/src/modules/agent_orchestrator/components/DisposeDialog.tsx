"use client"

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { KbdShortcut } from '@open-mercato/ui/primitives/kbd'
import { useT } from '@open-mercato/shared/lib/i18n/context'

/**
 * The reason-capturing disposition dialog (spec `2026-08-11-agent-taxonomy.md`,
 * Phase 4 frontend contract): `Cmd/Ctrl+Enter` submits, `Escape` cancels — the
 * latter via Radix's own dismiss, so the shortcut works from anywhere inside.
 *
 * It owns no verdict logic: the caller supplies the copy and the confirm
 * handler, so the Caseload queue and the proposal detail page use one dialog
 * rather than two that drift.
 */

export type DisposeDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: React.ReactNode
  reason: string
  onReasonChange: (reason: string) => void
  reasonPlaceholder?: string
  confirmLabel: string
  onConfirm: () => void
  busy?: boolean
  /** Confirm stays disabled until a non-empty reason is typed (edit/reject). */
  requireReason?: boolean
  /** Extra content above the reason field — e.g. the chosen option summary. */
  children?: React.ReactNode
}

export function DisposeDialog({
  open,
  onOpenChange,
  title,
  description,
  reason,
  onReasonChange,
  reasonPlaceholder,
  confirmLabel,
  onConfirm,
  busy = false,
  requireReason = true,
  children,
}: DisposeDialogProps) {
  const t = useT()
  const canConfirm = !busy && (!requireReason || reason.trim().length > 0)

  const submit = React.useCallback(() => {
    if (!canConfirm) return
    onConfirm()
  }, [canConfirm, onConfirm])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault()
            submit()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <div className="space-y-3">
          {children}
          <Textarea
            value={reason}
            onChange={(event) => onReasonChange(event.target.value)}
            placeholder={reasonPlaceholder}
            rows={3}
            autoFocus
          />
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              <KbdShortcut keys={['⌘', 'Enter']} />
            </span>
            <Button
              type="button"
              variant="outline"
              className="ml-auto"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              {t('agent_orchestrator.proposal.actions.cancelEdit')}
            </Button>
            <Button type="button" variant="destructive" onClick={submit} disabled={!canConfirm}>
              {confirmLabel}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default DisposeDialog
