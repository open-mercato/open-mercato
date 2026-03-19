"use client"
import * as React from 'react'
import Link from 'next/link'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { Card, CardContent, CardHeader, CardTitle } from '@open-mercato/ui/primitives/card'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

type DetailPayload = {
  transaction: {
    id: string
    amount?: number | null
    currencyCode: string
    status: string
    paymentStatus?: string | null
    gatewayTransactionId?: string | null
    selectedPriceItemId?: string | null
    firstName?: string | null
    lastName?: string | null
    email?: string | null
    phone?: string | null
    customerData?: Record<string, unknown> | null
    createdAt?: string | null
    updatedAt?: string | null
  }
  link?: {
    id: string
    name: string
    slug: string
    pricingMode: string
  } | null
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid gap-1 md:grid-cols-[160px_1fr]">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="text-sm">{value}</div>
    </div>
  )
}

function formatAmount(amount: number | null | undefined, currencyCode: string): string {
  const resolved = typeof amount === 'number' ? amount : 0
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currencyCode }).format(resolved)
  } catch {
    return `${resolved.toFixed(2)} ${currencyCode}`
  }
}

export default function CheckoutTransactionDetailPage({ params }: { params: Promise<{ id: string }> | { id: string } }) {
  const t = useT()
  const [payload, setPayload] = React.useState<DetailPayload | null>(null)
  const [transactionId, setTransactionId] = React.useState('')

  React.useEffect(() => {
    let active = true
    void Promise.resolve(params)
      .then((resolvedParams) => {
        if (!active) return
        setTransactionId(resolvedParams.id)
        return readApiResultOrThrow<DetailPayload>(`/api/checkout/transactions/${encodeURIComponent(resolvedParams.id)}`)
      })
      .then((result) => {
        if (active && result) setPayload(result)
      })
      .catch(() => {
        if (active) setPayload(null)
      })
    return () => { active = false }
  }, [params])

  return (
    <Page>
      <PageHeader title={t('checkout.admin.transactionDetail.title')} description={t('checkout.admin.transactionDetail.description')} />
      <PageBody className="space-y-6">
        {payload ? (
          <>
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Badge>{t(`checkout.admin.transactions.status.${payload.transaction.status}`, payload.transaction.status)}</Badge> {t('checkout.admin.transactionDetail.sections.payment')}</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <DetailRow label={t('checkout.admin.transactionDetail.fields.amount')} value={formatAmount(payload.transaction.amount, payload.transaction.currencyCode)} />
                <DetailRow label={t('checkout.admin.transactionDetail.fields.status')} value={payload.transaction.status} />
                <DetailRow label={t('checkout.admin.transactionDetail.fields.paymentStatus')} value={payload.transaction.paymentStatus ?? t('checkout.common.emptyValue')} />
                <DetailRow label={t('checkout.admin.transactionDetail.fields.transactionId')} value={payload.transaction.id} />
                <DetailRow label={t('checkout.admin.transactionDetail.fields.created')} value={payload.transaction.createdAt ?? t('checkout.common.emptyValue')} />
                <DetailRow label={t('checkout.admin.transactionDetail.fields.updated')} value={payload.transaction.updatedAt ?? t('checkout.common.emptyValue')} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>{t('checkout.admin.transactionDetail.sections.link')}</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <DetailRow label={t('checkout.admin.transactionDetail.fields.linkName')} value={payload.link?.name ?? t('checkout.common.emptyValue')} />
                <DetailRow label={t('checkout.admin.transactionDetail.fields.slug')} value={payload.link ? `/pay/${payload.link.slug}` : t('checkout.common.emptyValue')} />
                <DetailRow label={t('checkout.admin.transactionDetail.fields.pricingMode')} value={payload.link?.pricingMode ?? t('checkout.common.emptyValue')} />
                {payload.link ? (
                  <div className="pt-2">
                    <Link className="text-sm underline" href={`/pay/${encodeURIComponent(payload.link.slug)}`}>{t('checkout.admin.transactionDetail.actions.viewPayLink')}</Link>
                  </div>
                ) : null}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>{t('checkout.admin.transactionDetail.sections.customer')}</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <DetailRow label={t('checkout.admin.transactionDetail.fields.firstName')} value={payload.transaction.firstName ?? t('checkout.common.emptyValue')} />
                <DetailRow label={t('checkout.admin.transactionDetail.fields.lastName')} value={payload.transaction.lastName ?? t('checkout.common.emptyValue')} />
                <DetailRow label={t('checkout.admin.transactionDetail.fields.email')} value={payload.transaction.email ?? t('checkout.common.emptyValue')} />
                <DetailRow label={t('checkout.admin.transactionDetail.fields.phone')} value={payload.transaction.phone ?? t('checkout.common.emptyValue')} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>{t('checkout.admin.transactionDetail.sections.gateway')}</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <DetailRow label={t('checkout.admin.transactionDetail.fields.gatewayTransactionId')} value={payload.transaction.gatewayTransactionId ?? t('checkout.common.emptyValue')} />
                <DetailRow label={t('checkout.admin.transactionDetail.fields.selectedPriceItem')} value={payload.transaction.selectedPriceItemId ?? t('checkout.common.emptyValue')} />
                <DetailRow label={t('checkout.admin.transactionDetail.fields.checkoutTransaction')} value={transactionId || t('checkout.common.emptyValue')} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>{t('checkout.admin.transactionDetail.sections.customFields')}</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {payload.transaction.customerData && Object.keys(payload.transaction.customerData).length > 0 ? (
                  Object.entries(payload.transaction.customerData).map(([key, value]) => (
                    <DetailRow key={key} label={key} value={typeof value === 'string' ? value : JSON.stringify(value)} />
                  ))
                ) : (
                  <div className="text-sm text-muted-foreground">{t('checkout.admin.transactionDetail.emptyCustomFields')}</div>
                )}
              </CardContent>
            </Card>
          </>
        ) : null}
      </PageBody>
    </Page>
  )
}
