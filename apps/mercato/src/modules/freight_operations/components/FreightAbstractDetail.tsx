"use client"

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { ErrorMessage, LoadingMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { apiCall, apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { isAbstractActionAllowed } from '../lib/abstractState'
import {
  ABSTRACT_APPROVAL_MODE_FALLBACKS,
  ABSTRACT_STATUS_FALLBACKS,
} from '../lib/freightEnums'
import { customerNameOf, formatFreightAmount, formatFreightDate } from './freightOptions'
import { LIST_HREF } from './abstractListMeta'
import { RESOURCE, type FreightAbstractRow } from './FreightAbstractsTable'
import { AbstractLinesSection, type AbstractLineRow } from './AbstractLinesSection'
import { FreightPaymentsPanel } from './FreightPaymentsPanel'
import { AbstractRespondDialog } from './AbstractRespondDialog'
import { AbstractResolveDialog } from './AbstractResolveDialog'
import { AbstractActionDialog, type AbstractActionTarget, type AbstractNoteAction } from './AbstractActionDialog'

const DETAIL_MUTATION_CONTEXT_ID = 'freight_operations.abstracts.detail'
const ABSTRACT_ENTITY_ID = 'freight_operations:freight_trip_abstract'

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  )
}

function FieldRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-end font-medium text-foreground">{value}</span>
    </div>
  )
}

