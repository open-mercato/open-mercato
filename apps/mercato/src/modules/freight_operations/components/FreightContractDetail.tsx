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
import { apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { canEditContract, isContractActionAllowed, type ContractAction } from '../lib/actionGates'
import { BILLING_CYCLE_FALLBACKS, CONTRACT_STATUS_FALLBACKS } from '../lib/freightEnums'
import { customerNameOf, formatFreightDate } from './freightOptions'
import { LIST_HREF } from './contractListMeta'
import { RESOURCE, type FreightContractRow } from './FreightContractsTable'
import { ContractRoutesSection } from './ContractRoutesSection'

const ENTITY_ID = 'freight_operations:freight_contract'
const DETAIL_MUTATION_CONTEXT_ID = 'freight_operations.contracts.detail'

const ACTION_SUCCESS_FALLBACKS: Record<ContractAction, string> = {
  activate: 'Contract activated.',
  suspend: 'Contract suspended.',
  resume: 'Contract resumed.',
  terminate: 'Contract terminated.',
}

const ACTION_ERROR_FALLBACKS: Record<ContractAction, string> = {
  activate: 'Unable to activate the contract.',
  suspend: 'Unable to suspend the contract.',
  resume: 'Unable to resume the contract.',
  terminate: 'Unable to terminate the contract.',
}

const ACTION_LABEL_FALLBACKS: Record<ContractAction, string> = {
  activate: 'Activate',
  suspend: 'Suspend',
  resume: 'Resume',
  terminate: 'Terminate',
}

const ACTION_CONFIRM_FALLBACKS: Record<ContractAction, string> = {
  activate: 'Activate this contract? Trips can then be recorded against its rates.',
  suspend: 'Suspend this contract? Trips can no longer be recorded against it.',
  resume: 'Resume this contract?',
  terminate: 'Terminate this contract? This is final.',
}

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

export default function FreightContractDetail({ id }: { id: string }) {
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { runMutation, retryLastMutation } = useGuardedMutation<{ formId: string; resourceKind: string; resourceId?: string; retryLastMutation: () => Promise<boolean> }>({
    contextId: DETAIL_MUTATION_CONTEXT_ID,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const query = useQuery({
    queryKey: ['freight-contract-detail', id],
    queryFn: () => fetchCrudList<FreightContractRow>(RESOURCE, { ids: String(id), pageSize: 1 }),
  })
  const contract = query.data?.items?.[0]

  const runAction = React.useCallback(async (action: ContractAction) => {
    if (!contract) return
    const confirmed = await confirm({
      title: t(`freight_operations.contracts.actions.${action}.confirm`, ACTION_CONFIRM_FALLBACKS[action]),
      variant: action === 'terminate' ? 'destructive' : 'default',
    })
    if (!confirmed) return
    try {
      await runMutation<Awaited<ReturnType<typeof apiCallOrThrow>>>({
        operation: () => withScopedApiRequestHeaders(
          buildOptimisticLockHeader(contract.updatedAt ?? contract.updated_at ?? null),
          () => apiCallOrThrow(`/api/freight_operations/contracts/${action}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: contract.id }),
          }, { errorMessage: ACTION_ERROR_FALLBACKS[action] }),
        ),
        mutationPayload: { operation: `contracts.${action}`, id: contract.id, updatedAt: contract.updatedAt ?? null },
        context: { formId: DETAIL_MUTATION_CONTEXT_ID, resourceKind: ENTITY_ID, resourceId: contract.id, retryLastMutation },
      })
      flash(t(`freight_operations.contracts.actions.${action}.success`, ACTION_SUCCESS_FALLBACKS[action]), 'success')
      await query.refetch()
    } catch (error) {
      flash(error instanceof Error && error.message ? error.message : ACTION_ERROR_FALLBACKS[action], 'error')
    }
  }, [confirm, contract, query, retryLastMutation, runMutation, t])

  if (query.isLoading) {
    return <Page><PageBody><LoadingMessage label={t('freight_operations.contracts.detail.loading', 'Loading contract…')} /></PageBody></Page>
  }
  if (query.isError) {
    return <Page><PageBody><ErrorMessage label={t('freight_operations.contracts.detail.error', 'Could not load the contract.')} /></PageBody></Page>
  }
  if (!contract) {
    return (
      <Page><PageBody>
        <RecordNotFoundState
          label={t('freight_operations.contracts.form.error.notFound', 'Contract not found.')}
          backHref={LIST_HREF}
          backLabel={t('freight_operations.contracts.actions.backToList', 'Back to contracts')}
        />
      </PageBody></Page>
    )
  }

  const statusLabel = t(`freight_operations.contracts.status.${contract.status}`, CONTRACT_STATUS_FALLBACKS[contract.status] ?? contract.status)
  const cycle = contract.billing_cycle ?? 'monthly'
  const lifecycleActions: ContractAction[] = (['activate', 'suspend', 'resume', 'terminate'] as ContractAction[])
    .filter((action) => isContractActionAllowed(contract.status, action))

  return (
    <Page>
      <PageBody>
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-3">
                <h1 className="text-xl font-semibold text-foreground">{contract.contract_number}</h1>
                <Badge variant="secondary">{statusLabel}</Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                {customerNameOf(contract.customer_snapshot)} · {contract.title}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {canEditContract(contract.status) && (
                <Button asChild variant="outline">
                  <Link href={`${LIST_HREF}/${contract.id}/edit`}>{t('freight_operations.contracts.actions.edit', 'Edit')}</Link>
                </Button>
              )}
              {lifecycleActions.map((action) => (
                <Button
                  key={action}
                  type="button"
                  variant={action === 'terminate' ? 'outline' : 'default'}
                  onClick={() => { void runAction(action) }}
                >
                  {t(`freight_operations.contracts.actions.${action}.label`, ACTION_LABEL_FALLBACKS[action])}
                </Button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <DetailSection title={t('freight_operations.contracts.detail.terms', 'Terms')}>
              <FieldRow label={t('freight_operations.contracts.form.fields.validFrom', 'Valid from')} value={formatFreightDate(contract.valid_from)} />
              <FieldRow label={t('freight_operations.contracts.form.fields.validTo', 'Valid to')} value={formatFreightDate(contract.valid_to)} />
              <FieldRow
                label={t('freight_operations.contracts.form.fields.billingCycle', 'Billing cycle')}
                value={t(`freight_operations.contracts.cycle.${cycle}`, BILLING_CYCLE_FALLBACKS[cycle] ?? cycle)}
              />
              <FieldRow
                label={t('freight_operations.contracts.form.fields.paymentTerms', 'Payment terms (days)')}
                value={contract.payment_terms_days ?? 30}
              />
            </DetailSection>

            <DetailSection title={t('freight_operations.contracts.detail.billing', 'Billing')}>
              <FieldRow label={t('freight_operations.contracts.form.fields.currency', 'Currency')} value={contract.currency_code} />
              <FieldRow label={t('freight_operations.contracts.form.fields.vatRate', 'VAT rate (%)')} value={`${contract.vat_rate ?? '15'}%`} />
              <FieldRow
                label={t('freight_operations.contracts.form.fields.requiresApproval', 'Abstracts need customer approval')}
                value={contract.requires_customer_approval
                  ? t('freight_operations.contracts.detail.approvalRequired', 'Yes')
                  : t('freight_operations.contracts.detail.approvalWaived', 'No')}
              />
              <FieldRow
                label={t('freight_operations.contracts.form.fields.signedAt', 'Signed on')}
                value={formatFreightDate((contract as unknown as Record<string, unknown>).signed_at as string | null)}
              />
            </DetailSection>
          </div>

          <ContractRoutesSection
            contractId={contract.id}
            contractStatus={contract.status}
            currencyCode={contract.currency_code}
          />

          {contract.notes ? (
            <DetailSection title={t('freight_operations.contracts.form.fields.notes', 'Notes')}>
              <p className="whitespace-pre-wrap text-sm text-foreground">{contract.notes}</p>
            </DetailSection>
          ) : null}
        </div>
        {ConfirmDialogElement}
      </PageBody>
    </Page>
  )
}
