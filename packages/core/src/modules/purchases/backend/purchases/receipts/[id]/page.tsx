"use client"

import * as React from 'react'
import { useParams, useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { ArrowLeft, CheckCircle2, PackageCheck, AlertCircle } from 'lucide-react'

type ReceiptLine = {
  id: string
  orderLineId: string
  productDescription: string
  quantityExpected: string
  quantityDone: string
}

type ReceiptDetail = {
  id: string
  receiptNumber: string
  status: string
  isBackorder: boolean
  backorderOfId?: string | null
  purchaseOrder?: { id: string; orderNumber: string } | null
  receivedDate?: string | null
  createdAt: string
  lines: ReceiptLine[]
}

export default function GoodsReceiptDetailPage(props: { params?: { id?: string } }) {
  const t = useT()
  const router = useRouter()
  const pathname = usePathname()
  const clientParams = useParams()

  const receiptId = React.useMemo(() => {
    if (typeof props?.params?.id === 'string' && props.params.id) return props.params.id
    if (clientParams) {
      if (typeof clientParams.id === 'string' && clientParams.id) return clientParams.id
      if (Array.isArray(clientParams.id) && clientParams.id[0]) return clientParams.id[0]
      if (Array.isArray(clientParams.slug) && clientParams.slug.length > 0) {
        const last = clientParams.slug[clientParams.slug.length - 1]
        if (last && last !== 'create' && last !== 'edit' && last !== 'receipts') return last
      }
    }
    if (pathname) {
      const parts = pathname.split('/').filter(Boolean)
      const last = parts[parts.length - 1]
      if (last && last !== 'receipts') return last
    }
    return ''
  }, [props?.params, clientParams, pathname])
  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  const [receipt, setReceipt] = React.useState<ReceiptDetail | null>(null)
  const [quantities, setQuantities] = React.useState<Record<string, number>>({})
  const [loading, setLoading] = React.useState(true)
  const [validating, setValidating] = React.useState(false)

  const fetchReceipt = React.useCallback(async () => {
    try {
      const call = await apiCall<ReceiptDetail>(`/api/purchases/receipts/${receiptId}`)
      if (call.ok && call.result) {
        setReceipt(call.result)
        const initialMap: Record<string, number> = {}
        for (const l of call.result.lines) {
          initialMap[l.orderLineId] =
            call.result.status === 'done'
              ? Number(l.quantityDone)
              : Number(l.quantityExpected)
        }
        setQuantities(initialMap)
      }
    } catch (err: unknown) {
      flash((err as Error).message, 'error')
    } finally {
      setLoading(false)
    }
  }, [receiptId])

  React.useEffect(() => {
    if (receiptId) fetchReceipt()
  }, [fetchReceipt, receiptId])

  const handleValidate = async () => {
    if (!receipt) return

    // Check if any line has done < expected
    let hasShortage = false
    for (const l of receipt.lines) {
      const done = quantities[l.orderLineId] ?? Number(l.quantityExpected)
      if (done < Number(l.quantityExpected)) {
        hasShortage = true
        break
      }
    }

    let createBackorder = true
    if (hasShortage) {
      const ok = await confirm({
        title: t('purchases.receipts.backorder_prompt_title', 'Partial Delivery Detected'),
        text: t(
          'purchases.receipts.backorder_prompt_msg',
          'Some quantities are less than expected. Would you like to spawn a Backorder (PZ) for the remaining items?'
        ),
        confirmText: t('purchases.receipts.create_backorder', 'Create Backorder'),
        cancelText: t('purchases.receipts.no_backorder', 'No Backorder (Close Remainder)'),
      })
      createBackorder = ok
    }

    setValidating(true)
    try {
      const payload = {
        lines: receipt.lines.map((l) => ({
          orderLineId: l.orderLineId,
          quantityDone: quantities[l.orderLineId] ?? Number(l.quantityExpected),
        })),
        createBackorder,
      }

      const call = await apiCall<{ backorder?: { id: string; receiptNumber: string } | null; error?: string }>(
        `/api/purchases/receipts/${receiptId}/validate`,
        {
          method: 'POST',
          body: JSON.stringify(payload),
        }
      )

      if (!call.ok) {
        throw new Error(call.result?.error || 'Validation failed')
      }

      if (call.result?.backorder) {
        flash(
          t('purchases.receipts.backorder_spawned', 'Receipt confirmed! Backorder {number} created.', {
            number: call.result.backorder.receiptNumber,
          }),
          'success'
        )
      } else {
        flash(t('purchases.receipts.validated_success', 'Goods receipt confirmed and inventory synchronized!'), 'success')
      }

      await fetchReceipt()
    } catch (err: unknown) {
      flash((err as Error).message, 'error')
    } finally {
      setValidating(false)
    }
  }

  if (loading) {
    return (
      <Page>
        <PageBody>
          <div className="flex h-64 items-center justify-center text-muted-foreground">
            {t('common.loading', 'Loading receipt...')}
          </div>
        </PageBody>
      </Page>
    )
  }

  if (!receipt) {
    return (
      <Page>
        <PageBody>
          <div className="flex flex-col items-center justify-center gap-4 py-16">
            <p className="text-muted-foreground">{t('purchases.receipts.not_found', 'Receipt not found')}</p>
            <Link href="/backend/purchases/receipts">
              <Button variant="outline">{t('common.back', 'Back to Receipts')}</Button>
            </Link>
          </div>
        </PageBody>
      </Page>
    )
  }

  const isDone = receipt.status === 'done'

  return (
    <Page>
      <PageBody>
        {/* Header Bar */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href="/backend/purchases/receipts">
              <Button variant="outline" size="sm" aria-label="Back to receipts">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold tracking-tight">{receipt.receiptNumber}</h1>
                <StatusBadge variant={isDone ? 'success' : 'info'} dot>
                  {isDone ? 'Received (Done)' : 'Ready for Inspection'}
                </StatusBadge>
                {receipt.isBackorder && (
                  <span className="rounded bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-600">
                    Backorder
                  </span>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                {receipt.purchaseOrder ? (
                  <>
                    Source PO:{' '}
                    <Link
                      href={`/backend/purchases/orders/${receipt.purchaseOrder.id}`}
                      className="text-primary hover:underline"
                    >
                      {receipt.purchaseOrder.orderNumber}
                    </Link>
                  </>
                ) : (
                  'Direct Receipt'
                )}
              </p>
            </div>
          </div>

          {!isDone && (
            <Button onClick={handleValidate} disabled={validating} className="gap-2">
              <PackageCheck className="h-4 w-4" />
              {t('purchases.receipts.validate_button', 'Validate & Receive Goods')}
            </Button>
          )}
        </div>

        {/* Goods Checklist Matrix */}
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <div className="mb-4">
            <h2 className="text-lg font-semibold tracking-tight">
              {t('purchases.receipts.items_title', 'Inbound Line Items Checklist')}
            </h2>
            <p className="text-xs text-muted-foreground">
              {isDone
                ? 'These quantities have been verified and received into inventory.'
                : 'Inspect package contents and verify actual received quantities before confirming.'}
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="p-3">{t('purchases.receipts.product', 'Product / Item')}</th>
                  <th className="w-36 p-3 text-right">{t('purchases.receipts.expected', 'Expected (Ordered)')}</th>
                  <th className="w-44 p-3 text-right">{t('purchases.receipts.done', 'Actual Received')}</th>
                  <th className="w-28 p-3 text-center">{t('purchases.receipts.check', 'Match')}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {receipt.lines.map((line) => {
                  const expected = Number(line.quantityExpected)
                  const currentDone = quantities[line.orderLineId] ?? expected
                  const isMatching = currentDone === expected
                  const isShortage = currentDone < expected

                  return (
                    <tr key={line.id} className="hover:bg-muted/30">
                      <td className="p-3 font-medium">{line.productDescription}</td>
                      <td className="p-3 text-right text-muted-foreground">{expected.toFixed(2)}</td>
                      <td className="p-3 text-right">
                        {isDone ? (
                          <span className="font-semibold text-foreground">{Number(line.quantityDone).toFixed(2)}</span>
                        ) : (
                          <Input
                            type="number"
                            min="0"
                            step="any"
                            value={currentDone}
                            onChange={(e) =>
                              setQuantities((prev) => ({
                                ...prev,
                                [line.orderLineId]: Number(e.target.value),
                              }))
                            }
                            className="w-32 ml-auto text-right font-medium"
                          />
                        )}
                      </td>
                      <td className="p-3 text-center">
                        {isMatching ? (
                          <span className="inline-flex items-center gap-1 text-xs text-status-success-text">
                            <CheckCircle2 className="h-4 w-4" /> Full
                          </span>
                        ) : isShortage ? (
                          <span className="inline-flex items-center gap-1 text-xs text-status-warning-text font-medium">
                            <AlertCircle className="h-4 w-4" /> Shortage
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-status-info-text font-medium">
                            Surplus
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        {ConfirmDialogElement}
      </PageBody>
    </Page>
  )
}
