import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Lease } from '../data/entities'
import { isCurrentOrUpcoming, RESERVING_LEASE_STATUSES } from './leaseOccupancy'
import type { Scope } from './productUse'

export type UsageBlocker = {
  kind: 'lease' | 'booking'
  id: string
  label: string
  unitId: string
  until: string | null
}

export async function findActiveLeases(em: EntityManager, scope: Scope, unitIds: readonly string[]): Promise<UsageBlocker[]> {
  if (!unitIds.length) return []
  const leases = await findWithDecryption(
    em,
    Lease,
    { ...scope, unitId: { $in: [...unitIds] }, status: { $in: RESERVING_LEASE_STATUSES }, deletedAt: null },
    { orderBy: { startsOn: 'asc' } },
    scope,
  )
  return leases
    .filter((lease) => isCurrentOrUpcoming(lease))
    .map((lease) => ({ kind: 'lease' as const, id: lease.id, label: lease.reference, unitId: lease.unitId, until: lease.endsOn }))
}

export async function findUpcomingBookings(_em: EntityManager, _scope: Scope, unitIds: readonly string[]): Promise<UsageBlocker[]> {
  if (!unitIds.length) return []
  return []
}

export async function findUnitBlockers(em: EntityManager, scope: Scope, unitIds: readonly string[]): Promise<UsageBlocker[]> {
  const [leases, bookings] = await Promise.all([
    findActiveLeases(em, scope, unitIds),
    findUpcomingBookings(em, scope, unitIds),
  ])
  return [...leases, ...bookings]
}

export async function findUnitsEverUsed(em: EntityManager, scope: Scope, unitIds: readonly string[]): Promise<string[]> {
  if (!unitIds.length) return []
  const leases = await findWithDecryption(
    em,
    Lease,
    { ...scope, unitId: { $in: [...unitIds] }, status: { $nin: ['withdrawn', 'expired', 'declined'] } },
    { fields: ['id', 'unitId'] },
    scope,
  )
  return Array.from(new Set(leases.map((lease) => lease.unitId)))
}
