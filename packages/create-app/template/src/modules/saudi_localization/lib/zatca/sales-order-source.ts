import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { SalesOrder, SalesOrderLine } from '@open-mercato/core/modules/sales/data/entities'
import type { ZatcaOrderLineSource, ZatcaOrderSource } from './order-invoice'

/**
 * Reads a sales order into the shape the invoice mapping needs.
 *
 * This module imports the sales entities rather than any sales internals: a foreign
 * key plus a scoped read, no ORM relationship, and no sales code path involved — the
 * same coupling the platform uses between modules that genuinely need each other's
 * data. Reads go through the decryption helpers, because an order can carry encrypted
 * fields and a plain `em.find` would hand an invoice a ciphertext total.
 *
 * Scope is not optional. An invoice that mixes organizations is worse than no
 * invoice, so the tenant and the organization are both part of the query and a caller
 * without an organization gets nothing.
 */

export type ZatcaOrderScope = {
  tenantId: string
  organizationId: string
}

function toLineSource(line: SalesOrderLine): ZatcaOrderLineSource {
  const uomSnapshot = line.uomSnapshot
    ? { enteredUnitCode: line.uomSnapshot.enteredUnitCode, baseUnitCode: line.uomSnapshot.baseUnitCode }
    : null
  return {
    lineNumber: line.lineNumber,
    name: line.name ?? null,
    quantity: line.quantity,
    quantityUnit: line.quantityUnit ?? null,
    uomSnapshot,
    unitPriceNet: line.unitPriceNet,
    taxRate: line.taxRate,
    taxAmount: line.taxAmount,
    totalNetAmount: line.totalNetAmount,
    metadata: line.metadata ?? null,
  }
}

export async function loadZatcaOrderSource(options: {
  em: EntityManager
  orderId: string
  scope: ZatcaOrderScope
}): Promise<ZatcaOrderSource | null> {
  const { em, orderId, scope } = options
  const decryptionScope = { tenantId: scope.tenantId, organizationId: scope.organizationId }

  const order = await findOneWithDecryption(
    em,
    SalesOrder,
    { id: orderId, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
    {},
    decryptionScope,
  )
  if (!order) return null

  const lines = await findWithDecryption(
    em,
    SalesOrderLine,
    { order: order.id, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
    { orderBy: { lineNumber: 'asc' } },
    decryptionScope,
  )

  return {
    orderNumber: order.orderNumber,
    placedAt: order.placedAt ?? null,
    createdAt: order.createdAt,
    currencyCode: order.currencyCode,
    taxTotalAmount: order.taxTotalAmount,
    grandTotalGrossAmount: order.grandTotalGrossAmount,
    lines: lines.map(toLineSource),
  }
}
