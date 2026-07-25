import { conflict } from '@open-mercato/shared/lib/crud/errors'
import type {
  PaymentGatewayScope,
  PaymentOrderTotal,
  PaymentOrderTotalResolver,
} from '@open-mercato/shared/modules/payment_gateways/types'

/** Amounts are stored as numeric(18,4); anything below that is rounding noise, not a mismatch. */
const AMOUNT_TOLERANCE = 0.0001

function normalizeCurrencyCode(currencyCode: string): string {
  return currencyCode.trim().toUpperCase()
}

export function isPaymentOrderTotalResolver(candidate: unknown): candidate is PaymentOrderTotalResolver {
  return !!candidate
    && typeof candidate === 'object'
    && typeof (candidate as PaymentOrderTotalResolver).resolveOrderTotal === 'function'
}

export function assertSessionAmountMatchesOrderTotal(
  requested: { orderId: string; amount: number; currencyCode: string },
  orderTotal: PaymentOrderTotal,
): void {
  if (normalizeCurrencyCode(requested.currencyCode) !== normalizeCurrencyCode(orderTotal.currencyCode)) {
    throw conflict(
      `Payment session currency ${normalizeCurrencyCode(requested.currencyCode)} does not match the currency of order ${requested.orderId}`,
    )
  }
  if (Math.abs(requested.amount - orderTotal.amountDue) > AMOUNT_TOLERANCE) {
    throw conflict(
      `Payment session amount ${requested.amount} does not match the amount due for order ${requested.orderId}`,
    )
  }
}

/**
 * Reconciles a caller-supplied session amount against the authoritative amount
 * due for the referenced order. Reconciliation is skipped when the request
 * references no order, or when no module registered a resolver (for example an
 * installation without the `sales` module) — there is nothing authoritative to
 * compare against in either case. A referenced order that does not resolve
 * inside the caller's tenant/organization scope is rejected exactly like an
 * unknown one, so the response never reveals whether it exists elsewhere.
 */
export async function reconcileSessionAmountWithOrder(input: {
  orderId?: string
  amount: number
  currencyCode: string
  scope: PaymentGatewayScope
  resolver?: PaymentOrderTotalResolver | null
}): Promise<void> {
  const { orderId, resolver } = input
  if (!orderId || !resolver) return

  const orderTotal = await resolver.resolveOrderTotal(orderId, input.scope)
  if (!orderTotal) {
    throw conflict(`Order ${orderId} was not found in the current scope`)
  }

  assertSessionAmountMatchesOrderTotal(
    { orderId, amount: input.amount, currencyCode: input.currencyCode },
    orderTotal,
  )
}
