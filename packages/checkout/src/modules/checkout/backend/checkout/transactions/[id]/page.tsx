"use client"
import * as React from 'react'
import Link from 'next/link'
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
      <PageHeader title="Transaction Detail" description="Inspect the checkout transaction and related pay-link data." />
      <PageBody className="space-y-6">
        {payload ? (
          <>
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Badge>{payload.transaction.status}</Badge> Payment Details</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <DetailRow label="Amount" value={formatAmount(payload.transaction.amount, payload.transaction.currencyCode)} />
                <DetailRow label="Status" value={payload.transaction.status} />
                <DetailRow label="Payment Status" value={payload.transaction.paymentStatus ?? '—'} />
                <DetailRow label="Transaction ID" value={payload.transaction.id} />
                <DetailRow label="Created" value={payload.transaction.createdAt ?? '—'} />
                <DetailRow label="Updated" value={payload.transaction.updatedAt ?? '—'} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Link Details</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <DetailRow label="Link Name" value={payload.link?.name ?? '—'} />
                <DetailRow label="Slug" value={payload.link ? `/pay/${payload.link.slug}` : '—'} />
                <DetailRow label="Pricing Mode" value={payload.link?.pricingMode ?? '—'} />
                {payload.link ? (
                  <div className="pt-2">
                    <Link className="text-sm underline" href={`/pay/${encodeURIComponent(payload.link.slug)}`}>View pay link</Link>
                  </div>
                ) : null}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Customer Information</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <DetailRow label="First Name" value={payload.transaction.firstName ?? '—'} />
                <DetailRow label="Last Name" value={payload.transaction.lastName ?? '—'} />
                <DetailRow label="Email" value={payload.transaction.email ?? '—'} />
                <DetailRow label="Phone" value={payload.transaction.phone ?? '—'} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Gateway Transaction</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <DetailRow label="Gateway Txn ID" value={payload.transaction.gatewayTransactionId ?? '—'} />
                <DetailRow label="Selected Price Item" value={payload.transaction.selectedPriceItemId ?? '—'} />
                <DetailRow label="Checkout Transaction" value={transactionId || '—'} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Custom Fields</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {payload.transaction.customerData && Object.keys(payload.transaction.customerData).length > 0 ? (
                  Object.entries(payload.transaction.customerData).map(([key, value]) => (
                    <DetailRow key={key} label={key} value={typeof value === 'string' ? value : JSON.stringify(value)} />
                  ))
                ) : (
                  <div className="text-sm text-muted-foreground">No custom fields captured for this transaction.</div>
                )}
              </CardContent>
            </Card>
          </>
        ) : null}
      </PageBody>
    </Page>
  )
}
