import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { LeaseVersion, type Lease } from '../data/entities'
import { cancelEffectiveOn, compareIsoDates } from './leaseTerm'
import { previewCancelCredit, readRecurrence, type CancelSettlement, type CreditPreview, type RecurrenceRead } from './salesRecurrence'
import type { Scope } from './productUse'

export type EndPlanEntry = {
  versionId: string
  orderId: string
  effectiveOn: string
  recurrence: RecurrenceRead | null
  preview: CreditPreview
}

export type EndPlan = {
  entries: EndPlanEntry[]
  wouldCredit: boolean
}

export type RecurrenceReader = (orderId: string) => Promise<RecurrenceRead | null>

export async function loadBilledVersions(em: EntityManager, scope: Scope, leaseId: string): Promise<LeaseVersion[]> {
  return findWithDecryption(
    em,
    LeaseVersion,
    { ...scope, leaseId, state: 'in_force', salesOrderId: { $ne: null } },
    { orderBy: { versionNo: 'asc' } },
    scope,
  )
}

export function cutoffAlreadyCovers(recurrence: RecurrenceRead | null, effectiveOn: string): boolean {
  if (!recurrence?.cancelEffectiveOn) return false
  return compareIsoDates(recurrence.cancelEffectiveOn, effectiveOn) <= 0
}

export async function planLeaseEnd(
  versions: readonly LeaseVersion[],
  endsOn: string,
  settlement: CancelSettlement,
  reader: RecurrenceReader,
): Promise<EndPlan> {
  const entries: EndPlanEntry[] = []
  for (const version of versions) {
    if (!version.salesOrderId) continue
    if (compareIsoDates(version.endsOn, endsOn) <= 0) continue
    const effectiveOn = cancelEffectiveOn(endsOn, version.startsOn)
    const recurrence = await reader(version.salesOrderId)
    if (cutoffAlreadyCovers(recurrence, effectiveOn)) continue
    if (recurrence && (recurrence.status === 'completed' || recurrence.status === 'cancelled') && !recurrence.cancelEffectiveOn) continue
    entries.push({
      versionId: version.id,
      orderId: version.salesOrderId,
      effectiveOn,
      recurrence,
      preview: previewCancelCredit(recurrence, effectiveOn, settlement),
    })
  }
  return { entries, wouldCredit: entries.some((entry) => entry.preview.wouldCredit) }
}

export function defaultRecurrenceReader(em: EntityManager, scope: Scope): RecurrenceReader {
  return (orderId) => readRecurrence(em.fork(), scope, orderId)
}

export function memoizeRecurrenceReader(reader: RecurrenceReader): RecurrenceReader {
  const reads = new Map<string, Promise<RecurrenceRead | null>>()
  return (orderId) => {
    const cached = reads.get(orderId)
    if (cached) return cached
    const read = reader(orderId)
    reads.set(orderId, read)
    return read
  }
}

export function leaseHasEnded(lease: Lease, today: string): boolean {
  return lease.status === 'ended' || compareIsoDates(lease.endsOn, today) < 0
}
