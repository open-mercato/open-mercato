"use client"

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { ErrorMessage, LoadingMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { formatDualCalendarDate } from '../../saudi_localization/lib/saudi/hijri'
import { customerNameOf, formatFreightDate } from './freightOptions'
import {
  DELIVERY_NOTE_STATUS_FALLBACKS,
  EXTERNAL_WAYBILL_STATUS_FALLBACKS,
  snapshotName,
  type DeliveryNoteActionMode,
  type FreightDeliveryNoteRow,
} from './deliveryNoteOptions'
import { DeliveryNoteActionDialog } from './DeliveryNoteActionDialog'

const RESOURCE = 'freight_operations/delivery-notes'
const LABEL_MISSING = '—'

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

function displayDate(value: string | null | undefined, locale: string): string {
  if (!value) return LABEL_MISSING
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })
}

export default function DeliveryNoteDetail({ id }: { id: string }) {
  const t = useT()
  const locale = useLocale()
  const [actionMode, setActionMode] = React.useState<DeliveryNoteActionMode | null>(null)

  const query = useQuery({
    queryKey: ['freight-delivery-note-detail', id],
    queryFn: () => fetchCrudList<FreightDeliveryNoteRow>(RESOURCE, { ids: String(id), pageSize: 1 }),
  })

  const note = query.data?.items?.[0] ?? null

  if (query.isLoading) {
    return (
      <Page>
        <PageBody>
          <LoadingMessage label={t('freight_operations.delivery_notes.loading', 'Loading delivery note…')} />
        </PageBody>
      </Page>
    )
  }

  if (query.isError) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage
            label={t('freight_operations.delivery_notes.error.loadTitle', 'Unable to load the delivery note')}
            description={t(
              'freight_operations.delivery_notes.error.load',
              'Unable to load delivery notes.',
            )}
          />
        </PageBody>
      </Page>
    )
  }

  if (!note) {
    return (
      <Page>
        <PageBody>
          <RecordNotFoundState
            label={t('freight_operations.delivery_notes.error.notFoundTitle', 'Delivery note not found')}
            backHref="/backend/freight/delivery-notes"
            backLabel={t('freight_operations.delivery_notes.actions.backToList', 'Back to delivery notes')}
            description={t(
              'freight_operations.delivery_notes.error.notFound',
              'The delivery note does not exist in this organization.',
            )}
          />
        </PageBody>
      </Page>
    )
  }

  const sellerName = snapshotName(note.seller_snapshot, 'sellerName')
  const sellerVat = snapshotName(note.seller_snapshot, 'vatRegistrationNumber')
  const sellerCr = snapshotName(note.seller_snapshot, 'commercialRegistrationNumber')
  const vehiclePlate = snapshotName(note.vehicle_snapshot, 'plateNumber')
  const vehicleMake = snapshotName(note.vehicle_snapshot, 'make')
  const vehicleModel = snapshotName(note.vehicle_snapshot, 'model')
  const driverName = snapshotName(note.driver_snapshot, 'fullName')
  const driverPhone = snapshotName(note.driver_snapshot, 'phone')
  const driverLicense = snapshotName(note.driver_snapshot, 'licenseNumber')
  const issuedDual = formatDualCalendarDate(note.issued_at, { locale, latinDigits: true })

  const actions: Array<{ mode: DeliveryNoteActionMode; label: string }> = []
  if (note.status === 'draft') actions.push({ mode: 'issue', label: t('freight_operations.delivery_notes.issue.submit', 'Issue') })
  if (note.status === 'issued') {
    actions.push({ mode: 'deliver', label: t('freight_operations.delivery_notes.actions.recordDelivery', 'Record delivery') })
  }
  if (note.status !== 'draft' && note.status !== 'cancelled' && note.external_waybill_status !== 'recorded') {
    actions.push({ mode: 'waybill', label: t('freight_operations.delivery_notes.actions.recordWaybill', 'Record waybill') })
  }
  if (note.external_waybill_status === 'recorded') {
    actions.push({ mode: 'waybill_cancel', label: t('freight_operations.delivery_notes.actions.cancelWaybill', 'Cancel waybill') })
  }
  if (note.status === 'draft' || note.status === 'issued') {
    actions.push({ mode: 'cancel', label: t('freight_operations.delivery_notes.actions.cancel', 'Cancel note') })
  }

  return (
    <Page>
      <PageBody>
        <PageHeader
          title={note.note_number}
          description={t('freight_operations.delivery_notes.detail.description', 'Transport delivery note and Bayan Naql reference')}
          actions={(
            <div className="flex flex-wrap items-center gap-2 print:hidden">
              <Button asChild variant="outline">
                <Link href="/backend/freight/delivery-notes">
                  {t('freight_operations.delivery_notes.actions.backToList', 'Back to delivery notes')}
                </Link>
              </Button>
              <Button type="button" variant="outline" onClick={() => window.print()}>
                {t('freight_operations.delivery_notes.actions.print', 'Print')}
              </Button>
              {actions.map((action) => (
                <Button key={action.mode} type="button" onClick={() => setActionMode(action.mode)}>
                  {action.label}
                </Button>
              ))}
            </div>
          )}
        />
        <div className="flex flex-col gap-4 print:hidden">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">
              {t(`freight_operations.delivery_notes.status.${note.status}`, DELIVERY_NOTE_STATUS_FALLBACKS[note.status])}
            </Badge>
            <Badge variant="secondary">
              {t(
                `freight_operations.delivery_notes.waybillStatus.${note.external_waybill_status}`,
                EXTERNAL_WAYBILL_STATUS_FALLBACKS[note.external_waybill_status],
              )}
            </Badge>
            {note.freight_order_id ? (
              <Link
                href={`/backend/freight/orders/${note.freight_order_id}`}
                className="text-sm text-foreground underline-offset-4 hover:underline"
              >
                {t('freight_operations.delivery_notes.detail.orderLink', 'Order {number}', {
                  number: note.order_number_snapshot ?? note.freight_order_id,
                })}
              </Link>
            ) : null}
            {note.freight_trip_id ? (
              <Link
                href={`/backend/freight/trips/${note.freight_trip_id}`}
                className="text-sm text-foreground underline-offset-4 hover:underline"
              >
                {t('freight_operations.delivery_notes.detail.tripLink', 'Trip {number}', {
                  number: note.trip_number_snapshot ?? note.freight_trip_id,
                })}
              </Link>
            ) : null}
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <DetailSection title={t('freight_operations.delivery_notes.detail.parties', 'Parties')}>
              <FieldRow
                label={t('freight_operations.delivery_notes.fields.customer', 'Customer')}
                value={customerNameOf(note.customer_snapshot, LABEL_MISSING)}
              />
              <FieldRow
                label={t('freight_operations.delivery_notes.fields.consigneeName', 'Consignee')}
                value={note.consignee_name || LABEL_MISSING}
              />
              <FieldRow
                label={t('freight_operations.delivery_notes.fields.consigneePhone', 'Consignee phone')}
                value={note.consignee_phone || LABEL_MISSING}
              />
              <FieldRow
                label={t('freight_operations.delivery_notes.fields.seller', 'Seller')}
                value={sellerName || LABEL_MISSING}
              />
              <FieldRow
                label={t('freight_operations.delivery_notes.fields.sellerVat', 'Seller VAT number')}
                value={sellerVat || LABEL_MISSING}
              />
            </DetailSection>

            <DetailSection title={t('freight_operations.delivery_notes.detail.route', 'Route and dates')}>
              <FieldRow label={t('freight_operations.delivery_notes.fields.origin', 'Origin')} value={note.origin} />
              <FieldRow
                label={t('freight_operations.delivery_notes.fields.destination', 'Destination')}
                value={note.destination}
              />
              <FieldRow
                label={t('freight_operations.delivery_notes.fields.requestedPickup', 'Requested pickup')}
                value={formatFreightDate(note.requested_pickup_at, locale)}
              />
              <FieldRow
                label={t('freight_operations.delivery_notes.fields.requestedDelivery', 'Requested delivery')}
                value={formatFreightDate(note.requested_delivery_at, locale)}
              />
              <FieldRow
                label={t('freight_operations.delivery_notes.fields.issuedAt', 'Issued at')}
                value={displayDate(note.issued_at, locale)}
              />
            </DetailSection>

            <DetailSection title={t('freight_operations.delivery_notes.detail.cargo', 'Cargo')}>
              <FieldRow
                label={t('freight_operations.delivery_notes.fields.cargoDescription', 'Cargo description')}
                value={note.cargo_description}
              />
              <FieldRow
                label={t('freight_operations.delivery_notes.fields.cargoQuantity', 'Quantity')}
                value={
                  note.cargo_quantity
                    ? `${note.cargo_quantity}${note.cargo_unit ? ` ${note.cargo_unit}` : ''}`
                    : LABEL_MISSING
                }
              />
              <FieldRow
                label={t('freight_operations.delivery_notes.fields.cargoWeight', 'Weight (kg)')}
                value={note.cargo_weight_kg || LABEL_MISSING}
              />
              <FieldRow
                label={t('freight_operations.delivery_notes.fields.cargoVolume', 'Volume (m³)')}
                value={note.cargo_volume_m3 || LABEL_MISSING}
              />
              <FieldRow
                label={t('freight_operations.delivery_notes.fields.sealNumber', 'Seal number')}
                value={note.seal_number || LABEL_MISSING}
              />
            </DetailSection>

            <DetailSection title={t('freight_operations.delivery_notes.detail.execution', 'Driver and vehicle')}>
              <FieldRow label={t('freight_operations.delivery_notes.fields.driver', 'Driver')} value={driverName || LABEL_MISSING} />
              <FieldRow
                label={t('freight_operations.delivery_notes.fields.driverPhone', 'Driver phone')}
                value={driverPhone || LABEL_MISSING}
              />
              <FieldRow
                label={t('freight_operations.delivery_notes.fields.vehicle', 'Vehicle')}
                value={[vehiclePlate, vehicleMake, vehicleModel].filter(Boolean).join(' · ') || LABEL_MISSING}
              />
            </DetailSection>

            <DetailSection title={t('freight_operations.delivery_notes.detail.delivery', 'Delivery and POD')}>
              <FieldRow
                label={t('freight_operations.delivery_notes.fields.receivedByName', 'Received by')}
                value={note.received_by_name || LABEL_MISSING}
              />
              <FieldRow
                label={t('freight_operations.delivery_notes.fields.receivedByIdNumber', 'Receiver ID number')}
                value={note.received_by_id_number || LABEL_MISSING}
              />
              <FieldRow
                label={t('freight_operations.delivery_notes.fields.podReference', 'POD reference')}
                value={note.pod_reference || LABEL_MISSING}
              />
              <FieldRow
                label={t('freight_operations.delivery_notes.fields.popReference', 'Proof of pickup reference')}
                value={note.pop_reference || LABEL_MISSING}
              />
              <FieldRow
                label={t('freight_operations.delivery_notes.fields.deliveredAt', 'Delivered at')}
                value={displayDate(note.delivered_at, locale)}
              />
            </DetailSection>

            <DetailSection title={t('freight_operations.delivery_notes.detail.waybill', 'Bayan Naql waybill')}>
              <FieldRow
                label={t('freight_operations.delivery_notes.fields.waybillNumber', 'Waybill number')}
                value={note.external_waybill_number || LABEL_MISSING}
              />
              <FieldRow
                label={t('freight_operations.delivery_notes.fields.waybillStatus', 'Waybill status')}
                value={t(
                  `freight_operations.delivery_notes.waybillStatus.${note.external_waybill_status}`,
                  EXTERNAL_WAYBILL_STATUS_FALLBACKS[note.external_waybill_status],
                )}
              />
              <FieldRow
                label={t('freight_operations.delivery_notes.fields.waybillRecordedAt', 'Recorded at')}
                value={displayDate(note.external_waybill_recorded_at, locale)}
              />
              <FieldRow
                label={t('freight_operations.delivery_notes.fields.waybillCancelledAt', 'Cancelled at')}
                value={displayDate(note.external_waybill_cancelled_at, locale)}
              />
            </DetailSection>
          </div>

          {note.cancellation_reason ? (
            <DetailSection title={t('freight_operations.delivery_notes.detail.cancellation', 'Cancellation')}>
              <p className="text-sm text-foreground">{note.cancellation_reason}</p>
            </DetailSection>
          ) : null}
          {note.notes ? (
            <DetailSection title={t('freight_operations.delivery_notes.fields.notes', 'Notes')}>
              <p className="whitespace-pre-wrap text-sm text-foreground">{note.notes}</p>
            </DetailSection>
          ) : null}
        </div>

        <style>{`
          @media print {
            body * { visibility: hidden; }
            .delivery-note-print, .delivery-note-print * { visibility: visible; }
            .delivery-note-print { position: absolute; inset: 0; width: 100%; }
            @page { size: A4; margin: 14mm; }
          }
        `}</style>
        <div className="delivery-note-print mt-6 flex flex-col gap-6 rounded-lg border border-border bg-card p-8 text-foreground">
          <header className="flex items-start justify-between gap-6 border-b border-border pb-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                {t('freight_operations.delivery_notes.print.documentType', 'Delivery note')}
              </p>
              <h1 className="text-2xl font-semibold">{note.note_number}</h1>
              {issuedDual ? <p className="text-xs text-muted-foreground">{issuedDual}</p> : null}
            </div>
            <div className="text-end text-sm">
              <p className="font-semibold">{sellerName || LABEL_MISSING}</p>
              {sellerVat ? (
                <p className="text-xs text-muted-foreground">
                  {t('freight_operations.delivery_notes.fields.sellerVat', 'Seller VAT number')}: {sellerVat}
                </p>
              ) : null}
              {sellerCr ? (
                <p className="text-xs text-muted-foreground">
                  {t('freight_operations.delivery_notes.fields.sellerCr', 'Commercial registration')}: {sellerCr}
                </p>
              ) : null}
            </div>
          </header>

          <div className="grid grid-cols-2 gap-6 text-sm">
            <div>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('freight_operations.delivery_notes.print.consignee', 'Consignee')}
              </h2>
              <p className="font-medium">{note.consignee_name || customerNameOf(note.customer_snapshot, LABEL_MISSING)}</p>
              {note.consignee_phone ? <p>{note.consignee_phone}</p> : null}
              {note.consignee_address ? <p>{note.consignee_address}</p> : null}
            </div>
            <div>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('freight_operations.delivery_notes.print.route', 'Route')}
              </h2>
              <p>
                <span className="text-muted-foreground">{t('freight_operations.delivery_notes.fields.origin', 'Origin')}:</span>{' '}
                {note.origin}
              </p>
              <p>
                <span className="text-muted-foreground">{t('freight_operations.delivery_notes.fields.destination', 'Destination')}:</span>{' '}
                {note.destination}
              </p>
              <p>
                <span className="text-muted-foreground">{t('freight_operations.delivery_notes.fields.requestedPickup', 'Requested pickup')}:</span>{' '}
                {formatFreightDate(note.requested_pickup_at, locale)}
              </p>
            </div>
          </div>

          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-start">
                <th className="py-2 text-start">{t('freight_operations.delivery_notes.fields.cargoDescription', 'Cargo description')}</th>
                <th className="py-2 text-end">{t('freight_operations.delivery_notes.fields.cargoQuantity', 'Quantity')}</th>
                <th className="py-2 text-end">{t('freight_operations.delivery_notes.fields.cargoWeight', 'Weight (kg)')}</th>
                <th className="py-2 text-end">{t('freight_operations.delivery_notes.fields.cargoVolume', 'Volume (m³)')}</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border">
                <td className="py-2">{note.cargo_description}</td>
                <td className="py-2 text-end">
                  {note.cargo_quantity ? `${note.cargo_quantity}${note.cargo_unit ? ` ${note.cargo_unit}` : ''}` : LABEL_MISSING}
                </td>
                <td className="py-2 text-end">{note.cargo_weight_kg || LABEL_MISSING}</td>
                <td className="py-2 text-end">{note.cargo_volume_m3 || LABEL_MISSING}</td>
              </tr>
            </tbody>
          </table>

          <div className="grid grid-cols-2 gap-6 text-sm">
            <div>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('freight_operations.delivery_notes.print.driver', 'Driver and vehicle')}
              </h2>
              <p>{driverName || LABEL_MISSING}</p>
              {driverPhone ? <p>{driverPhone}</p> : null}
              {driverLicense ? (
                <p>
                  {t('freight_operations.delivery_notes.fields.driverLicense', 'License')}: {driverLicense}
                </p>
              ) : null}
              <p>{[vehiclePlate, vehicleMake, vehicleModel].filter(Boolean).join(' · ') || LABEL_MISSING}</p>
              {note.seal_number ? (
                <p>
                  {t('freight_operations.delivery_notes.fields.sealNumber', 'Seal number')}: {note.seal_number}
                </p>
              ) : null}
            </div>
            <div>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('freight_operations.delivery_notes.print.waybill', 'Bayan Naql')}
              </h2>
              <p>
                {t('freight_operations.delivery_notes.fields.waybillNumber', 'Waybill number')}:{' '}
                {note.external_waybill_number || LABEL_MISSING}
              </p>
              <p>
                {t('freight_operations.delivery_notes.fields.waybillStatus', 'Waybill status')}:{' '}
                {t(
                  `freight_operations.delivery_notes.waybillStatus.${note.external_waybill_status}`,
                  EXTERNAL_WAYBILL_STATUS_FALLBACKS[note.external_waybill_status],
                )}
              </p>
              <p>
                {t('freight_operations.delivery_notes.fields.podReference', 'POD reference')}:{' '}
                {note.pod_reference || LABEL_MISSING}
              </p>
              <p>
                {t('freight_operations.delivery_notes.fields.receivedByName', 'Received by')}:{' '}
                {note.received_by_name || LABEL_MISSING}
              </p>
            </div>
          </div>

          {note.notes ? (
            <div>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('freight_operations.delivery_notes.fields.notes', 'Notes')}
              </h2>
              <p className="whitespace-pre-wrap text-sm">{note.notes}</p>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-10 pt-10 text-sm">
            <div className="border-t border-border pt-2 text-muted-foreground">
              {t('freight_operations.delivery_notes.print.receiverSignature', 'Receiver name and signature')}
            </div>
            <div className="border-t border-border pt-2 text-muted-foreground">
              {t('freight_operations.delivery_notes.print.driverSignature', 'Driver name and signature')}
            </div>
          </div>

          <footer className="border-t border-border pt-3 text-xs text-muted-foreground">
            {t(
              'freight_operations.delivery_notes.print.legalNote',
              'This is a delivery note, not a tax invoice. The Bayan Naql waybill is issued separately on the TGA platform.',
            )}
          </footer>
        </div>
        <DeliveryNoteActionDialog
          note={note}
          mode={actionMode}
          onOpenChange={(open) => {
            if (!open) setActionMode(null)
          }}
          onCompleted={() => { void query.refetch() }}
        />
      </PageBody>
    </Page>
  )
}
