import type { Kysely } from 'kysely'
import type { EnricherContext, ResponseEnricher } from '@open-mercato/shared/lib/crud/response-enricher'
import { CLAIM_METRIC_TERMINAL_STATUSES } from './constants'

type NumericAggregateValue = string | number | bigint | null
type NumericCountValue = Exclude<NumericAggregateValue, null>

type WarrantyClaimMetricsTable = {
  customer_id: string | null
  organization_id: string
  tenant_id: string
  status: string
  created_at: Date | string | null
  deleted_at: Date | string | null
}

type WarrantyClaimsEnricherDb = {
  warranty_claims: WarrantyClaimMetricsTable
}

type CustomerRecord = Record<string, unknown> & {
  id: string
}

type WarrantyClaimsPayload = {
  openCount: number
  lifetimeCount: number
  lastClaimDate: string | null
}

type WarrantyClaimsEnrichment = {
  _warranty_claims: WarrantyClaimsPayload
}

type ClaimMetricsRow = {
  customer_id: string | null
  lifetime_count: NumericAggregateValue
  open_count: NumericAggregateValue
  last_claim_date: Date | string | null
}

const ZERO_WARRANTY_CLAIMS_PAYLOAD: WarrantyClaimsPayload = {
  openCount: 0,
  lifetimeCount: 0,
  lastClaimDate: null,
}

function resolveKyselyClient<TDb>(em: unknown): Kysely<TDb> | null {
  if (em == null || typeof em !== 'object') return null
  const getKysely = (em as { getKysely?: unknown }).getKysely
  if (typeof getKysely !== 'function') return null
  const db = (getKysely as () => unknown).call(em)
  if (db == null) return null
  return db as Kysely<TDb>
}

function parseCount(value: NumericAggregateValue): number {
  if (value === null) return 0
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0
}

function toIsoString(value: Date | string | null): string | null {
  if (value === null) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function withZeroPayload(records: CustomerRecord[]): Array<CustomerRecord & WarrantyClaimsEnrichment> {
  return records.map((record) => ({
    ...record,
    _warranty_claims: ZERO_WARRANTY_CLAIMS_PAYLOAD,
  }))
}

async function enrichCustomerClaimMetrics(
  records: CustomerRecord[],
  context: EnricherContext,
): Promise<Array<CustomerRecord & WarrantyClaimsEnrichment>> {
  if (records.length === 0) return []

  const db = resolveKyselyClient<WarrantyClaimsEnricherDb>(context.em)
  if (!db) return withZeroPayload(records)

  const customerIds = records
    .map((record) => record.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)

  if (customerIds.length === 0) return withZeroPayload(records)

  const rows = await db
    .selectFrom('warranty_claims')
    .select(['customer_id'])
    .select((eb) => [
      eb.fn.countAll<NumericCountValue>().as('lifetime_count'),
      eb.fn.countAll<NumericCountValue>()
        .filterWhere('status', 'not in', [...CLAIM_METRIC_TERMINAL_STATUSES])
        .as('open_count'),
      eb.fn.max<Date | string | null>('created_at').as('last_claim_date'),
    ])
    .where('tenant_id', '=', context.tenantId)
    .where('organization_id', '=', context.organizationId)
    .where('deleted_at', 'is', null)
    .where('customer_id', 'in', customerIds)
    .groupBy('customer_id')
    .execute() as ClaimMetricsRow[]

  const metricsByCustomer = new Map<string, WarrantyClaimsPayload>()
  for (const row of rows) {
    const customerId = typeof row.customer_id === 'string' ? row.customer_id : null
    if (!customerId) continue
    metricsByCustomer.set(customerId, {
      openCount: parseCount(row.open_count),
      lifetimeCount: parseCount(row.lifetime_count),
      lastClaimDate: toIsoString(row.last_claim_date),
    })
  }

  return records.map((record) => ({
    ...record,
    _warranty_claims: metricsByCustomer.get(record.id) ?? ZERO_WARRANTY_CLAIMS_PAYLOAD,
  }))
}

export const warrantyClaimsPersonEnricher: ResponseEnricher<CustomerRecord, WarrantyClaimsEnrichment> = {
  id: 'warranty_claims.customer-claim-metrics-person',
  targetEntity: 'customers.person',
  features: ['warranty_claims.claim.view'],
  priority: 20,
  timeout: 1500,
  fallback: { _warranty_claims: ZERO_WARRANTY_CLAIMS_PAYLOAD },
  critical: false,
  cacheableOnListHit: false,

  async enrichOne(record, context) {
    const enriched = await this.enrichMany!([record], context)
    return enriched[0]
  },

  async enrichMany(records, context) {
    return enrichCustomerClaimMetrics(records, context)
  },
}

export const warrantyClaimsCompanyEnricher: ResponseEnricher<CustomerRecord, WarrantyClaimsEnrichment> = {
  id: 'warranty_claims.customer-claim-metrics-company',
  targetEntity: 'customers.company',
  features: ['warranty_claims.claim.view'],
  priority: 20,
  timeout: 1500,
  fallback: { _warranty_claims: ZERO_WARRANTY_CLAIMS_PAYLOAD },
  critical: false,
  cacheableOnListHit: false,

  async enrichOne(record, context) {
    const enriched = await this.enrichMany!([record], context)
    return enriched[0]
  },

  async enrichMany(records, context) {
    return enrichCustomerClaimMetrics(records, context)
  },
}

export const enrichers: ResponseEnricher[] = [warrantyClaimsPersonEnricher, warrantyClaimsCompanyEnricher]
