export type SubscriptionRuntimeScope = {
  tenantId: string
  organizationId: string
}

export type SubscriptionPlanInterval = 'month' | 'year'

export type SubscriptionCustomerRef = {
  providerCustomerId: string
}

export type SubscriptionEnsureCustomerInput = {
  scope: SubscriptionRuntimeScope
  omCustomerId: string
  externalAccountId: string
  email?: string | null
  name?: string | null
  credentials: Record<string, unknown>
  metadata?: Record<string, unknown>
}

export type SubscriptionPlanSyncEntry = {
  planCode: string
  productCode: string
  title: string
  description?: string | null
  prices: Array<{
    priceCode: string
    productLookupKey: string
    priceLookupKey: string
    currencyCode: string
    interval: SubscriptionPlanInterval
    intervalCount: number
    unitAmountMinor: number
    trialDays?: number | null
    taxBehavior?: 'inclusive' | 'exclusive' | 'unspecified'
    isActive: boolean
  }>
}

export type SubscriptionEnsureCatalogResult = {
  prices: Array<{
    priceCode: string
    providerProductRef: string
    providerPriceRef: string
  }>
}

export type SubscriptionCheckoutInput = {
  scope: SubscriptionRuntimeScope
  customerRef: SubscriptionCustomerRef
  priceRef: { providerPriceRef: string; priceCode: string }
  externalAccountId: string
  successUrl: string
  cancelUrl: string
  allowPromotionCodes?: boolean
  trialPeriodDays?: number | null
  metadata?: Record<string, unknown>
  credentials: Record<string, unknown>
}

export type SubscriptionCheckoutResult = {
  checkoutUrl: string
  providerSessionId: string
}

export type SubscriptionBillingPortalInput = {
  scope: SubscriptionRuntimeScope
  customerRef: SubscriptionCustomerRef
  returnUrl: string
  allowPlanSwitching?: boolean
  credentials: Record<string, unknown>
}

export type SubscriptionBillingPortalResult = {
  portalUrl: string
}

export type SubscriptionCancelInput = {
  scope: SubscriptionRuntimeScope
  providerSubscriptionId: string
  atPeriodEnd: boolean
  credentials: Record<string, unknown>
}

export type SubscriptionCancelResult = {
  providerStatus: string
  cancelAtPeriodEnd: boolean
  cancelledAt?: Date | null
}

export type SubscriptionSnapshot = {
  providerSubscriptionId: string
  providerCustomerId: string
  providerStatus: string
  cancelAtPeriodEnd: boolean
  cancelledAt?: Date | null
  currentPeriodStart?: Date | null
  currentPeriodEnd?: Date | null
  trialEndsAt?: Date | null
  priceCode?: string | null
  providerPriceRef?: string | null
  providerProductRef?: string | null
  externalAccountId?: string | null
  subjectEntityType?: string | null
  subjectEntityId?: string | null
  lastEventAt?: Date | null
}

export type SubscriptionFetchSnapshotInput = {
  scope: SubscriptionRuntimeScope
  providerSubscriptionId: string
  credentials: Record<string, unknown>
}

export interface PaymentRecurringRuntime {
  readonly providerKey: string
  ensureCustomer(input: SubscriptionEnsureCustomerInput): Promise<SubscriptionCustomerRef>
  ensureCatalog(input: {
    scope: SubscriptionRuntimeScope
    plans: SubscriptionPlanSyncEntry[]
    credentials: Record<string, unknown>
  }): Promise<SubscriptionEnsureCatalogResult>
  createCheckoutSession(input: SubscriptionCheckoutInput): Promise<SubscriptionCheckoutResult>
  createBillingPortalSession(input: SubscriptionBillingPortalInput): Promise<SubscriptionBillingPortalResult>
  cancelSubscription(input: SubscriptionCancelInput): Promise<SubscriptionCancelResult>
  fetchSubscriptionSnapshot(input: SubscriptionFetchSnapshotInput): Promise<SubscriptionSnapshot | null>
}

const RUNTIME_REGISTRY_KEY = '__openMercatoPaymentRecurringRuntimes__'

function getRuntimeRegistry(): Map<string, PaymentRecurringRuntime> {
  const globalState = globalThis as typeof globalThis & {
    [RUNTIME_REGISTRY_KEY]?: Map<string, PaymentRecurringRuntime>
  }
  if (!globalState[RUNTIME_REGISTRY_KEY]) {
    globalState[RUNTIME_REGISTRY_KEY] = new Map<string, PaymentRecurringRuntime>()
  }
  return globalState[RUNTIME_REGISTRY_KEY]
}

export function registerPaymentRecurringRuntime(runtime: PaymentRecurringRuntime): () => void {
  const registry = getRuntimeRegistry()
  registry.set(runtime.providerKey, runtime)
  return () => {
    const current = registry.get(runtime.providerKey)
    if (current === runtime) registry.delete(runtime.providerKey)
  }
}

export function getPaymentRecurringRuntime(providerKey: string): PaymentRecurringRuntime | undefined {
  return getRuntimeRegistry().get(providerKey)
}

export function listPaymentRecurringRuntimes(): PaymentRecurringRuntime[] {
  return Array.from(getRuntimeRegistry().values())
}

export function clearPaymentRecurringRuntimes(): void {
  getRuntimeRegistry().clear()
}
