"use client"

import * as React from "react"
import { Spinner } from "@open-mercato/ui/primitives/spinner"
import { Button } from "@open-mercato/ui/primitives/button"
import { Input } from "@open-mercato/ui/primitives/input"
import { Label } from "@open-mercato/ui/primitives/label"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@open-mercato/ui/primitives/dialog"
import { useT } from "@open-mercato/shared/lib/i18n/context"
import { apiCall } from "@open-mercato/ui/backend/utils/apiCall"
import { fetchCrudList, createCrud } from "@open-mercato/ui/backend/utils/crud"
import { useGuardedMutation } from "@open-mercato/ui/backend/injection/useGuardedMutation"
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'

/**
 * Client-safe id — importing the server-only `productionToggle.ts` resolver
 * here would pull `createRequestContainer` into the browser bundle.
 */
const PRODUCTION_TOGGLE_ID = 'production_enabled'

type OrderTabContext = {
  kind: 'order' | 'quote'
  record: { id: string; expectedDeliveryAt?: string | null } | null
}

const isOrderContext = (ctx: unknown): ctx is OrderTabContext =>
  !!ctx &&
  typeof ctx === 'object' &&
  (ctx as OrderTabContext).kind === 'order' &&
  !!(ctx as OrderTabContext).record &&
  typeof (ctx as OrderTabContext).record?.id === 'string'

type ProductionOrderRow = {
  id: string
  number: number
  status: string
  qtyPlanned: string
  qtyCompleted: string
  productId: string
}

type SalesOrderLine = {
  id: string
  productId: string | null
  quantity: string
  quantityUnit: string | null
}

type PlanningParamsRow = {
  productId: string
  procurement: 'make' | 'buy'
}

async function checkProductionToggleEnabled(): Promise<boolean> {
  const res = await apiCall<{ ok?: boolean; value?: unknown }>(
    `/api/feature_toggles/check/boolean?identifier=${PRODUCTION_TOGGLE_ID}`,
    undefined,
    { fallback: { ok: false } },
  )
  return res.ok && res.result?.ok === true && res.result.value === true
}

