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
import {
  RENTAL_CHECK_KIND_FALLBACKS,
  RENTAL_CLIENT_TYPE_FALLBACKS,
  RENTAL_DURATION_TYPE_FALLBACKS,
  RENTAL_STATUS_FALLBACKS,
  RENTAL_TYPE_FALLBACKS,
} from '../lib/rentalEnums'
import { customerNameOf, formatRentalAmount, formatRentalDate } from './rentalOptions'
import { LIST_HREF } from './rentalListMeta'
import { RESOURCE, type RentalContractRow } from './RentalContractsTable'
import { RentalHandoverDialog, type RentalCheckTarget } from './RentalHandoverDialog'
import { RentalReturnDialog } from './RentalReturnDialog'

const ENTITY_ID = 'vehicle_rentals:rental_contract'
const DETAIL_MUTATION_CONTEXT_ID = 'vehicle_rentals.contracts.detail'

type RentalCheckRow = {
  id: string
  kind: string
  odometerKm: number
  fuelLevel: number | null
  hasDamage: boolean
  conditionNotes: string | null
  checkedAt: string
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

export default function RentalContractDetail({ id }: { id: string }) {
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [handoverOpen, setHandoverOpen] = React.useState(false)
  const [returnOpen, setReturnOpen] = React.useState(false)
  const { runMutation, retryLastMutation } = useGuardedMutation<{ formId: string; resourceKind: string; resourceId?: string; retryLastMutation: () => Promise<boolean> }>({
    contextId: DETAIL_MUTATION_CONTEXT_ID,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const query = useQuery({
    queryKey: ['rental-contract-detail', id],
    queryFn: () => fetchCrudList<RentalContractRow>(RESOURCE, { ids: String(id), pageSize: 1 }),
  })
  const rental = query.data?.items?.[0]

  const checksQuery = useQuery({
    queryKey: ['rental-contract-checks', id],
    queryFn: async () => {
      const call = await apiCall<{ items?: RentalCheckRow[] }>(`/api/vehicle_rentals/checks?contractId=${encodeURIComponent(id)}`)
      return call.result?.items ?? []
    },
  })

  const cancelRental = React.useCallback(async () => {
    if (!rental) return
    const confirmed = await confirm({ title: t('vehicle_rentals.contracts.actions.cancel.confirm', 'Cancel this rental?'), variant: 'destructive' })
    if (!confirmed) return
    try {
      await runMutation<Awaited<ReturnType<typeof apiCallOrThrow>>>({
        operation: () => withScopedApiRequestHeaders(
          buildOptimisticLockHeader(rental.updatedAt ?? rental.updated_at ?? null),
          () => apiCallOrThrow('/api/vehicle_rentals/contracts/cancel', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: rental.id }),
          }, { errorMessage: t('vehicle_rentals.errors.cancel_failed', 'Unable to cancel the rental.') }),
        ),
        mutationPayload: { operation: 'rentals.cancel', id: rental.id, updatedAt: rental.updatedAt ?? null },
        context: { formId: DETAIL_MUTATION_CONTEXT_ID, resourceKind: ENTITY_ID, resourceId: rental.id, retryLastMutation },
      })
      flash(t('vehicle_rentals.contracts.actions.cancel.success', 'Rental cancelled.'), 'success')
      await query.refetch()
    } catch (error) {
      flash(error instanceof Error && error.message ? error.message : t('vehicle_rentals.errors.cancel_failed', 'Unable to cancel the rental.'), 'error')
    }
  }, [confirm, query, rental, retryLastMutation, runMutation, t])

  if (query.isLoading) {
    return <Page><PageBody><LoadingMessage label={t('vehicle_rentals.contracts.detail.loading', 'Loading rental…')} /></PageBody></Page>
  }
  if (query.isError) {
    return <Page><PageBody><ErrorMessage label={t('vehicle_rentals.contracts.detail.error', 'Could not load the rental.')} /></PageBody></Page>
  }
  if (!rental) {
    return (
      <Page><PageBody>
        <RecordNotFoundState
          label={t('vehicle_rentals.contracts.form.error.notFound', 'Rental not found.')}
          backHref={LIST_HREF}
          backLabel={t('vehicle_rentals.contracts.actions.backToList', 'Back to rentals')}
        />
      </PageBody></Page>
    )
  }

  const raw = rental as unknown as Record<string, unknown>
  const statusLabel = t(`vehicle_rentals.status.${rental.status}`, RENTAL_STATUS_FALLBACKS[rental.status] ?? rental.status)
  const vehicleSnapshot = rental.vehicle_snapshot ?? null
  const driverSnapshot = rental.driver_snapshot ?? null
  const currency = rental.currency_code
  const checks = checksQuery.data ?? []
  const target: RentalCheckTarget = {
    id: rental.id,
    rentalNumber: rental.rental_number,
    rentalType: rental.rental_type,
    vehicleId: rental.vehicle_id ?? null,
    driverId: (raw.driver_id as string | null) ?? null,
    updatedAt: rental.updatedAt ?? null,
    updated_at: rental.updated_at ?? null,
  }

  return (
    <Page>
      <PageBody>
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-xl font-semibold text-foreground">{rental.rental_number}</h1>
                <Badge variant="secondary">{statusLabel}</Badge>
                <Badge variant="secondary">
                  {t(`vehicle_rentals.rental_type.${rental.rental_type}`, RENTAL_TYPE_FALLBACKS[rental.rental_type] ?? rental.rental_type)}
                </Badge>
                <Badge variant="secondary">
                  {t(`vehicle_rentals.client_type.${rental.client_type}`, RENTAL_CLIENT_TYPE_FALLBACKS[rental.client_type] ?? rental.client_type)}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                {customerNameOf(rental.customer_snapshot)} ·{' '}
                {[formatRentalDate(rental.start_at), formatRentalDate(rental.end_at)].join(' → ')}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {rental.status !== 'completed' && rental.status !== 'cancelled' && (
                <Button asChild variant="outline">
                  <Link href={`${LIST_HREF}/${rental.id}/edit`}>{t('vehicle_rentals.contracts.actions.edit', 'Edit')}</Link>
                </Button>
              )}
              {rental.status === 'draft' && (
                <Button type="button" onClick={() => setHandoverOpen(true)}>
                  {t('vehicle_rentals.contracts.handover.open', 'Hand over')}
                </Button>
              )}
              {rental.status === 'active' && (
                <Button type="button" onClick={() => setReturnOpen(true)}>
                  {t('vehicle_rentals.contracts.return.open', 'Record return')}
                </Button>
              )}
              {(rental.status === 'draft' || rental.status === 'active') && (
                <Button type="button" variant="outline" onClick={() => { void cancelRental() }}>
                  {t('vehicle_rentals.contracts.actions.cancel.label', 'Cancel')}
                </Button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <DetailSection title={t('vehicle_rentals.contracts.detail.assignment', 'Vehicle and driver')}>
              <FieldRow
                label={t('vehicle_rentals.contracts.form.fields.vehicle', 'Vehicle')}
                value={vehicleSnapshot
                  ? [vehicleSnapshot.plateNumber, vehicleSnapshot.make, vehicleSnapshot.model].filter(Boolean).join(' ') || '—'
                  : t('vehicle_rentals.contracts.detail.notAssigned', 'Not assigned yet')}
              />
              <FieldRow
                label={t('vehicle_rentals.contracts.form.fields.driver', 'Driver')}
                value={driverSnapshot ? String(driverSnapshot.fullName ?? '—') : '—'}
              />
              <FieldRow
                label={t('vehicle_rentals.contracts.form.fields.durationType', 'Billing period')}
                value={t(`vehicle_rentals.duration_type.${rental.duration_type}`, RENTAL_DURATION_TYPE_FALLBACKS[rental.duration_type] ?? rental.duration_type)}
              />
              <FieldRow
                label={t('vehicle_rentals.contracts.detail.actualWindow', 'Actual window')}
                value={[
                  formatRentalDate((raw.actual_start_at as string | null) ?? null),
                  formatRentalDate((raw.actual_end_at as string | null) ?? null),
                ].join(' → ')}
              />
            </DetailSection>

            <DetailSection title={t('vehicle_rentals.contracts.detail.mileage', 'Mileage')}>
              <FieldRow label={t('vehicle_rentals.contracts.handover.odo', 'Odometer (km)')} value={String(rental.odo_start_km ?? '—')} />
              <FieldRow label={t('vehicle_rentals.contracts.return.odo', 'Odometer (km)')} value={String(rental.odo_end_km ?? '—')} />
              <FieldRow label={t('vehicle_rentals.contracts.detail.usage', 'Driven (km)')} value={String(rental.usage_km ?? '—')} />
              <FieldRow label={t('vehicle_rentals.contracts.detail.extraKm', 'Extra km')} value={String(rental.extra_km ?? '—')} />
            </DetailSection>

            <DetailSection title={t('vehicle_rentals.contracts.detail.pricing', 'Pricing')}>
              <FieldRow
                label={t('vehicle_rentals.contracts.detail.baseRate', 'Rental amount (net)')}
                value={formatRentalAmount(rental.rental_amount_net ?? '0', currency)}
              />
              <FieldRow
                label={t('vehicle_rentals.contracts.detail.extraAmount', 'Extra mileage (net)')}
                value={formatRentalAmount(rental.extra_km_amount_net ?? '0', currency)}
              />
              <FieldRow label={t('vehicle_rentals.contracts.detail.net', 'Total (net)')} value={formatRentalAmount(rental.total_net_amount ?? '0', currency)} />
              <FieldRow
                label={t('vehicle_rentals.contracts.detail.tax', 'VAT ({rate}%)', { rate: String(raw.tax_rate ?? '15') })}
                value={formatRentalAmount(rental.tax_amount ?? '0', currency)}
              />
              <FieldRow label={t('vehicle_rentals.contracts.detail.gross', 'Total (gross)')} value={formatRentalAmount(rental.total_gross_amount ?? '0', currency)} />
            </DetailSection>

            <DetailSection title={t('vehicle_rentals.contracts.detail.checks', 'Vehicle checks')}>
              {checksQuery.isLoading ? (
                <LoadingMessage label={t('vehicle_rentals.contracts.detail.checksLoading', 'Loading checks…')} />
              ) : checks.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('vehicle_rentals.contracts.detail.checksEmpty', 'No checks recorded yet.')}</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {checks.map((check) => (
                    <div key={check.id} className="rounded-md border border-border p-2 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium">
                          {t(`vehicle_rentals.check_kind.${check.kind}`, RENTAL_CHECK_KIND_FALLBACKS[check.kind] ?? check.kind)}
                        </span>
                        <span className="text-xs text-muted-foreground">{formatRentalDate(check.checkedAt)}</span>
                      </div>
                      <p className="text-muted-foreground">
                        {t('vehicle_rentals.contracts.detail.checkReading', '{km} km · fuel {fuel}%', {
                          km: check.odometerKm,
                          fuel: check.fuelLevel ?? '—',
                        })}
                        {check.hasDamage ? ` · ${t('vehicle_rentals.contracts.detail.checkDamage', 'damage noted')}` : ''}
                      </p>
                      {check.conditionNotes ? <p className="text-xs text-muted-foreground">{check.conditionNotes}</p> : null}
                    </div>
                  ))}
                </div>
              )}
            </DetailSection>
          </div>

          {raw.notes ? (
            <DetailSection title={t('vehicle_rentals.contracts.form.fields.notes', 'Notes')}>
              <p className="whitespace-pre-wrap text-sm text-foreground">{String(raw.notes)}</p>
            </DetailSection>
          ) : null}
        </div>

        <RentalHandoverDialog
          target={handoverOpen ? target : null}
          onOpenChange={setHandoverOpen}
          onDone={() => {
            setHandoverOpen(false)
            void query.refetch()
            void checksQuery.refetch()
          }}
        />
        <RentalReturnDialog
          target={returnOpen && rental
            ? {
                ...target,
                odoStartKm: rental.odo_start_km ?? null,
                includedKm: (raw.included_km as number | null) ?? null,
                extraKmRate: (raw.extra_km_rate as string | null) ?? null,
                currencyCode: currency,
                ...(rental.start_at ? { startAt: rental.start_at } : {}),
              } as never
            : null}
          onOpenChange={setReturnOpen}
          onDone={() => {
            setReturnOpen(false)
            void query.refetch()
            void checksQuery.refetch()
          }}
        />
        {ConfirmDialogElement}
      </PageBody>
    </Page>
  )
}
