"use client"

import * as React from 'react'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge, type StatusMap } from '@open-mercato/ui/primitives/status-badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@open-mercato/ui/primitives/dialog'
import { useDialogKeyHandler } from '@open-mercato/ui/hooks/useDialogKeyHandler'
import { emitSalesDocumentDataRefresh } from '../../../lib/frontend/documentDataEvents'
import { useSalesDocumentMutation } from '../../../components/documents/useSalesDocumentMutation'
import type { SalesOrderRecurrenceStatus } from '../../../lib/recurrence'
import { formatRecurrenceDate, formatRecurrenceSchedule } from '../../../lib/recurrenceLabel'
import {
  RecurrenceFields,
  createRecurrenceDraft,
  resolveRecurrenceDraft,
  type RecurrenceDraft,
  type RecurrenceValue,
} from '../../../components/documents/RecurrenceFields'

type RecurrenceRecord = RecurrenceValue & {
  endsOn: string | null
  nextInvoiceOn: string | null
  status: SalesOrderRecurrenceStatus | null
  locked: boolean
}

type DocumentRecord = {
  id: string
  updatedAt?: string | null
  recurrence?: RecurrenceRecord | null
  canManageRecurrence?: boolean
}

type WidgetContext = { kind?: 'order' | 'quote' }

type FormValues = { id: string; updatedAt: string | null; recurrence: RecurrenceDraft }

const STATUS_VARIANTS: StatusMap<SalesOrderRecurrenceStatus> = {
  scheduled: 'info',
  active: 'success',
  cancelling: 'warning',
  completed: 'neutral',
  cancelled: 'neutral',
}

