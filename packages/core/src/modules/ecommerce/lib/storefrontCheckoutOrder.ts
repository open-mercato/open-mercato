import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { CommandBus } from '@open-mercato/shared/lib/commands'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import { z } from 'zod'
import { CatalogOffer } from '@open-mercato/core/modules/catalog/data/entities'
import { EcommerceCart } from '../data/entities'
import type { StoreContext } from './storeContext'
import type { CartDto } from './storefrontCart'
import { formatCartDto, loadCartLines } from './storefrontCart'

const currencyCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, { message: 'Invalid currency code' })

function normalizeCurrencyCode(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const parsed = currencyCodeSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export type CheckoutCustomerInfo = {
  name: string
  email: string
  phone?: string
  address?: string
}

export type PlaceOrderResult = {
  orderId: string
  cart: CartDto
}

export async function placeOrderFromCart(
  req: Request,
  em: EntityManager,
  commandBus: CommandBus,
  container: unknown,
  storeCtx: StoreContext,
  cart: EcommerceCart,
  customerInfo: CheckoutCustomerInfo,
): Promise<PlaceOrderResult> {
  const { organizationId, tenantId } = storeCtx
  const salesChannelId = storeCtx.channelBinding?.salesChannelId
  if (!salesChannelId) {
    throw new CrudHttpError(404, { error: 'Storefront sales channel is not configured' })
  }

  if (cart.status !== 'active') {
    throw new CrudHttpError(400, { error: `Cart is not active (${cart.status})` })
  }

  const cartLines = await loadCartLines(em, cart.id, organizationId, tenantId)
  if (cartLines.length === 0) {
    throw new CrudHttpError(400, { error: 'Cart is empty' })
  }

  const productIds = Array.from(
    new Set(cartLines.map((line) => line.productId).filter((id): id is string => !!id)),
  )
  const offeredProductIds = new Set(
    (
      await em.find(
        CatalogOffer,
        {
          organizationId,
          tenantId,
          channelId: salesChannelId,
          product: { $in: productIds },
          isActive: true,
          deletedAt: null,
        },
        { fields: ['product'] },
      )
    )
      .map((offer) => (typeof offer.product === 'string' ? offer.product : offer.product?.id ?? null))
      .filter((id): id is string => !!id),
  )

  const unavailableProducts = productIds.filter((id) => !offeredProductIds.has(id))
  if (unavailableProducts.length > 0) {
    throw new CrudHttpError(400, {
      error: 'Cart contains products unavailable in this storefront',
      details: unavailableProducts,
    })
  }

  const orderCurrencyCode = normalizeCurrencyCode(cart.currencyCode)
  if (!orderCurrencyCode) {
    throw new CrudHttpError(400, { error: 'Invalid cart currency code configuration' })
  }

  const lineCurrencyCodes = cartLines.map((line) =>
    normalizeCurrencyCode(line.currencyCode ?? orderCurrencyCode),
  )
  const invalidCurrencyIndex = lineCurrencyCodes.findIndex((value) => value === null)
  if (invalidCurrencyIndex >= 0) {
    throw new CrudHttpError(400, {
      error: `Invalid currency code on cart line ${invalidCurrencyIndex + 1}`,
    })
  }
  const resolvedLineCurrencyCodes = lineCurrencyCodes as string[]

  const ctx: CommandRuntimeContext = {
    container: container as CommandRuntimeContext['container'],
    auth: null,
    organizationScope: null,
    selectedOrganizationId: organizationId,
    organizationIds: [organizationId],
    request: req,
  }

  const { result } = await commandBus.execute<unknown, { orderId: string }>('sales.orders.create', {
    input: {
      organizationId,
      tenantId,
      currencyCode: orderCurrencyCode,
      channelId: salesChannelId,
      placedAt: new Date(),
      customerSnapshot: {
        customer: {
          displayName: customerInfo.name,
          primaryEmail: customerInfo.email,
          primaryPhone: customerInfo.phone ?? null,
        },
        shippingAddress: customerInfo.address ?? null,
      },
      metadata: {
        sourceCartId: cart.id,
        sourceStoreId: storeCtx.store.id,
      },
      lines: cartLines.map((line, i) => ({
        currencyCode: resolvedLineCurrencyCodes[i],
        kind: 'product' as const,
        productId: line.productId ?? undefined,
        productVariantId: line.variantId ?? undefined,
        name: line.titleSnapshot ?? undefined,
        quantity: line.quantity,
        unitPriceNet: line.unitPriceNet ?? 0,
        unitPriceGross: line.unitPriceGross ?? 0,
        lineNumber: i + 1,
        catalogSnapshot: {
          sku: line.skuSnapshot ?? null,
          imageUrl: line.imageUrlSnapshot ?? null,
        },
      })),
    },
    ctx,
  })

  const orderId = z.object({ orderId: z.string().uuid() }).parse(result).orderId

  cart.status = 'converted'
  cart.convertedOrderId = orderId
  await em.flush()

  const updatedLines = await loadCartLines(em, cart.id, organizationId, tenantId)
  return { orderId, cart: formatCartDto(cart, updatedLines) }
}
