import type { EntityManager } from '@mikro-orm/postgresql'
import { SalesTaxRate } from '../data/entities'

export type SalesSeedScope = { tenantId: string; organizationId: string }

const DEFAULT_TAX_RATES = [
  { code: 'vat-23', name: '23% VAT', rate: '23' },
  { code: 'vat-0', name: '0% VAT', rate: '0' },
] as const

export async function seedSalesTaxRates(
  em: EntityManager,
  scope: SalesSeedScope,
) {
  const existing = await em.find(SalesTaxRate, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  })
  const existingCodes = new Set(existing.map((entry) => entry.code.toLowerCase()))
  const hasDefault = existing.some((entry) => entry.isDefault)
  let assignedDefault = hasDefault
  const now = new Date()

  for (const def of DEFAULT_TAX_RATES) {
    if (existingCodes.has(def.code)) continue
    const shouldSetDefault = !assignedDefault
    const record = em.create(SalesTaxRate, {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      name: def.name,
      code: def.code,
      rate: def.rate,
      countryCode: null,
      regionCode: null,
      postalCode: null,
      city: null,
      customerGroupId: null,
      productCategoryId: null,
      channelId: null,
      priority: 0,
      isCompound: false,
      isDefault: shouldSetDefault,
      metadata: null,
      startsAt: null,
      endsAt: null,
      createdAt: now,
      updatedAt: now,
    })
    if (shouldSetDefault) assignedDefault = true
    em.persist(record)
  }
}
