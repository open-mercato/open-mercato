"use client"

import * as React from 'react'
import { CheckCircle2 } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { buildOptimisticLockHeader, extractOptimisticLockConflict } from '@open-mercato/ui/backend/utils/optimisticLock'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import {
  Alert,
  AlertTitle,
} from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import type { EudrStatementStatus } from '../data/validators'
import {
  EUDR_AMEND_WINDOW_MS,
  EUDR_STATEMENT_TRANSITIONS,
} from '../lib/statement-lifecycle'
import { statusBadgeVariant } from './formConfig'

type StatementLifecycleRecord = {
  id: string
  status: EudrStatementStatus
  referenceNumber: string | null
  verificationNumber: string | null
  referenceIssuedAt: string | null
  submittedAt: string | null
  updatedAt: string
}

type ReferenceFormValues = {
  referenceNumber: string
  verificationNumber: string
  referenceIssuedAt: string
} & Record<string, unknown>

type MutationContext = {
  formId: string
  resourceKind: string
  resourceId: string
  retryLastMutation: () => Promise<boolean>
}

export type StatementLifecycleBarProps = {
  statement: StatementLifecycleRecord
  speciesMissing?: boolean
  onChanged: () => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function extractGateReasons(error: unknown): string[] {
  const candidates: unknown[] = []
  if (isRecord(error)) {
    candidates.push(error.details)
    candidates.push(error)
  }
  for (const candidate of candidates) {
    if (!isRecord(candidate) || !Array.isArray(candidate.reasons)) continue
    return candidate.reasons
      .filter((reason): reason is string => typeof reason === 'string' && reason.trim().length > 0)
      .map((reason) => reason.startsWith('eudr.') ? reason : `eudr.gate.${reason}`)
  }
  return []
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function addYears(date: Date, years: number): Date {
  const next = new Date(date)
  next.setFullYear(next.getFullYear() + years)
  return next
}

function formatRemaining(ms: number): string {
  const totalMinutes = Math.max(0, Math.ceil(ms / 60_000))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

function toDateTimeLocalInput(date: Date): string {
  const offsetMs = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16)
}

function optionalText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function transitionActionKey(status: EudrStatementStatus): string {
  return `eudr.lifecycle.actions.to${status.charAt(0).toUpperCase()}${status.slice(1)}`
}

const confirmTitleKeys: Record<EudrStatementStatus, string> = {
  draft: 'eudr.lifecycle.confirmReturnToDraft',
  submitted: 'eudr.lifecycle.confirmSubmit',
  available: 'eudr.lifecycle.confirmMarkAvailable',
  withdrawn: 'eudr.lifecycle.confirmWithdraw',
  archived: 'eudr.lifecycle.confirmArchive',
}

const confirmBodyKeys: Record<EudrStatementStatus, string> = {
  draft: 'eudr.lifecycle.confirmReturnToDraftBody',
  submitted: 'eudr.lifecycle.confirmSubmitBody',
  available: 'eudr.lifecycle.confirmMarkAvailableBody',
  withdrawn: 'eudr.lifecycle.confirmWithdrawBody',
  archived: 'eudr.lifecycle.confirmArchiveBody',
}

export function StatementLifecycleBar({
  statement,
  speciesMissing = false,
  onChanged,
}: StatementLifecycleBarProps) {
  const translate = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [now, setNow] = React.useState(() => new Date())
  const [referenceDialogOpen, setReferenceDialogOpen] = React.useState(false)
  const [gateReasons, setGateReasons] = React.useState<string[]>([])
  const mutationContextId = `eudr-statement-lifecycle:${statement.id}`
  const { runMutation, retryLastMutation } = useGuardedMutation<MutationContext>({
    contextId: mutationContextId,
    blockedMessage: translate('ui.forms.flash.saveBlocked'),
  })

  React.useEffect(() => {
    if (statement.status !== 'available') return
    const interval = window.setInterval(() => setNow(new Date()), 60_000)
    setNow(new Date())
    return () => window.clearInterval(interval)
  }, [statement.status, statement.referenceIssuedAt])

  const issuedAt = parseDate(statement.referenceIssuedAt)
  const submittedAt = parseDate(statement.submittedAt)
  const amendRemainingMs = statement.status === 'available' && issuedAt
    ? issuedAt.getTime() + EUDR_AMEND_WINDOW_MS - now.getTime()
    : 0
  const amendWindowOpen = statement.status === 'available'
    && issuedAt !== null
    && now.getTime() >= issuedAt.getTime()
    && amendRemainingMs > 0
  const retainUntil = submittedAt ? addYears(submittedAt, 5) : null

  const performTransition = React.useCallback(async (
    nextStatus: EudrStatementStatus,
    extraPayload?: Record<string, unknown>,
  ): Promise<boolean> => {
    setGateReasons([])
    try {
      await runMutation({
        operation: () => withScopedApiRequestHeaders(
          buildOptimisticLockHeader(statement.updatedAt),
          () => updateCrud('eudr/statements', {
            id: statement.id,
            status: nextStatus,
            ...(extraPayload ?? {}),
          }, {
            errorMessage: translate('eudr.lifecycle.transitionError'),
          }),
        ),
        context: {
          formId: mutationContextId,
          resourceKind: 'eudr.due_diligence_statement',
          resourceId: statement.id,
          retryLastMutation,
        },
        mutationPayload: { id: statement.id, status: nextStatus, ...(extraPayload ?? {}) },
      })
      flash(translate('eudr.lifecycle.transitionSuccess'), 'success')
      onChanged()
      return true
    } catch (error) {
      const reasons = extractGateReasons(error)
      if (reasons.length > 0) {
        setGateReasons(reasons)
        return false
      }
      if (extractOptimisticLockConflict(error)) {
        return false
      }
      flash(translate('eudr.lifecycle.transitionError'), 'error')
      return false
    }
  }, [mutationContextId, onChanged, retryLastMutation, runMutation, statement.id, statement.updatedAt, translate])

  const handleTransitionClick = React.useCallback(async (nextStatus: EudrStatementStatus) => {
    if (statement.status === 'submitted' && nextStatus === 'available') {
      setReferenceDialogOpen(true)
      return
    }
    const confirmed = await confirm({
      title: translate(confirmTitleKeys[nextStatus]),
      text: translate(confirmBodyKeys[nextStatus]),
      variant: nextStatus === 'archived' || nextStatus === 'withdrawn' ? 'destructive' : 'default',
    })
    if (!confirmed) return
    await performTransition(nextStatus)
  }, [confirm, performTransition, statement.status, translate])

  const referenceFields = React.useMemo<CrudField[]>(() => [
    {
      id: 'referenceNumber',
      label: translate('eudr.statements.form.referenceNumber'),
      type: 'text',
      required: true,
    },
    {
      id: 'verificationNumber',
      label: translate('eudr.statements.form.verificationNumber'),
      type: 'text',
      required: true,
    },
    {
      id: 'referenceIssuedAt',
      label: translate('eudr.statements.form.referenceIssuedAt'),
      type: 'datetime-local',
      maxDate: new Date(),
    },
  ], [translate])

  const referenceGroups = React.useMemo<CrudFormGroup[]>(() => [
    {
      id: 'reference',
      title: translate('eudr.lifecycle.referenceDialog.details'),
      column: 1,
      fields: ['referenceNumber', 'verificationNumber', 'referenceIssuedAt'],
    },
  ], [translate])

  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{translate('eudr.lifecycle.currentStatus')}</span>
            <StatusBadge variant={statusBadgeVariant(statement.status)} dot>
              {translate(`eudr.statementStatus.${statement.status}`)}
            </StatusBadge>
            {statement.status === 'available' && issuedAt ? (
              amendWindowOpen ? (
                <StatusBadge variant="info">
                  {translate('eudr.lifecycle.amendWindowRemaining', { remaining: formatRemaining(amendRemainingMs) })}
                </StatusBadge>
              ) : (
                <StatusBadge variant="neutral">
                  {translate('eudr.lifecycle.amendWindowClosed')}
                </StatusBadge>
              )
            ) : null}
            {speciesMissing ? (
              <StatusBadge variant="warning">
                {translate('eudr.warnings.speciesMissing')}
              </StatusBadge>
            ) : null}
          </div>
          {retainUntil ? (
            <p className="text-sm text-muted-foreground">
              {translate('eudr.lifecycle.retainUntil', { date: retainUntil.toLocaleDateString() })}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {EUDR_STATEMENT_TRANSITIONS[statement.status].map((nextStatus) => (
            <Button
              key={nextStatus}
              type="button"
              variant={nextStatus === 'archived' || nextStatus === 'withdrawn' ? 'outline' : 'default'}
              onClick={() => void handleTransitionClick(nextStatus)}
            >
              <CheckCircle2 className="size-4" aria-hidden="true" />
              {translate(transitionActionKey(nextStatus))}
            </Button>
          ))}
        </div>
      </div>

      {gateReasons.length > 0 ? (
        <Alert status="warning" style="lighter">
          <AlertTitle>{translate('eudr.lifecycle.gateFailureTitle')}</AlertTitle>
          <div className="text-sm leading-5">
            <ul className="list-disc space-y-1 pl-5">
              {gateReasons.map((reason) => (
                <li key={reason}>{translate(reason)}</li>
              ))}
            </ul>
          </div>
        </Alert>
      ) : null}

      <Dialog open={referenceDialogOpen} onOpenChange={setReferenceDialogOpen}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>{translate('eudr.lifecycle.referenceDialog.title')}</DialogTitle>
          </DialogHeader>
          <CrudForm<ReferenceFormValues>
            embedded
            title={translate('eudr.lifecycle.referenceDialog.title')}
            submitLabel={translate('eudr.lifecycle.referenceDialog.submit')}
            fields={referenceFields}
            groups={referenceGroups}
            initialValues={{
              referenceNumber: statement.referenceNumber ?? '',
              verificationNumber: statement.verificationNumber ?? '',
              referenceIssuedAt: statement.referenceIssuedAt
                ? toDateTimeLocalInput(new Date(statement.referenceIssuedAt))
                : toDateTimeLocalInput(new Date()),
            }}
            onSubmit={async (values) => {
              const referenceNumber = optionalText(values.referenceNumber)
              if (!referenceNumber) {
                const message = translate('eudr.lifecycle.referenceDialog.referenceNumberRequired')
                throw createCrudFormError(message, { referenceNumber: message })
              }
              const verificationNumber = optionalText(values.verificationNumber)
              if (!verificationNumber) {
                const message = translate('eudr.lifecycle.referenceDialog.verificationNumberRequired')
                throw createCrudFormError(message, { verificationNumber: message })
              }
              const issuedAtText = optionalText(values.referenceIssuedAt)
              const issuedAt = issuedAtText ? new Date(issuedAtText) : new Date()
              if (Number.isNaN(issuedAt.getTime()) || issuedAt.getTime() > Date.now()) {
                const message = translate('eudr.lifecycle.referenceDialog.referenceIssuedAtInvalid')
                throw createCrudFormError(message, { referenceIssuedAt: message })
              }
              const ok = await performTransition('available', {
                referenceNumber,
                verificationNumber,
                referenceIssuedAt: issuedAt.toISOString(),
              })
              if (!ok) {
                throw createCrudFormError(translate('eudr.lifecycle.transitionBlocked'))
              }
              setReferenceDialogOpen(false)
            }}
          />
        </DialogContent>
      </Dialog>
      {ConfirmDialogElement}
    </section>
  )
}

export default StatementLifecycleBar
