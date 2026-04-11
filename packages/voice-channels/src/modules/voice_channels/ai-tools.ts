import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/core'
import type { AiToolDefinition } from '@open-mercato/ai-assistant'
import { selectBestPrice, type PriceRow } from '@open-mercato/core/modules/catalog/lib/pricing'
import {
  CatalogOffer,
  CatalogProduct,
  CatalogProductPrice,
} from '@open-mercato/core/modules/catalog/data/entities'
import {
  CustomerActivity,
  CustomerComment,
  CustomerDealPersonLink,
  CustomerEntity,
} from '@open-mercato/core/modules/customers/data/entities'
import { SalesOrder } from '@open-mercato/core/modules/sales/data/entities'
import type {
  CopilotCustomerContextResult,
  CopilotOpenDealsResult,
  CopilotPricingCheckResult,
  CopilotProductSearchResult,
} from './types'

type ProductSearchInput = {
  keywords: string[]
  customerId?: string
  limit?: number
}

type CustomerContextInput = {
  customerId: string
}

type PricingCheckInput = {
  productId?: string
  customerId?: string
  context?: string
}

type OpenDealsInput = {
  customerId: string
}

function requireScope(ctx: {
  tenantId: string | null
  organizationId: string | null
  container: { resolve: <T = unknown>(name: string) => T }
}): { em: EntityManager; tenantId: string; organizationId: string } {
  if (!ctx.tenantId || !ctx.organizationId) {
    throw new Error('Tenant and organization context are required')
  }

  const em = ctx.container.resolve<EntityManager>('em').fork()
  return { em, tenantId: ctx.tenantId, organizationId: ctx.organizationId }
}

function normalizeMoney(value: string | number | null | undefined): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0
  }
  if (typeof value !== 'string') {
    return 0
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0
}

function readProductCategory(product: CatalogProduct): string {
  const metadata = isRecord(product.metadata) ? product.metadata : null
  const category =
    readString(metadata?.categoryName) ??
    readString(metadata?.category) ??
    readString(product.subtitle) ??
    'Uncategorized'

  return category
}

