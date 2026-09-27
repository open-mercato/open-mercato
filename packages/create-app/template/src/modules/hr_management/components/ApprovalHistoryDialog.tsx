"use client"

import * as React from 'react'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { parseApprovalComment } from '../lib/approvalInbox'
import { useHrUserLabels } from './userOptions'

const RESOURCE = 'hr_management/approval-logs'

export type ApprovalLogRow = {
  id: string
  approval_request_id: string
  step_order: number | null
  action: string | null
  actor_user_id?: string | null
  comment?: string | null
  created_at?: string | null
}

const ACTION_VARIANTS: Record<string, StatusBadgeVariant> = {
  approved: 'success',
  rejected: 'error',
  cancelled: 'neutral',
  reassigned: 'info',
  commented: 'neutral',
}

const ACTION_FALLBACKS: Record<string, string> = {
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  reassigned: 'Reassigned',
  commented: 'Commented',
}

/** An instant as the viewer's locale writes it; the day alone loses "two decisions a minute apart". */
export function formatInstant(value: string | null | undefined, locale: string): string {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })
}

export type ApprovalHistoryDialogProps = {
  approvalRequestId: string | null
  summary?: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * The audit trail of one approval request, read from the engine's own log rows.
 *
 * The engine writes one row per decision, which makes this the only place an operator can see
 * why a request ended up where it did — including who reassigned it, which the engine stores as
 * a marker appended to the comment rather than in a column of its own.
 */
export function ApprovalHistoryDialog({
  approvalRequestId,
  summary,
  open,
  onOpenChange,
}: ApprovalHistoryDialogProps) {
  const t = useT()
  const locale = useLocale()
  const [rows, setRows] = React.useState<ApprovalLogRow[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open || !approvalRequestId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const data = await fetchCrudList<ApprovalLogRow>(RESOURCE, {
          approvalRequestId,
          sortField: 'created_at',
          sortDir: 'asc',
          pageSize: 100,
        })
        if (!cancelled) setRows(data?.items ?? [])
      } catch (caught: unknown) {
        if (!cancelled) {
          setRows([])
          setError(caught instanceof Error && caught.message
            ? caught.message
            : t('hr_management.approvals.history.error.load', 'Could not load the approval history.'))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [open, approvalRequestId, t])

  const parsed = React.useMemo(() => rows.map((row) => parseApprovalComment(row.comment)), [rows])
  const actorIds = React.useMemo(
    () => rows.map((row) => row.actor_user_id ?? '').concat(parsed.map((entry) => entry.reassignedToUserId ?? '')),
    [rows, parsed],
  )
  const userLabels = useHrUserLabels(actorIds)

  const actorLabel = React.useCallback(
    (userId: string | null | undefined) => {
      if (!userId) return t('hr_management.approvals.history.system', 'System')
      return userLabels.get(userId) ?? userId
    },
    [t, userLabels],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('hr_management.approvals.history.title', 'Approval history')}</DialogTitle>
          <DialogDescription>
            {summary && summary.trim().length > 0
              ? summary
              : t('hr_management.approvals.history.description', 'Every decision recorded for this request, oldest first.')}
          </DialogDescription>
        </DialogHeader>

        {loading ? <LoadingMessage label={t('hr_management.approvals.history.loading', 'Loading history…')} /> : null}
        {error ? <ErrorMessage label={error} /> : null}
        {!loading && !error && rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t('hr_management.approvals.history.empty', 'No decision has been recorded for this request yet.')}
          </p>
        ) : null}

        {!loading && rows.length > 0 ? (
          <ol className="flex flex-col gap-3">
            {rows.map((row, index) => {
              const entry = parsed[index]
              const action = row.action ?? 'commented'
              return (
                <li key={row.id} className="border-s-2 border-border ps-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge variant={ACTION_VARIANTS[action] ?? 'neutral'} dot>
                      {t(`hr_management.approvals.log.${action}`, ACTION_FALLBACKS[action] ?? action)}
                    </StatusBadge>
                    <span className="text-xs text-muted-foreground">
                      {t('hr_management.approvals.history.step', 'Step {step}', { step: String(row.step_order ?? 1) })}
                    </span>
                    <span className="text-xs text-muted-foreground">{actorLabel(row.actor_user_id)}</span>
                    <span className="text-xs text-muted-foreground">{formatInstant(row.created_at, locale)}</span>
                  </div>
                  {entry.text ? <p className="mt-1 whitespace-pre-line text-sm text-foreground">{entry.text}</p> : null}
                  {entry.reassignedToUserId ? (
                    <p className="mt-1 text-sm text-muted-foreground">
                      {t('hr_management.approvals.history.reassignedTo', 'Handed to {user}', {
                        user: actorLabel(entry.reassignedToUserId),
                      })}
                    </p>
                  ) : null}
                </li>
              )
            })}
          </ol>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
