import Stripe from 'stripe'
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
  SubscriptionPlanSyncEntry,
  SubscriptionSnapshot,
} from '@open-mercato/shared/modules/subscriptions/runtime'

function getStripe(credentials: Record<string, unknown>): Stripe {
  const apiKey = credentials.secretKey ?? credentials.apiKey
  if (typeof apiKey !== 'string' || apiKey.length === 0) {
    throw new Error('gateway_stripe: missing secretKey credential for recurring runtime')
  }
  return new Stripe(apiKey)
}

function unixToDate(value: number | null | undefined): Date | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return new Date(value * 1000)
}

function readUnixField(record: Record<string, unknown>, key: string): Date | null {
  const value = record[key]
  return typeof value === 'number' ? unixToDate(value) : null
}

function buildMetadata(extra?: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  if (!extra) return out
  for (const [key, value] of Object.entries(extra)) {
    if (value === null || value === undefined) continue
    out[key] = typeof value === 'string' ? value : JSON.stringify(value)
  }
  return out
}

async function ensureProduct(stripe: Stripe, plan: SubscriptionPlanSyncEntry, productLookupKey: string): Promise<Stripe.Product> {
  const existing = await stripe.products.search({
    query: `metadata['om_product_code']:'${productLookupKey.replace(/'/g, "\\'")}'`,
    limit: 1,
  })
  if (existing.data.length > 0) {
    const current = existing.data[0]
    const needsUpdate = current.name !== plan.title || (current.description ?? '') !== (plan.description ?? '')
    if (needsUpdate) {
      return await stripe.products.update(current.id, {
        name: plan.title,
        description: plan.description ?? undefined,
        metadata: { ...(current.metadata ?? {}), om_product_code: productLookupKey, om_plan_code: plan.planCode },
      })
    }
    return current
  }

  return await stripe.products.create({
    name: plan.title,
    description: plan.description ?? undefined,
    metadata: {
      om_product_code: productLookupKey,
      om_plan_code: plan.planCode,
    },
  })
}

async function ensurePrice(
  stripe: Stripe,
  product: Stripe.Product,
  price: SubscriptionPlanSyncEntry['prices'][number],
): Promise<Stripe.Price> {
  const existing = await stripe.prices.list({
    lookup_keys: [price.priceLookupKey],
    limit: 1,
    active: true,
  })
  if (existing.data.length > 0) {
    const current = existing.data[0]
    const sameAmount = current.unit_amount === price.unitAmountMinor
    const sameCurrency = current.currency === price.currencyCode.toLowerCase()
    const sameInterval = current.recurring?.interval === price.interval && (current.recurring?.interval_count ?? 1) === price.intervalCount
    if (!sameAmount || !sameCurrency || !sameInterval) {
      throw new Error(
        `gateway_stripe: existing Stripe Price ${current.id} (${price.priceLookupKey}) has different economics; create a new versioned priceLookupKey instead of mutating in place`,
      )
    }
    return current
  }

  return await stripe.prices.create({
    product: product.id,
    currency: price.currencyCode.toLowerCase(),
    unit_amount: price.unitAmountMinor,
    lookup_key: price.priceLookupKey,
    recurring: {
      interval: price.interval,
      interval_count: price.intervalCount,
    },
    tax_behavior: price.taxBehavior,
    metadata: {
      om_price_code: price.priceCode,
    },
  })
}

function buildSnapshot(subscription: Stripe.Subscription): SubscriptionSnapshot {
  const subscriptionRecord = subscription as unknown as Record<string, unknown>
  const item = subscription.items?.data?.[0]
  const price = item?.price
  return {
    providerSubscriptionId: subscription.id,
    providerCustomerId: typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id ?? '',
    providerStatus: subscription.status,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    cancelledAt: readUnixField(subscriptionRecord, 'canceled_at'),
    currentPeriodStart: readUnixField(subscriptionRecord, 'current_period_start'),
    currentPeriodEnd: readUnixField(subscriptionRecord, 'current_period_end'),
    trialEndsAt: readUnixField(subscriptionRecord, 'trial_end'),
    priceCode: price?.metadata?.om_price_code ?? null,
    providerPriceRef: price?.id ?? null,
    providerProductRef: typeof price?.product === 'string' ? price.product : price?.product?.id ?? null,
    externalAccountId: subscription.metadata?.externalAccountId ?? null,
    subjectEntityType: subscription.metadata?.subjectEntityType ?? null,
    subjectEntityId: subscription.metadata?.subjectEntityId ?? null,
    lastEventAt: new Date(),
  }
}

