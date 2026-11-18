import type { LeaseChangeKind, LeasePendingChange, LeaseStatus } from '../data/entities'

export type PendingChangeTermSource = {
  endsOn: string
  startsOn: string
  status: LeaseStatus
  termMonths: number
  currentVersionId?: string | null
}

export function previousTermOf(lease: PendingChangeTermSource): LeasePendingChange['previous'] {
  return {
    endsOn: lease.endsOn,
    startsOn: lease.startsOn,
    status: lease.status,
    termMonths: lease.termMonths,
    currentVersionId: lease.currentVersionId ?? null,
  }
}

export function buildPendingChange(
  kind: LeaseChangeKind,
  changeId: string,
  previous: LeasePendingChange['previous'],
  operationIds: string[],
): LeasePendingChange {
  return { kind, changeId, previous, operationIds }
}
