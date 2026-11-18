import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Lease, LeaseProposal, LeaseVersion, type LeaseStatus } from '../data/entities'
import { compareIsoDates, localToday, rangesOverlap, reservedInterval } from './leaseTerm'
import type { Scope } from './productUse'

export const RESERVING_LEASE_STATUSES: LeaseStatus[] = ['proposed', 'pending_order', 'active']
export const OPEN_PROPOSAL_STATUSES = ['sending', 'sent', 'declined'] as const

export type ReservedRange = {
  leaseId: string
  reference: string
  unitId: string
  startsOn: string
  endsOn: string
  source: 'lease' | 'extension' | 'proposal'
}

export async function loadReservedRanges(
  em: EntityManager,
  scope: Scope,
  unitIds: readonly string[],
  options: { excludeLeaseId?: string | null } = {},
): Promise<ReservedRange[]> {
  if (!unitIds.length) return []
  const leases = await findWithDecryption(
    em,
    Lease,
    { ...scope, unitId: { $in: [...unitIds] }, status: { $in: RESERVING_LEASE_STATUSES }, deletedAt: null },
    undefined,
    scope,
  )
  const relevant = leases.filter((lease) => lease.id !== options.excludeLeaseId)
  if (!relevant.length) return []
  const leaseIds = relevant.map((lease) => lease.id)
  const [pendingExtensions, openProposals] = await Promise.all([
    findWithDecryption(
      em,
      LeaseVersion,
      { ...scope, leaseId: { $in: leaseIds }, event: 'extended', state: 'pending', holdToken: { $ne: null } },
      undefined,
      scope,
    ),
    findWithDecryption(
      em,
      LeaseProposal,
      { ...scope, leaseId: { $in: leaseIds }, kind: 'extension', status: { $in: [...OPEN_PROPOSAL_STATUSES] } },
      undefined,
      scope,
    ),
  ])
  const byId = new Map(relevant.map((lease) => [lease.id, lease]))
  const ranges: ReservedRange[] = relevant.map((lease) => ({
    leaseId: lease.id,
    reference: lease.reference,
    unitId: lease.unitId,
    ...reservedInterval(lease),
    source: 'lease',
  }))
  for (const version of pendingExtensions) {
    const lease = byId.get(version.leaseId)
    if (!lease) continue
    ranges.push({ leaseId: lease.id, reference: lease.reference, unitId: lease.unitId, startsOn: version.startsOn, endsOn: version.endsOn, source: 'extension' })
  }
  for (const proposal of openProposals) {
    const lease = byId.get(proposal.leaseId)
    if (!lease) continue
    ranges.push({ leaseId: lease.id, reference: lease.reference, unitId: lease.unitId, startsOn: proposal.startsOn, endsOn: proposal.endsOn, source: 'proposal' })
  }
  return ranges
}

export function findOverlaps(ranges: readonly ReservedRange[], unitId: string, term: { startsOn: string; endsOn: string }): ReservedRange[] {
  return ranges.filter((range) => range.unitId === unitId && rangesOverlap(range, term))
}

export function isCurrentOrUpcoming(lease: { endsOn: string }, today: string = localToday()): boolean {
  return compareIsoDates(lease.endsOn, today) >= 0
}
