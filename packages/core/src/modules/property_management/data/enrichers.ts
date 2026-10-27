import type { EntityManager } from '@mikro-orm/postgresql'
import type { EnricherContext, ResponseEnricher } from '@open-mercato/shared/lib/crud/response-enricher'
import { E } from '#generated/entities.ids.generated'
import { loadProductUses } from '../lib/productUse'
import type { BillingUnit, ProductUseKind } from './entities'

type CatalogProductRecord = Record<string, unknown> & { id?: string }

export type CatalogProductPropertyEnrichment = {
  _property_management: { use: ProductUseKind | null; billingUnit: BillingUnit | null }
}

const EMPTY: CatalogProductPropertyEnrichment = { _property_management: { use: null, billingUnit: null } }

function recordId(record: CatalogProductRecord): string | null {
  return typeof record.id === 'string' && record.id.length ? record.id : null
}

export const catalogProductUseEnricher: ResponseEnricher<CatalogProductRecord, CatalogProductPropertyEnrichment> = {
  id: 'property_management.catalog-product-use',
  targetEntity: E.catalog.catalog_product,
  features: ['property_management.view'],
  priority: 30,
  timeout: 2000,
  fallback: EMPTY,

  async enrichOne(record, context: EnricherContext) {
    const [enriched] = await this.enrichMany!([record], context)
    return enriched
  },

  async enrichMany(records, context: EnricherContext) {
    const ids = records.map(recordId).filter((id): id is string => Boolean(id))
    if (!ids.length) return records.map((record) => ({ ...record, ...EMPTY }))
    const em = (context.em as EntityManager).fork()
    const uses = await loadProductUses(em, { tenantId: context.tenantId, organizationId: context.organizationId }, ids)
    return records.map((record) => {
      const id = recordId(record)
      const use = id ? uses.get(id) : undefined
      return { ...record, _property_management: { use: use?.use ?? null, billingUnit: use?.billingUnit ?? null } }
    })
  },
}

export const enrichers: ResponseEnricher[] = [catalogProductUseEnricher as ResponseEnricher]
