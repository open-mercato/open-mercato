import { conflict } from '@open-mercato/shared/lib/crud/errors'
import {
  parseDecimal,
  resolveAmountDecimalPlaces,
  resolveExactDecimal,
  toDecimal,
  type DecimalValue,
} from '@open-mercato/shared/lib/decimal'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createFallbackTranslator, type TranslateWithFallbackFn } from '@open-mercato/shared/lib/i18n/translate'
import type {
  PaymentGatewayScope,
  PaymentOrderTotal,
  PaymentOrderTotalResolver,
} from '@open-mercato/shared/modules/payment_gateways/types'

const FLOAT_AMOUNT_DUE_TOLERANCE = '0.0001'

/**
 * Below half a unit of the currency's amount precision (at least the 4th decimal) is
 * rounding noise, not a mismatch, so an amount a whole unit off is always rejected.
 * A resolver that only reports a float `amountDue` keeps the historical 0.0001
 * tolerance, so binary float noise (`0.30000000000000004`) is never a mismatch.
 */
function amountTolerance(orderTotal: PaymentOrderTotal, currencyDecimalPlaces?: number | null): DecimalValue {
  if (parseDecimal(orderTotal.amountDueExact) === null) return toDecimal(FLOAT_AMOUNT_DUE_TOLERANCE)
  return toDecimal(`5e-${resolveAmountDecimalPlaces(currencyDecimalPlaces) + 1}`)
}

function normalizeCurrencyCode(currencyCode: string): string {
  return currencyCode.trim().toUpperCase()
}

/**
 * Conflict copy is served from the module catalog on a request path. Contexts
 * without a registered module dictionary (CLI commands, workers, unit tests)
 * fall back to the English template shipped with each call, so a missing
 * dictionary degrades the wording of a rejection but never its outcome.
 */
export async function resolvePaymentGatewayTranslator(): Promise<TranslateWithFallbackFn> {
  try {
    const { translate } = await resolveTranslations()
    return translate
  } catch {
    return createFallbackTranslator({})
  }
}

export function isPaymentOrderTotalResolver(candidate: unknown): candidate is PaymentOrderTotalResolver {
  return !!candidate
    && typeof candidate === 'object'
    && typeof (candidate as PaymentOrderTotalResolver).resolveOrderTotal === 'function'
}

export function assertSessionAmountMatchesOrderTotal(
  requested: { orderId: string; amount: number; amountExact?: string | null; currencyCode: string },
  orderTotal: PaymentOrderTotal,
  translate: TranslateWithFallbackFn,
  currencyDecimalPlaces?: number | null,
): void {
  if (normalizeCurrencyCode(requested.currencyCode) !== normalizeCurrencyCode(orderTotal.currencyCode)) {
    throw conflict(translate(
      'payment_gateways.errors.sessionCurrencyMismatch',
      'Payment session currency {currencyCode} does not match the currency of order {orderId}',
      { currencyCode: normalizeCurrencyCode(requested.currencyCode), orderId: requested.orderId },
    ))
  }
  const requestedAmount = toDecimal(resolveExactDecimal(requested.amountExact, requested.amount) ?? 0)
  const amountDue = resolveExactDecimal(orderTotal.amountDueExact, orderTotal.amountDue) ?? '0'
  if (requestedAmount.minus(amountDue).abs().gt(amountTolerance(orderTotal, currencyDecimalPlaces))) {
    throw conflict(translate(
      'payment_gateways.errors.sessionAmountMismatch',
      'Payment session amount {amount} does not match the amount due for order {orderId}',
      { amount: requested.amount, orderId: requested.orderId },
    ))
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
  amountExact?: string | null
  currencyCode: string
  currencyDecimalPlaces?: number | null
  scope: PaymentGatewayScope
  resolver?: PaymentOrderTotalResolver | null
}): Promise<void> {
  const { orderId, resolver } = input
  if (!orderId || !resolver) return

  const orderTotal = await resolver.resolveOrderTotal(orderId, input.scope)
  const translate = await resolvePaymentGatewayTranslator()
  if (!orderTotal) {
    throw conflict(translate(
      'payment_gateways.errors.sessionOrderNotFound',
      'Order {orderId} was not found in the current scope',
      { orderId },
    ))
  }

  assertSessionAmountMatchesOrderTotal(
    { orderId, amount: input.amount, amountExact: input.amountExact, currencyCode: input.currencyCode },
    orderTotal,
    translate,
    input.currencyDecimalPlaces,
  )
}
