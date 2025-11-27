"use client"

import * as React from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@/lib/i18n/context'

type DocumentRecord = {
  id: string
  orderNumber?: string | null
  quoteNumber?: string | null
  status?: string | null
  currencyCode?: string | null
  customerEntityId?: string | null
  billingAddressId?: string | null
  shippingAddressId?: string | null
  createdAt?: string
  updatedAt?: string
}

async function fetchDocument(id: string, kind: 'order' | 'quote'): Promise<DocumentRecord | null> {
  const params = new URLSearchParams({ id, page: '1', pageSize: '1' })
  const call = await apiCall<{ items?: DocumentRecord[] }>(`/api/sales/${kind === 'order' ? 'orders' : 'quotes'}?${params.toString()}`)
  if (!call.ok) return null
  const items = Array.isArray(call.result?.items) ? call.result?.items : []
  return items.length ? (items[0] as DocumentRecord) : null
}

export default function SalesDocumentDetailPage({ params }: { params: { id: string } }) {
  const t = useT()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [loading, setLoading] = React.useState(true)
  const [record, setRecord] = React.useState<DocumentRecord | null>(null)
  const [kind, setKind] = React.useState<'order' | 'quote'>('quote')
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      const requestedKind = searchParams.get('kind')
      const preferredKind = requestedKind === 'order' ? 'order' : requestedKind === 'quote' ? 'quote' : null
      const kindsToTry: Array<'order' | 'quote'> = preferredKind ? [preferredKind] : ['quote', 'order']
      for (const candidate of kindsToTry) {
        try {
          const entry = await fetchDocument(params.id, candidate)
          if (entry && !cancelled) {
            setRecord(entry)
            setKind(candidate)
            setLoading(false)
            return
          }
        } catch (err) {
          console.error('sales.documents.detail.load', err)
        }
      }
      if (!cancelled) {
        setLoading(false)
        setError(t('sales.documents.detail.error', 'Document not found or inaccessible.'))
      }
    }
    load().catch(() => {})
    return () => { cancelled = true }
  }, [params.id, searchParams, t])

  const number = record?.orderNumber ?? record?.quoteNumber ?? record?.id

  return (
    <Page>
      <PageBody>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner className="h-4 w-4" />
            {t('sales.documents.detail.loading', 'Loading document…')}
          </div>
        ) : error ? (
          <div className="space-y-3">
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" onClick={() => router.push('/backend/sales/documents/create')}>
              {t('sales.documents.detail.backToCreate', 'Create a new document')}
            </Button>
          </div>
        ) : record ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase text-muted-foreground">{kind === 'order' ? t('sales.documents.detail.order', 'Sales order') : t('sales.documents.detail.quote', 'Sales quote')}</p>
                <h1 className="text-xl font-semibold">{number}</h1>
                {record.status ? <p className="text-sm text-muted-foreground">{record.status}</p> : null}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => router.push('/backend/sales/channels')}>
                  {t('sales.documents.detail.back', 'Back to Sales')}
                </Button>
                <Button
                  onClick={() => {
                    flash(t('sales.documents.detail.edit.stub', 'Line item editing will be available soon.'), 'info')
                  }}
                >
                  {t('sales.documents.detail.edit', 'Edit details')}
                </Button>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded border p-3">
                <p className="text-xs uppercase text-muted-foreground">{t('sales.documents.detail.customer', 'Customer')}</p>
                <p className="text-sm font-medium">{record.customerEntityId ?? t('sales.documents.detail.customer.empty', 'Not linked')}</p>
              </div>
              <div className="rounded border p-3">
                <p className="text-xs uppercase text-muted-foreground">{t('sales.documents.detail.currency', 'Currency')}</p>
                <p className="text-sm font-medium">{record.currencyCode ?? '—'}</p>
              </div>
              <div className="rounded border p-3">
                <p className="text-xs uppercase text-muted-foreground">{t('sales.documents.detail.shipping', 'Shipping address')}</p>
                <p className="text-sm font-medium">{record.shippingAddressId ?? t('sales.documents.detail.customer.empty', 'Not linked')}</p>
              </div>
              <div className="rounded border p-3">
                <p className="text-xs uppercase text-muted-foreground">{t('sales.documents.detail.billing', 'Billing address')}</p>
                <p className="text-sm font-medium">{record.billingAddressId ?? t('sales.documents.detail.customer.empty', 'Not linked')}</p>
              </div>
              <div className="rounded border p-3">
                <p className="text-xs uppercase text-muted-foreground">{t('sales.documents.detail.timestamps', 'Timestamps')}</p>
                <p className="text-sm font-medium">
                  {t('sales.documents.detail.created', 'Created')}: {record.createdAt ?? '—'}
                </p>
                <p className="text-sm font-medium">
                  {t('sales.documents.detail.updated', 'Updated')}: {record.updatedAt ?? '—'}
                </p>
              </div>
            </div>
          </div>
        ) : null}
      </PageBody>
    </Page>
  )
}
