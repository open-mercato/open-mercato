"use client"

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { SalesDocumentForm } from '../../../../components/documents/SalesDocumentForm'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'

interface InboxDraft {
  actionId: string
  proposalId: string
  payload: Record<string, unknown>
}

function readInboxDraft(): InboxDraft | null {
  try {
    const raw = sessionStorage.getItem('inbox_ops.orderDraft')
    if (!raw) return null
    const parsed = JSON.parse(raw) as InboxDraft
    if (!parsed.actionId || !parsed.proposalId || !parsed.payload) return null
    return parsed
  } catch {
    return null
  }
}

export default function CreateSalesDocumentPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const t = useT()
  const requestedKind = searchParams.get('kind')
  const fromInboxAction = searchParams.get('fromInboxAction')
  const initialKind = requestedKind === 'order' ? 'order' : requestedKind === 'quote' ? 'quote' : undefined

  const inboxDraft = React.useMemo<InboxDraft | null>(() => {
    if (!fromInboxAction) return null
    return readInboxDraft()
  }, [fromInboxAction])

  const inboxPreFill = React.useMemo(() => {
    if (!inboxDraft) return undefined
    const p = inboxDraft.payload
    return {
      customerEntityId: typeof p.customerEntityId === 'string' ? p.customerEntityId : undefined,
      currencyCode: typeof p.currencyCode === 'string' ? p.currencyCode : undefined,
      channelId: typeof p.channelId === 'string' ? p.channelId : undefined,
      comments: typeof p.notes === 'string' ? p.notes : undefined,
      lineItems: Array.isArray(p.lineItems) ? (p.lineItems as Record<string, unknown>[]) : undefined,
    }
  }, [inboxDraft])

  const handleCreated = React.useCallback(async ({ id, kind }: { id: string; kind: 'order' | 'quote' }) => {
    if (inboxDraft) {
      try {
        sessionStorage.removeItem('inbox_ops.orderDraft')
      } catch { /* ignore */ }

      // Auto-add line items from the inbox draft
      const lineItems = Array.isArray(inboxDraft.payload.lineItems)
        ? (inboxDraft.payload.lineItems as Record<string, unknown>[])
        : []
      const lineEndpoint = kind === 'order' ? '/api/sales/order-lines' : '/api/sales/quote-lines'
      const currencyCode = typeof inboxDraft.payload.currencyCode === 'string'
        ? inboxDraft.payload.currencyCode.trim().toUpperCase()
        : 'USD'

      for (const [index, item] of lineItems.entries()) {
        try {
          const linePayload: Record<string, unknown> = {
            [kind === 'order' ? 'orderId' : 'quoteId']: id,
            quantity: typeof item.quantity === 'number' ? String(item.quantity) : (item.quantity || '1'),
            currencyCode,
            name: item.productName || item.name || `Line ${index + 1}`,
            kind: item.kind || (item.productId ? 'product' : 'service'),
          }
          if (item.productId) linePayload.productId = item.productId
          if (item.unitPrice) linePayload.unitPriceNet = item.unitPrice
          if (item.sku || item.catalogPrice) {
            linePayload.catalogSnapshot = {
              sku: item.sku ?? null,
              catalogPrice: item.catalogPrice ?? null,
            }
          }
          await apiCall(lineEndpoint, {
            method: 'POST',
            body: JSON.stringify(linePayload),
          })
        } catch {
          // Best-effort line creation; user can add remaining lines manually
        }
      }

      try {
        await apiCall(
          `/api/inbox_ops/proposals/${inboxDraft.proposalId}/actions/${inboxDraft.actionId}/complete`,
          {
            method: 'PATCH',
            body: JSON.stringify({
              createdEntityId: id,
              createdEntityType: kind === 'order' ? 'sales_order' : 'sales_quote',
            }),
          },
        )
      } catch {
        flash(t('inbox_ops.flash.complete_failed', 'Order created but failed to update inbox action status.'), 'warning')
      }
    }

    const target = `/backend/sales/documents/${encodeURIComponent(id)}?kind=${kind}`
    router.push(target)
  }, [inboxDraft, router, t])

  return (
    <Page>
      <PageBody>
        <SalesDocumentForm
          onCreated={handleCreated}
          isSubmitting={false}
          initialKind={initialKind}
          inboxPreFill={inboxPreFill}
        />
        <p className="mt-4 text-sm text-muted-foreground">
          {t('sales.documents.form.nextStep', 'After creation you will add items, prices, and fulfillment details.')}
        </p>
      </PageBody>
    </Page>
  )
}
