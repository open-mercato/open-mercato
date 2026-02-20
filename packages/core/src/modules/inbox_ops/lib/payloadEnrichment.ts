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

interface EnrichmentContext {
  em: EntityManager
  scope: { tenantId: string; organizationId: string }
  contactMatches: ContactMatch[]
  catalogProducts: CatalogProduct[]
  senderEmail: string
  salesChannelClass?: EntityClass<SalesChannelLike>
}

export async function enrichOrderPayload(
  payload: Record<string, unknown>,
  ctx: EnrichmentContext,
): Promise<Record<string, unknown>> {
  const enriched = { ...payload }

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
      }
    } catch {
      // Channel resolution is best-effort
    }
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

  // 3. Resolve products in line items
  const lineItems = Array.isArray(enriched.lineItems)
    ? (enriched.lineItems as Record<string, unknown>[])
    : []

  if (lineItems.length > 0 && ctx.catalogProducts.length > 0) {
    for (const item of lineItems) {
      if (item.productId) continue
      const productName = typeof item.productName === 'string' ? item.productName.toLowerCase().trim() : ''
      if (!productName) continue

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

  // 4. Coerce numeric fields to strings
  for (const item of lineItems) {
    if (typeof item.quantity === 'number') {
      item.quantity = String(item.quantity)
    }
    if (typeof item.unitPrice === 'number') {
      item.unitPrice = String(item.unitPrice)
    }
  }

  return enriched
}