export default function FreightAbstractDetail({ id }: { id: string }) {
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { runMutation, retryLastMutation } = useGuardedMutation<{ formId: string; resourceKind: string; resourceId?: string; retryLastMutation: () => Promise<boolean> }>({
    contextId: DETAIL_MUTATION_CONTEXT_ID,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })
  const [respondOpen, setRespondOpen] = React.useState(false)
  const [resolveOpen, setResolveOpen] = React.useState(false)
  const [noteAction, setNoteAction] = React.useState<AbstractNoteAction | null>(null)

  const query = useQuery({
    queryKey: ['freight-abstract-detail', id],
    queryFn: () => fetchCrudList<FreightAbstractRow>(RESOURCE, { ids: String(id), pageSize: 1 }),
  })
  const abstract = query.data?.items?.[0]

  const linesQuery = useQuery({
    queryKey: ['freight-abstract-lines', id],
    queryFn: async () => {
      const call = await apiCall<{ items?: AbstractLineRow[] }>(`/api/freight_operations/abstracts/lines?id=${encodeURIComponent(id)}`)
      return call.result?.items ?? []
    },
  })
  const lines = linesQuery.data ?? []

  const refetchAll = React.useCallback(async () => {
    await Promise.all([query.refetch(), linesQuery.refetch()])
  }, [linesQuery, query])

  const target: AbstractActionTarget | null = abstract
    ? { id: abstract.id, abstractNumber: abstract.abstract_number, updatedAt: abstract.updatedAt ?? null, updated_at: abstract.updated_at ?? null }
    : null

  const runDirectAction = React.useCallback(async (action: 'submit' | 'invoice') => {
    if (!abstract) return
    const confirmed = await confirm({
      title: action === 'submit'
        ? t('freight_operations.abstracts.actions.submit.confirm', 'Submit this abstract to the customer for review?')
        : t('freight_operations.abstracts.actions.invoice.confirm', 'Issue a tax invoice for this abstract? This creates a sales order and invoice.'),
    })
    if (!confirmed) return
    try {
      await runMutation<Awaited<ReturnType<typeof apiCallOrThrow>>>({
        operation: () => withScopedApiRequestHeaders(
          buildOptimisticLockHeader(abstract.updatedAt ?? abstract.updated_at ?? null),
          () => apiCallOrThrow(`/api/freight_operations/abstracts/${action}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: abstract.id }),
          }, {
            errorMessage: action === 'submit'
              ? t('freight_operations.abstracts.actions.submit.error', 'Unable to submit the abstract.')
              : t('freight_operations.abstracts.actions.invoice.error', 'Unable to issue the invoice.'),
          }),
        ),
        mutationPayload: { operation: `abstracts.${action}`, id: abstract.id, updatedAt: abstract.updatedAt ?? null },
        context: { formId: DETAIL_MUTATION_CONTEXT_ID, resourceKind: ABSTRACT_ENTITY_ID, resourceId: abstract.id, retryLastMutation },
      })
      flash(
        action === 'submit'
          ? t('freight_operations.abstracts.actions.submit.success', 'Abstract submitted.')
          : t('freight_operations.abstracts.actions.invoice.success', 'Invoice issued.'),
        'success',
      )
      // Invoicing also flips every trip on the abstract to `billed`, so the lines
      // are refetched alongside the header.
      await refetchAll()
    } catch (error) {
      flash(
        error instanceof Error && error.message
          ? error.message
          : t('freight_operations.abstracts.actions.submit.error', 'Unable to submit the abstract.'),
        'error',
      )
    }
  }, [abstract, confirm, refetchAll, retryLastMutation, runMutation, t])

  if (query.isLoading) {
    return <Page><PageBody><LoadingMessage label={t('freight_operations.abstracts.detail.loading', 'Loading abstract…')} /></PageBody></Page>
  }
  if (query.isError) {
    return <Page><PageBody><ErrorMessage label={t('freight_operations.abstracts.detail.error', 'Could not load the abstract.')} /></PageBody></Page>
  }
  if (!abstract) {
    return (
      <Page><PageBody>
        <RecordNotFoundState
          label={t('freight_operations.abstracts.form.error.notFound', 'Abstract not found.')}
          backHref={LIST_HREF}
          backLabel={t('freight_operations.abstracts.actions.backToList', 'Back to abstracts')}
        />
      </PageBody></Page>
    )
  }

  const status = abstract.status
  const statusLabel = t(`freight_operations.abstracts.status.${status}`, ABSTRACT_STATUS_FALLBACKS[status] ?? status)
  const approvalMode = abstract.approval_mode
    ? t(`freight_operations.abstracts.approval_mode.${abstract.approval_mode}`, ABSTRACT_APPROVAL_MODE_FALLBACKS[abstract.approval_mode] ?? abstract.approval_mode)
    : '—'
  const currency = abstract.currency_code
  const disputedLines = lines.filter((line) => line.dispute_status === 'disputed')
  const requiresApproval = abstract.requires_customer_approval !== false

  return (
    <Page>
      <PageBody>
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-xl font-semibold text-foreground">{abstract.abstract_number}</h1>
                <Badge variant="secondary">{statusLabel}</Badge>
                {abstract.approval_mode ? <Badge variant="secondary">{approvalMode}</Badge> : null}
              </div>
              <p className="text-sm text-muted-foreground">
                {customerNameOf(abstract.customer_snapshot)} ·{' '}
                {[formatFreightDate(abstract.period_from), formatFreightDate(abstract.period_to)].join(' → ')}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button asChild variant="outline">
                <Link href={`/backend/freight/contracts/${abstract.contract_id}`}>
                  {t('freight_operations.abstracts.detail.viewContract', 'View contract')}
                </Link>
              </Button>
              {isAbstractActionAllowed(status, 'submit') && requiresApproval && (
                <Button type="button" onClick={() => { void runDirectAction('submit') }}>
                  {t('freight_operations.abstracts.actions.submit.label', 'Submit to customer')}
                </Button>
              )}
              {isAbstractActionAllowed(status, 'finalize') && !requiresApproval && (
                <Button type="button" onClick={() => setNoteAction('finalize')}>
                  {t('freight_operations.abstracts.actions.finalize.label', 'Finalize internally')}
                </Button>
              )}
              {isAbstractActionAllowed(status, 'record_offline_approval') && (
                <Button type="button" variant="outline" onClick={() => setNoteAction('record-offline-approval')}>
                  {t('freight_operations.abstracts.actions.record-offline-approval.label', 'Record offline approval')}
                </Button>
              )}
              {isAbstractActionAllowed(status, 'invoice') && (
                <Button type="button" onClick={() => { void runDirectAction('invoice') }}>
                  {t('freight_operations.abstracts.actions.invoice.label', 'Issue invoice')}
                </Button>
              )}
              {isAbstractActionAllowed(status, 'cancel') && (
                <Button type="button" variant="outline" onClick={() => setNoteAction('cancel')}>
                  {t('freight_operations.abstracts.actions.cancel.label', 'Cancel')}
                </Button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <DetailSection title={t('freight_operations.abstracts.detail.totals', 'Totals')}>
              <FieldRow label={t('freight_operations.abstracts.columns.trips', 'Trips')} value={abstract.trip_count ?? 0} />
              <FieldRow
                label={t('freight_operations.abstracts.detail.subtotal', 'Subtotal (net)')}
                value={formatFreightAmount(abstract.subtotal_net_amount ?? '0', currency)}
              />
              <FieldRow
                label={t('freight_operations.abstracts.lines.tax', 'VAT')}
                value={formatFreightAmount(abstract.tax_total_amount ?? '0', currency)}
              />
              <FieldRow
                label={t('freight_operations.abstracts.detail.grandTotal', 'Grand total (gross)')}
                value={formatFreightAmount(abstract.grand_total_gross_amount ?? '0', currency)}
              />
            </DetailSection>

            <DetailSection title={t('freight_operations.abstracts.detail.approval', 'Approval')}>
              <FieldRow
                label={t('freight_operations.abstracts.detail.requiresApproval', 'Customer approval required')}
                value={requiresApproval
                  ? t('freight_operations.contracts.detail.approvalRequired', 'Yes')
                  : t('freight_operations.contracts.detail.approvalWaived', 'No')}
              />
              <FieldRow label={t('freight_operations.abstracts.detail.approvalMode', 'Approval route')} value={approvalMode} />
              <FieldRow label={t('freight_operations.abstracts.detail.submittedAt', 'Submitted at')} value={formatFreightDate((abstract as unknown as Record<string, unknown>).submitted_at as string | null)} />
            </DetailSection>

            <DetailSection title={t('freight_operations.abstracts.detail.invoice', 'Invoice and payments')}>
              {abstract.sales_invoice_id ? (
                <>
                  <FieldRow
                    label={t('freight_operations.abstracts.detail.invoiceNumber', 'Sales invoice')}
                    value={abstract.sales_invoice_number ?? abstract.sales_invoice_id}
                  />
                  <FieldRow label={t('freight_operations.abstracts.detail.dueDate', 'Due date')} value={formatFreightDate((abstract as unknown as Record<string, unknown>).due_date as string | null)} />
                  <FieldRow label={t('freight_operations.abstracts.detail.paid', 'Paid')} value={formatFreightAmount((abstract as unknown as Record<string, unknown>).paid_total_amount as string ?? '0', currency)} />
                  <FieldRow
                    label={t('freight_operations.abstracts.detail.outstanding', 'Outstanding')}
                    value={formatFreightAmount(abstract.outstanding_amount ?? '0', currency)}
                  />
                  <FreightPaymentsPanel
                    scope={{ abstractId: abstract.id }}
                    currencyCode={currency}
                    targetUpdatedAt={abstract.updatedAt ?? abstract.updated_at ?? null}
                    targetLabel={abstract.abstract_number}
                    canRecord
                    onChanged={() => { void query.refetch() }}
                  />
                </>
              ) : (
                <p className="text-sm text-muted-foreground">{t('freight_operations.abstracts.detail.noInvoice', 'No invoice issued yet.')}</p>
              )}
            </DetailSection>

            <DetailSection title={t('freight_operations.abstracts.detail.stamps', 'Stamps')}>
              <FieldRow label={t('freight_operations.abstracts.detail.staffNote', 'Staff finalize note')} value={String((abstract as unknown as Record<string, unknown>).staff_finalize_note ?? '—')} />
              <FieldRow label={t('freight_operations.abstracts.detail.offlineReference', 'Offline approval reference')} value={String((abstract as unknown as Record<string, unknown>).offline_approval_reference ?? '—')} />
              <FieldRow label={t('freight_operations.abstracts.detail.cancellation', 'Cancellation reason')} value={String((abstract as unknown as Record<string, unknown>).cancellation_reason ?? '—')} />
            </DetailSection>
          </div>

          <AbstractLinesSection
            lines={lines}
            currencyCode={currency}
            isLoading={linesQuery.isLoading}
            isError={linesQuery.isError}
            canRespond={isAbstractActionAllowed(status, 'respond')}
            canResolve={isAbstractActionAllowed(status, 'resolve') && disputedLines.length > 0}
            onRespond={() => setRespondOpen(true)}
            onResolve={() => setResolveOpen(true)}
          />

          {abstract.notes ? (
            <DetailSection title={t('freight_operations.abstracts.detail.notes', 'Notes')}>
              <p className="whitespace-pre-wrap text-sm text-foreground">{abstract.notes}</p>
            </DetailSection>
          ) : null}
        </div>

        <AbstractRespondDialog
          target={target}
          lines={lines}
          currencyCode={currency}
          open={respondOpen}
          onOpenChange={setRespondOpen}
          onResponded={() => {
            setRespondOpen(false)
            void refetchAll()
          }}
        />
        <AbstractResolveDialog
          target={target}
          disputedLines={disputedLines}
          currencyCode={currency}
          open={resolveOpen}
          onOpenChange={setResolveOpen}
          onResolved={() => {
            setResolveOpen(false)
            void refetchAll()
          }}
        />
        <AbstractActionDialog
          action={noteAction}
          target={target}
          onOpenChange={(open) => { if (!open) setNoteAction(null) }}
          onDone={() => {
            setNoteAction(null)
            void refetchAll()
          }}
        />
        {ConfirmDialogElement}
      </PageBody>
    </Page>
  )
}
