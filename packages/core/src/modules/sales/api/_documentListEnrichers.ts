import type { EntityManager } from '@mikro-orm/postgresql'
import { parseDecryptedFieldValue } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { SalesOrder, SalesInvoiceLine, SalesCreditMemoLine } from '../data/entities'

type AnyRecord = Record<string, unknown>

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number') return Number.isNaN(value) ? null : value
  const parsed = Number(value)
  return Number.isNaN(parsed) ? null : parsed
}

function normalizeJsonRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  if (typeof value !== 'string') return null
  const parsed = parseDecryptedFieldValue(value)
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : null
}

type FinancialDocumentKind = 'invoice' | 'credit-memo'

export function normalizeFinancialDocumentItem(
  item: AnyRecord,
  kind: FinancialDocumentKind,
): AnyRecord {
  const base: AnyRecord = {
    id: item.id,
    status: item.status ?? null,
    statusEntryId: item.status_entry_id ?? item.statusEntryId ?? null,
    orderId: item.order_id ?? item.orderId ?? null,
    currencyCode: item.currency_code ?? item.currencyCode ?? null,
    issueDate: item.issue_date ?? item.issueDate ?? null,
    subtotalNetAmount: toNumberOrNull(item.subtotal_net_amount ?? item.subtotalNetAmount),
    subtotalGrossAmount: toNumberOrNull(item.subtotal_gross_amount ?? item.subtotalGrossAmount),
    taxTotalAmount: toNumberOrNull(item.tax_total_amount ?? item.taxTotalAmount),
    grandTotalNetAmount: toNumberOrNull(item.grand_total_net_amount ?? item.grandTotalNetAmount),
    grandTotalGrossAmount: toNumberOrNull(item.grand_total_gross_amount ?? item.grandTotalGrossAmount),
    metadata: normalizeJsonRecord(item.metadata),
    createdAt: item.created_at ?? item.createdAt ?? null,
    updatedAt: item.updated_at ?? item.updatedAt ?? null,
  }

  if (kind === 'invoice') {
    base.invoiceNumber = item.invoice_number ?? item.invoiceNumber ?? null
    base.dueDate = item.due_date ?? item.dueDate ?? null
    base.discountTotalAmount = toNumberOrNull(item.discount_total_amount ?? item.discountTotalAmount)
    base.paidTotalAmount = toNumberOrNull(item.paid_total_amount ?? item.paidTotalAmount)
    base.outstandingAmount = toNumberOrNull(item.outstanding_amount ?? item.outstandingAmount)
  } else {
    base.creditMemoNumber = item.credit_memo_number ?? item.creditMemoNumber ?? null
    base.invoiceId = item.invoice_id ?? item.invoiceId ?? null
    base.reason = item.reason ?? null
  }

  return base
}

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
