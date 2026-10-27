import type { EntityManager } from '@mikro-orm/postgresql'
import type { Scope } from './productUse'

export type UsageBlocker = {
  kind: 'lease' | 'booking'
  id: string
  label: string
  unitId: string
  until: string | null
}

export async function findActiveLeases(_em: EntityManager, _scope: Scope, unitIds: readonly string[]): Promise<UsageBlocker[]> {
  if (!unitIds.length) return []
  return []
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

export async function findUnitsEverUsed(_em: EntityManager, _scope: Scope, unitIds: readonly string[]): Promise<string[]> {
  if (!unitIds.length) return []
  return []
}
