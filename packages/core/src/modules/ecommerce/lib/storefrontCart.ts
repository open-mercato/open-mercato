import { randomUUID } from 'crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { EcommerceCart, EcommerceCartLine } from '../data/entities'
import type { StoreContext } from './storeContext'

export type CartLineDto = {
  id: string
  productId: string
  variantId: string | null
  quantity: number
  unitPriceNet: string | null
  unitPriceGross: string | null
  currencyCode: string | null
  titleSnapshot: string | null
  skuSnapshot: string | null
  imageUrlSnapshot: string | null
}

export type CartDto = {
  id: string
  token: string
  status: string
  currencyCode: string
  locale: string | null
  lines: CartLineDto[]
  itemCount: number
  subtotalGross: string | null
}

export async function resolveCartByToken(
  em: EntityManager,
  token: string,
  organizationId: string,
  tenantId: string,
): Promise<EcommerceCart | null> {
  return em.findOne(EcommerceCart, { token, organizationId, tenantId, status: 'active' })
}

export async function getOrCreateCart(
  em: EntityManager,
  storeCtx: StoreContext,
  token: string | null,
): Promise<EcommerceCart> {
  if (token) {
    const existing = await resolveCartByToken(
      em,
      token,
      storeCtx.organizationId,
      storeCtx.tenantId,
    )
    if (existing) return existing
  }

  const cart = em.create(EcommerceCart, {
    organizationId: storeCtx.organizationId,
    tenantId: storeCtx.tenantId,
    storeId: storeCtx.store.id,
    token: randomUUID(),
    status: 'active',
    currencyCode: storeCtx.store.defaultCurrencyCode,
    locale: storeCtx.effectiveLocale,
  })
  await em.flush()
  return cart
}

export function formatCartLineDto(line: EcommerceCartLine): CartLineDto {
  return {
    id: line.id,
    productId: line.productId,
    variantId: line.variantId ?? null,
    quantity: line.quantity,
    unitPriceNet: line.unitPriceNet ?? null,
    unitPriceGross: line.unitPriceGross ?? null,
    currencyCode: line.currencyCode ?? null,
    titleSnapshot: line.titleSnapshot ?? null,
    skuSnapshot: line.skuSnapshot ?? null,
    imageUrlSnapshot: line.imageUrlSnapshot ?? null,
  }
}

export function formatCartDto(cart: EcommerceCart, lines: EcommerceCartLine[]): CartDto {
  const itemCount = lines.reduce((sum, line) => sum + line.quantity, 0)

  const subtotalGross = lines.reduce((sum, line) => {
    const price = line.unitPriceGross ?? line.unitPriceNet
    if (!price) return sum
    return sum + parseFloat(price) * line.quantity
  }, 0)

  return {
    id: cart.id,
    token: cart.token,
    status: cart.status,
    currencyCode: cart.currencyCode,
    locale: cart.locale ?? null,
    lines: lines.map(formatCartLineDto),
    itemCount,
    subtotalGross: itemCount > 0 ? subtotalGross.toFixed(4) : null,
  }
}

export async function loadCartLines(
  em: EntityManager,
  cartId: string,
  organizationId: string,
  tenantId: string,
): Promise<EcommerceCartLine[]> {
  return em.find(EcommerceCartLine, { cartId, organizationId, tenantId })
}

export function resolveCartToken(req: Request): string | null {
  const headerToken = req.headers.get('x-cart-token')
  if (headerToken) return headerToken
  const url = new URL(req.url)
  return url.searchParams.get('cartToken')
}