const MANAGED_PORTAL_CONFIGURATION_KEY = 'subscriptions-mvp-v1'
const MANAGED_CANCELLATION_REASON_OPTIONS = [
  'customer_service',
  'low_quality',
  'missing_features',
  'other',
  'switched_service',
  'too_complex',
  'too_expensive',
  'unused',
] as const

function hasManagedPortalFeatures(configuration: Stripe.BillingPortal.Configuration): boolean {
  const cancellationReason = configuration.features.subscription_cancel.cancellation_reason
  const configuredOptions = Array.isArray(cancellationReason?.options) ? cancellationReason.options : []

  return configuration.features.payment_method_update.enabled === true
    && configuration.features.customer_update.enabled === false
    && configuration.features.invoice_history.enabled === true
    && configuration.features.subscription_cancel.enabled === true
    && configuration.features.subscription_cancel.mode === 'at_period_end'
    && configuration.features.subscription_cancel.proration_behavior === 'none'
    && cancellationReason?.enabled === false
    && MANAGED_CANCELLATION_REASON_OPTIONS.every((option) => configuredOptions.includes(option))
    && configuration.features.subscription_update.enabled === false
    && configuration.features.subscription_update.proration_behavior === 'none'
}

async function ensureBillingPortalConfiguration(stripe: Stripe): Promise<string> {
  const existing = await stripe.billingPortal.configurations.list({ active: true, limit: 100 })
  const managed = existing.data.find(
    (configuration) => configuration.metadata?.om_subscription_portal_config === MANAGED_PORTAL_CONFIGURATION_KEY,
  )

  const desiredFeatures = {
    customer_update: { enabled: false, allowed_updates: [] },
    invoice_history: { enabled: true },
    payment_method_update: { enabled: true },
    subscription_cancel: {
      enabled: true,
      mode: 'at_period_end',
      proration_behavior: 'none',
      cancellation_reason: {
        enabled: false,
        options: MANAGED_CANCELLATION_REASON_OPTIONS,
      },
    },
    subscription_update: {
      enabled: false,
      default_allowed_updates: [],
      proration_behavior: 'none',
    },
  }

  if (managed) {
    if (!hasManagedPortalFeatures(managed)) {
      const updated = await stripe.billingPortal.configurations.update(managed.id, {
        features: desiredFeatures as never,
        metadata: {
          ...(managed.metadata ?? {}),
          om_subscription_portal_config: MANAGED_PORTAL_CONFIGURATION_KEY,
        },
      })
      return updated.id
    }
    return managed.id
  }

  const created = await stripe.billingPortal.configurations.create({
    features: desiredFeatures as never,
    metadata: {
      om_subscription_portal_config: MANAGED_PORTAL_CONFIGURATION_KEY,
    },
  })
  return created.id
}

