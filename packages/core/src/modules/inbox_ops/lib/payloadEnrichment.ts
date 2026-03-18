import type { EntityManager } from '@mikro-orm/postgresql'
import type { EntityClass } from '@mikro-orm/core'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'

interface ContactMatch {
  participant: { name: string; email: string }
  match?: { contactId: string; contactType: string; confidence: number } | null
}

interface CatalogProduct {
  id: string
  name: string
  sku?: string
  price?: string
}

interface SalesChannelLike {
  id: string
  name: string
  currencyCode?: string
  tenantId?: string
  organizationId?: string
  deletedAt?: Date | null
}

interface CustomerAddressLike {
  id: string
  isPrimary: boolean
  tenantId?: string
  organizationId?: string
  entity?: { id: string } | string
  createdAt?: Date
}

interface EnrichmentContext {
  em: EntityManager
  scope: { tenantId: string; organizationId: string }
  contactMatches: ContactMatch[]
  catalogProducts: CatalogProduct[]
  senderEmail: string
  salesChannelClass?: EntityClass<SalesChannelLike>
  customerAddressClass?: EntityClass<CustomerAddressLike>
}

export interface EnrichmentResult {
  payload: Record<string, unknown>
  warnings: string[]
}

export async function enrichOrderPayload(
  payload: Record<string, unknown>,
  ctx: EnrichmentContext,
): Promise<EnrichmentResult> {
  const enriched = { ...payload }
  const warnings: string[] = []

  // 1. Resolve channelId if missing, and resolve currencyCode from channel
  if (ctx.salesChannelClass) {
    try {
      const channelWhere: Record<string, unknown> = {
        tenantId: ctx.scope.tenantId,
        organizationId: ctx.scope.organizationId,
        deletedAt: null,
      }
      if (enriched.channelId) {
        channelWhere.id = enriched.channelId
      }
      const channel = await findOneWithDecryption(
        ctx.em,
        ctx.salesChannelClass,
        channelWhere,
        enriched.channelId ? undefined : { orderBy: { name: 'ASC' } },
        ctx.scope,
      )
      if (channel) {
        if (!enriched.channelId) enriched.channelId = channel.id
        if (!enriched.currencyCode && channel.currencyCode) {
          enriched.currencyCode = channel.currencyCode
        }
      } else {
        warnings.push('no_channel_resolved')
      }
    } catch {
      warnings.push('no_channel_resolved')
    }
  } else if (!enriched.channelId) {
    warnings.push('no_channel_resolved')
  }

  // 2. Resolve customerEntityId from contact matches
  if (!enriched.customerEntityId) {
    const senderMatch = ctx.contactMatches.find(
      (m) => m.participant.email.toLowerCase() === ctx.senderEmail.toLowerCase() && m.match?.contactId,
    )
    if (senderMatch?.match) {
      enriched.customerEntityId = senderMatch.match.contactId
    }
  }

  // 3. Resolve billing/shipping address from CRM when not in email
  const customerEntityId = typeof enriched.customerEntityId === 'string' ? enriched.customerEntityId : null
  if (customerEntityId && !enriched.billingAddress && !enriched.billingAddressId && ctx.customerAddressClass) {
    try {
      const primaryAddress = await findOneWithDecryption(
        ctx.em,
        ctx.customerAddressClass,
        {
          entity: customerEntityId,
          tenantId: ctx.scope.tenantId,
          organizationId: ctx.scope.organizationId,
        },
        { orderBy: { isPrimary: 'DESC', createdAt: 'DESC' } },
        ctx.scope,
      )
      if (primaryAddress) {
        enriched.billingAddressId = primaryAddress.id
        if (!enriched.shippingAddress && !enriched.shippingAddressId) {
          enriched.shippingAddressId = primaryAddress.id
        }
      }
    } catch {
      // Customer address module not available — skip
    }
  }

  // 4. Resolve products in line items
  const lineItems = Array.isArray(enriched.lineItems)
    ? (enriched.lineItems as Record<string, unknown>[])
    : []

  const catalogProductIds = new Set(ctx.catalogProducts.map((p) => p.id))

  if (lineItems.length > 0) {
    for (const item of lineItems) {
      // Clear hallucinated productIds that don't match any real catalog product
      if (item.productId && typeof item.productId === 'string' && !catalogProductIds.has(item.productId)) {
        item.productId = undefined
      }

      if (item.productId) continue
      const productName = typeof item.productName === 'string' ? item.productName.toLowerCase().trim() : ''
      if (!productName || ctx.catalogProducts.length === 0) continue

      const match = ctx.catalogProducts.find((p) => {
        const catalogName = p.name.toLowerCase().trim()
        const catalogSku = (p.sku || '').toLowerCase().trim()
        return catalogName === productName
          || catalogSku === productName
          || catalogName.includes(productName)
          || productName.includes(catalogName)
      })

      if (match) {
        item.productId = match.id
        if (match.sku) item.sku = match.sku
        if (match.price && !item.unitPrice) item.catalogPrice = match.price
      }
    }
  }

  // 5. Coerce numeric fields to strings
  for (const item of lineItems) {
    if (typeof item.quantity === 'number') {
      item.quantity = String(item.quantity)
    }
    if (typeof item.unitPrice === 'number') {
      item.unitPrice = String(item.unitPrice)
    }
  }

  // 6. Warn if currencyCode is still missing after all enrichment
  if (!enriched.currencyCode) {
    warnings.push('no_currency_resolved')
  }

  return { payload: enriched, warnings }
}
