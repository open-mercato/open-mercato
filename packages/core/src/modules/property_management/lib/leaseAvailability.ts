import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { Lease } from '../data/entities'
import { unavailabilityInTerm, type MergedSpan, type UnavailabilityWindow } from './availabilityResolver'
import { RESERVING_LEASE_STATUSES } from './leaseOccupancy'
import { localToday, reservedInterval } from './leaseTerm'
import type { Scope } from './productUse'

const logger = createLogger('property_management')

export type LeaseUnavailability = { from: string | null; until: string | null }

export function leaseUnavailability(
  lease: Pick<Lease, 'status' | 'startsOn' | 'endsOn' | 'pendingChange'>,
  windows: readonly UnavailabilityWindow[],
  today: string,
): LeaseUnavailability | null {
  if (!RESERVING_LEASE_STATUSES.includes(lease.status)) return null
  const span: MergedSpan | null = unavailabilityInTerm(windows, reservedInterval(lease), today)
  return span ? { from: span.start, until: span.end } : null
}

export function reservedStartSql(alias: string): string {
  return `(case when ${alias}.pending_change->>'kind' in ('end', 'reschedule') then least(${alias}.starts_on, (${alias}.pending_change->'previous'->>'startsOn')::date) else ${alias}.starts_on end)`
}

export function reservedEndSql(alias: string): string {
  return `(case when ${alias}.pending_change->>'kind' in ('end', 'reschedule') then greatest(${alias}.ends_on, (${alias}.pending_change->'previous'->>'endsOn')::date) else ${alias}.ends_on end)`
}

const CLOSURE_END_SQL = 'least(closure.ends_at, closure.ended_at)'

export const UNAVAILABLE_LEASE_ID_LIMIT = 1000

export type LeaseAvailabilityNarrowing = {
  statuses?: readonly string[]
  unitId?: string | null
  customerCompanyId?: string | null
  leaseId?: string | null
  limit?: number
}

export async function findLeaseIdsWithUnavailableUnit(
  em: EntityManager,
  scope: Scope,
  buildingIds: readonly string[] | null,
  narrowing: LeaseAvailabilityNarrowing = {},
  today: string = localToday(),
): Promise<string[]> {
  if (buildingIds !== null && !buildingIds.length) return []
  const requested = narrowing.statuses?.length ? new Set(narrowing.statuses) : null
  const statuses = RESERVING_LEASE_STATUSES.filter((status) => requested === null || requested.has(status))
  if (!statuses.length) return []
  const limit = narrowing.limit ?? UNAVAILABLE_LEASE_ID_LIMIT
  const reservedStart = reservedStartSql('lease')
  const reservedEnd = reservedEndSql('lease')
  const termFrom = `greatest(${reservedStart}, ?::date)`
  const params: unknown[] = [scope.organizationId, scope.tenantId, ...statuses]
  if (buildingIds !== null) params.push(...buildingIds)
  const narrowingSql: string[] = []
  if (narrowing.unitId) {
    narrowingSql.push('and lease.unit_id = ?')
    params.push(narrowing.unitId)
  }
  if (narrowing.customerCompanyId) {
    narrowingSql.push('and lease.customer_company_id = ?')
    params.push(narrowing.customerCompanyId)
  }
  if (narrowing.leaseId) {
    narrowingSql.push('and lease.id = ?')
    params.push(narrowing.leaseId)
  }
  params.push(today, today, limit + 1)
  const rows = await em.getConnection().execute<Array<{ id: string }>>(
    `select lease.id
       from property_management_leases lease
       join property_management_units unit
         on unit.id = lease.unit_id
        and unit.organization_id = lease.organization_id
        and unit.tenant_id = lease.tenant_id
        and unit.deleted_at is null
      where lease.organization_id = ?
        and lease.tenant_id = ?
        and lease.status in (${statuses.map(() => '?').join(', ')})
        and lease.deleted_at is null
        ${buildingIds !== null ? `and unit.building_id in (${buildingIds.map(() => '?').join(', ')})` : ''}
        ${narrowingSql.join('\n        ')}
        and ${reservedEnd} >= ${termFrom}
        and exists (
          select 1
            from property_management_unavailabilities closure
           where closure.organization_id = lease.organization_id
             and closure.tenant_id = lease.tenant_id
             and closure.building_id = unit.building_id
             and closure.deleted_at is null
             and ((closure.subject_type = 'building' and closure.subject_id = unit.building_id)
               or (closure.subject_type = 'floor' and closure.subject_id = unit.floor_id)
               or (closure.subject_type = 'space' and closure.subject_id = unit.space_id)
               or (closure.subject_type = 'unit' and closure.subject_id = unit.id))
             and (${CLOSURE_END_SQL} is null or ${CLOSURE_END_SQL} > closure.starts_at)
             and closure.starts_at < (${reservedEnd} + 1)::timestamp
             and (${CLOSURE_END_SQL} is null or ${CLOSURE_END_SQL} > ${termFrom}::timestamp)
        )
      order by lease.ends_on, lease.id
      limit ?`,
    params,
    'all',
    em.getTransactionContext(),
  )
  if (rows.length > limit) {
    logger.warn('The unit-unavailable lease filter matched more leases than it returns', { limit, organizationId: scope.organizationId })
  }
  return rows.slice(0, limit).map((row) => row.id)
}
