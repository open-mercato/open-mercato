import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Subscription, SubscriptionPlan, SubscriptionPrice } from '../data/entities'
import type { SubscriptionAccessState } from './access-state'

export type AccessLookupScope = { tenantId: string; organizationId: string }

export type AccessSnapshot = {
  subscriptionId: string | null
  externalAccountId: string
  productCode: string
  planCode: string | null
  priceCode: string | null
  provider: string | null
  providerStatus: string | null
  accessState: SubscriptionAccessState
  currentPeriodStart: string | null
  currentPeriodEnd: string | null
  trialEndsAt: string | null
  cancelAtPeriodEnd: boolean
  entitlements: Record<string, unknown> | null
  updatedAt: string | null
}

const ACCESS_STATE_PRIORITY: Record<SubscriptionAccessState, number> = {
  granted: 3,
  grace: 2,
  pending: 1,
  blocked: 0,
}

export async function computeAccessSnapshot(
  em: EntityManager,
  scope: AccessLookupScope,
  externalAccountId: string,
  productCode: string,
): Promise<AccessSnapshot> {
  const query = {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    externalAccountId,
    deletedAt: null,
  } as Record<string, unknown>

  const em2 = em.fork()
  const candidates = await em2.find(
    Subscription,
    query,
    { populate: ['plan', 'price'], orderBy: { updatedAt: 'desc' } },
  )

  const matching = candidates.filter((sub) => sub.plan?.productCode === productCode)
  if (matching.length === 0) {
    return {
      subscriptionId: null,
      externalAccountId,
      productCode,
      planCode: null,
      priceCode: null,
      provider: null,
      providerStatus: null,
      accessState: 'blocked',
      currentPeriodStart: null,
      currentPeriodEnd: null,
      trialEndsAt: null,
      cancelAtPeriodEnd: false,
      entitlements: null,
      updatedAt: null,
    }
  }

  matching.sort((a, b) => {
    const priorityDiff = ACCESS_STATE_PRIORITY[b.accessState] - ACCESS_STATE_PRIORITY[a.accessState]
    if (priorityDiff !== 0) return priorityDiff
    const aTime = a.updatedAt?.getTime() ?? 0
    const bTime = b.updatedAt?.getTime() ?? 0
    return bTime - aTime
  })
  const best = matching[0]

  return {
    subscriptionId: best.id,
    externalAccountId,
    productCode,
    planCode: best.plan?.code ?? null,
    priceCode: best.price?.code ?? null,
    provider: best.providerKey,
    providerStatus: best.providerStatus,
    accessState: best.accessState,
    currentPeriodStart: best.currentPeriodStart ? best.currentPeriodStart.toISOString() : null,
    currentPeriodEnd: best.currentPeriodEnd ? best.currentPeriodEnd.toISOString() : null,
    trialEndsAt: best.trialEndsAt ? best.trialEndsAt.toISOString() : null,
    cancelAtPeriodEnd: best.cancelAtPeriodEnd,
    entitlements: best.plan?.entitlementsJson ?? null,
    updatedAt: best.updatedAt?.toISOString() ?? null,
  }
}

export type CacheLike = {
  get: <T>(key: string) => Promise<T | null | undefined>
  set: (key: string, value: unknown, options?: { ttl?: number; tags?: string[] }) => Promise<void>
  invalidateTag?: (tag: string) => Promise<void>
}

export type AccessSnapshotCachedDeps = {
  em: EntityManager
  cache?: CacheLike | null
  scope: AccessLookupScope
  externalAccountId: string
  productCode: string
  ttlSeconds?: number
}

export function buildAccessCacheKey(scope: AccessLookupScope, externalAccountId: string, productCode: string): string {
  return `subscriptions:access:${scope.tenantId}:${scope.organizationId}:${externalAccountId}:${productCode}`
}

export function buildAccessCacheTags(scope: AccessLookupScope, externalAccountId: string, subscriptionId?: string | null): string[] {
  const tags = [
    `tenant:${scope.tenantId}`,
    `org:${scope.organizationId}`,
    `external_account:${externalAccountId}`,
    `subscriptions:account:${scope.tenantId}:${externalAccountId}`,
  ]
  if (subscriptionId) tags.push(`subscription:${subscriptionId}`)
  return tags
}

export async function computeAccessSnapshotCached(deps: AccessSnapshotCachedDeps): Promise<AccessSnapshot> {
  const { em, cache, scope, externalAccountId, productCode } = deps
  const key = buildAccessCacheKey(scope, externalAccountId, productCode)
  if (cache) {
    const cached = await cache.get<AccessSnapshot>(key)
    if (cached) return cached
  }
  const snapshot = await computeAccessSnapshot(em, scope, externalAccountId, productCode)
  if (cache) {
    await cache.set(key, snapshot, {
      ttl: deps.ttlSeconds ?? 60,
      tags: buildAccessCacheTags(scope, externalAccountId, snapshot.subscriptionId),
    })
  }
  return snapshot
}

export type ResolvePriceResult = {
  plan: SubscriptionPlan
  price: SubscriptionPrice
}

export async function resolveActivePriceByCode(
  em: EntityManager,
  scope: AccessLookupScope,
  priceCode: string,
): Promise<ResolvePriceResult | null> {
  const price = await findOneWithDecryption(
    em,
    SubscriptionPrice,
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      code: priceCode,
      deletedAt: null,
    },
    { populate: ['plan'] },
    scope,
  )
  if (!price) return null
  if (!price.isActive) return null
  if (!price.plan?.isActive) return null
  return { plan: price.plan, price }
}
