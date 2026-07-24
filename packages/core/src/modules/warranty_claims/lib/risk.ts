import type { EntityManager } from '@mikro-orm/postgresql'
import { sql } from 'kysely'
import { WarrantyClaim, WarrantyClaimLine } from '../data/entities'
import { loadWarrantyClaimSettings } from './settings'

export type ClaimRiskLevel = 'none' | 'low' | 'medium' | 'high'

export type ClaimRiskSignal = {
  id: 'duplicate_serial' | 'duplicate_order_claim' | 'outside_return_window' | 'over_quantity_claim' | 'repeat_claimer' | 'value_velocity'
  level: 'low' | 'medium' | 'high'
  messageKey: string
  params?: Record<string, string | number>
  relatedClaimNumbers?: string[]
}

export type ClaimRiskAssessment = { level: ClaimRiskLevel; signals: ClaimRiskSignal[] }

type NumericAggregateValue = string | number | bigint | null

type WarrantyClaimsTable = {
  id: string
  organization_id: string
  tenant_id: string
  claim_number: string
  status: string
  customer_id: string | null
  order_id: string | null
  currency_code: string | null
  total_claimed_amount: string | number | null
  created_at: Date
  deleted_at: Date | null
}

type WarrantyClaimLinesTable = {
  id: string
  claim_id: string
  organization_id: string
  tenant_id: string
  order_line_id: string | null
  qty_claimed: string | number | null
  line_status: string
  serial_number: string | null
  deleted_at: Date | null
}

type SalesOrderLinesTable = {
  id: string
  organization_id: string
  tenant_id: string
  quantity: string | number | null
  deleted_at: Date | null
}

type SalesOrdersTable = {
  id: string
  organization_id: string
  tenant_id: string
  placed_at: Date | string | null
  created_at: Date | string | null
  deleted_at: Date | null
}

type WarrantyClaimsRiskDb = {
  warranty_claims: WarrantyClaimsTable
  warranty_claim_lines: WarrantyClaimLinesTable
  sales_order_lines: SalesOrderLinesTable
  sales_orders: SalesOrdersTable
}

const DUPLICATE_SERIAL_LEVEL = 'high' satisfies ClaimRiskSignal['level']
const REPEAT_CLAIMER_MEDIUM_COUNT = 3
const REPEAT_CLAIMER_HIGH_COUNT = 5
const VALUE_VELOCITY_MEDIUM_TOTAL = 10000
const VALUE_VELOCITY_HIGH_TOTAL = 50000
const RISK_WINDOW_DAYS = 90
const MILLISECONDS_PER_DAY = 86_400_000
const QUANTITY_SCALE = 10_000
const LEVEL_RANK: Record<ClaimRiskLevel, number> = { none: 0, low: 1, medium: 2, high: 3 }

