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
import {
  canEditTrip,
  canExcludeTrip,
  isTripActionAllowed,
  type TripAction,
} from '../lib/actionGates'
import {
  RATE_BASIS_FALLBACKS,
  TRIP_BILLING_STATUS_FALLBACKS,
  TRIP_EXECUTION_STATUS_FALLBACKS,
} from '../lib/freightEnums'
import { customerNameOf, formatFreightAmount, formatFreightDate } from './freightOptions'
import { LIST_HREF } from './tripListMeta'
import { RESOURCE, type FreightTripRow } from './FreightTripsTable'
import { TripChargesSection } from './TripChargesSection'
import { TripChargesDialog } from './TripChargesDialog'
import { TripDeliverDialog } from './TripDeliverDialog'

const ENTITY_ID = 'freight_operations:freight_trip'
const DETAIL_MUTATION_CONTEXT_ID = 'freight_operations.trips.detail'

const ACTION_LABEL_FALLBACKS: Record<TripAction | 'exclude', string> = {
  dispatch: 'Dispatch',
  start: 'Start',
  deliver: 'Record delivery',
  cancel: 'Cancel',
  exclude: 'Exclude from billing',
}

const ACTION_SUCCESS_FALLBACKS: Record<TripAction | 'exclude', string> = {
  dispatch: 'Trip dispatched.',
  start: 'Trip started.',
  deliver: 'Delivery recorded.',
  cancel: 'Trip cancelled.',
  exclude: 'Trip excluded from billing.',
}

const ACTION_ERROR_FALLBACKS: Record<TripAction | 'exclude', string> = {
  dispatch: 'Unable to dispatch the trip.',
  start: 'Unable to start the trip.',
  deliver: 'Unable to record the delivery.',
  cancel: 'Unable to cancel the trip.',
  exclude: 'Unable to exclude the trip.',
}

