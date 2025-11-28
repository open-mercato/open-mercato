"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { SalesDocumentForm } from '../../../../components/documents/SalesDocumentForm'
import { useT } from '@/lib/i18n/context'

export default function CreateSalesDocumentPage() {
  const router = useRouter()
  const t = useT()

  return (
    <Page>
      <PageBody>
        <SalesDocumentForm
          onCreated={({ id, kind }) => {
            const target = `/backend/sales/documents/${encodeURIComponent(id)}?kind=${kind}`
            router.push(target)
          }}
          isSubmitting={false}
        />
        <p className="mt-4 text-sm text-muted-foreground">
          {t('sales.documents.form.nextStep', 'After creation you will add items, prices, and fulfillment details.')}
        </p>
      </PageBody>
    </Page>
  )
}

