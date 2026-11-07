import type { CheckoutSession } from '../data/entities'

/**
 * `CheckoutSession` response shape — shared by the buyer `/sessions/current` routes and
 * the admin `/sessions`/`/sessions/[id]` routes. `tokenHash` NEVER appears here (it is not
 * secret in the credential sense `token` is, but there is no reason to echo it either).
 * PII fields (`email`, `phone`, `shippingAddress`, `billingAddress`) are included only for
 * the buyer's own session, or for an admin caller holding `checkout.viewPii` — the same
 * gate Phase A already uses for links/transactions (§9.1).
 */
export function serializeCheckoutSession(session: CheckoutSession, options: { includePii: boolean }) {
  return {
    id: session.id,
    status: session.status,
    step: session.step,
    channel: session.channel,
    cartId: session.cartId ?? null,
    storeId: session.storeId ?? null,
    linkId: session.linkId ?? null,
    currencyCode: session.currencyCode,
    locale: session.locale,
    customerId: session.customerId ?? null,
    customerUserId: session.customerUserId ?? null,
    email: options.includePii ? session.email ?? null : undefined,
    phone: options.includePii ? session.phone ?? null : undefined,
    shippingAddress: options.includePii ? session.shippingAddress ?? null : undefined,
    billingAddress: options.includePii ? session.billingAddress ?? null : undefined,
    billingSameAsShipping: session.billingSameAsShipping,
    shippingMethod: session.shippingMethod ?? null,
    quotedTotals: session.quotedTotals ?? null,
    deliveryWindowId: session.deliveryWindowId ?? null,
    paymentMethodCode: session.paymentMethodCode ?? null,
    paymentIntentRef: session.paymentIntentRef ?? null,
    paymentExpiresAt: session.paymentExpiresAt ? session.paymentExpiresAt.toISOString() : null,
    purchaseOrderNumber: session.purchaseOrderNumber ?? null,
    submitAttempt: session.submitAttempt,
    submitProgress: session.submitProgress ?? null,
    outcomeKind: session.outcomeKind ?? null,
    salesOrderId: session.salesOrderId ?? null,
    salesQuoteId: session.salesQuoteId ?? null,
    termsAcceptedAt: session.termsAcceptedAt ? session.termsAcceptedAt.toISOString() : null,
    consentFlags: session.consentFlags ?? null,
    failureCode: session.failureCode ?? null,
    failureDetail: session.failureDetail ?? null,
    expiresAt: session.expiresAt.toISOString(),
    completedAt: session.completedAt ? session.completedAt.toISOString() : null,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
  }
}
