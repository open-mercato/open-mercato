import type {
  ShopifyCustomerNode,
  ShopifyMoney,
  ShopifyOrderLineNode,
  ShopifyOrderNode,
  ShopifyProductNode,
  ShopifyShippingLineNode,
  ShopifyVariantNode,
} from './types'

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
const SKU_PATTERN = /^[A-Za-z0-9\-_\.]+$/
const HANDLE_PATTERN = /^[a-z0-9\-_]+$/

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

export function sanitizeSku(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed || !SKU_PATTERN.test(trimmed)) return null
  return trimmed.slice(0, 191)
}

export function sanitizeHandle(value: string, fallback: string): string {
  const base = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const candidate = (base || fallback).slice(0, 150)
  return HANDLE_PATTERN.test(candidate) ? candidate : fallback.slice(0, 150)
}

function moneyAmount(value: ShopifyMoney | null | undefined): number | null {
  if (!value) return null
  const amount = Number(value.amount)
  if (!Number.isFinite(amount) || amount < 0) return null
  return amount
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100
}

function lineDiscountTotal(line: ShopifyOrderLineNode): number {
  const allocated = moneyAmount(line.discountTotal)
  if (allocated !== null) return allocated
  const originalUnit = moneyAmount(line.originalUnitPrice) ?? 0
  const discountedUnit = moneyAmount(line.discountedUnitPrice)
  if (discountedUnit === null || !(line.quantity > 0)) return 0
  return Math.max((originalUnit - discountedUnit) * line.quantity, 0)
}

/**
 * Resolve a percent tax rate for a line. Prefer Shopify's rate; otherwise derive
 * from tax and (discounted) line total so sales.orders.create can compute net.
 */
export function resolveLineTaxRate(line: ShopifyOrderLineNode, taxesIncluded: boolean): number | null {
  if (typeof line.taxRate === 'number' && Number.isFinite(line.taxRate) && line.taxRate >= 0) {
    return line.taxRate
  }
  const taxAmount = moneyAmount(line.taxTotal) ?? 0
  if (taxAmount <= 0) return null
  const lineGross = moneyAmount(line.totalPrice)
  if (lineGross === null || lineGross <= 0) return null
  if (taxesIncluded) {
    const net = lineGross - taxAmount
    if (net <= 0) return null
    return roundMoney((taxAmount / net) * 100)
  }
  // Tax-exclusive: totalPrice is net; tax sits on top.
  return roundMoney((taxAmount / lineGross) * 100)
}

function buildOrderLineInput(
  line: ShopifyOrderLineNode,
  index: number,
  currencyCode: string,
  taxesIncluded: boolean,
  link: CatalogLink | null,
  placedAt: string,
): Record<string, unknown> | null {
  if (!(line.quantity > 0)) return null
  const originalUnit = moneyAmount(line.originalUnitPrice) ?? 0
  const discountAmount = lineDiscountTotal(line)
  const taxAmount = moneyAmount(line.taxTotal) ?? 0
  const totalPrice = moneyAmount(line.totalPrice)
  const taxRate = resolveLineTaxRate(line, taxesIncluded)
  const quantity = String(line.quantity)
  const pricing = taxesIncluded
    ? {
        priceMode: 'gross' as const,
        unitPriceGross: originalUnit,
        discountAmount,
        discountAmountBasis: 'line' as const,
        ...(taxRate !== null ? { taxRate } : {}),
        ...(taxAmount > 0 ? { taxAmount } : {}),
        ...(totalPrice !== null ? { totalGrossAmount: totalPrice } : {}),
      }
    : {
        priceMode: 'net' as const,
        unitPriceNet: originalUnit,
        discountAmount,
        discountAmountBasis: 'line' as const,
        ...(taxRate !== null ? { taxRate } : {}),
        ...(taxAmount > 0 ? { taxAmount } : {}),
        ...(totalPrice !== null
          ? { totalGrossAmount: totalPrice + taxAmount }
          : {}),
      }

  return {
    kind: 'product' as const,
    lineNumber: index + 1,
    name: clip(line.title, 255),
    productId: link?.productId,
    productVariantId: link?.variantId,
    currencyCode,
    quantity: line.quantity,
    ...pricing,
    metadata: {
      shopifyLineId: line.id,
      sku: line.sku,
      shopifyOriginalUnitPrice: line.originalUnitPrice,
      shopifyDiscountedUnitPrice: line.discountedUnitPrice,
      shopifyTaxRate: taxRate,
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
      source: { conversionId: null, resolvedAt: placedAt },
    },
  }
}

function shippingDiscountAmount(shipping: ShopifyShippingLineNode): number {
  const original = moneyAmount(shipping.originalPrice) ?? 0
  const discounted = moneyAmount(shipping.discountedPrice)
  if (discounted === null) return 0
  return Math.max(original - discounted, 0)
}

