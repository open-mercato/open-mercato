import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  getPaymentRecurringRuntime,
  type SubscriptionSnapshot,
} from '@open-mercato/shared/modules/subscriptions/runtime'
import { GatewaySubscriptionMapping } from '../../payment_gateways/data/entities'
import { Subscription, SubscriptionPlan, SubscriptionPrice } from '../data/entities'
import { mapProviderStatusToAccessState } from '../lib/access-state'
import { loadCredentials } from '../lib/subscription-service'
import { normalizeSubjectEntityType } from '../lib/subject-entity'
import type { CredentialsService } from '../../integrations/lib/credentials-service'

export type GatewaySubscriptionEventPayload = {
  providerKey: string
  organizationId: string
  tenantId: string
  externalAccountId: string | null
  subscriptionId?: string | null
  subjectEntityType?: string | null
  subjectEntityId?: string | null
  providerSubscriptionId: string | null
  providerCustomerId: string | null
  providerInvoiceId: string | null
  providerChargeId: string | null
  providerEventType: string
  providerEventId: string
  providerEventCreatedAt: string
  data: Record<string, unknown>
}

export function parseEventTimestamp(payload: GatewaySubscriptionEventPayload): Date | null {
  if (!payload.providerEventCreatedAt) return null
  const ts = new Date(payload.providerEventCreatedAt)
  return Number.isNaN(ts.getTime()) ? null : ts
}

export async function loadMappingForEvent(
  em: EntityManager,
  payload: GatewaySubscriptionEventPayload,
): Promise<GatewaySubscriptionMapping | null> {
  const scope = { tenantId: payload.tenantId, organizationId: payload.organizationId }
  if (payload.providerSubscriptionId) {
    const bySub = await findOneWithDecryption(
      em,
      GatewaySubscriptionMapping,
      {
        providerKey: payload.providerKey,
        providerSubscriptionId: payload.providerSubscriptionId,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
      },
      undefined,
      scope,
    )
    if (bySub) return bySub
  }
  if (payload.providerCustomerId) {
    return findOneWithDecryption(
      em,
      GatewaySubscriptionMapping,
      {
        providerKey: payload.providerKey,
        providerCustomerId: payload.providerCustomerId,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
      },
      { orderBy: { createdAt: 'desc' } },
      scope,
    )
  }
  return null
}

export async function loadSubscription(
  em: EntityManager,
  payload: GatewaySubscriptionEventPayload,
): Promise<Subscription | null> {
  const scope = { tenantId: payload.tenantId, organizationId: payload.organizationId }
  if (payload.subscriptionId) {
    const byId = await findOneWithDecryption(
      em,
      Subscription,
      { id: payload.subscriptionId, deletedAt: null },
      { populate: ['plan', 'price'] },
      scope,
    )
    if (byId) return byId
  }
  if (payload.providerSubscriptionId) {
    return findOneWithDecryption(
      em,
      Subscription,
      {
        providerKey: payload.providerKey,
        providerSubscriptionId: payload.providerSubscriptionId,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        deletedAt: null,
      },
      { populate: ['plan', 'price'] },
      scope,
    )
  }
  return null
}

