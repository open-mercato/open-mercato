"use client"

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { KpiCard } from '@open-mercato/ui/backend/charts'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { formatFreightAmount } from './freightOptions'
import { LIST_HREF } from './orderListMeta'
import { LIST_HREF as TRIPS_HREF } from './tripListMeta'
import { LIST_HREF as ABSTRACTS_HREF } from './abstractListMeta'
import { LIST_HREF as PAYMENTS_HREF } from './paymentListMeta'

export type FreightDashboardSummary = {
  openOrders: number
  ordersAwaitingPod: number
  ordersAwaitingInvoice: number
  invoicedOrders: number
  unbilledTrips: number
  abstractsAwaitingCustomer: number
  approvedNotInvoiced: number
  overdueInvoices: number
  outstandingAmount: string
}

export default function FreightDashboard() {
  const t = useT()
  const query = useQuery({
    queryKey: ['freight-dashboard-summary'],
    queryFn: async (): Promise<FreightDashboardSummary> => {
      const call = await apiCall<FreightDashboardSummary>('/api/freight_operations/dashboard-summary')
      return call.result ?? {
        openOrders: 0,
        ordersAwaitingPod: 0,
        ordersAwaitingInvoice: 0,
        invoicedOrders: 0,
        unbilledTrips: 0,
        abstractsAwaitingCustomer: 0,
        approvedNotInvoiced: 0,
        overdueInvoices: 0,
        outstandingAmount: '0',
      }
    },
    refetchInterval: 60 * 1000,
  })

  const summary = query.data
  const loading = query.isLoading

  if (loading) {
    return <Page><PageBody><LoadingMessage label={t('freight_operations.dashboard.loading', 'Loading freight summary…')} /></PageBody></Page>
  }

  const tiles: Array<{ key: keyof FreightDashboardSummary; labelKey: string; fallback: string; href?: string }> = [
    { key: 'openOrders', labelKey: 'freight_operations.dashboard.openOrders', fallback: 'Open orders', href: `${LIST_HREF}?status=confirmed` },
    { key: 'ordersAwaitingPod', labelKey: 'freight_operations.dashboard.ordersAwaitingPod', fallback: 'Awaiting proof of delivery', href: `${LIST_HREF}?status=delivered` },
    { key: 'ordersAwaitingInvoice', labelKey: 'freight_operations.dashboard.ordersAwaitingInvoice', fallback: 'Awaiting invoice', href: `${LIST_HREF}?status=completed` },
    { key: 'invoicedOrders', labelKey: 'freight_operations.dashboard.invoicedOrders', fallback: 'Invoiced orders', href: `${LIST_HREF}?status=invoiced` },
    { key: 'unbilledTrips', labelKey: 'freight_operations.dashboard.unbilledTrips', fallback: 'Unbilled trips', href: `${TRIPS_HREF}?billingStatus=unbilled` },
    { key: 'abstractsAwaitingCustomer', labelKey: 'freight_operations.dashboard.abstractsAwaitingCustomer', fallback: 'Abstracts with the customer', href: `${ABSTRACTS_HREF}?status=submitted` },
    { key: 'approvedNotInvoiced', labelKey: 'freight_operations.dashboard.approvedNotInvoiced', fallback: 'Approved, not invoiced', href: `${ABSTRACTS_HREF}?status=approved` },
    { key: 'overdueInvoices', labelKey: 'freight_operations.dashboard.overdueInvoices', fallback: 'Overdue invoices', href: PAYMENTS_HREF },
  ]

  return (
    <Page>
      <PageBody>
        <PageHeader
          title={t('freight_operations.dashboard.title', 'Freight overview')}
          description={t('freight_operations.dashboard.description', 'The operating picture: orders in flight, deliveries without proof, and receivables.')}
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {tiles.map((tile) => {
            const value = summary ? Number(summary[tile.key]) : null
            return (
              <KpiCard
                key={tile.key}
                title={t(tile.labelKey, tile.fallback)}
                value={value}
                headerAction={tile.href ? (
                  <Link href={tile.href} className="text-sm text-muted-foreground underline-offset-4 hover:underline">
                    {t('freight_operations.dashboard.view', 'View')}
                  </Link>
                ) : undefined}
              />
            )
          })}
          <KpiCard
            title={t('freight_operations.dashboard.outstandingAmount', 'Outstanding (gross)')}
            value={summary ? Number(summary.outstandingAmount) : null}
            formatValue={(value) => formatFreightAmount(value)}
          />
        </div>
      </PageBody>
    </Page>
  )
}
