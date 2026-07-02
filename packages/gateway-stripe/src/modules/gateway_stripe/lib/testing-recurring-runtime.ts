import { createHash, randomUUID } from 'node:crypto'
import type {
  PaymentRecurringRuntime,
  SubscriptionBillingPortalInput,
  SubscriptionBillingPortalResult,
  SubscriptionCancelInput,
  SubscriptionCancelResult,
  SubscriptionCheckoutInput,
  SubscriptionCheckoutResult,
  SubscriptionCustomerRef,
  SubscriptionEnsureCatalogResult,
  SubscriptionEnsureCustomerInput,
  SubscriptionFetchSnapshotInput,
  SubscriptionSnapshot,
} from '@open-mercato/shared/modules/subscriptions/runtime'

export const STRIPE_INTEGRATION_TEST_PUBLISHABLE_KEY = 'pk_test_open_mercato_integration'
export const STRIPE_INTEGRATION_TEST_SECRET_KEY = 'sk_test_open_mercato_integration'
export const STRIPE_INTEGRATION_TEST_WEBHOOK_SECRET = 'whsec_open_mercato_integration'

const STORE_KEY = '__openMercatoStripeIntegrationTestSubscriptions__'

type StoredSnapshot = SubscriptionSnapshot

function getStore(): Map<string, StoredSnapshot> {
  const globalState = globalThis as typeof globalThis & {
    [STORE_KEY]?: Map<string, StoredSnapshot>
  }
  if (!globalState[STORE_KEY]) {
    globalState[STORE_KEY] = new Map<string, StoredSnapshot>()
  }
  return globalState[STORE_KEY]
}

function hashId(prefix: string, value: string): string {
  const digest = createHash('sha256').update(value).digest('hex').slice(0, 24)
  return `${prefix}_${digest}`
}

function randomProviderId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 24)}`
}

function cloneSnapshot(snapshot: StoredSnapshot): SubscriptionSnapshot {
  return {
    ...snapshot,
    currentPeriodStart: snapshot.currentPeriodStart ? new Date(snapshot.currentPeriodStart) : null,
    currentPeriodEnd: snapshot.currentPeriodEnd ? new Date(snapshot.currentPeriodEnd) : null,
    trialEndsAt: snapshot.trialEndsAt ? new Date(snapshot.trialEndsAt) : null,
    cancelledAt: snapshot.cancelledAt ? new Date(snapshot.cancelledAt) : null,
    lastEventAt: snapshot.lastEventAt ? new Date(snapshot.lastEventAt) : null,
  }
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000)
}

function readMetadataString(input: Record<string, unknown> | undefined, key: string): string | null {
  const value = input?.[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

export function resetStripeIntegrationTestRecurringRuntime(): void {
  getStore().clear()
}

export const stripeIntegrationTestRecurringRuntime: PaymentRecurringRuntime = {
  providerKey: 'stripe',

  async ensureCustomer(input: SubscriptionEnsureCustomerInput): Promise<SubscriptionCustomerRef> {
    return {
      providerCustomerId: hashId(
        'cus_test_om',
        `${input.scope.tenantId}:${input.scope.organizationId}:${input.externalAccountId}:${input.omCustomerId}`,
      ),
    }
  },

  async ensureCatalog(input): Promise<SubscriptionEnsureCatalogResult> {
    return {
      prices: input.plans.flatMap((plan) =>
        plan.prices
          .filter((price) => price.isActive)
          .map((price) => ({
            priceCode: price.priceCode,
            providerProductRef: hashId('prod_test_om', `${input.scope.tenantId}:${plan.productCode}:${price.productLookupKey}`),
            providerPriceRef: hashId('price_test_om', `${input.scope.tenantId}:${price.priceLookupKey}`),
          })),
      ),
    }
  },

  async createCheckoutSession(input: SubscriptionCheckoutInput): Promise<SubscriptionCheckoutResult> {
    const providerSessionId = randomProviderId('cs_test_om')
    const providerSubscriptionId = randomProviderId('sub_test_om')
    const providerProductRef = hashId('prod_test_om', input.priceRef.providerPriceRef)
    const now = new Date()
    const store = getStore()

    store.set(providerSubscriptionId, {
      providerSubscriptionId,
      providerCustomerId: input.customerRef.providerCustomerId,
      providerStatus: 'active',
      cancelAtPeriodEnd: false,
      cancelledAt: null,
      currentPeriodStart: now,
      currentPeriodEnd: addDays(now, 30),
      trialEndsAt: input.trialPeriodDays ? addDays(now, input.trialPeriodDays) : null,
      priceCode: input.priceRef.priceCode,
      providerPriceRef: input.priceRef.providerPriceRef,
      providerProductRef,
      externalAccountId: input.externalAccountId,
      subjectEntityType: readMetadataString(input.metadata, 'subjectEntityType'),
      subjectEntityId: readMetadataString(input.metadata, 'subjectEntityId'),
      lastEventAt: now,
    })

    const url = new URL(`https://checkout.stripe.test/c/pay/${providerSessionId}`)
    url.searchParams.set('session', providerSessionId)
    url.searchParams.set('subscription', providerSubscriptionId)
    url.searchParams.set('customer', input.customerRef.providerCustomerId)

    return {
      checkoutUrl: url.toString(),
      providerSessionId,
    }
  },

  async createBillingPortalSession(input: SubscriptionBillingPortalInput): Promise<SubscriptionBillingPortalResult> {
    const url = new URL(`https://billing.stripe.test/session/${randomProviderId('bps_test_om')}`)
    url.searchParams.set('customer', input.customerRef.providerCustomerId)
    url.searchParams.set('subscription_update', input.allowPlanSwitching === false ? 'false' : 'true')
    url.searchParams.set('return_url', input.returnUrl)
    return { portalUrl: url.toString() }
  },

  async cancelSubscription(input: SubscriptionCancelInput): Promise<SubscriptionCancelResult> {
    const store = getStore()
    const existing = store.get(input.providerSubscriptionId)
    const cancelledAt = input.atPeriodEnd ? null : new Date()
    const providerStatus = input.atPeriodEnd ? existing?.providerStatus ?? 'active' : 'canceled'
    if (existing) {
      store.set(input.providerSubscriptionId, {
        ...existing,
        providerStatus,
        cancelAtPeriodEnd: input.atPeriodEnd,
        cancelledAt,
        lastEventAt: new Date(),
      })
    }
    return {
      providerStatus,
      cancelAtPeriodEnd: input.atPeriodEnd,
      cancelledAt,
    }
  },

  async fetchSubscriptionSnapshot(input: SubscriptionFetchSnapshotInput): Promise<SubscriptionSnapshot | null> {
    const snapshot = getStore().get(input.providerSubscriptionId)
    return snapshot ? cloneSnapshot(snapshot) : null
  },
}
