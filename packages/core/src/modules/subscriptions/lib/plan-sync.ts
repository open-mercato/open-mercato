import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type {
  PaymentRecurringRuntime,
  SubscriptionPlanSyncEntry,
} from '@open-mercato/shared/modules/subscriptions/runtime'
import { SubscriptionPlan, SubscriptionPrice } from '../data/entities'
import { subscriptionPlans, type SubscriptionPlanManifest } from '../plans'

export type PlanSyncScope = { tenantId: string; organizationId: string }

export type PlanSyncResult = {
  plansUpserted: number
  pricesUpserted: number
  pricesDeactivated: number
  providerEnsured: number
}

function toRuntimeEntry(plan: SubscriptionPlanManifest): SubscriptionPlanSyncEntry {
  return {
    planCode: plan.code,
    productCode: plan.productCode,
    title: plan.title,
    description: plan.description ?? null,
    prices: plan.prices
      .filter((price) => price.providerKey === 'stripe')
      .map((price) => ({
        priceCode: price.code,
        productLookupKey: price.stripe.productLookupKey,
        priceLookupKey: price.stripe.priceLookupKey,
        currencyCode: price.currencyCode,
        interval: price.interval,
        intervalCount: price.intervalCount,
        unitAmountMinor: price.unitAmountMinor,
        trialDays: price.trialDays ?? null,
        taxBehavior: price.stripe.taxBehavior,
        isActive: price.isActive !== false,
      })),
  }
}

export type SyncPlansDeps = {
  em: EntityManager
  scope: PlanSyncScope
  runtime?: PaymentRecurringRuntime | null
  credentials?: Record<string, unknown> | null
  manifest?: SubscriptionPlanManifest[]
}

export async function syncSubscriptionPlans(deps: SyncPlansDeps): Promise<PlanSyncResult> {
  const { em, scope, runtime, credentials } = deps
  const manifest = deps.manifest ?? subscriptionPlans

  let providerEnsured = 0
  const providerResultByPriceCode = new Map<string, { providerProductRef: string; providerPriceRef: string }>()
  if (runtime && credentials) {
    const ensured = await runtime.ensureCatalog({
      scope,
      credentials,
      plans: manifest.map(toRuntimeEntry),
    })
    for (const entry of ensured.prices) {
      providerResultByPriceCode.set(entry.priceCode, {
        providerProductRef: entry.providerProductRef,
        providerPriceRef: entry.providerPriceRef,
      })
    }
    providerEnsured = ensured.prices.length
  }

  let plansUpserted = 0
  let pricesUpserted = 0
  const manifestPlanCodes = new Set<string>()
  const manifestPriceCodesByPlan = new Map<string, Set<string>>()

  for (const planEntry of manifest) {
    manifestPlanCodes.add(planEntry.code)
    let plan = await findOneWithDecryption(
      em,
      SubscriptionPlan,
      { tenantId: scope.tenantId, organizationId: scope.organizationId, code: planEntry.code, deletedAt: null },
      undefined,
      scope,
    )
    const planIsActive = planEntry.isActive !== false
    if (!plan) {
      plan = em.create(SubscriptionPlan, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        code: planEntry.code,
        productCode: planEntry.productCode,
        title: planEntry.title,
        description: planEntry.description ?? null,
        entitlementsJson: planEntry.entitlements ?? null,
        isActive: planIsActive,
      })
      em.persist(plan)
    } else {
      plan.productCode = planEntry.productCode
      plan.title = planEntry.title
      plan.description = planEntry.description ?? null
      plan.entitlementsJson = planEntry.entitlements ?? null
      plan.isActive = planIsActive
    }
    plansUpserted += 1

    const priceCodes = new Set<string>()
    manifestPriceCodesByPlan.set(planEntry.code, priceCodes)
    for (const priceEntry of planEntry.prices) {
      if (priceEntry.providerKey !== 'stripe') continue
      priceCodes.add(priceEntry.code)
      let price = await findOneWithDecryption(
        em,
        SubscriptionPrice,
        { tenantId: scope.tenantId, organizationId: scope.organizationId, code: priceEntry.code, deletedAt: null },
        undefined,
        scope,
      )
      const providerRefs = providerResultByPriceCode.get(priceEntry.code) ?? null
      const isActive = priceEntry.isActive !== false
      if (!price) {
        price = em.create(SubscriptionPrice, {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          plan,
          code: priceEntry.code,
          providerKey: priceEntry.providerKey,
          currencyCode: priceEntry.currencyCode,
          interval: priceEntry.interval,
          intervalCount: priceEntry.intervalCount,
          unitAmountMinor: priceEntry.unitAmountMinor,
          trialDays: priceEntry.trialDays ?? null,
          providerProductRef: providerRefs?.providerProductRef ?? null,
          providerPriceRef: providerRefs?.providerPriceRef ?? null,
          productLookupKey: priceEntry.stripe.productLookupKey,
          priceLookupKey: priceEntry.stripe.priceLookupKey,
          isDefault: priceEntry.isDefault === true,
          isActive,
        })
        em.persist(price)
      } else {
        if (price.unitAmountMinor !== priceEntry.unitAmountMinor || price.currencyCode !== priceEntry.currencyCode || price.interval !== priceEntry.interval || price.intervalCount !== priceEntry.intervalCount) {
          throw new Error(
            `subscriptions.plan-sync: economic change on existing price code "${priceEntry.code}" is not allowed; introduce a new versioned price code instead`,
          )
        }
        price.trialDays = priceEntry.trialDays ?? null
        price.productLookupKey = priceEntry.stripe.productLookupKey
        price.priceLookupKey = priceEntry.stripe.priceLookupKey
        price.isDefault = priceEntry.isDefault === true
        price.isActive = isActive
        if (providerRefs) {
          price.providerProductRef = providerRefs.providerProductRef
          price.providerPriceRef = providerRefs.providerPriceRef
          await em.nativeUpdate(
            SubscriptionPrice,
            { id: price.id, tenantId: scope.tenantId, organizationId: scope.organizationId },
            {
              providerProductRef: providerRefs.providerProductRef,
              providerPriceRef: providerRefs.providerPriceRef,
            },
          )
        }
      }
      pricesUpserted += 1
    }
  }

  const existingPlans = await findWithDecryption(
    em,
    SubscriptionPlan,
    { tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
    undefined,
    scope,
  )

  let pricesDeactivated = 0
  for (const existing of existingPlans) {
    if (!manifestPlanCodes.has(existing.code) && existing.isActive) {
      existing.isActive = false
    }
    const allowedCodes = manifestPriceCodesByPlan.get(existing.code) ?? new Set<string>()
    const prices = await findWithDecryption(
      em,
      SubscriptionPrice,
      { tenantId: scope.tenantId, organizationId: scope.organizationId, plan: existing, deletedAt: null },
      undefined,
      scope,
    )
    for (const price of prices) {
      if (!allowedCodes.has(price.code) && price.isActive) {
        price.isActive = false
        pricesDeactivated += 1
      }
    }
  }

  await em.flush()

  return {
    plansUpserted,
    pricesUpserted,
    pricesDeactivated,
    providerEnsured,
  }
}