function buildShippingAdjustment(
  shipping: ShopifyShippingLineNode,
  position: number,
  currencyCode: string,
  taxesIncluded: boolean,
): Record<string, unknown> | null {
  const amount = moneyAmount(shipping.discountedPrice) ?? moneyAmount(shipping.originalPrice) ?? 0
  if (amount <= 0) return null
  const taxAmount = moneyAmount(shipping.taxTotal) ?? 0
  let taxRate = typeof shipping.taxRate === 'number' && Number.isFinite(shipping.taxRate) && shipping.taxRate >= 0
    ? shipping.taxRate
    : null
  if (taxRate === null && taxAmount > 0 && amount > 0) {
    if (taxesIncluded) {
      const net = amount - taxAmount
      if (net > 0) taxRate = roundMoney((taxAmount / net) * 100)
    } else {
      taxRate = roundMoney((taxAmount / amount) * 100)
    }
  }

  let amountNet: number
  let amountGross: number
  if (taxesIncluded) {
    amountGross = amount
    amountNet = taxAmount > 0 ? roundMoney(amount - taxAmount) : amount
  } else {
    amountNet = amount
    amountGross = taxAmount > 0 ? roundMoney(amount + taxAmount) : amount
  }

  return {
    scope: 'order',
    kind: 'shipping',
    label: clip(shipping.title, 255),
    position,
    currencyCode,
    amountNet,
    amountGross,
    metadata: {
      shopifyShippingLineId: shipping.id,
      ...(taxRate !== null ? { taxRate } : {}),
      ...(taxAmount > 0 ? { shopifyTaxAmount: taxAmount } : {}),
    },
  }
}

/** Map Shopify displayFinancialStatus → sales.payment_status dictionary value. */
export function mapShopifyPaymentStatusValue(status: string | null | undefined): string | null {
  if (!status) return null
  switch (status.trim().toUpperCase()) {
    case 'PAID':
      return 'received'
    case 'AUTHORIZED':
      return 'authorized'
    case 'PARTIALLY_PAID':
      return 'pending'
    case 'PARTIALLY_REFUNDED':
    case 'REFUNDED':
      return 'refunded'
    case 'VOIDED':
      return 'canceled'
    case 'PENDING':
      return 'pending'
    default:
      return null
  }
}

export function shopifyOrderIsFullyPaid(status: string | null | undefined): boolean {
  return status?.trim().toUpperCase() === 'PAID'
}

export function buildOrderCommandInput(input: {
  scope: { organizationId: string; tenantId: string }
  order: ShopifyOrderNode
  customerEntityId: string | null
  catalogByVariantId: ReadonlyMap<string, CatalogLink>
  paymentStatusEntryId?: string | null
}): Record<string, unknown> {
  const currencyCode = input.order.currencyCode.trim().toUpperCase()
  if (!ISO_CURRENCY.test(currencyCode)) {
    throw new Error(`Shopify order ${input.order.name} has no ISO currency.`)
  }

  const lines = input.order.lines.flatMap((line, index) => {
    const link = line.variantId ? input.catalogByVariantId.get(line.variantId) ?? null : null
    const mapped = buildOrderLineInput(
      line,
      index,
      currencyCode,
      input.order.taxesIncluded,
      link,
      input.order.createdAt,
    )
    return mapped ? [mapped] : []
  })

  if (lines.length === 0) {
    throw new Error(`Shopify order ${input.order.name} has no importable lines.`)
  }

  const lineDiscountTotalAmount = lines.reduce((sum, line) => {
    const amount = typeof line.discountAmount === 'number' ? line.discountAmount : 0
    return sum + amount
  }, 0)
  const shippingDiscountTotal = input.order.shippingLines.reduce(
    (sum, shipping) => sum + shippingDiscountAmount(shipping),
    0,
  )
  const sourceDiscountTotal = moneyAmount(input.order.totalDiscounts) ?? 0
  // Exclude shipping-line discounts already reflected in discounted shipping amounts
  // so a free-shipping voucher is not subtracted again as an order-level discount.
  const remainingOrderDiscount = Math.max(
    sourceDiscountTotal - lineDiscountTotalAmount - shippingDiscountTotal,
    0,
  )

  const adjustments: Array<Record<string, unknown>> = []
  let position = 0
  for (const shipping of input.order.shippingLines) {
    const adjustment = buildShippingAdjustment(
      shipping,
      position,
      currencyCode,
      input.order.taxesIncluded,
    )
    if (!adjustment) continue
    adjustments.push(adjustment)
    position++
  }
  if (remainingOrderDiscount > 0) {
    adjustments.push({
      scope: 'order',
      kind: 'discount',
      label: 'Shopify order discount',
      position: position++,
      currencyCode,
      amountNet: remainingOrderDiscount,
      amountGross: remainingOrderDiscount,
      metadata: { shopifyTotalDiscounts: input.order.totalDiscounts },
    })
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
    ...(input.paymentStatusEntryId
      ? { paymentStatusEntryId: input.paymentStatusEntryId }
      : {}),
    metadata: {
      shopifyOrderId: input.order.id,
      shopifyTotal: input.order.total,
      shopifySubtotal: input.order.subtotal,
      shopifyTotalDiscounts: input.order.totalDiscounts,
      shopifyTotalShipping: input.order.totalShipping,
      shopifyTotalTax: input.order.totalTax,
      shopifyTaxesIncluded: input.order.taxesIncluded,
      shopifyFinancialStatus: input.order.displayFinancialStatus,
    },
    lines,
    adjustments: adjustments.length > 0 ? adjustments : undefined,
  }
}

export function primaryVariant(product: ShopifyProductNode): ShopifyVariantNode | null {
  return product.variants[0] ?? null
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max)
}
