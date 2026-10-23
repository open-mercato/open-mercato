import type { EntityManager } from '@mikro-orm/postgresql'
import { VendorPricelist, VendorPricelistItem } from '../data/entities'
import type {
  VendorPricelistCreateInput,
  VendorPricelistUpdateInput,
} from '../data/validators'

type Scope = {
  organizationId: string
  tenantId: string
}

export type BestPriceResult = {
  price: string
  currencyCode: string
  leadTimeDays: number
  vendorProductCode?: string | null
  minQuantity: string
  pricelistId: string
  pricelistName: string
}

export class VendorPricelistService {
  constructor(private readonly em: EntityManager) {}

  async createPricelist(scope: Scope, input: VendorPricelistCreateInput): Promise<VendorPricelist> {
    const now = new Date()
    const pricelist = this.em.create(VendorPricelist, {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      vendorId: input.vendorId,
      name: input.name,
      currencyCode: input.currencyCode || 'PLN',
      isActive: input.isActive ?? true,
      createdAt: now,
      updatedAt: now,
    })

    const items = (input.items ?? []).map((it) =>
      this.em.create(VendorPricelistItem, {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        pricelist,
        productId: it.productId,
        vendorProductCode: it.vendorProductCode ?? null,
        minQuantity: String(it.minQuantity || 1),
        price: String(it.price),
        leadTimeDays: it.leadTimeDays ?? 0,
        validFrom: it.validFrom ? new Date(it.validFrom) : null,
        validTo: it.validTo ? new Date(it.validTo) : null,
        createdAt: now,
        updatedAt: now,
      })
    )

    await this.em.persist([pricelist, ...items]).flush()
    return pricelist
  }

  async updatePricelist(
    id: string,
    scope: Scope,
    input: VendorPricelistUpdateInput
  ): Promise<VendorPricelist> {
    const pricelist = await this.em.findOneOrFail(
      VendorPricelist,
      { id, organizationId: scope.organizationId, tenantId: scope.tenantId, deletedAt: null },
      { populate: ['items'] }
    )

    const now = new Date()
    if (input.name !== undefined) pricelist.name = input.name
    if (input.currencyCode !== undefined) pricelist.currencyCode = input.currencyCode
    if (input.isActive !== undefined) pricelist.isActive = input.isActive

    if (input.items) {
      for (const existing of pricelist.items.getItems()) {
        existing.deletedAt = now
      }

      const newItems = input.items.map((it) =>
        this.em.create(VendorPricelistItem, {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          pricelist,
          productId: it.productId,
          vendorProductCode: it.vendorProductCode ?? null,
          minQuantity: String(it.minQuantity || 1),
          price: String(it.price),
          leadTimeDays: it.leadTimeDays ?? 0,
          validFrom: it.validFrom ? new Date(it.validFrom) : null,
          validTo: it.validTo ? new Date(it.validTo) : null,
          createdAt: now,
          updatedAt: now,
        })
      )

      this.em.persist(newItems)
    }

    pricelist.updatedAt = now
    await this.em.flush()
    return pricelist
  }

  async resolveBestPrice(
    scope: Scope,
    params: {
      vendorId: string
      productId: string
      quantity?: number
      date?: Date
    }
  ): Promise<BestPriceResult | null> {
    const qty = params.quantity ?? 1
    const targetDate = params.date ?? new Date()

    const pricelists = await this.em.find(
      VendorPricelist,
      {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        vendorId: params.vendorId,
        isActive: true,
        deletedAt: null,
      },
      { populate: ['items'] }
    )

    const candidates: BestPriceResult[] = []

    for (const pl of pricelists) {
      for (const item of pl.items.getItems()) {
        if (item.deletedAt !== null) continue
        if (item.productId !== params.productId) continue

        // Check date validity
        if (item.validFrom && targetDate < item.validFrom) continue
        if (item.validTo && targetDate > item.validTo) continue

        // Check quantity tier break
        const minQty = Number(item.minQuantity)
        if (qty < minQty) continue

        candidates.push({
          price: item.price,
          currencyCode: pl.currencyCode,
          leadTimeDays: item.leadTimeDays,
          vendorProductCode: item.vendorProductCode,
          minQuantity: item.minQuantity,
          pricelistId: pl.id,
          pricelistName: pl.name,
        })
      }
    }

    if (candidates.length === 0) return null

    // Return the lowest price candidate
    candidates.sort((a, b) => Number(a.price) - Number(b.price))
    return candidates[0]
  }
}