function readProductStock(product: CatalogProduct): number {
  const metadata = isRecord(product.metadata) ? product.metadata : null
  const rawStock = metadata?.stockQuantity

  if (typeof rawStock === 'number' && Number.isFinite(rawStock)) {
    return rawStock
  }

  if (typeof rawStock === 'string') {
    const parsed = Number(rawStock)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return 0
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildKeywordPattern(keywords: string[]): string {
  const tokens = keywords
    .map((keyword) => keyword.trim())
    .filter((keyword) => keyword.length > 0)
    .map(escapeRegex)

  if (!tokens.length) {
    return '(?!)'
  }

  return `(?i)(${tokens.join('|')})`
}

function pickBestPrice(
  priceRows: CatalogProductPrice[],
  customerId?: string
): { amount: number; currency: string; priceType: string } {
  const rows = priceRows as PriceRow[]
  const best = selectBestPrice(rows, {
    customerId: customerId ?? null,
    quantity: 1,
    date: new Date(),
  })

  if (!best) {
    return { amount: 0, currency: 'PLN', priceType: 'standard' }
  }

  return {
    amount: normalizeMoney(best.unitPriceGross ?? best.unitPriceNet),
    currency: readString(best.currencyCode) ?? 'PLN',
    priceType: readString(best.kind) ?? 'standard',
  }
}

function isBaselinePriceRow(row: CatalogProductPrice): boolean {
  const offer = row.offer
  const priceKind = row.priceKind
  const priceKindIsPromotion =
    typeof priceKind === 'object' && priceKind !== null && 'isPromotion' in priceKind
      ? Boolean(priceKind.isPromotion)
      : false

  if (offer) {
    return false
  }
  if (row.customerId || row.customerGroupId || row.userId || row.userGroupId || row.channelId) {
    return false
  }
  if (priceKindIsPromotion) {
    return false
  }
  return row.kind === 'regular' || row.kind === 'standard' || row.kind === ''
}

function extractTopCategories(orders: SalesOrder[]): string[] {
  const counts = new Map<string, number>()

  for (const order of orders) {
    for (const line of order.lines.getItems()) {
      const snapshot = isRecord(line.catalogSnapshot) ? line.catalogSnapshot : null
      const metadata = isRecord(line.metadata) ? line.metadata : null
      const category =
        readString(snapshot?.categoryName) ??
        readString(metadata?.categoryName) ??
        readString(line.description?.split('|')[0]) ??
        'Uncategorized'

      counts.set(category, (counts.get(category) ?? 0) + 1)
    }
  }

  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .map(([category]) => category)
}

function buildPromotionSummary(
  basePrice: number,
  priceRows: CatalogProductPrice[],
  offers: CatalogOffer[]
): Array<{ name: string; discount: string; validUntil: string }> {
  const rowsByOfferId = new Map<string, CatalogProductPrice[]>()

  for (const row of priceRows) {
    const offer = row.offer
    if (!offer || typeof offer === 'string') {
      continue
    }
    const current = rowsByOfferId.get(offer.id) ?? []
    current.push(row)
    rowsByOfferId.set(offer.id, current)
  }

  return offers.map((offer) => {
    const offerRows = rowsByOfferId.get(offer.id) ?? []
    const bestOfferRow = offerRows.reduce<CatalogProductPrice | null>((best, row) => {
      const currentValue = normalizeMoney(row.unitPriceGross ?? row.unitPriceNet)
      if (!best) {
        return row
      }
      const bestValue = normalizeMoney(best.unitPriceGross ?? best.unitPriceNet)
      return currentValue < bestValue ? row : best
    }, null)

    const offerPrice = bestOfferRow
      ? normalizeMoney(bestOfferRow.unitPriceGross ?? bestOfferRow.unitPriceNet)
      : 0
    const discountAmount = basePrice > 0 && offerPrice > 0 ? basePrice - offerPrice : 0
    const discountPercent = basePrice > 0 && discountAmount > 0 ? (discountAmount / basePrice) * 100 : 0
    const validUntil = bestOfferRow?.endsAt ? bestOfferRow.endsAt.toISOString().split('T')[0] : 'Bezterminowa'

    return {
      name: offer.title,
      discount:
        discountPercent > 0
          ? `${Math.round(discountPercent * 10) / 10}%`
          : offerPrice > 0
            ? `${Math.round(offerPrice * 100) / 100} PLN`
            : 'Oferta aktywna',
      validUntil,
    }
  })
}

const copilotSearchProducts: AiToolDefinition<ProductSearchInput, CopilotProductSearchResult> = {
  name: 'copilot_search_products',
  description: `Search the product catalog for items mentioned during a sales conversation.

Returns matching products with scoped pricing, category, and stock metadata for the current organization.`,
  inputSchema: z.object({
    keywords: z.array(z.string().min(1)).min(1).describe('Product-related keywords from the conversation'),
    customerId: z.string().uuid().optional().describe('Customer entity ID used for customer-specific pricing'),
    limit: z.number().int().min(1).max(10).optional().default(3).describe('Maximum number of products to return'),
  }),
  requiredFeatures: ['voice_channels.copilot.view'],
  handler: async (input, ctx) => {
    const { em, organizationId, tenantId } = requireScope(ctx)
    const pattern = buildKeywordPattern(input.keywords)

    const products = await em.find(
      CatalogProduct,
      {
        organizationId,
        tenantId,
        isActive: true,
        deletedAt: null,
        $or: [
          { title: { $re: pattern } },
          { sku: { $re: pattern } },
          { description: { $re: pattern } },
        ],
      },
      {
        orderBy: { title: 'ASC' },
        limit: input.limit ?? 3,
      }
    )

    const productIds = products.map((product) => product.id)
    const priceRows = productIds.length
      ? await em.find(
          CatalogProductPrice,
          {
            organizationId,
            tenantId,
            product: { $in: productIds },
          },
          { populate: ['offer', 'priceKind'] }
        )
      : []

    const rowsByProductId = new Map<string, CatalogProductPrice[]>()
    for (const row of priceRows) {
      const product = row.product
      const productId = typeof product === 'string' ? product : product?.id
      if (!productId) {
        continue
      }
      const current = rowsByProductId.get(productId) ?? []
      current.push(row)
      rowsByProductId.set(productId, current)
    }

    return {
      products: products.map((product) => {
        const resolvedPrice = pickBestPrice(rowsByProductId.get(product.id) ?? [], input.customerId)
        const stockQuantity = readProductStock(product)

        return {
          id: product.id,
          name: product.title,
          sku: readString(product.sku) ?? '',
          price: resolvedPrice,
          available: stockQuantity > 0,
          stockQuantity,
          category: readProductCategory(product),
        }
      }),
    }
  },
}

const copilotCustomerContext: AiToolDefinition<CustomerContextInput, CopilotCustomerContextResult> = {
  name: 'copilot_customer_context',
  description: `Get customer context for a live copilot session.

Returns identity, company, lifetime value, order metrics, top categories, and latest relationship notes.`,
  inputSchema: z.object({
    customerId: z.string().uuid().describe('Customer entity ID for a person record'),
  }),
  requiredFeatures: ['voice_channels.copilot.view'],
  handler: async (input, ctx) => {
    const { em, organizationId, tenantId } = requireScope(ctx)

    const customer = await em.findOne(
      CustomerEntity,
      {
        id: input.customerId,
        organizationId,
        tenantId,
        kind: 'person',
      },
      { populate: ['personProfile', 'personProfile.company', 'companyProfile'] }
    )

    if (!customer) {
      throw new Error('Customer not found')
    }

    const orders = await em.find(
      SalesOrder,
      {
        organizationId,
        tenantId,
        customerEntityId: customer.id,
        deletedAt: null,
      },
      {
        orderBy: { placedAt: 'DESC', createdAt: 'DESC' },
        limit: 100,
        populate: ['lines'],
      }
    )

    const activities = await em.find(
      CustomerActivity,
      {
        organizationId,
        tenantId,
        entity: customer,
      },
      {
        orderBy: { occurredAt: 'DESC', createdAt: 'DESC' },
        limit: 5,
      }
    )

    const comments = await em.find(
      CustomerComment,
      {
        organizationId,
        tenantId,
        entity: customer,
        deletedAt: null,
      },
      {
        orderBy: { createdAt: 'DESC' },
        limit: 3,
      }
    )

    const lifetimeValue = orders.reduce(
      (sum, order) => sum + normalizeMoney(order.grandTotalGrossAmount),
      0
    )
    const orderCount = orders.length
    const avgOrderValue = orderCount > 0 ? lifetimeValue / orderCount : 0
    const lastOrderDate = orders[0]?.placedAt
      ? orders[0].placedAt.toISOString().split('T')[0]
      : 'Brak'
    const personProfile = customer.personProfile
    const company = personProfile?.company
    const latestComment = comments[0]?.body
    const latestActivity = activities.find((activity) => readString(activity.body) || readString(activity.subject))

    return {
      customer: {
        id: customer.id,
        name:
          readString(customer.displayName) ??
          [readString(personProfile?.firstName), readString(personProfile?.lastName)].filter(Boolean).join(' '),
        company:
          readString(company?.displayName) ??
          readString(company?.companyProfile?.legalName) ??
          '',
        lifetimeValue: Math.round(lifetimeValue * 100) / 100,
        currency: orders[0]?.currencyCode ?? 'PLN',
        lastOrderDate,
        orderCount,
        avgOrderValue: Math.round(avgOrderValue * 100) / 100,
        topCategories: extractTopCategories(orders),
        openTickets: 0,
        assignedRep: customer.ownerUserId ?? '',
        notes:
          readString(latestComment) ??
          readString(latestActivity?.body) ??
          readString(latestActivity?.subject) ??
          '',
      },
    }
  },
}

const copilotCheckPricing: AiToolDefinition<PricingCheckInput, CopilotPricingCheckResult | null> = {
  name: 'copilot_check_pricing',
  description: `Check pricing details for a product in the current organization.

Returns the base price, customer-specific price when applicable, and active catalog offer data.`,
  inputSchema: z.object({
    productId: z.string().uuid().optional().describe('Exact product ID when known'),
    customerId: z.string().uuid().optional().describe('Customer entity ID used for tier or direct customer pricing'),
    context: z.string().optional().describe('Conversation text used to locate a product by keywords'),
  }),
  requiredFeatures: ['voice_channels.copilot.view'],
  handler: async (input, ctx) => {
    const { em, organizationId, tenantId } = requireScope(ctx)

    let product: CatalogProduct | null = null

    if (input.productId) {
      product = await em.findOne(CatalogProduct, {
        id: input.productId,
        organizationId,
        tenantId,
        deletedAt: null,
      })
    } else if (readString(input.context)) {
      const pattern = buildKeywordPattern((input.context ?? '').split(/\s+/))
      product =
        (await em.findOne(
          CatalogProduct,
          {
            organizationId,
            tenantId,
            isActive: true,
            deletedAt: null,
            $or: [{ title: { $re: pattern } }, { sku: { $re: pattern } }],
          },
          { orderBy: { title: 'ASC' } }
        )) ?? null
    }

    if (!product) {
      return null
    }

    const priceRows = await em.find(
      CatalogProductPrice,
      {
        organizationId,
        tenantId,
        product,
      },
      { populate: ['offer', 'priceKind'] }
    )

    const basePriceCandidates = priceRows.filter(isBaselinePriceRow)
    const basePriceRow =
      selectBestPrice(
        ((basePriceCandidates.length ? basePriceCandidates : priceRows.filter((row) => !row.customerId && !row.customerGroupId)) as PriceRow[]),
        { quantity: 1, date: new Date() }
      ) ?? null
    const customerPriceRow =
      selectBestPrice(
        (priceRows as PriceRow[]),
        {
          customerId: input.customerId ?? null,
          quantity: 1,
          date: new Date(),
        }
      ) ?? null

    const basePrice = normalizeMoney(basePriceRow?.unitPriceGross ?? basePriceRow?.unitPriceNet)
    const customerPrice = normalizeMoney(
      customerPriceRow?.unitPriceGross ?? customerPriceRow?.unitPriceNet ?? basePrice
    )
    const currency =
      readString(customerPriceRow?.currencyCode) ??
      readString(basePriceRow?.currencyCode) ??
      readString(product.primaryCurrencyCode) ??
      'PLN'

    const activeOffers = await em.find(
      CatalogOffer,
      {
        organizationId,
        tenantId,
        product,
        isActive: true,
        deletedAt: null,
      },
      { orderBy: { createdAt: 'DESC' } }
    )

    return {
      productId: product.id,
      productName: product.title,
      basePrice,
      customerPrice,
      currency,
      floorPrice: Math.round(basePrice * 0.88 * 100) / 100,
      maxDiscountPercent: 12,
      activePromotions: buildPromotionSummary(basePrice, priceRows, activeOffers),
    }
  },
}

const copilotOpenDeals: AiToolDefinition<OpenDealsInput, CopilotOpenDealsResult> = {
  name: 'copilot_open_deals',
  description: `Get open deals linked to a person customer.

Returns active deals with stage, value, probability, and a stalled flag.`,
  inputSchema: z.object({
    customerId: z.string().uuid().describe('Customer entity ID for a person record'),
  }),
  requiredFeatures: ['voice_channels.copilot.view'],
  handler: async (input, ctx) => {
    const { em, organizationId, tenantId } = requireScope(ctx)

    const customer = await em.findOne(CustomerEntity, {
      id: input.customerId,
      organizationId,
      tenantId,
      kind: 'person',
    })

    if (!customer) {
      throw new Error('Customer not found')
    }

    const links = await em.find(
      CustomerDealPersonLink,
      {
        person: customer,
      },
      {
        populate: ['deal'],
        orderBy: { createdAt: 'DESC' },
      }
    )

    const now = Date.now()
    const deals = links
      .map((link) => link.deal)
      .filter((deal) => deal.organizationId === organizationId && deal.tenantId === tenantId)
      .filter((deal) => deal.status === 'open')
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())

    return {
      deals: deals.map((deal) => {
        const stageUpdatedAt = deal.updatedAt ?? deal.createdAt
        const daysInStage = Math.floor((now - stageUpdatedAt.getTime()) / 86_400_000)

        return {
          id: deal.id,
          title: deal.title,
          stage: readString(deal.pipelineStage) ?? 'Unknown',
          value: normalizeMoney(deal.valueAmount),
          currency: readString(deal.valueCurrency) ?? 'PLN',
          daysInStage,
          isStalled: daysInStage > 14,
          probability: typeof deal.probability === 'number' ? deal.probability : 0,
        }
      }),
    }
  },
}

export const aiTools: AiToolDefinition[] = [
  copilotSearchProducts,
  copilotCustomerContext,
  copilotCheckPricing,
  copilotOpenDeals,
]

export default aiTools
