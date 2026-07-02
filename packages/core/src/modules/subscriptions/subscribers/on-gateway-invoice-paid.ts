import type { EntityManager } from '@mikro-orm/postgresql'
import { UniqueConstraintViolationException } from '@mikro-orm/core'
import { emitSubscriptionsEvent } from '../events'
import {
  loadSubscription,
  parseEventTimestamp,
  type GatewaySubscriptionEventPayload,
} from './shared'
import { SubscriptionBillingRecord } from '../data/entities'

export const metadata = {
  event: 'payment_gateways.invoice.paid',
  persistent: true,
  id: 'subscriptions.on-gateway-invoice-paid',
}

type Ctx = {
  resolve?: <T = unknown>(name: string) => T
  container?: { resolve: <T = unknown>(name: string) => T }
}

function getResolver(ctx: Ctx | undefined): (<T>(name: string) => T) | null {
  if (!ctx) return null
  if (typeof ctx.resolve === 'function') return ctx.resolve as <T>(name: string) => T
  if (ctx.container && typeof ctx.container.resolve === 'function') return ctx.container.resolve.bind(ctx.container) as <T>(name: string) => T
  return null
}

function readNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return 0
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

export default async function handler(payload: GatewaySubscriptionEventPayload, ctx: Ctx): Promise<void> {
  const resolve = getResolver(ctx)
  if (!resolve) return
  const em = resolve<EntityManager>('em')

  let subscription = await loadSubscription(em, payload)
  if (!subscription) return

  const data = payload.data ?? {}
  const amountPaid = readNumber(data.amount_paid ?? data.amount_due ?? data.total)
  const currency = (typeof data.currency === 'string' ? data.currency : subscription.price?.currencyCode ?? 'USD').toUpperCase()
  const eventTime = parseEventTimestamp(payload) ?? new Date()
  const periodStart = readNumber(data.period_start)
  const periodEnd = readNumber(data.period_end)

  const record = em.create(SubscriptionBillingRecord, {
    tenantId: payload.tenantId,
    organizationId: payload.organizationId,
    subscription,
    providerKey: payload.providerKey,
    providerInvoiceId: payload.providerInvoiceId ?? readString(data.id),
    providerPaymentIntentId: readString(data.payment_intent),
    providerChargeId: readString(data.charge),
    status: 'paid',
    amountMinor: amountPaid,
    currencyCode: currency,
    periodStart: periodStart ? new Date(periodStart * 1000) : null,
    periodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
    eventType: payload.providerEventType,
    processedAt: eventTime,
  })
  try {
    em.persist(record)
    await em.flush()
  } catch (error: unknown) {
    if (!(error instanceof UniqueConstraintViolationException)) throw error
    em.clear()
    subscription = await loadSubscription(em, payload)
    if (!subscription) return
  }

  const previous = subscription.accessState
  if (subscription.accessState === 'grace') {
    subscription.accessState = 'granted'
    await em.flush()
  }
  if (previous !== subscription.accessState) {
    await emitSubscriptionsEvent(
      'subscriptions.access.changed',
      {
        tenantId: payload.tenantId,
        organizationId: payload.organizationId,
        subscriptionId: subscription.id,
        externalAccountId: subscription.externalAccountId,
        accessState: subscription.accessState,
        previousAccessState: previous,
        providerStatus: subscription.providerStatus,
      },
    )
  }
}
