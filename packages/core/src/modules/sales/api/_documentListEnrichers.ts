import type { EntityManager } from '@mikro-orm/postgresql'
import { SalesOrder, SalesInvoiceLine, SalesCreditMemoLine } from '../data/entities'

type AnyRecord = Record<string, unknown>

type EnricherCtx = {
  container?: { resolve?: (name: string) => unknown }
  auth?: { tenantId?: string | null; orgId?: string | null } | null
  selectedOrganizationId?: string | null
}

function resolveEm(ctx: EnricherCtx): EntityManager | null {
  const em = ctx?.container?.resolve?.('em')
  return em ? (em as EntityManager) : null
}

function scopeWhere(ctx: EnricherCtx, base: AnyRecord): AnyRecord {
  const tenantId = ctx?.auth?.tenantId ?? null
  const organizationId = ctx?.selectedOrganizationId ?? ctx?.auth?.orgId ?? null
  const where: AnyRecord = { ...base }
  if (tenantId) where.tenantId = tenantId
  if (organizationId) where.organizationId = organizationId
  return where
}

function readId(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value
  if (value && typeof value === 'object') {
    const id = (value as { id?: unknown }).id
    if (typeof id === 'string' && id.length > 0) return id
  }
  return null
}

function serializeLine(line: AnyRecord): AnyRecord {
  return {
    id: line.id,
    lineNumber: line.lineNumber,
    orderLineId: line.orderLineId ?? null,
    kind: line.kind ?? null,
    name: line.name ?? null,
    sku: line.sku ?? null,
    description: line.description ?? null,
    quantity: String(line.quantity ?? '0'),
    quantityUnit: line.quantityUnit ?? null,
    currencyCode: line.currencyCode ?? null,
    unitPriceNet: String(line.unitPriceNet ?? '0'),
    unitPriceGross: String(line.unitPriceGross ?? '0'),
    discountAmount: line.discountAmount != null ? String(line.discountAmount) : null,
    discountPercent: line.discountPercent != null ? String(line.discountPercent) : null,
    taxRate: String(line.taxRate ?? '0'),
    taxAmount: String(line.taxAmount ?? '0'),
    totalNetAmount: String(line.totalNetAmount ?? '0'),
    totalGrossAmount: String(line.totalGrossAmount ?? '0'),
  }
}

export async function attachOrderContext(payload: { items?: unknown }, ctx: EnricherCtx): Promise<void> {
  const items = Array.isArray(payload?.items) ? (payload.items as AnyRecord[]) : []
  if (!items.length) return
  const orderIds = Array.from(
    new Set(
      items
        .map((item) => readId(item.order_id ?? item.orderId ?? item.order))
        .filter((id): id is string => !!id),
    ),
  )
  const orderById = new Map<string, SalesOrder>()
  if (orderIds.length) {
    const em = resolveEm(ctx)
    if (em) {
      const orders = await em.find(SalesOrder, scopeWhere(ctx, { id: { $in: orderIds }, deletedAt: null }) as never)
      for (const order of orders) orderById.set(order.id, order)
    }
  }
  for (const item of items) {
    const orderId = readId(item.order_id ?? item.orderId ?? item.order)
    const order = orderId ? orderById.get(orderId) ?? null : null
    item.orderId = orderId
    item.order = order ? { id: order.id, orderNumber: order.orderNumber } : null
    item.customerEntityId = order?.customerEntityId ?? null
    item.customerSnapshot = order?.customerSnapshot ?? null
  }
}

function parentIdsOf(items: AnyRecord[]): string[] {
  return Array.from(new Set(items.map((item) => readId(item.id)).filter((id): id is string => !!id)))
}

export async function attachInvoiceLines(payload: { items?: unknown }, ctx: EnricherCtx): Promise<void> {
  const items = Array.isArray(payload?.items) ? (payload.items as AnyRecord[]) : []
  if (!items.length) return
  const ids = parentIdsOf(items)
  if (!ids.length) return
  const em = resolveEm(ctx)
  if (!em) return
  const lines = await em.find(SalesInvoiceLine, scopeWhere(ctx, { invoice: { $in: ids } }) as never, {
    orderBy: { lineNumber: 'asc' },
  })
  const byParent = new Map<string, AnyRecord[]>()
  for (const line of lines as unknown as AnyRecord[]) {
    const parentId = readId(line.invoice)
    if (!parentId) continue
    const bucket = byParent.get(parentId) ?? []
    bucket.push(serializeLine(line))
    byParent.set(parentId, bucket)
  }
  for (const item of items) {
    const id = readId(item.id)
    item.lines = id ? byParent.get(id) ?? [] : []
  }
}

export async function attachCreditMemoLines(payload: { items?: unknown }, ctx: EnricherCtx): Promise<void> {
  const items = Array.isArray(payload?.items) ? (payload.items as AnyRecord[]) : []
  if (!items.length) return
  const ids = parentIdsOf(items)
  if (!ids.length) return
  const em = resolveEm(ctx)
  if (!em) return
  const lines = await em.find(SalesCreditMemoLine, scopeWhere(ctx, { creditMemo: { $in: ids } }) as never, {
    orderBy: { lineNumber: 'asc' },
  })
  const byParent = new Map<string, AnyRecord[]>()
  for (const line of lines as unknown as AnyRecord[]) {
    const parentId = readId(line.creditMemo)
    if (!parentId) continue
    const bucket = byParent.get(parentId) ?? []
    bucket.push(serializeLine(line))
    byParent.set(parentId, bucket)
  }
  for (const item of items) {
    const id = readId(item.id)
    item.lines = id ? byParent.get(id) ?? [] : []
  }
}