function parseNumeric(value: NumericAggregateValue): number {
  if (value === null) return 0
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function parseNullableNumeric(value: NumericAggregateValue): number | null {
  if (value === null) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function roundQuantity(value: number): number {
  return Math.round((value + Number.EPSILON) * QUANTITY_SCALE) / QUANTITY_SCALE
}

function isMissingTableError(err: unknown, tableName: string): boolean {
  if (typeof err !== 'object' || err === null) return false
  const candidate = err as { code?: unknown; message?: unknown }
  return candidate.code === '42P01'
    || (typeof candidate.message === 'string'
      && candidate.message.includes(tableName)
      && candidate.message.includes('does not exist'))
}

function maxRiskLevel(signals: ClaimRiskSignal[]): ClaimRiskLevel {
  let level: ClaimRiskLevel = 'none'
  for (const signal of signals) {
    if (LEVEL_RANK[signal.level] > LEVEL_RANK[level]) {
      level = signal.level
    }
  }
  return level
}

function riskWindowStart(now = new Date()): Date {
  return new Date(now.getTime() - RISK_WINDOW_DAYS * 24 * 60 * 60 * 1000)
}

export async function evaluateClaimRisk(
  em: EntityManager,
  claim: WarrantyClaim,
  lines: WarrantyClaimLine[],
  now = new Date(),
): Promise<ClaimRiskAssessment> {
  const db = em.getKysely<WarrantyClaimsRiskDb>()
  const signals: ClaimRiskSignal[] = []
  const scope = { tenantId: claim.tenantId, organizationId: claim.organizationId }
  const serials = Array.from(new Set(lines
    .map((line) => line.serialNumber?.trim() ?? '')
    .filter((serial): serial is string => serial.length > 0)))

  if (serials.length > 0) {
    const rows = await db
      .selectFrom('warranty_claim_lines')
      .innerJoin('warranty_claims', 'warranty_claims.id', 'warranty_claim_lines.claim_id')
      .select([
        'warranty_claim_lines.serial_number as serialNumber',
        'warranty_claims.claim_number as claimNumber',
      ])
      .where('warranty_claim_lines.tenant_id', '=', scope.tenantId)
      .where('warranty_claim_lines.organization_id', '=', scope.organizationId)
      .where('warranty_claim_lines.deleted_at', 'is', null)
      .where('warranty_claims.tenant_id', '=', scope.tenantId)
      .where('warranty_claims.organization_id', '=', scope.organizationId)
      .where('warranty_claims.deleted_at', 'is', null)
      .where('warranty_claims.id', '!=', claim.id)
      .where('warranty_claims.status', '!=', 'cancelled')
      .where('warranty_claim_lines.serial_number', 'in', serials)
      .execute()

    const relatedBySerial = new Map<string, Set<string>>()
    for (const row of rows) {
      if (!row.serialNumber || !row.claimNumber) continue
      const related = relatedBySerial.get(row.serialNumber) ?? new Set<string>()
      related.add(row.claimNumber)
      relatedBySerial.set(row.serialNumber, related)
    }

    for (const serial of serials) {
      const related = relatedBySerial.get(serial)
      if (!related || related.size === 0) continue
      signals.push({
        id: 'duplicate_serial',
        level: DUPLICATE_SERIAL_LEVEL,
        messageKey: 'warranty_claims.risk.duplicateSerial',
        params: { serial, count: related.size },
        relatedClaimNumbers: Array.from(related).sort((left, right) => left.localeCompare(right)),
      })
    }
  }

  const orderId = claim.orderId ?? null
  if (orderId) {
    const orderRows = await db
      .selectFrom('warranty_claims')
      .select('claim_number as claimNumber')
      .where('tenant_id', '=', scope.tenantId)
      .where('organization_id', '=', scope.organizationId)
      .where('deleted_at', 'is', null)
      .where('order_id', '=', orderId)
      .where('status', '!=', 'cancelled')
      .where('id', '!=', claim.id)
      .execute()
    const relatedOrderClaims = Array.from(new Set(
      orderRows
        .map((row) => row.claimNumber)
        .filter((claimNumber): claimNumber is string => typeof claimNumber === 'string' && claimNumber.length > 0),
    )).sort((left, right) => left.localeCompare(right))
    if (relatedOrderClaims.length > 0) {
      signals.push({
        id: 'duplicate_order_claim',
        level: 'medium',
        messageKey: 'warranty_claims.risk.duplicateOrderClaim',
        params: { count: relatedOrderClaims.length },
        relatedClaimNumbers: relatedOrderClaims,
      })
    }
  }

  if (orderId && (claim.claimType === 'return' || claim.claimType === 'core_return')) {
    const settings = await loadWarrantyClaimSettings(em, scope)
    const returnWindowDays = settings?.returnWindowDays ?? null
    if (returnWindowDays !== null && returnWindowDays > 0) {
      let order: { placedAt: Date | string | null; createdAt: Date | string | null } | undefined
      try {
        order = await db
          .selectFrom('sales_orders')
          .select(['placed_at as placedAt', 'created_at as createdAt'])
          .where('id', '=', orderId)
          .where('tenant_id', '=', scope.tenantId)
          .where('organization_id', '=', scope.organizationId)
          .where('deleted_at', 'is', null)
          .executeTakeFirst()
      } catch (err) {
        if (!isMissingTableError(err, 'sales_orders')) throw err
      }

      const anchorValue = order?.placedAt ?? order?.createdAt ?? null
      if (anchorValue !== null) {
        const anchor = anchorValue instanceof Date ? anchorValue : new Date(anchorValue)
        if (!Number.isNaN(anchor.getTime())) {
          const days = Math.floor((now.getTime() - anchor.getTime()) / MILLISECONDS_PER_DAY)
          if (days > returnWindowDays) {
            signals.push({
              id: 'outside_return_window',
              level: days > 2 * returnWindowDays ? 'high' : 'medium',
              messageKey: 'warranty_claims.risk.outsideReturnWindow',
              params: { days, window: returnWindowDays },
            })
          }
        }
      }
    }
  }

  const currentQuantityByOrderLine = new Map<string, number>()
  for (const line of lines) {
    const orderLineId = line.orderLineId ?? null
    if (!orderLineId || line.deletedAt || line.lineStatus === 'rejected') continue
    const current = currentQuantityByOrderLine.get(orderLineId) ?? 0
    currentQuantityByOrderLine.set(orderLineId, roundQuantity(current + parseNumeric(line.qtyClaimed)))
  }
  const orderLineIds = Array.from(currentQuantityByOrderLine.keys()).sort((left, right) => left.localeCompare(right))
  if (orderLineIds.length > 0) {
    let soldRows: Array<{ id: string; quantity: string | number | null }>
    try {
      soldRows = await db
        .selectFrom('sales_order_lines')
        .select(['id', 'quantity'])
        .where('tenant_id', '=', scope.tenantId)
        .where('organization_id', '=', scope.organizationId)
        .where('deleted_at', 'is', null)
        .where('id', 'in', orderLineIds)
        .execute()
    } catch (err) {
      if (!isMissingTableError(err, 'sales_order_lines')) throw err
      soldRows = []
    }

    const soldByOrderLine = new Map<string, number>()
    for (const row of soldRows) {
      const quantity = parseNullableNumeric(row.quantity)
      if (quantity !== null) soldByOrderLine.set(row.id, roundQuantity(quantity))
    }
    const scopedOrderLineIds = orderLineIds.filter((id) => soldByOrderLine.has(id))
    if (scopedOrderLineIds.length > 0) {
      const otherRows = await db
        .selectFrom('warranty_claim_lines')
        .innerJoin('warranty_claims', 'warranty_claims.id', 'warranty_claim_lines.claim_id')
        .select([
          'warranty_claim_lines.order_line_id as orderLineId',
          'warranty_claim_lines.qty_claimed as qtyClaimed',
          'warranty_claims.claim_number as claimNumber',
        ])
        .where('warranty_claim_lines.tenant_id', '=', scope.tenantId)
        .where('warranty_claim_lines.organization_id', '=', scope.organizationId)
        .where('warranty_claim_lines.deleted_at', 'is', null)
        .where('warranty_claim_lines.line_status', '!=', 'rejected')
        .where('warranty_claim_lines.order_line_id', 'in', scopedOrderLineIds)
        .where('warranty_claims.tenant_id', '=', scope.tenantId)
        .where('warranty_claims.organization_id', '=', scope.organizationId)
        .where('warranty_claims.deleted_at', 'is', null)
        .where('warranty_claims.id', '!=', claim.id)
        .where('warranty_claims.status', '!=', 'cancelled')
        .execute()

      const otherQuantityByOrderLine = new Map<string, number>()
      const relatedClaimsByOrderLine = new Map<string, Set<string>>()
      for (const row of otherRows) {
        if (!row.orderLineId) continue
        const current = otherQuantityByOrderLine.get(row.orderLineId) ?? 0
        otherQuantityByOrderLine.set(row.orderLineId, roundQuantity(current + parseNumeric(row.qtyClaimed)))
        if (row.claimNumber) {
          const related = relatedClaimsByOrderLine.get(row.orderLineId) ?? new Set<string>()
          related.add(row.claimNumber)
          relatedClaimsByOrderLine.set(row.orderLineId, related)
        }
      }

      for (const orderLineId of scopedOrderLineIds) {
        const sold = soldByOrderLine.get(orderLineId)
        if (sold === undefined) continue
        const count = roundQuantity(
          (currentQuantityByOrderLine.get(orderLineId) ?? 0)
          + (otherQuantityByOrderLine.get(orderLineId) ?? 0),
        )
        if (count <= sold) continue
        signals.push({
          id: 'over_quantity_claim',
          level: count >= sold * 2 ? 'high' : 'medium',
          messageKey: 'warranty_claims.risk.overQuantityClaim',
          params: { count, sold },
          relatedClaimNumbers: Array.from(relatedClaimsByOrderLine.get(orderLineId) ?? [])
            .sort((left, right) => left.localeCompare(right)),
        })
      }
    }
  }

  const customerId = claim.customerId ?? null
  if (customerId) {
    const windowStart = riskWindowStart()
    const repeatRow = await db
      .selectFrom('warranty_claims')
      .select(sql<NumericAggregateValue>`count(*)`.as('count'))
      .where('tenant_id', '=', scope.tenantId)
      .where('organization_id', '=', scope.organizationId)
      .where('deleted_at', 'is', null)
      .where('customer_id', '=', customerId)
      .where('created_at', '>=', windowStart)
      .where('status', '!=', 'cancelled')
      .where('id', '!=', claim.id)
      .executeTakeFirst()
    const otherClaimCount = Math.trunc(parseNumeric(repeatRow?.count ?? null))
    const windowClaimCount = otherClaimCount + 1
    if (windowClaimCount >= REPEAT_CLAIMER_MEDIUM_COUNT) {
      signals.push({
        id: 'repeat_claimer',
        level: windowClaimCount >= REPEAT_CLAIMER_HIGH_COUNT ? 'high' : 'medium',
        messageKey: 'warranty_claims.risk.repeatClaimer',
        params: { count: otherClaimCount },
      })
    }

    const currencyCode = claim.currencyCode?.trim() || null
    if (currencyCode) {
      const valueRow = await db
        .selectFrom('warranty_claims')
        .select(sql<NumericAggregateValue>`coalesce(sum(total_claimed_amount), 0)`.as('total'))
        .where('tenant_id', '=', scope.tenantId)
        .where('organization_id', '=', scope.organizationId)
        .where('deleted_at', 'is', null)
        .where('customer_id', '=', customerId)
        .where('currency_code', '=', currencyCode)
        .where('created_at', '>=', windowStart)
        .where('status', '!=', 'cancelled')
        .executeTakeFirst()
      const total = parseNumeric(valueRow?.total ?? null)
      if (total >= VALUE_VELOCITY_MEDIUM_TOTAL) {
        signals.push({
          id: 'value_velocity',
          level: total >= VALUE_VELOCITY_HIGH_TOTAL ? 'high' : 'medium',
          messageKey: 'warranty_claims.risk.valueVelocity',
          params: { total: Number(total.toFixed(2)), currencyCode },
        })
      }
    }
  }

  return { level: maxRiskLevel(signals), signals }
}