export async function ensureSubscriptionFromSnapshot(
  ctx: { em: EntityManager; credentialsService: CredentialsService; eventBus?: { emitEvent?: Function } | null; cache?: { invalidateTag?: (tag: string) => Promise<void> } | null },
  payload: GatewaySubscriptionEventPayload,
  snapshot: SubscriptionSnapshot,
): Promise<Subscription | null> {
  const { em } = ctx
  const scope = { tenantId: payload.tenantId, organizationId: payload.organizationId }
  const eventTime = parseEventTimestamp(payload) ?? snapshot.lastEventAt ?? null
  const existing = await loadSubscription(em, payload)
  if (existing) {
    existing.providerStatus = snapshot.providerStatus
    existing.accessState = mapProviderStatusToAccessState(snapshot.providerStatus)
    existing.providerSubscriptionId = snapshot.providerSubscriptionId
    existing.currentPeriodStart = snapshot.currentPeriodStart ?? null
    existing.currentPeriodEnd = snapshot.currentPeriodEnd ?? null
    existing.trialEndsAt = snapshot.trialEndsAt ?? null
    existing.cancelAtPeriodEnd = snapshot.cancelAtPeriodEnd
    existing.cancelledAt = snapshot.cancelledAt ?? null
    if (eventTime) existing.lastProviderEventAt = eventTime
    await em.flush()
    return existing
  }

  if (!snapshot.priceCode || !payload.externalAccountId) {
    return null
  }
  const price = await findOneWithDecryption(
    em,
    SubscriptionPrice,
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      code: snapshot.priceCode,
      deletedAt: null,
    },
    { populate: ['plan'] },
    scope,
  )
  if (!price || !price.plan) return null

  const mapping = await loadMappingForEvent(em, payload)
  const subjectEntityTypeRaw = snapshot.subjectEntityType
    ?? payload.subjectEntityType
    ?? mapping?.subjectEntityType
    ?? null
  const subjectEntityType = subjectEntityTypeRaw ? normalizeSubjectEntityType(subjectEntityTypeRaw) : null
  const subjectEntityId = snapshot.subjectEntityId
    ?? payload.subjectEntityId
    ?? mapping?.subjectEntityId
    ?? null
  if (!subjectEntityType || !subjectEntityId) return null

  const created = em.create(Subscription, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    externalAccountId: payload.externalAccountId,
    subjectEntityType,
    subjectEntityId,
    plan: price.plan,
    price,
    providerKey: payload.providerKey,
    providerCustomerId: snapshot.providerCustomerId,
    providerSubscriptionId: snapshot.providerSubscriptionId,
    providerStatus: snapshot.providerStatus,
    accessState: mapProviderStatusToAccessState(snapshot.providerStatus),
    currentPeriodStart: snapshot.currentPeriodStart ?? null,
    currentPeriodEnd: snapshot.currentPeriodEnd ?? null,
    trialEndsAt: snapshot.trialEndsAt ?? null,
    cancelAtPeriodEnd: snapshot.cancelAtPeriodEnd,
    cancelledAt: snapshot.cancelledAt ?? null,
    lastProviderEventAt: eventTime,
  })
  em.persist(created)
  await em.flush()
  return created
}

export async function fetchSnapshotForPayload(
  ctx: { credentialsService: CredentialsService },
  payload: GatewaySubscriptionEventPayload,
): Promise<SubscriptionSnapshot | null> {
  if (!payload.providerSubscriptionId) return null
  const runtime = getPaymentRecurringRuntime(payload.providerKey)
  if (!runtime) return null
  const credentials = await loadCredentials(ctx.credentialsService, payload.providerKey, {
    tenantId: payload.tenantId,
    organizationId: payload.organizationId,
  })
  return runtime.fetchSubscriptionSnapshot({
    scope: { tenantId: payload.tenantId, organizationId: payload.organizationId },
    providerSubscriptionId: payload.providerSubscriptionId,
    credentials,
  })
}

export async function linkMappingToSubscription(
  em: EntityManager,
  payload: GatewaySubscriptionEventPayload,
  subscription: Subscription,
): Promise<void> {
  const mapping = await loadMappingForEvent(em, payload)
  if (!mapping) return
  let dirty = false
  if (payload.providerSubscriptionId && mapping.providerSubscriptionId !== payload.providerSubscriptionId) {
    mapping.providerSubscriptionId = payload.providerSubscriptionId
    dirty = true
  }
  if (!mapping.subscriptionId) {
    mapping.subscriptionId = subscription.id
    dirty = true
  }
  if (dirty) await em.flush()
}

export { SubscriptionPlan, SubscriptionPrice }
