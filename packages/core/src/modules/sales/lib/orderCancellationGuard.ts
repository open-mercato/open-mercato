import type { EntityManager } from '@mikro-orm/postgresql'
import { conflict } from '@open-mercato/shared/lib/crud/errors'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { SalesPayment, SalesShipment, type SalesOrder } from '../data/entities'

type Amount = string | number | null | undefined

export type CancellationShipmentState = {
  id?: string | null
  status?: string | null
}

export type CancellationPaymentState = {
  id?: string | null
  status?: string | null
  amount?: Amount
  capturedAmount?: Amount
  refundedAmount?: Amount
}

const NON_BLOCKING_SHIPMENT_STATUSES = new Set(['canceled', 'cancelled', 'returned'])
const NON_HOLDING_PAYMENT_STATUSES = new Set(['pending', 'failed', 'canceled', 'cancelled'])
const HELD_AMOUNT_EPSILON = 0.0001

function normalizeStatus(status: string | null | undefined): string | null {
  if (typeof status !== 'string') return null
  const trimmed = status.trim()
  return trimmed.length ? trimmed : null
}

function toAmount(value: Amount): number {
  const numeric = typeof value === 'number' ? value : Number(value ?? 0)
  return Number.isFinite(numeric) ? numeric : 0
}

export function isCancelledOrderStatus(status: string | null | undefined): boolean {
  const normalized = normalizeStatus(status)
  return normalized === 'canceled' || normalized === 'cancelled'
}

export function isBlockingShipment(shipment: CancellationShipmentState): boolean {
  const status = normalizeStatus(shipment.status)
  return status === null || !NON_BLOCKING_SHIPMENT_STATUSES.has(status)
}

export function resolveHeldPaymentAmount(payment: CancellationPaymentState): number {
  const status = normalizeStatus(payment.status)
  if (status && NON_HOLDING_PAYMENT_STATUSES.has(status)) return 0
  const captured = toAmount(payment.capturedAmount)
  const paid = captured > 0 ? captured : toAmount(payment.amount)
  return Math.max(paid - toAmount(payment.refundedAmount), 0)
}

function mergeById<T extends { id?: string | null }>(stored: T[], pending: T | undefined): T[] {
  if (!pending) return stored
  if (!pending.id) return [...stored, pending]
  const merged = stored.filter((entry) => entry.id !== pending.id)
  merged.push(pending)
  return merged
}

/**
 * Cancelling an order is a status flip with no return or refund bookkeeping, so it is refused
 * while goods are still out with the customer or money is still held (issue #4054); the user
 * cancels or returns the shipments and refunds the payments first. `pending` describes a
 * shipment or payment the same request is creating or updating, which the stored rows do not
 * reflect yet. MUST run before the caller mutates anything on `em`.
 */
export async function assertOrderCanBeCancelled(
  em: EntityManager,
  order: SalesOrder,
  pending: { shipment?: CancellationShipmentState; payment?: CancellationPaymentState } = {},
): Promise<void> {
  const scope = { tenantId: order.tenantId, organizationId: order.organizationId }
  const { translate } = await resolveTranslations()
  const shipments = await findWithDecryption(em, SalesShipment, { order: order.id, deletedAt: null }, {}, scope)
  const shipmentStates = mergeById<CancellationShipmentState>(
    shipments.map((shipment) => ({ id: shipment.id, status: shipment.status ?? null })),
    pending.shipment,
  )
  if (shipmentStates.some(isBlockingShipment)) {
    throw conflict(
      translate(
        'sales.orders.errors.cancel_has_shipments',
        'This order has shipments. Cancel or return them before cancelling the order.',
      ),
    )
  }
  const payments = await findWithDecryption(em, SalesPayment, { order: order.id, deletedAt: null }, {}, scope)
  const paymentStates = mergeById<CancellationPaymentState>(
    payments.map((payment) => ({
      id: payment.id,
      status: payment.status ?? null,
      amount: payment.amount,
      capturedAmount: payment.capturedAmount,
      refundedAmount: payment.refundedAmount,
    })),
    pending.payment,
  )
  const held = paymentStates.reduce((sum, payment) => sum + resolveHeldPaymentAmount(payment), 0)
  if (held > HELD_AMOUNT_EPSILON) {
    throw conflict(
      translate(
        'sales.orders.errors.cancel_has_payments',
        'This order has payments that were not refunded. Refund them before cancelling the order.',
      ),
    )
  }
}