function CreateOrderDialog({
  open,
  onOpenChange,
  line,
  orderId,
  defaultDueDate,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  line: SalesOrderLine | null
  orderId: string
  defaultDueDate: string | null
  onCreated: () => void
}) {
  const t = useT()
  const { runMutation } = useGuardedMutation<{ orderId: string; lineId: string }>({
    contextId: `production:order-production-tab:${orderId}`,
  })
  const [qty, setQty] = React.useState('')
  const [uom, setUom] = React.useState('pcs')
  const [dueDate, setDueDate] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open || !line) return
    setQty(line.quantity ?? '')
    setUom(line.quantityUnit ?? 'pcs')
    setDueDate(defaultDueDate ? defaultDueDate.slice(0, 10) : '')
    setError(null)
  }, [open, line, defaultDueDate])

  const handleSubmit = React.useCallback(async () => {
    if (!line?.productId) return
    setSaving(true)
    setError(null)
    try {
      await runMutation({
        context: { orderId, lineId: line.id },
        operation: async () => createCrud('production/orders', {
          productId: line.productId,
          qtyPlanned: Number(qty) || 0,
          uom,
          dueDate: dueDate || null,
          sourceType: 'sales_order',
          sourceId: orderId,
        }),
      })
      onOpenChange(false)
      onCreated()
    } catch (err) {
      setError(t('production.injection.orderTab.dialog.error', 'Failed to create production order.'))
    } finally {
      setSaving(false)
    }
  }, [line, orderId, qty, uom, dueDate, runMutation, onOpenChange, onCreated, t])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            void handleSubmit()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('production.injection.orderTab.dialog.title', 'Create production order')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="production-order-qty">{t('production.injection.orderTab.dialog.qty', 'Quantity')}</Label>
            <Input
              id="production-order-qty"
              type="number"
              value={qty}
              onChange={(event) => setQty(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="production-order-uom">{t('production.injection.orderTab.dialog.uom', 'Unit')}</Label>
            <Input
              id="production-order-uom"
              value={uom}
              onChange={(event) => setUom(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="production-order-due-date">{t('production.injection.orderTab.dialog.dueDate', 'Due date')}</Label>
            <Input
              id="production-order-due-date"
              type="date"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
            />
          </div>
          {error ? <div className="text-destructive text-sm">{error}</div> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('production.injection.orderTab.dialog.cancel', 'Cancel')}
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={saving}>
            {t('production.injection.orderTab.dialog.submit', 'Create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export const OrderProductionTabWidget: React.FC<InjectionWidgetComponentProps<unknown, unknown>> = ({ context }) => {
  const t = useT()
  const [toggleChecked, setToggleChecked] = React.useState(false)
  const [toggleEnabled, setToggleEnabled] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [orders, setOrders] = React.useState<ProductionOrderRow[]>([])
  const [makeLines, setMakeLines] = React.useState<SalesOrderLine[]>([])
  const [dialogLine, setDialogLine] = React.useState<SalesOrderLine | null>(null)
  const [refreshToken, setRefreshToken] = React.useState(0)

  const valid = isOrderContext(context)
  const orderId = valid ? (context as OrderTabContext).record!.id : null
  const dueDate = valid ? (context as OrderTabContext).record?.expectedDeliveryAt ?? null : null

  React.useEffect(() => {
    let cancelled = false
    checkProductionToggleEnabled()
      .then((enabled) => {
        if (cancelled) return
        setToggleEnabled(enabled)
        setToggleChecked(true)
      })
      .catch(() => {
        if (cancelled) return
        setToggleEnabled(false)
        setToggleChecked(true)
      })
    return () => { cancelled = true }
  }, [])

  React.useEffect(() => {
    if (!toggleChecked || !toggleEnabled || !orderId) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)

    const load = async () => {
      const ordersList = await fetchCrudList<ProductionOrderRow>('production/orders', {
        sourceType: 'sales_order',
        sourceId: orderId,
        page: 1,
        pageSize: 100,
      }).catch(() => ({ items: [] as ProductionOrderRow[], total: 0, page: 1, pageSize: 100, totalPages: 0 }))

      const linesRes = await apiCall<{ items?: Array<Record<string, unknown>> }>(
        `/api/sales/order-lines?orderId=${orderId}&page=1&pageSize=100`,
        undefined,
        { fallback: { items: [] } },
      )
      const lines: SalesOrderLine[] = (linesRes.ok ? linesRes.result?.items ?? [] : []).map((item) => ({
        id: String(item.id ?? ''),
        productId: typeof item.product_id === 'string' ? item.product_id : null,
        quantity: typeof item.quantity === 'string' ? item.quantity : String(item.quantity ?? '0'),
        quantityUnit: typeof item.quantity_unit === 'string' ? item.quantity_unit : null,
      })).filter((line) => line.id)

      const productIds = Array.from(new Set(lines.map((line) => line.productId).filter((v): v is string => !!v)))
      const planningParamsByProduct = new Map<string, PlanningParamsRow>()
      await Promise.all(productIds.map(async (productId) => {
        const res = await apiCall<{ items?: Array<Record<string, unknown>> }>(
          `/api/production/planning-params?productId=${productId}&page=1&pageSize=1`,
          undefined,
          { fallback: { items: [] } },
        )
        const row = res.ok ? res.result?.items?.[0] : null
        if (row && typeof row.procurement === 'string') {
          planningParamsByProduct.set(productId, { productId, procurement: row.procurement as 'make' | 'buy' })
        }
      }))

      if (cancelled) return
      setOrders(ordersList.items)
      setMakeLines(lines.filter((line) => line.productId && planningParamsByProduct.get(line.productId)?.procurement === 'make'))
      setLoading(false)
    }

    load().catch(() => {
      if (cancelled) return
      setError(t('production.injection.orderTab.error', 'Failed to load production data.'))
      setLoading(false)
    })

    return () => { cancelled = true }
  }, [toggleChecked, toggleEnabled, orderId, refreshToken, t])

  if (!valid) return null

  if (!toggleChecked) {
    return (
      <div className="flex items-center justify-center h-24">
        <Spinner />
      </div>
    )
  }

  if (!toggleEnabled) {
    return (
      <div className="text-muted-foreground text-sm py-6 text-center">
        {t('production.injection.orderTab.disabled', 'The production module is not enabled for this tenant.')}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {loading ? (
        <div className="flex items-center justify-center h-24">
          <Spinner />
        </div>
      ) : error ? (
        <div className="text-destructive text-sm">{error}</div>
      ) : (
        <>
          <div className="space-y-2">
            <div className="text-sm font-medium">{t('production.injection.orderTab.ordersTitle', 'Production orders')}</div>
            {orders.length ? (
              <div className="space-y-1.5">
                {orders.map((order) => (
                  <div key={order.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
                    <span>#{order.number}</span>
                    <span className="text-muted-foreground">{order.status}</span>
                    <span>{order.qtyCompleted} / {order.qtyPlanned}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-muted-foreground text-sm">
                {t('production.injection.orderTab.ordersEmpty', 'No production orders linked to this sales order yet.')}
              </div>
            )}
          </div>

          {makeLines.length ? (
            <div className="space-y-2">
              <div className="text-sm font-medium">{t('production.injection.orderTab.makeLinesTitle', 'Make-flagged lines')}</div>
              <div className="space-y-1.5">
                {makeLines.map((line) => (
                  <div key={line.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
                    <span>{line.quantity} {line.quantityUnit ?? ''}</span>
                    <Button size="sm" variant="outline" onClick={() => setDialogLine(line)}>
                      {t('production.injection.orderTab.createButton', 'Create production order')}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </>
      )}

      {orderId ? (
        <CreateOrderDialog
          open={!!dialogLine}
          onOpenChange={(next) => { if (!next) setDialogLine(null) }}
          line={dialogLine}
          orderId={orderId}
          defaultDueDate={dueDate ?? null}
          onCreated={() => setRefreshToken((value) => value + 1)}
        />
      ) : null}
    </div>
  )
}

export default OrderProductionTabWidget