const STATUS_FALLBACKS: Record<SalesOrderRecurrenceStatus, string> = {
  scheduled: 'Scheduled',
  active: 'Active',
  cancelling: 'Cancelling',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

export default function RecurrenceSectionWidget({
  context,
  data,
}: InjectionWidgetComponentProps<WidgetContext, DocumentRecord>) {
  const t = useT()
  const locale = useLocale()
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const dialogContentRef = React.useRef<HTMLDivElement | null>(null)
  const dialogTitleRef = React.useRef<HTMLHeadingElement | null>(null)
  const kind = context?.kind === 'quote' ? 'quote' : 'order'
  const recurrence = data?.recurrence ?? null
  const locked = recurrence?.locked === true
  const canEditSchedule = data?.canManageRecurrence === true && !locked
  const runDocumentMutation = useSalesDocumentMutation(kind, data?.id)

  const fields = React.useMemo<CrudField[]>(
    () => [
      {
        id: 'recurrence',
        label: '',
        type: 'custom',
        component: ({ value, setValue, error }) => {
          const draft = (value as RecurrenceDraft | undefined) ?? createRecurrenceDraft()
          const resolved = error ? resolveRecurrenceDraft(draft) : null
          return (
            <RecurrenceFields
              value={draft}
              onChange={async (next) => {
                if (recurrence && draft.enabled && !next.enabled) {
                  const confirmed = await confirm({
                    title: t('sales.recurring.section.confirmRemoval', 'Remove the recurring schedule?'),
                    description: t('sales.recurring.section.removalDescription', 'Saving will remove the schedule and switch to one-time billing.'),
                    confirmText: t('sales.recurring.section.remove', 'Remove schedule'),
                    variant: 'destructive',
                  })
                  if (!confirmed) return
                }
                setValue(next)
              }}
              errors={resolved && !resolved.ok ? resolved.fieldErrors : undefined}
            />
          )
        },
      },
    ],
    [confirm, recurrence, t],
  )

  const initialValues = React.useMemo<FormValues | null>(
    () =>
      data?.id
        ? { id: data.id, updatedAt: data.updatedAt ?? null, recurrence: createRecurrenceDraft(recurrence) }
        : null,
    [data?.id, data?.updatedAt, recurrence],
  )

  const handleSubmit = React.useCallback(
    async (values: Record<string, unknown>) => {
      if (!data?.id || !canEditSchedule) return
      const resolved = resolveRecurrenceDraft(values.recurrence as RecurrenceDraft | undefined)
      if (!resolved.ok) {
        const firstError = Object.values(resolved.fieldErrors)[0] ?? 'sales.recurring.errors.invalid'
        const message = t(firstError, t('sales.recurring.errors.invalid', 'Check the recurring schedule.'))
        throw createCrudFormError(message, { recurrence: message })
      }
      const payload = { id: data.id, recurrence: resolved.recurrence }
      await runDocumentMutation(
        () =>
          apiCallOrThrow(
            kind === 'order' ? '/api/sales/orders' : '/api/sales/quotes',
            {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            },
            { errorMessage: t('sales.recurring.section.saveError', 'Failed to save the recurring schedule.') },
          ),
        payload,
      )
      flash(t('sales.recurring.section.saved', 'Recurring schedule saved.'), 'success')
      setDialogOpen(false)
      emitSalesDocumentDataRefresh({ documentId: data.id, kind })
    },
    [canEditSchedule, data?.id, kind, runDocumentMutation, t],
  )

  const submitForm = React.useCallback(() => dialogContentRef.current?.querySelector('form')?.requestSubmit(), [])
  const handleKeyDown = useDialogKeyHandler({ onConfirm: submitForm })

  if (!data?.id) return null

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4 shadow-sm" data-testid="sales-recurrence-section">
      <SectionHeader title={t('sales.recurring.section.title', 'Recurring billing')} />
      {recurrence ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium" data-testid="sales-recurrence-schedule">
              {formatRecurrenceSchedule(recurrence, t, locale)}
            </span>
            {recurrence.status ? (
              <StatusBadge variant={STATUS_VARIANTS[recurrence.status]} dot>
                {t(`sales.recurring.status.${recurrence.status}`, STATUS_FALLBACKS[recurrence.status])}
              </StatusBadge>
            ) : null}
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            {recurrence.nextInvoiceOn ? (
              <>
                <dt className="text-muted-foreground">{t('sales.recurring.section.nextInvoice', 'Next invoice')}</dt>
                <dd data-testid="sales-recurrence-next-invoice">{formatRecurrenceDate(recurrence.nextInvoiceOn, locale)}</dd>
              </>
            ) : null}
            <dt className="text-muted-foreground">{t('sales.recurring.section.endsOn', 'Ends on')}</dt>
            <dd data-testid="sales-recurrence-ends-on">
              {recurrence.endsOn
                ? formatRecurrenceDate(recurrence.endsOn, locale)
                : t('sales.recurring.form.noEnd', 'No end date')}
            </dd>
          </dl>
          {locked ? (
            <p className="text-sm text-muted-foreground">
              {t('sales.recurring.section.locked', 'Invoices have been issued, so this schedule can no longer change.')}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {kind === 'order'
            ? t('sales.recurring.section.emptyOrder', 'This order is billed once.')
            : t('sales.recurring.section.emptyQuote', 'This quote is billed once.')}
        </p>
      )}
      {canEditSchedule ? (
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button type="button" variant="outline" data-testid="sales-recurrence-edit">
              {recurrence
                ? t('sales.recurring.section.edit', 'Edit schedule')
                : t('sales.recurring.section.setUp', 'Set up recurring billing')}
            </Button>
          </DialogTrigger>
          <DialogContent
            className="sm:max-w-2xl"
            onKeyDown={handleKeyDown}
            onOpenAutoFocus={(event) => {
              if (!dialogTitleRef.current) return
              event.preventDefault()
              dialogTitleRef.current.focus()
            }}
            ref={dialogContentRef}
          >
            <DialogHeader>
              <DialogTitle ref={dialogTitleRef} tabIndex={-1}>
                {t('sales.recurring.section.dialogTitle', 'Recurring schedule')}
              </DialogTitle>
            </DialogHeader>
            {initialValues ? (
              <CrudForm<FormValues>
                embedded
                disableInitialFocus
                fields={fields}
                initialValues={initialValues}
                submitLabel={t('sales.recurring.section.save', 'Save schedule')}
                onSubmit={handleSubmit}
              />
            ) : null}
          </DialogContent>
        </Dialog>
      ) : null}
      {ConfirmDialogElement}
    </div>
  )
}
