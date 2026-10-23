"use client"

import * as React from 'react'
import Link from 'next/link'
import { useParams, useRouter, usePathname } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import {
  FileText,
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ShieldCheck,
} from 'lucide-react'

type BillDetail = {
  id: string
  vendorBillNumber: string
  purchaseOrderId: string
  purchaseOrderNumber: string
  controlPolicy: string
  billDate: string
  status: string
  matchingStatus: string
  exceptionNotes?: string | null
  totalNet: string
  totalGross: string
  createdAt: string
  updatedAt: string
  lines: Array<{
    id: string
    orderLineId?: string | null
    productId?: string | null
    productDescription: string
    quantity: string
    unitPriceNet: string
    subtotalNet: string
  }>
}

export default function PurchaseBillDetailPage(props: { params?: { id?: string } }) {
  const router = useRouter()
  const pathname = usePathname()
  const clientParams = useParams()

  const id = React.useMemo(() => {
    if (typeof props?.params?.id === 'string' && props.params.id) return props.params.id
    if (clientParams) {
      if (typeof clientParams.id === 'string' && clientParams.id) return clientParams.id
      if (Array.isArray(clientParams.id) && clientParams.id[0]) return clientParams.id[0]
      if (Array.isArray(clientParams.slug) && clientParams.slug.length > 0) {
        const last = clientParams.slug[clientParams.slug.length - 1]
        if (last && last !== 'create' && last !== 'edit' && last !== 'bills') return last
      }
    }
    if (pathname) {
      const parts = pathname.split('/').filter(Boolean)
      const last = parts[parts.length - 1]
      if (last && last !== 'bills') return last
    }
    return ''
  }, [props?.params, clientParams, pathname])

  const [bill, setBill] = React.useState<BillDetail | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [verifying, setVerifying] = React.useState(false)

  const loadBill = React.useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const res = await apiCall<{ item: BillDetail }>(`/api/purchases/bills/${id}`)
      if (res.ok && res.result?.item) {
        setBill(res.result.item)
      } else {
        flash('Failed to load bill', 'error')
      }
    } catch {
      flash('Error connecting to purchasing API', 'error')
    } finally {
      setLoading(false)
    }
  }, [id])

  React.useEffect(() => {
    if (id) {
      loadBill()
    }
  }, [id, loadBill])

  const handleVerify = async () => {
    setVerifying(true)
    try {
      const res = await apiCall<{ verified: boolean; matchingStatus: string; exceptions: string[] }>(
        `/api/purchases/bills/${id}/verify-match`,
        { method: 'POST' }
      )
      if (res.ok && res.result) {
        if (res.result.verified) {
          flash('3-way match verified successfully! Bill posted.', 'success')
        } else {
          flash(`Match exception: ${res.result.exceptions.join('; ')}`, 'warning')
        }
        loadBill()
      } else {
        flash('Verification failed', 'error')
      }
    } catch {
      flash('Failed to run verification', 'error')
    } finally {
      setVerifying(false)
    }
  }

  if (loading) {
    return (
      <Page>
        <PageBody>
          <div className="p-8 text-center text-muted-foreground">Loading bill details...</div>
        </PageBody>
      </Page>
    )
  }

  if (!bill) {
    return (
      <Page>
        <PageBody>
          <div className="p-8 text-center text-destructive">Bill not found</div>
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody>
        <div className="space-y-6 max-w-5xl">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link href="/backend/purchases/bills">
                <Button variant="ghost" size="icon" aria-label="Back">
                  <ArrowLeft className="h-4 w-4" />
                </Button>
              </Link>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-2xl font-bold tracking-tight">{bill.vendorBillNumber}</h1>
                  {bill.matchingStatus === 'verified' && (
                    <StatusBadge variant="success" dot>
                      Verified
                    </StatusBadge>
                  )}
                  {bill.matchingStatus === 'exception' && (
                    <StatusBadge variant="error" dot>
                      Exception
                    </StatusBadge>
                  )}
                  {bill.matchingStatus === 'pending' && (
                    <StatusBadge variant="warning" dot>
                      Pending Match
                    </StatusBadge>
                  )}
                  <StatusBadge variant={bill.status === 'posted' ? 'success' : 'neutral'}>
                    {bill.status.toUpperCase()}
                  </StatusBadge>
                </div>
                <p className="text-sm text-muted-foreground">
                  Purchased via order{' '}
                  <Link
                    href={`/backend/purchases/orders/${bill.purchaseOrderId}`}
                    className="text-primary hover:underline font-mono"
                  >
                    {bill.purchaseOrderNumber}
                  </Link>
                  {' '}&bull; Policy: {bill.controlPolicy === 'on_received' ? 'On Received (PZ)' : 'On Ordered'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {bill.matchingStatus !== 'verified' && (
                <Button onClick={handleVerify} disabled={verifying}>
                  <ShieldCheck className="h-4 w-4 mr-2" />
                  {verifying ? 'Verifying...' : 'Verify 3-Way Match'}
                </Button>
              )}
            </div>
          </div>

          {/* Reconciliation Status Alert */}
          {bill.matchingStatus === 'exception' && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-destructive flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 mt-0.5 shrink-0" />
              <div>
                <h4 className="font-semibold text-sm">3-Way Match Discrepancy Detected</h4>
                <p className="text-sm mt-1 whitespace-pre-wrap">{bill.exceptionNotes}</p>
              </div>
            </div>
          )}

          {bill.matchingStatus === 'verified' && (
            <div className="rounded-lg border border-emerald-500/50 bg-emerald-500/10 p-4 text-emerald-700 dark:text-emerald-400 flex items-start gap-3">
              <CheckCircle2 className="h-5 w-5 mt-0.5 shrink-0" />
              <div>
                <h4 className="font-semibold text-sm">3-Way Match Verified</h4>
                <p className="text-sm mt-1">
                  Quantities and unit prices fully conform with purchase order and warehouse goods receipts.
                </p>
              </div>
            </div>
          )}

          {/* Details Overview Card */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 p-4 rounded-lg border bg-card text-card-foreground">
            <div>
              <span className="text-xs text-muted-foreground block">Bill Date</span>
              <span className="text-sm font-medium">
                {bill.billDate ? new Date(bill.billDate).toLocaleDateString() : '—'}
              </span>
            </div>
            <div>
              <span className="text-xs text-muted-foreground block">Order Reference</span>
              <Link
                href={`/backend/purchases/orders/${bill.purchaseOrderId}`}
                className="text-sm font-medium text-primary hover:underline font-mono"
              >
                {bill.purchaseOrderNumber}
              </Link>
            </div>
            <div>
              <span className="text-xs text-muted-foreground block">Total Net</span>
              <span className="text-sm font-mono font-medium">{Number(bill.totalNet).toFixed(2)}</span>
            </div>
            <div>
              <span className="text-xs text-muted-foreground block">Total Gross</span>
              <span className="text-sm font-mono font-bold text-primary">{Number(bill.totalGross).toFixed(2)}</span>
            </div>
          </div>

          {/* Line Items */}
          <div className="rounded-lg border overflow-hidden">
            <div className="p-4 bg-muted/40 font-semibold text-sm flex items-center justify-between">
              <span>Billed Items</span>
              <span className="text-xs text-muted-foreground">{bill.lines.length} line(s)</span>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-muted/20 border-b text-xs text-muted-foreground text-left">
                <tr>
                  <th className="p-3">Description</th>
                  <th className="p-3 text-right">Quantity</th>
                  <th className="p-3 text-right">Unit Price Net</th>
                  <th className="p-3 text-right">Subtotal Net</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {bill.lines.map((l) => (
                  <tr key={l.id}>
                    <td className="p-3 font-medium">{l.productDescription}</td>
                    <td className="p-3 text-right font-mono">{Number(l.quantity).toFixed(2)}</td>
                    <td className="p-3 text-right font-mono">{Number(l.unitPriceNet).toFixed(2)}</td>
                    <td className="p-3 text-right font-mono font-semibold">{Number(l.subtotalNet).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </PageBody>
    </Page>
  )
}