export const stripeRecurringRuntime: PaymentRecurringRuntime = {
  providerKey: 'stripe',

  async ensureCustomer(input: SubscriptionEnsureCustomerInput): Promise<SubscriptionCustomerRef> {
    const stripe = getStripe(input.credentials)
    const lookupKey = `om:${input.scope.tenantId}:${input.scope.organizationId}:${input.omCustomerId}`
    const existing = await stripe.customers.search({
      query: `metadata['om_customer_lookup_key']:'${lookupKey.replace(/'/g, "\\'")}'`,
      limit: 1,
    })
    if (existing.data.length > 0) {
      return { providerCustomerId: existing.data[0].id }
    }
    const created = await stripe.customers.create({
      email: input.email ?? undefined,
      name: input.name ?? undefined,
      metadata: {
        om_customer_lookup_key: lookupKey,
        om_customer_id: input.omCustomerId,
        external_account_id: input.externalAccountId,
        tenant_id: input.scope.tenantId,
        organization_id: input.scope.organizationId,
        ...buildMetadata(input.metadata),
      },
    })
    return { providerCustomerId: created.id }
  },

  async ensureCatalog(input): Promise<SubscriptionEnsureCatalogResult> {
    const stripe = getStripe(input.credentials)
    const result: SubscriptionEnsureCatalogResult = { prices: [] }
    for (const plan of input.plans) {
      const productLookupKey = plan.prices[0]?.productLookupKey ?? plan.productCode
      const product = await ensureProduct(stripe, plan, productLookupKey)
      for (const price of plan.prices) {
        if (!price.isActive) continue
        const ensured = await ensurePrice(stripe, product, price)
        result.prices.push({
          priceCode: price.priceCode,
          providerProductRef: product.id,
          providerPriceRef: ensured.id,
        })
      }
    }
    return result
  },

  async createCheckoutSession(input: SubscriptionCheckoutInput): Promise<SubscriptionCheckoutResult> {
    const stripe = getStripe(input.credentials)
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: input.customerRef.providerCustomerId,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      allow_promotion_codes: input.allowPromotionCodes === true,
      client_reference_id: input.externalAccountId,
      line_items: [
        {
          price: input.priceRef.providerPriceRef,
          quantity: 1,
        },
      ],
      subscription_data: {
        trial_period_days: input.trialPeriodDays ?? undefined,
        metadata: {
          externalAccountId: input.externalAccountId,
          priceCode: input.priceRef.priceCode,
          tenantId: input.scope.tenantId,
          organizationId: input.scope.organizationId,
          ...buildMetadata(input.metadata),
        },
      },
      metadata: {
        externalAccountId: input.externalAccountId,
        priceCode: input.priceRef.priceCode,
        tenantId: input.scope.tenantId,
        organizationId: input.scope.organizationId,
      },
    })
    if (!session.url) {
      throw new Error('gateway_stripe: Stripe Checkout did not return a URL')
    }
    return { checkoutUrl: session.url, providerSessionId: session.id }
  },

  async createBillingPortalSession(input: SubscriptionBillingPortalInput): Promise<SubscriptionBillingPortalResult> {
    const stripe = getStripe(input.credentials)
    const configuration = input.allowPlanSwitching === false
      ? await ensureBillingPortalConfiguration(stripe)
      : undefined
    const session = await stripe.billingPortal.sessions.create({
      customer: input.customerRef.providerCustomerId,
      configuration,
      return_url: input.returnUrl,
    })
    return { portalUrl: session.url }
  },

  async cancelSubscription(input: SubscriptionCancelInput): Promise<SubscriptionCancelResult> {
    const stripe = getStripe(input.credentials)
    if (input.atPeriodEnd) {
      const updated = await stripe.subscriptions.update(input.providerSubscriptionId, { cancel_at_period_end: true })
      return {
        providerStatus: updated.status,
        cancelAtPeriodEnd: updated.cancel_at_period_end,
        cancelledAt: unixToDate(updated.canceled_at),
      }
    }
    const cancelled = await stripe.subscriptions.cancel(input.providerSubscriptionId)
    return {
      providerStatus: cancelled.status,
      cancelAtPeriodEnd: cancelled.cancel_at_period_end,
      cancelledAt: unixToDate(cancelled.canceled_at),
    }
  },

  async fetchSubscriptionSnapshot(input: SubscriptionFetchSnapshotInput): Promise<SubscriptionSnapshot | null> {
    const stripe = getStripe(input.credentials)
    try {
      const subscription = await stripe.subscriptions.retrieve(input.providerSubscriptionId, {
        expand: ['items.data.price.product'],
      })
      return buildSnapshot(subscription)
    } catch (error: unknown) {
      const status = (error as { statusCode?: number }).statusCode
      if (status === 404) return null
      throw error
    }
  },
}
