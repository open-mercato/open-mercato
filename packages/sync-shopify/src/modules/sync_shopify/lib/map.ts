import type { ShopifyCustomerNode, ShopifyOrderNode, ShopifyProductNode, ShopifyVariantNode } from './types'

export type PersonName = {
  firstName: string
  lastName: string
  displayName: string
}

export type CatalogLink = {
  productId: string
  variantId: string
}

const ISO_CURRENCY = /^[A-Z]{3}$/

export function shopifyNumericId(gid: string): string {
  const tail = gid.split('/').pop()?.trim() ?? ''
  return tail.length > 0 ? tail : 'item'
}

export function splitPersonName(customer: ShopifyCustomerNode): PersonName {
  const first = customer.firstName?.trim() ?? ''
  const last = customer.lastName?.trim() ?? ''
  if (first && last) {
    return {
      firstName: clip(first, 120),
      lastName: clip(last, 120),
      displayName: clip(customer.displayName?.trim() || `${first} ${last}`, 200),
    }
  }

  const display = customer.displayName?.trim() ?? ''
  const parts = display.split(/\s+/).filter((part) => part.length > 0)
  if (parts.length >= 2) {
    return {
      firstName: clip(parts[0], 120),
      lastName: clip(parts.slice(1).join(' '), 120),
      displayName: clip(display, 200),
    }
  }

  const emailLocal = customer.email?.split('@')[0]?.trim() ?? ''
  const fallbackFirst = first || parts[0] || emailLocal || 'Shopify'
  const fallbackLast = last || 'Customer'
  return {
    firstName: clip(fallbackFirst, 120),
    lastName: clip(fallbackLast, 120),
    displayName: clip(display || `${fallbackFirst} ${fallbackLast}`, 200),
  }
}

export function productIsActive(status: string): boolean {
  return status === 'ACTIVE'
}

export function variantPriceAmount(variant: ShopifyVariantNode): number | null {
  const amount = Number(variant.price)
  if (!Number.isFinite(amount) || amount < 0) return null
  return amount
}

export function buildOrderCommandInput(input: {
  scope: { organizationId: string; tenantId: string }
  order: ShopifyOrderNode
  customerEntityId: string | null
  catalogByVariantId: ReadonlyMap<string, CatalogLink>
}): Record<string, unknown> {
  const currencyCode = input.order.currencyCode.trim().toUpperCase()
  if (!ISO_CURRENCY.test(currencyCode)) {
    throw new Error(`Shopify order ${input.order.name} has no ISO currency.`)
  }

  const lines = input.order.lines.flatMap((line, index) => {
    if (!(line.quantity > 0)) return []
    const link = line.variantId ? input.catalogByVariantId.get(line.variantId) ?? null : null
    const unitPrice = line.unitPrice ? Number(line.unitPrice.amount) : 0
    const quantity = String(line.quantity)
    return [{
      kind: 'product' as const,
      lineNumber: index + 1,
      name: clip(line.title, 255),
      productId: link?.productId,
      productVariantId: link?.variantId,
      currencyCode,
      quantity: line.quantity,
      unitPriceGross: Number.isFinite(unitPrice) && unitPrice >= 0 ? unitPrice : 0,
      priceMode: 'gross' as const,
      metadata: {
        shopifyLineId: line.id,
        sku: line.sku,
      },
      uomSnapshot: {
        version: 1 as const,
        productId: link?.productId ?? null,
        productVariantId: link?.variantId ?? null,
        baseUnitCode: 'pcs',
        enteredUnitCode: 'pcs',
        enteredQuantity: quantity,
        toBaseFactor: '1',
        normalizedQuantity: quantity,
        rounding: { mode: 'half_up' as const, scale: 4 },
        source: { conversionId: null, resolvedAt: input.order.createdAt },
      },
    }]
  })

  if (lines.length === 0) {
    throw new Error(`Shopify order ${input.order.name} has no importable lines.`)
  }

  const orderNumber = input.order.name.replace(/^#/, '').trim()
  return {
    organizationId: input.scope.organizationId,
    tenantId: input.scope.tenantId,
    orderNumber: orderNumber.length > 0 ? clip(orderNumber, 191) : undefined,
    externalReference: clip(input.order.name, 191),
    customerEntityId: input.customerEntityId ?? undefined,
    currencyCode,
    placedAt: input.order.createdAt,
    comments: input.order.email ? `Shopify customer ${input.order.email}` : undefined,
    internalNotes: [
      input.order.displayFinancialStatus ? `Payment: ${input.order.displayFinancialStatus}` : null,
      input.order.displayFulfillmentStatus ? `Fulfillment: ${input.order.displayFulfillmentStatus}` : null,
    ].filter((part): part is string => Boolean(part)).join('. ') || undefined,
    metadata: {
      shopifyOrderId: input.order.id,
      shopifyTotal: input.order.total,
    },
    lines,
  }
}

export function primaryVariant(product: ShopifyProductNode): ShopifyVariantNode | null {
  return product.variants[0] ?? null
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max)
}
