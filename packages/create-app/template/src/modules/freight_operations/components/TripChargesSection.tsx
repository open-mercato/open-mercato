"use client"

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@open-mercato/ui/primitives/button'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { CHARGE_KIND_FALLBACKS } from '../lib/freightEnums'
import { formatFreightAmount } from './freightOptions'
import type { TripBillingStatus } from '../data/entities'
import { canEditTrip } from '../lib/actionGates'
import type { TripChargeRow } from './TripChargesDialog'

export function TripChargesSection({
  tripId,
  billingStatus,
  currencyCode,
  onEdit,
}: {
  tripId: string
  billingStatus: TripBillingStatus
  currencyCode: string
  onEdit: () => void
}) {
  const t = useT()
  const query = useQuery({
    queryKey: ['freight-trip-charges', tripId],
    queryFn: async () => {
      const call = await apiCall<{ items?: TripChargeRow[] }>(`/api/freight_operations/trips/charges?tripId=${encodeURIComponent(tripId)}`)
      return call.result?.items ?? []
    },
  })

  const rows = query.data ?? []

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">
          {t('freight_operations.trips.charges.sectionTitle', 'Extra charges')}
        </h2>
        {canEditTrip(billingStatus) ? (
          <Button type="button" size="sm" variant="outline" onClick={onEdit}>
            {t('freight_operations.trips.actions.charges.label', 'Edit charges')}
          </Button>
        ) : null}
      </div>

      {query.isLoading ? (
        <LoadingMessage label={t('freight_operations.trips.charges.loading', 'Loading charge lines…')} />
      ) : query.isError ? (
        <p className="text-sm text-destructive">{t('freight_operations.trips.charges.loadError', 'Could not load the charge lines.')}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('freight_operations.trips.charges.empty', 'No extra charges yet.')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-start text-muted-foreground">
                <th className="py-2 text-start font-medium">{t('freight_operations.trips.charges.kind', 'Kind')}</th>
                <th className="py-2 text-start font-medium">{t('freight_operations.trips.charges.descriptionLabel', 'Description')}</th>
                <th className="py-2 text-start font-medium">{t('freight_operations.trips.charges.quantity', 'Qty')}</th>
                <th className="py-2 text-start font-medium">{t('freight_operations.trips.charges.unitAmount', 'Unit (net)')}</th>
                <th className="py-2 text-start font-medium">{t('freight_operations.trips.charges.amount', 'Amount (net)')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-border/60">
                  <td className="py-2">
                    {t(`freight_operations.trips.charge_kind.${row.kind}`, CHARGE_KIND_FALLBACKS[row.kind] ?? row.kind)}
                  </td>
                  <td className="py-2">{row.description ?? '—'}</td>
                  <td className="py-2">{row.quantity ?? '—'}</td>
                  <td className="py-2">{formatFreightAmount(row.unit_amount_net, currencyCode)}</td>
                  <td className="py-2 font-medium">{formatFreightAmount(row.amount_net, currencyCode)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