const ACTION_CONFIRM_FALLBACKS: Record<TripAction | 'exclude', string> = {
  dispatch: 'Dispatch this trip?',
  start: 'Start this trip now?',
  deliver: 'Record the delivery of this trip?',
  cancel: 'Cancel this trip?',
  exclude: 'Exclude this trip from billing? It will never be billed.',
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

export default function FreightTripDetail({ id }: { id: string }) {
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { runMutation, retryLastMutation } = useGuardedMutation<{ formId: string; resourceKind: string; resourceId?: string; retryLastMutation: () => Promise<boolean> }>({
    contextId: DETAIL_MUTATION_CONTEXT_ID,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })
  const [deliverOpen, setDeliverOpen] = React.useState(false)
  const [chargesOpen, setChargesOpen] = React.useState(false)

  const query = useQuery({
    queryKey: ['freight-trip-detail', id],
    queryFn: () => fetchCrudList<FreightTripRow>(RESOURCE, { ids: String(id), pageSize: 1 }),
  })
  const trip = query.data?.items?.[0]

  const runAction = React.useCallback(async (action: TripAction | 'exclude') => {
    if (!trip) return
    const confirmed = await confirm({
      title: t(`freight_operations.trips.actions.${action}.confirm`, ACTION_CONFIRM_FALLBACKS[action]),
      variant: action === 'cancel' || action === 'exclude' ? 'destructive' : 'default',
    })
    if (!confirmed) return
    try {
      await runMutation<Awaited<ReturnType<typeof apiCallOrThrow>>>({
        operation: () => withScopedApiRequestHeaders(
          buildOptimisticLockHeader(trip.updatedAt ?? trip.updated_at ?? null),
          () => apiCallOrThrow(`/api/freight_operations/trips/${action}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: trip.id }),
          }, { errorMessage: ACTION_ERROR_FALLBACKS[action] }),
        ),
        mutationPayload: { operation: `trips.${action}`, id: trip.id, updatedAt: trip.updatedAt ?? null },
        context: { formId: DETAIL_MUTATION_CONTEXT_ID, resourceKind: ENTITY_ID, resourceId: trip.id, retryLastMutation },
      })
      flash(t(`freight_operations.trips.actions.${action}.success`, ACTION_SUCCESS_FALLBACKS[action]), 'success')
      await query.refetch()
    } catch (error) {
      flash(error instanceof Error && error.message ? error.message : ACTION_ERROR_FALLBACKS[action], 'error')
    }
  }, [confirm, query, retryLastMutation, runMutation, t, trip])

  if (query.isLoading) {
    return <Page><PageBody><LoadingMessage label={t('freight_operations.trips.detail.loading', 'Loading trip…')} /></PageBody></Page>
  }
  if (query.isError) {
    return <Page><PageBody><ErrorMessage label={t('freight_operations.trips.detail.error', 'Could not load the trip.')} /></PageBody></Page>
  }
  if (!trip) {
    return (
      <Page><PageBody>
        <RecordNotFoundState
          label={t('freight_operations.trips.form.error.notFound', 'Trip not found.')}
          backHref={LIST_HREF}
          backLabel={t('freight_operations.trips.actions.backToList', 'Back to trips')}
        />
      </PageBody></Page>
    )
  }

  const executionLabel = t(`freight_operations.trips.execution_status.${trip.execution_status}`, TRIP_EXECUTION_STATUS_FALLBACKS[trip.execution_status] ?? trip.execution_status)
  const billingLabel = t(`freight_operations.trips.billing_status.${trip.billing_status}`, TRIP_BILLING_STATUS_FALLBACKS[trip.billing_status] ?? trip.billing_status)
  const currency = trip.currency_code
  const raw = trip as unknown as Record<string, unknown>

  return (
    <Page>
      <PageBody>
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-xl font-semibold text-foreground">{trip.trip_number}</h1>
                <Badge variant="secondary">{executionLabel}</Badge>
                <Badge variant="secondary">{billingLabel}</Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                {customerNameOf(trip.customer_snapshot)} · {trip.origin} → {trip.destination}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {canEditTrip(trip.billing_status) && (
                <Button asChild variant="outline">
                  <Link href={`${LIST_HREF}/${trip.id}/edit`}>{t('freight_operations.trips.actions.edit', 'Edit')}</Link>
                </Button>
              )}
              {isTripActionAllowed(trip.execution_status, 'dispatch') && (
                <Button type="button" onClick={() => { void runAction('dispatch') }}>
                  {t('freight_operations.trips.actions.dispatch.label', ACTION_LABEL_FALLBACKS.dispatch)}
                </Button>
              )}
              {isTripActionAllowed(trip.execution_status, 'start') && (
                <Button type="button" onClick={() => { void runAction('start') }}>
                  {t('freight_operations.trips.actions.start.label', ACTION_LABEL_FALLBACKS.start)}
                </Button>
              )}
              {isTripActionAllowed(trip.execution_status, 'deliver') && (
                <Button type="button" onClick={() => setDeliverOpen(true)}>
                  {t('freight_operations.trips.actions.deliver.label', ACTION_LABEL_FALLBACKS.deliver)}
                </Button>
              )}
              {canExcludeTrip(trip.billing_status) && (
                <Button type="button" variant="outline" onClick={() => { void runAction('exclude') }}>
                  {t('freight_operations.trips.actions.exclude.label', ACTION_LABEL_FALLBACKS.exclude)}
                </Button>
              )}
              {canEditTrip(trip.billing_status) && isTripActionAllowed(trip.execution_status, 'cancel') && (
                <Button type="button" variant="outline" onClick={() => { void runAction('cancel') }}>
                  {t('freight_operations.trips.actions.cancel.label', ACTION_LABEL_FALLBACKS.cancel)}
                </Button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <DetailSection title={t('freight_operations.trips.detail.route', 'Route')}>
              <FieldRow label={t('freight_operations.trips.columns.lane', 'Lane')} value={`${trip.origin} → ${trip.destination}`} />
              <FieldRow
                label={t('freight_operations.trips.columns.executionDate', 'Executed')}
                value={formatFreightDate(trip.execution_date)}
              />
              <FieldRow
                label={t('freight_operations.trips.form.fields.rateLine', 'Contract rate line')}
                value={raw.route_code_snapshot ? String(raw.route_code_snapshot) : '—'}
              />
              <FieldRow label={t('freight_operations.trips.form.fields.quantity', 'Quantity')} value={trip.quantity ?? '—'} />
              {(raw.waiting_minutes || raw.distance_km) ? (
                <>
                  <FieldRow label={t('freight_operations.trips.form.fields.waiting', 'Waiting (minutes)')} value={String(raw.waiting_minutes ?? '—')} />
                  <FieldRow label={t('freight_operations.trips.form.fields.distance', 'Distance (km)')} value={String(raw.distance_km ?? '—')} />
                </>
              ) : null}
            </DetailSection>

            <DetailSection title={t('freight_operations.trips.detail.pricing', 'Pricing')}>
              <FieldRow
                label={t('freight_operations.trips.detail.rateBasis', 'Rate basis')}
                value={t(`freight_operations.contracts.rate_basis.${trip.rate_basis ?? 'per_trip'}`, RATE_BASIS_FALLBACKS[trip.rate_basis ?? 'per_trip'] ?? '—')}
              />
              <FieldRow
                label={t('freight_operations.trips.detail.unitPrice', 'Unit price (net)')}
                value={formatFreightAmount(trip.unit_price_net ?? '0', currency)}
              />
              <FieldRow label={t('freight_operations.trips.detail.base', 'Base amount (net)')} value={formatFreightAmount(trip.base_amount_net ?? '0', currency)} />
              <FieldRow label={t('freight_operations.trips.detail.charges', 'Charges (net)')} value={formatFreightAmount(trip.charges_total_net ?? '0', currency)} />
              <FieldRow label={t('freight_operations.trips.detail.net', 'Total (net)')} value={formatFreightAmount(trip.total_net_amount, currency)} />
              <FieldRow label={t('freight_operations.trips.detail.tax', 'VAT')} value={formatFreightAmount(trip.tax_amount, currency)} />
              <FieldRow label={t('freight_operations.trips.detail.gross', 'Total (gross)')} value={formatFreightAmount(trip.total_gross_amount, currency)} />
            </DetailSection>

            <DetailSection title={t('freight_operations.trips.detail.billingStatus', 'Billing status')}>
              <FieldRow label={t('freight_operations.trips.columns.billingStatus', 'Billing')} value={billingLabel} />
              <FieldRow
                label={t('freight_operations.trips.detail.abstract', 'Abstract')}
                value={trip.active_abstract_id
                  ? <Link className="underline-offset-4 hover:underline" href={`/backend/freight/abstracts/${trip.active_abstract_id}`}>{t('freight_operations.trips.detail.viewAbstract', 'View abstract')}</Link>
                  : '—'}
              />
              <FieldRow
                label={t('freight_operations.trips.detail.source', 'Source')}
                value={trip.freight_order_id
                  ? <Link className="underline-offset-4 hover:underline" href={`/backend/freight/orders/${trip.freight_order_id}`}>{t('freight_operations.trips.detail.viewOrder', 'View spot order')}</Link>
                  : (trip.contract_id
                    ? <Link className="underline-offset-4 hover:underline" href={`/backend/freight/contracts/${trip.contract_id}`}>{t('freight_operations.trips.detail.viewContract', 'View contract')}</Link>
                    : '—')}
              />
            </DetailSection>

            <DetailSection title={t('freight_operations.trips.detail.pod', 'Proof of delivery')}>
              <FieldRow label={t('freight_operations.trips.deliver.podReference', 'POD reference')} value={trip.pod_reference ?? '—'} />
              <FieldRow
                label={t('freight_operations.trips.deliver.receivedBy', 'Received by')}
                value={raw.pod_received_by_name ? String(raw.pod_received_by_name) : '—'}
              />
              <FieldRow
                label={t('freight_operations.trips.deliver.receivedAt', 'Received at')}
                value={formatFreightDate(raw.pod_received_at as string | null)}
              />
            </DetailSection>
          </div>

          <TripChargesSection
            tripId={trip.id}
            billingStatus={trip.billing_status}
            currencyCode={currency}
            onEdit={() => setChargesOpen(true)}
          />

          {raw.notes ? (
            <DetailSection title={t('freight_operations.trips.form.fields.notes', 'Notes')}>
              <p className="whitespace-pre-wrap text-sm text-foreground">{String(raw.notes)}</p>
            </DetailSection>
          ) : null}
        </div>

        <TripDeliverDialog
          trip={deliverOpen ? trip : null}
          onOpenChange={(open) => setDeliverOpen(open)}
          onDelivered={() => {
            setDeliverOpen(false)
            void query.refetch()
          }}
        />
        <TripChargesDialog
          trip={chargesOpen ? trip : null}
          onOpenChange={(open) => setChargesOpen(open)}
          onSaved={() => {
            setChargesOpen(false)
            void query.refetch()
          }}
        />
        {ConfirmDialogElement}
      </PageBody>
    </Page>
  )
}
