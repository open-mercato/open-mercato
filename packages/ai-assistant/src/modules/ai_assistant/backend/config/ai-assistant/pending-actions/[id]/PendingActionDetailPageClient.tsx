'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Label } from '@open-mercato/ui/primitives/label'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { FieldDiffCard } from '@open-mercato/ui/ai/parts/FieldDiffCard'
import type {
  AiPendingActionCardFieldDiff,
  AiPendingActionCardRecordDiff,
} from '@open-mercato/ui/ai/parts/types'
import { ErrorMessage, LoadingMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import {
  OPTIONAL_REQUEST_HEADERS,
  PENDING_ACTIONS_API_PATH,
  PENDING_ACTIONS_HREF,
  formatDateTime,
  pendingActionChannelLabel,
  pendingActionErrorMessage,
  pendingActionStatusLabel,
  pendingActionStatusVariant,
  type PendingActionItem,
} from '../../../../../components/pending-actions/pendingActionsShared'
import { RequesterLabel } from '../../../../../components/pending-actions/RequesterLabel'
import { useRequesterLabels } from '../../../../../components/pending-actions/useRequesterLabels'
import { refreshPendingActionsNavBadge } from '../../../../../components/pending-actions/pendingActionsNavBadge'

export const REJECT_REASON_MAX_LENGTH = 500

type ApiErrorBody = { error?: unknown; code?: unknown }

type ConfirmResponse = {
  ok?: boolean
  pendingAction?: PendingActionItem
  mutationResult?: { error?: { code?: unknown; message?: unknown } | null } | null
}

type DetailLoadResult =
  | { kind: 'found'; action: PendingActionItem }
  | { kind: 'not_found' }

export class PendingActionRequestError extends Error {
  readonly status: number
  readonly code: string | null

  constructor(status: number, code: string | null) {
    super(`[internal] Pending action request failed (${status}${code ? `, ${code}` : ''})`)
    this.name = 'PendingActionRequestError'
    this.status = status
    this.code = code
  }
}

function readErrorCode(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const code = (body as ApiErrorBody).code
  return typeof code === 'string' && code.length > 0 ? code : null
}

function actionEndpoint(id: string, suffix?: 'confirm' | 'cancel'): string {
  const base = `${PENDING_ACTIONS_API_PATH}/${encodeURIComponent(id)}`
  return suffix ? `${base}/${suffix}` : base
}

async function loadPendingAction(id: string): Promise<DetailLoadResult> {
  const call = await apiCall<PendingActionItem>(actionEndpoint(id), {
    headers: OPTIONAL_REQUEST_HEADERS,
  })
  if (call.status === 404 || call.status === 400) return { kind: 'not_found' }
  if (!call.ok || !call.result) {
    throw new PendingActionRequestError(call.status, readErrorCode(call.result))
  }
  return { kind: 'found', action: call.result }
}

async function postDecision<TResult>(
  id: string,
  suffix: 'confirm' | 'cancel',
  body: Record<string, unknown>,
): Promise<TResult> {
  const call = await apiCall<TResult>(actionEndpoint(id, suffix), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...OPTIONAL_REQUEST_HEADERS },
    body: JSON.stringify(body),
  })
  if (!call.ok) {
    throw new PendingActionRequestError(call.status, readErrorCode(call.result))
  }
  return (call.result ?? {}) as TResult
}

function errorCodeOf(error: unknown): string | null {
  return error instanceof PendingActionRequestError ? error.code : null
}

type DetailRowProps = { label: string; children: React.ReactNode }

function DetailRow({ label, children }: DetailRowProps) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  )
}

type RejectDialogProps = {
  open: boolean
  submitting: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (reason: string) => void
}

