import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { Dictionary, DictionaryEntry, type DictionaryManagerVisibility } from '@open-mercato/core/modules/dictionaries/data/entities'
import { CatalogPriceKind } from '../data/entities'
import { seedCatalogExamples } from '../seed/examples'
import { CATALOG_UNIT_DEFAULTS } from './unitLabels'

export type CatalogSeedScope = { tenantId: string; organizationId: string }

const PRICE_KIND_DEFAULTS = [
  { code: 'regular', title: 'Regular', isPromotion: false, displayMode: 'including-tax' as const, currencyCode: 'USD' as const },
  { code: 'sale', title: 'Sale', isPromotion: true, displayMode: 'including-tax' as const, currencyCode: 'USD' as const },
] as const

export async function seedCatalogUnits(
  em: EntityManager,
  scope: CatalogSeedScope,
) {
  let dictionary = await em.findOne(Dictionary, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    key: 'unit',
    deletedAt: null,
  })
  if (!dictionary) {
    dictionary = em.create(Dictionary, {
      key: 'unit',
      name: 'Units of measure',
      description: 'Reusable units for catalog products and pricing.',
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      isSystem: true,
      isActive: true,
      managerVisibility: 'default' satisfies DictionaryManagerVisibility,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(dictionary)
    await em.flush()
  }
  const existingEntries = await em.find(DictionaryEntry, {
    dictionary,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })
  const existingMap = new Map(existingEntries.map((entry) => [entry.value.toLowerCase(), entry]))
  for (const unit of CATALOG_UNIT_DEFAULTS) {
    const key = unit.value.toLowerCase()
    if (existingMap.has(key)) continue
    const entry = em.create(DictionaryEntry, {
      dictionary,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      value: unit.value,
      normalizedValue: key,
      label: unit.label,
      color: null,
      icon: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(entry)
  }
  await em.flush()
}

export async function seedCatalogPriceKinds(
  em: EntityManager,
  scope: Omit<CatalogSeedScope, 'organizationId'> & { organizationId?: string | null },
) {
  const existing = await em.find(CatalogPriceKind, {
    tenantId: scope.tenantId,
  })
  const existingCodes = new Set(existing.map((record) => record.code.toLowerCase()))
  const now = new Date()
  const targetOrganizationId = scope.organizationId ?? null

  for (const def of PRICE_KIND_DEFAULTS) {
    const key = def.code.toLowerCase()
    if (existingCodes.has(key)) continue
    const record = em.create(CatalogPriceKind, {
      organizationId: targetOrganizationId,
      tenantId: scope.tenantId,
      code: def.code,
      title: def.title,
      displayMode: def.displayMode ?? 'including-tax',
      currencyCode: def.currencyCode ?? null,
      isPromotion: def.isPromotion,
      isActive: true,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    })
    em.persist(record)
  }
  await em.flush()
}

export async function seedCatalogExamplesForScope(
  em: EntityManager,
  container: AwilixContainer,
  scope: CatalogSeedScope,
): Promise<boolean> {
  return seedCatalogExamples(em, container, scope)
}

export async function installExampleCatalogData(
  container: AwilixContainer,
  scope: CatalogSeedScope,
  em?: EntityManager,
): Promise<{ seededExamples: boolean }> {
  const manager = em ?? container.resolve<EntityManager>('em')
  await seedCatalogUnits(manager, scope)
  await seedCatalogPriceKinds(manager, scope)
  const seededExamples = await seedCatalogExamples(manager, container, scope)
  return { seededExamples }
}
