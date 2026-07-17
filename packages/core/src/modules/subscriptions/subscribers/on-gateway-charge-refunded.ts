import type { EntityManager } from '@mikro-orm/postgresql'
import { UniqueConstraintViolationException } from '@mikro-orm/core'
import {
  loadSubscription,
  parseEventTimestamp,
  type GatewaySubscriptionEventPayload,
} from './shared'
import { SubscriptionBillingRecord } from '../data/entities'

export const metadata = {
  event: 'payment_gateways.charge.refunded',
  persistent: true,
  id: 'subscriptions.on-gateway-charge-refunded',
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

  const subscription = await loadSubscription(em, payload)
  if (!subscription) return

  const data = payload.data ?? {}
  const amount = readNumber(data.amount_refunded ?? data.amount)
  const currency = (typeof data.currency === 'string' ? data.currency : subscription.price?.currencyCode ?? 'USD').toUpperCase()
  const eventTime = parseEventTimestamp(payload) ?? new Date()
  const invoiceId = typeof data.invoice === 'string' ? data.invoice : null

  const record = em.create(SubscriptionBillingRecord, {
    tenantId: payload.tenantId,
    organizationId: payload.organizationId,
    subscription,
    providerKey: payload.providerKey,
    providerInvoiceId: invoiceId ?? null,
    providerPaymentIntentId: readString(data.payment_intent),
    providerChargeId: payload.providerChargeId ?? readString(data.id),
    status: 'refunded',
    amountMinor: amount,
    currencyCode: currency,
    periodStart: null,
    periodEnd: null,
    eventType: payload.providerEventType,
    processedAt: eventTime,
  })
  try {
    em.persist(record)
    await em.flush()
  } catch (error: unknown) {
    if (!(error instanceof UniqueConstraintViolationException)) throw error
    em.clear()
  }
}
