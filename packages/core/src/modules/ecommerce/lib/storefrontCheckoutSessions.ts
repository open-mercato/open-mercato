import type { EntityManager } from '@mikro-orm/postgresql'
import { EcommerceCheckoutSession } from '../data/entities'
import type { StoreContext } from './storeContext'

export type CheckoutSessionDto = {
  id: string
  cartId: string
  cartToken: string
  workflowName: string
  workflowState: string
  status: string
  version: number
  customerInfo: Record<string, unknown> | null
  shippingInfo: Record<string, unknown> | null
  billingInfo: Record<string, unknown> | null
  metadata: Record<string, unknown> | null
  placedOrderId: string | null
  expiresAt: string
  createdAt: string
  updatedAt: string
  allowedActions: string[]
}

export function formatCheckoutSessionDto(session: EcommerceCheckoutSession): CheckoutSessionDto {
  return {
    id: session.id,
    cartId: session.cartId,
    cartToken: session.cartToken,
    workflowName: session.workflowName,
    workflowState: session.workflowState,
    status: session.status,
    version: session.version,
    customerInfo: session.customerInfo ?? null,
    shippingInfo: session.shippingInfo ?? null,
    billingInfo: session.billingInfo ?? null,
    metadata: session.metadata ?? null,
    placedOrderId: session.placedOrderId ?? null,
    expiresAt: session.expiresAt.toISOString(),
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
    allowedActions: getAllowedCheckoutActions(session),
  }
}

export function getAllowedCheckoutActions(session: EcommerceCheckoutSession): string[] {
  if (session.status !== 'active') return []
  switch (session.workflowState) {
    case 'cart':
      return ['set_customer', 'cancel']
    case 'customer':
      return ['set_customer', 'set_shipping', 'review', 'cancel']
    case 'shipping':
      return ['set_shipping', 'review', 'cancel']
    case 'review':
      return ['review', 'place_order', 'cancel']
    case 'placing_order':
      return ['place_order']
    default:
      return []
  }
}

export function isSessionExpired(session: EcommerceCheckoutSession, now = new Date()): boolean {
  return session.expiresAt.getTime() <= now.getTime()
}

export async function findActiveCheckoutSessionByCart(
  em: EntityManager,
  cartId: string,
  organizationId: string,
  tenantId: string,
): Promise<EcommerceCheckoutSession | null> {
  return em.findOne(EcommerceCheckoutSession, {
    cartId,
    organizationId,
    tenantId,
    status: 'active',
    deletedAt: null,
  })
}

export async function findCheckoutSessionById(
  em: EntityManager,
  id: string,
  organizationId: string,
  tenantId: string,
): Promise<EcommerceCheckoutSession | null> {
  return em.findOne(EcommerceCheckoutSession, {
    id,
    organizationId,
    tenantId,
    deletedAt: null,
  })
}

export async function createCheckoutSession(
  em: EntityManager,
  storeCtx: StoreContext,
  cartId: string,
  cartToken: string,
  expiresAt: Date,
): Promise<EcommerceCheckoutSession> {
  const session = em.create(EcommerceCheckoutSession, {
    organizationId: storeCtx.organizationId,
    tenantId: storeCtx.tenantId,
    storeId: storeCtx.store.id,
    cartId,
    cartToken,
    workflowName: 'ecommerce.checkout.v1',
    workflowState: 'cart',
    status: 'active',
    version: 1,
    expiresAt,
  })
  await em.persistAndFlush(session)
  return session
}
