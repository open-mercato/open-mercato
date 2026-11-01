import type {
  PaymentGatewayDescriptorService,
  ResolvedPaymentGatewayDescriptor,
} from '@open-mercato/core/modules/payment_gateways/lib/descriptor-service'
import type { CustomerCreditService } from '@open-mercato/core/modules/customer_groups/services/customerCreditService'
import type { CustomerGroupsService } from '@open-mercato/core/modules/customer_groups/services/customerGroupsService'
import { tryResolve } from './tryResolve'

// Release 5, Step 2.13 (§5.5). This Step lists ONLY the gateway methods a buyer can pay
// with today — `on_account` and `request_quote` both depend on `customer_groups` terms
// (`allow_purchase_on_account`/`allow_quote_requests`) that are not yet wired into
// checkout (B.5, Step 3.5+); their absence from this response is expected, not a gap.
//
// Release 5, Step 5.1 (B.5, §5.5's own B.5 half, D-R5-5/D-R5-20): wires the two in. Both
// gates are independent of one another — `on_account`'s gate is `allowPurchaseOnAccount`
// + `customerCreditService.checkCredit` (an account in the cart currency, not on hold);
// `request_quote`'s gate is only `allowQuoteRequests`. Neither method is offered to a
// guest cart (OQ1): §5.5's own "when the cart is identified" clause.

export type CheckoutPaymentMethod =
  | { providerKey: string; label: string; kind: 'gateway' }
  | { kind: 'on_account' }
  | { kind: 'request_quote' }

export type CheckoutPaymentMethodsBuyer = { customerId: string | null; customerIds: string[] }

function supportsCurrency(descriptor: ResolvedPaymentGatewayDescriptor, currencyCode: string): boolean {
  const supported = descriptor.sessionConfig?.supportedCurrencies
  if (!supported || supported === '*') return true
  return supported.includes(currencyCode)
}

export type PaymentMethodsContainer = { resolve: <T = unknown>(name: string) => T }

/**
 * Storefront/API/agent/POS sessions (no `linkId`) list every configured, currency-
 * compatible gateway descriptor for the tenant — `ecommerce` has no per-store gateway
 * selection yet (a gap, follow-up needed), so this is "every gateway the tenant has
 * configured", not "every gateway this store offers". A link session (B.2, not reachable
 * via the public API until Step 3.5) is restricted to its own single configured
 * `gatewayProviderKey` instead, unchanged from Phase A's own one-provider-per-link model.
 */
export async function listCheckoutPaymentMethods(
  container: PaymentMethodsContainer,
  scope: { tenantId: string; organizationId: string },
  input: {
    currencyCode: string
    linkGatewayProviderKey: string | null
    buyer?: CheckoutPaymentMethodsBuyer | null
  },
): Promise<CheckoutPaymentMethod[]> {
  const methods: CheckoutPaymentMethod[] = []

  const descriptorService = tryResolve<PaymentGatewayDescriptorService>(container, 'paymentGatewayDescriptorService')
  if (descriptorService) {
    const resolved = await descriptorService.listResolved(scope)
    const available = resolved.filter((descriptor) => descriptor.isConfigured && supportsCurrency(descriptor, input.currencyCode))

    const scoped = input.linkGatewayProviderKey
      ? available.filter((descriptor) => descriptor.providerKey === input.linkGatewayProviderKey)
      : available

    methods.push(...scoped.map((descriptor) => ({ providerKey: descriptor.providerKey, label: descriptor.label, kind: 'gateway' as const })))
  }

  // §5.5's B.5 half (D-R5-5/D-R5-20): never offered to a guest cart (OQ1) — a buyer with
  // no identity at all cannot hold a `customer_groups` membership to resolve terms from.
  const buyer = input.buyer
  const isIdentified = !!buyer && (buyer.customerId != null || buyer.customerIds.length > 0)
  if (isIdentified) {
    const groupsService = tryResolve<CustomerGroupsService>(container, 'customerGroupsService')
    const terms = groupsService
      ? await groupsService.resolveTerms({
          customerId: buyer!.customerId,
          customerIds: buyer!.customerIds,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
        })
      : null

    if (terms?.allowPurchaseOnAccount) {
      const creditService = tryResolve<CustomerCreditService>(container, 'customerCreditService')
      if (creditService) {
        // `customerIds` (the buyer's full identity — person AND company) must be
        // preferred whenever available, never the single person-only `customerId`: a
        // credit account is held by the COMPANY, and only the `customerIds` form drives
        // `resolveBuyerCustomerId`'s company-first resolution
        // (`customerCreditService.ts`) — a bare `customerId` is returned verbatim with no
        // resolution at all. `submit.ts`'s own `reserveCredit` call already follows this
        // convention (`buyer: { customerIds: cartPeer.customerIds }` unconditionally);
        // this listing must agree, or `on_account` can be missing here while submit still
        // accepts it.
        const creditBuyer = buyer!.customerIds.length > 0 ? { customerIds: buyer!.customerIds } : { customerId: buyer!.customerId! }
        // §5.5: "an account in the cart currency that is not on hold" — the amount is
        // irrelevant to THIS gate (a `limit_exceeded` reason, from a non-zero amount,
        // never excludes the method from the listing per the response's own three-reason
        // catalogue below), so `0` is passed; submit's own `reserveCredit` call is the
        // authoritative, amount-aware check (never trusted from this listing).
        const check = await creditService.checkCredit({ scope, buyer: creditBuyer, currencyCode: input.currencyCode, amount: '0' })
        if (check.reason !== 'no_account' && check.reason !== 'on_hold' && check.reason !== 'not_permitted') {
          methods.push({ kind: 'on_account' })
        }
      }
    }

    if (terms?.allowQuoteRequests) {
      methods.push({ kind: 'request_quote' })
    }
  }

  return methods
}
