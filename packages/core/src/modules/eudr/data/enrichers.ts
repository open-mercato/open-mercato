import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { ResponseEnricher, EnricherContext } from '@open-mercato/shared/lib/crud/response-enricher'
import { EudrProductMapping } from './entities'

type ProductRecord = Record<string, unknown> & { id: string }
type ProductCompliance = {
  _eudr: {
    commodity: string
    isInScope: boolean
  } | null
}

const ENRICHER_TIMEOUT_MS = 2000

function hasRecordId(record: Record<string, unknown>): record is ProductRecord {
  return typeof record.id === 'string' && record.id.length > 0
}

const productComplianceEnricher: ResponseEnricher<ProductRecord, ProductCompliance> = {
  id: 'eudr.product-compliance',
  targetEntity: 'catalog.product',
  priority: 10,
  timeout: ENRICHER_TIMEOUT_MS,
  critical: false,
  fallback: { _eudr: null },
  features: ['eudr.mappings.view'],

  async enrichOne(record, context) {
    const enriched = await this.enrichMany!([record], context)
    return enriched[0]
  },

  async enrichMany(records, context: EnricherContext): Promise<Array<ProductRecord & ProductCompliance>> {
    if (records.length === 0) return []

    const productIds = Array.from(
      new Set(
        records
          .filter(hasRecordId)
          .map((record) => record.id),
      ),
    )
    if (!productIds.length) {
      return records.map((record) => ({ ...record, _eudr: null }))
    }

    const em = context.em as EntityManager
    const mappings = await em.find(EudrProductMapping, {
      productId: { $in: productIds },
      tenantId: context.tenantId,
      organizationId: context.organizationId,
      deletedAt: null,
    } as FilterQuery<EudrProductMapping>, {
      orderBy: { isInScope: 'DESC', createdAt: 'DESC' },
    })

    const byProductId = new Map<string, EudrProductMapping>()
    for (const mapping of mappings) {
      const existing = byProductId.get(mapping.productId)
      if (!existing || (!existing.isInScope && mapping.isInScope)) {
        byProductId.set(mapping.productId, mapping)
      }
    }

    return records.map((record) => {
      if (!hasRecordId(record)) return Object.assign({}, record, { _eudr: null })
      const mapping = byProductId.get(record.id)
      return {
        ...record,
        _eudr: mapping
          ? {
              commodity: mapping.commodity,
              isInScope: mapping.isInScope,
            }
          : null,
      }
    })
  },
}

export const enrichers: ResponseEnricher[] = [productComplianceEnricher]
