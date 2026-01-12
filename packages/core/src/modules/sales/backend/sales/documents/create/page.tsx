"use client"

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { SalesDocumentForm } from '../../../../components/documents/SalesDocumentForm'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export default function CreateSalesDocumentPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const t = useT()
  const requestedKind = searchParams.get('kind')
  const initialKind = requestedKind === 'order' ? 'order' : requestedKind === 'quote' ? 'quote' : undefined

  return (
    <Page>
      <PageBody>
        <SalesDocumentForm
          onCreated={({ id, kind }) => {
            const target = `/backend/sales/documents/${encodeURIComponent(id)}?kind=${kind}`
            router.push(target)
          }}
          isSubmitting={false}
          initialKind={initialKind}
        />
        <p className="mt-4 text-sm text-muted-foreground">
          {t('sales.documents.form.nextStep', 'After creation you will add items, prices, and fulfillment details.')}
        </p>
      </PageBody>
    </Page>
  )
}