export function RejectPendingActionDialog({ open, submitting, onOpenChange, onSubmit }: RejectDialogProps) {
  const t = useT()
  const [reason, setReason] = React.useState('')

  React.useEffect(() => {
    if (!open) setReason('')
  }, [open])

  const submit = React.useCallback(() => {
    if (submitting) return
    onSubmit(reason.trim())
  }, [onSubmit, reason, submitting])

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        submit()
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        onOpenChange(false)
      }
    },
    [onOpenChange, submit],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onKeyDown={handleKeyDown} data-pending-action-reject-dialog>
        <DialogHeader>
          <DialogTitle>{t('ai_assistant.pendingActions.rejectDialog.title', 'Reject this AI action?')}</DialogTitle>
          <DialogDescription>
            {t(
              'ai_assistant.pendingActions.rejectDialog.description',
              'The action will not run. The requester sees the reason you give.',
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="pending-action-reject-reason">
            {t('ai_assistant.pendingActions.rejectDialog.reasonLabel', 'Reason (optional)')}
          </Label>
          <Textarea
            id="pending-action-reject-reason"
            value={reason}
            maxLength={REJECT_REASON_MAX_LENGTH}
            onChange={(event) => setReason(event.target.value)}
            placeholder={t(
              'ai_assistant.pendingActions.rejectDialog.reasonPlaceholder',
              'Why is this action rejected?',
            )}
          />
          <p className="text-xs text-muted-foreground">
            {t('ai_assistant.pendingActions.rejectDialog.reasonCounter', '{count} / {max}', {
              count: String(reason.length),
              max: String(REJECT_REASON_MAX_LENGTH),
            })}
          </p>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            {t('ai_assistant.pendingActions.rejectDialog.cancel', 'Cancel')}
          </Button>
          <Button type="button" variant="destructive" onClick={submit} disabled={submitting}>
            {t('ai_assistant.pendingActions.rejectDialog.submit', 'Reject action')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type MutationContext = {
  formId: string
  resourceKind: string
  resourceId: string
  data: PendingActionItem | null
  retryLastMutation: () => Promise<boolean>
}

export function PendingActionDetailPageClient({ id }: { id: string }) {
  const t = useT()
  const [rejectOpen, setRejectOpen] = React.useState(false)
  const [submitting, setSubmitting] = React.useState<'confirm' | 'cancel' | null>(null)

  const query = useQuery<DetailLoadResult>({
    queryKey: ['ai_assistant', 'pending_actions', 'detail', id],
    queryFn: () => loadPendingAction(id),
    retry: false,
  })

  const action = query.data?.kind === 'found' ? query.data.action : null
  const requesterIds = React.useMemo(() => [action?.requester.userId ?? null], [action])
  const requesterLabels = useRequesterLabels(requesterIds)

  const mutationContextId = `ai_assistant.pending_action:${id}`
  const { runMutation, retryLastMutation } = useGuardedMutation<MutationContext>({
    contextId: mutationContextId,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const injectionContext = React.useMemo<MutationContext>(
    () => ({
      formId: mutationContextId,
      resourceKind: 'ai_assistant.pending_action',
      resourceId: id,
      data: action,
      retryLastMutation,
    }),
    [action, id, mutationContextId, retryLastMutation],
  )

  const afterDecision = React.useCallback(async () => {
    await query.refetch()
    void refreshPendingActionsNavBadge(t)
  }, [query, t])

  const handleApprove = React.useCallback(async () => {
    if (submitting) return
    setSubmitting('confirm')
    try {
      const result = await runMutation({
        operation: () => postDecision<ConfirmResponse>(id, 'confirm', {}),
        context: injectionContext,
        mutationPayload: { decision: 'confirm' },
      })
      const handlerError = result.mutationResult?.error
      if (result.ok === false || handlerError) {
        flash(pendingActionErrorMessage(t, 'execution_failed'), 'error')
      } else {
        flash(t('ai_assistant.pendingActions.flash.approved', 'AI action approved.'), 'success')
      }
    } catch (error) {
      flash(pendingActionErrorMessage(t, errorCodeOf(error)), 'error')
    } finally {
      setSubmitting(null)
      await afterDecision()
    }
  }, [afterDecision, id, injectionContext, runMutation, submitting, t])

  const handleReject = React.useCallback(
    async (reason: string) => {
      if (submitting) return
      setSubmitting('cancel')
      try {
        await runMutation({
          operation: () => postDecision(id, 'cancel', reason ? { reason } : {}),
          context: injectionContext,
          mutationPayload: { decision: 'cancel', reason },
        })
        setRejectOpen(false)
        flash(t('ai_assistant.pendingActions.flash.rejected', 'AI action rejected.'), 'success')
      } catch (error) {
        flash(pendingActionErrorMessage(t, errorCodeOf(error)), 'error')
      } finally {
        setSubmitting(null)
        await afterDecision()
      }
    },
    [afterDecision, id, injectionContext, runMutation, submitting, t],
  )

  if (query.isLoading) {
    return <LoadingMessage label={t('ai_assistant.pendingActions.detail.loading', 'Loading AI action…')} />
  }

  if (query.data?.kind === 'not_found') {
    return (
      <RecordNotFoundState
        label={t('ai_assistant.pendingActions.detail.notFound', 'AI action not found')}
        description={t(
          'ai_assistant.pendingActions.detail.notFoundDescription',
          'It may have been removed, or you cannot access it.',
        )}
        backHref={PENDING_ACTIONS_HREF}
        backLabel={t('ai_assistant.pendingActions.detail.back', 'Back to pending AI actions')}
      />
    )
  }

  if (query.error || !action) {
    return (
      <ErrorMessage
        label={t('ai_assistant.pendingActions.detail.loadError', 'Failed to load the AI action.')}
        action={
          <Button type="button" variant="outline" size="sm" onClick={() => void query.refetch()}>
            {t('ai_assistant.pendingActions.detail.retry', 'Try again')}
          </Button>
        }
      />
    )
  }

  const isPending = action.status === 'pending'
  const executionError = action.executionResult?.error ?? null
  const executedRecordId = action.executionResult?.recordId ?? null
  const fieldDiff = action.fieldDiff as unknown as AiPendingActionCardFieldDiff[]
  const records = action.records as unknown as AiPendingActionCardRecordDiff[] | null

  return (
    <div className="flex flex-col gap-6" data-pending-action-detail>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Link href={PENDING_ACTIONS_HREF} className="text-xs text-muted-foreground hover:underline">
            {t('ai_assistant.pendingActions.detail.back', 'Back to pending AI actions')}
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-mono text-base font-semibold">{action.toolName}</h2>
            <StatusBadge variant={pendingActionStatusVariant(action.status)} dot>
              {pendingActionStatusLabel(t, action.status)}
            </StatusBadge>
          </div>
          {action.sideEffectsSummary ? (
            <p className="text-sm text-muted-foreground">{action.sideEffectsSummary}</p>
          ) : null}
        </div>
        {isPending ? (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setRejectOpen(true)}
              disabled={submitting !== null}
              data-pending-action-reject
            >
              {t('ai_assistant.pendingActions.actions.reject', 'Reject')}
            </Button>
            <Button
              type="button"
              onClick={() => void handleApprove()}
              disabled={submitting !== null}
              data-pending-action-approve
            >
              {t('ai_assistant.pendingActions.actions.approve', 'Approve')}
            </Button>
          </div>
        ) : null}
      </div>

      <dl className="grid grid-cols-1 gap-4 rounded-md border border-border p-4 sm:grid-cols-2 lg:grid-cols-3">
        <DetailRow label={t('ai_assistant.pendingActions.columns.tool', 'Tool')}>
          <span className="font-mono text-xs">{action.toolName}</span>
        </DetailRow>
        <DetailRow label={t('ai_assistant.pendingActions.columns.channel', 'Channel')}>
          {pendingActionChannelLabel(t, action.channel)}
        </DetailRow>
        <DetailRow label={t('ai_assistant.pendingActions.columns.requester', 'Requester')}>
          <RequesterLabel requester={action.requester} labels={requesterLabels} />
        </DetailRow>
        <DetailRow label={t('ai_assistant.pendingActions.columns.target', 'Target')}>
          {action.targetEntityType || action.targetRecordId ? (
            <span className="flex flex-col gap-0.5">
              <span>{action.targetEntityType ?? '—'}</span>
              {action.targetRecordId ? (
                <span className="font-mono text-xs text-muted-foreground">{action.targetRecordId}</span>
              ) : null}
            </span>
          ) : (
            '—'
          )}
        </DetailRow>
        <DetailRow label={t('ai_assistant.pendingActions.columns.createdAt', 'Created')}>
          {formatDateTime(action.createdAt)}
        </DetailRow>
        <DetailRow label={t('ai_assistant.pendingActions.columns.expiresAt', 'Expires')}>
          {formatDateTime(action.expiresAt)}
        </DetailRow>
        {action.resolvedAt ? (
          <DetailRow label={t('ai_assistant.pendingActions.detail.resolvedAt', 'Decided')}>
            {formatDateTime(action.resolvedAt)}
          </DetailRow>
        ) : null}
      </dl>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">
          {t('ai_assistant.pendingActions.detail.changes', 'Proposed changes')}
        </h3>
        <div className="rounded-md border border-border p-4">
          <FieldDiffCard fieldDiff={fieldDiff} records={records} />
        </div>
      </section>

      {executionError ? (
        <Alert status="error" data-pending-action-execution-error>
          <AlertTitle>{t('ai_assistant.pendingActions.detail.executionFailed', 'Execution failed')}</AlertTitle>
          <AlertDescription>{executionError.message}</AlertDescription>
        </Alert>
      ) : null}

      {!executionError && executedRecordId ? (
        <Alert status="success" data-pending-action-execution-result>
          <AlertTitle>{t('ai_assistant.pendingActions.detail.executed', 'Action applied')}</AlertTitle>
          <AlertDescription>
            {t('ai_assistant.pendingActions.detail.executedRecord', 'Record {id}', { id: executedRecordId })}
          </AlertDescription>
        </Alert>
      ) : null}

      <RejectPendingActionDialog
        open={rejectOpen}
        submitting={submitting === 'cancel'}
        onOpenChange={setRejectOpen}
        onSubmit={(reason) => void handleReject(reason)}
      />
    </div>
  )
}

export default PendingActionDetailPageClient
