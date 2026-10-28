"use client"

import * as React from 'react'
import Link from 'next/link'
import { Lock } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@open-mercato/ui/primitives/card'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { formatDate, formatMoney, type LeaseDetail } from './leaseModel'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-xs font-medium uppercase text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  )
}

export function LeaseSummaryCard({ detail }: { detail: LeaseDetail }) {
  const t = useT()
  const locale = useLocale()
  const lease = detail.lease
  const acceptedProposal = detail.proposals.find((proposal) => proposal.kind === 'new' && proposal.status === 'approved')
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('property_management.leases.detail.summary', 'Lease')}</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-4 sm:grid-cols-2">
          <Field label={t('property_management.leases.detail.building', 'Building')}>{lease.buildingName ?? '—'}</Field>
          <Field label={t('property_management.leases.detail.unit', 'Unit')}>
            {[lease.unitName, lease.floorName].filter(Boolean).join(' · ') || '—'}
          </Field>
          <Field label={t('property_management.leases.detail.tenant', 'Tenant')}>
            <Link href={`/backend/customers/companies/${lease.customerCompanyId}`} className="hover:underline">{lease.companyName ?? '—'}</Link>
          </Field>
          <Field label={t('property_management.leases.detail.contact', 'Primary contact')}>{lease.contactName ?? '—'}</Field>
          <Field label={t('property_management.leases.detail.product', 'Product')}>
            <span className="flex items-center gap-1">
              <Lock className="size-3.5 text-muted-foreground" aria-hidden />
              {lease.productName ?? '—'}
            </span>
            <span className="block text-xs text-muted-foreground">
              {t('property_management.leases.detail.productHint', 'Recorded on the lease when it was made. It stays on the lease and every invoice under it, even if the unit’s product changes later.')}
            </span>
          </Field>
          <Field label={t('property_management.leases.detail.salesOrder', 'Sales order')}>
            {lease.salesOrderId ? (
              <Link href={`/backend/sales/orders/${lease.salesOrderId}`} className="hover:underline">{lease.salesOrderNumber ?? lease.salesOrderId}</Link>
            ) : (
              <span className="text-muted-foreground">{t('property_management.leases.detail.noOrder', 'Not created yet')}</span>
            )}
            <span className="block text-xs text-muted-foreground">
              {acceptedProposal
                ? t('property_management.leases.detail.orderFromProposal', 'Created when the tenant approved the proposal in their portal.')
                : t('property_management.leases.detail.orderDirect', 'Created directly for this lease. Sales issues each month’s invoice against it.')}
            </span>
          </Field>
          <Field label={t('property_management.leases.detail.start', 'Lease start')}>{formatDate(lease.startsOn, locale)}</Field>
          <Field label={t('property_management.leases.detail.end', 'Lease end')}>
            {formatDate(lease.endsOn, locale)}
            <span className="block text-xs text-muted-foreground">
              {t('property_management.leases.detail.termHint', '{months}-month term. Change it with Extend lease or End lease.', { months: lease.termMonths })}
            </span>
          </Field>
          <Field label={t('property_management.leases.detail.rate', 'Monthly rate')}>{formatMoney(lease.monthlyRate, lease.currencyCode, locale)}</Field>
        </dl>
      </CardContent>
    </Card>
  )
}

export default LeaseSummaryCard
