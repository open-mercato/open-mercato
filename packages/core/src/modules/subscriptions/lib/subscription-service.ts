import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  getPaymentRecurringRuntime,
  type PaymentRecurringRuntime,
  type SubscriptionRuntimeScope,
  type SubscriptionSnapshot,
} from '@open-mercato/shared/modules/subscriptions/runtime'
import { GatewaySubscriptionMapping } from '../../payment_gateways/data/entities'
import { Subscription } from '../data/entities'
import { mapProviderStatusToAccessState } from './access-state'
import type { CredentialsService } from '../../integrations/lib/credentials-service'
import type { EventBusLike } from './types'

export type SubscriptionServiceDeps = {
  em: EntityManager
  integrationCredentialsService: CredentialsService
  eventBus?: EventBusLike | null
  cache?: {
    invalidateTag?: (tag: string) => Promise<void>
  } | null
}

export type CheckoutSessionInput = {
  scope: SubscriptionRuntimeScope
  externalAccountId: string
  subjectEntityType: string
  subjectEntityId: string
  priceCode: string
  successUrl: string
  cancelUrl: string
  omCustomerId: string
  customerEmail?: string | null
  customerName?: string | null
  metadata?: Record<string, unknown>
}

export type CheckoutSessionResult = {
  checkoutUrl: string
  providerCustomerId: string
  providerSessionId: string
  subscriptionRequestId: string
}

function requireRuntime(providerKey: string): PaymentRecurringRuntime {
  const runtime = getPaymentRecurringRuntime(providerKey)
  if (!runtime) {
    throw new Error(`subscriptions: no recurring runtime registered for provider "${providerKey}"`)
  }
  return runtime
}

export async function loadCredentials(
  credentialsService: CredentialsService,
  providerKey: string,
  scope: SubscriptionRuntimeScope,
): Promise<Record<string, unknown>> {
  const credentials = await credentialsService.resolve(`gateway_${providerKey}`, scope)
  if (!credentials) {
    throw new Error(`subscriptions: missing integration credentials for gateway_${providerKey}`)
  }
  return credentials
}

export async function applySnapshotToSubscription(
  em: EntityManager,
  subscription: Subscription,
  snapshot: SubscriptionSnapshot,
  options: { authoritative?: boolean; eventTimestamp?: Date | null } = {},
): Promise<{ changed: boolean; previousAccessState: Subscription['accessState'] }> {
  const previousAccessState = subscription.accessState
  const eventTime = options.eventTimestamp ?? snapshot.lastEventAt ?? null
  if (!options.authoritative && eventTime && subscription.lastProviderEventAt && eventTime.getTime() < subscription.lastProviderEventAt.getTime()) {
    return { changed: false, previousAccessState }
  }

  subscription.providerStatus = snapshot.providerStatus
  subscription.accessState = mapProviderStatusToAccessState(snapshot.providerStatus)
  subscription.currentPeriodStart = snapshot.currentPeriodStart ?? null
  subscription.currentPeriodEnd = snapshot.currentPeriodEnd ?? null
  subscription.trialEndsAt = snapshot.trialEndsAt ?? null
  subscription.cancelAtPeriodEnd = snapshot.cancelAtPeriodEnd
  subscription.cancelledAt = snapshot.cancelledAt ?? null
  if (snapshot.providerSubscriptionId) {
    subscription.providerSubscriptionId = snapshot.providerSubscriptionId
  }
  if (eventTime) {
    subscription.lastProviderEventAt = eventTime
  }
  return { changed: true, previousAccessState }
}

export async function ensureMappingForSubscription(
  em: EntityManager,
  params: {
    providerKey: string
    providerCustomerId: string
    organizationId: string
    tenantId: string
    externalAccountId: string
    subjectEntityType: string
    subjectEntityId: string
  },
): Promise<GatewaySubscriptionMapping> {
  const existing = await findOneWithDecryption(
    em,
    GatewaySubscriptionMapping,
    {
      providerKey: params.providerKey,
      providerCustomerId: params.providerCustomerId,
      organizationId: params.organizationId,
      tenantId: params.tenantId,
      externalAccountId: params.externalAccountId,
      providerSubscriptionId: null,
    },
    undefined,
    { organizationId: params.organizationId, tenantId: params.tenantId },
  )
  if (existing) {
    let dirty = false
    if (existing.subjectEntityType !== params.subjectEntityType) {
      existing.subjectEntityType = params.subjectEntityType
      dirty = true
    }
    if (existing.subjectEntityId !== params.subjectEntityId) {
      existing.subjectEntityId = params.subjectEntityId
      dirty = true
    }
    if (dirty) await em.flush()
    return existing
  }
  const mapping = em.create(GatewaySubscriptionMapping, {
    providerKey: params.providerKey,
    providerCustomerId: params.providerCustomerId,
    organizationId: params.organizationId,
    tenantId: params.tenantId,
    externalAccountId: params.externalAccountId,
    subjectEntityType: params.subjectEntityType,
    subjectEntityId: params.subjectEntityId,
  })
  em.persist(mapping)
  await em.flush()
  return mapping
}

export { requireRuntime }
