import { LockMode } from '@mikro-orm/core'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { randomUUID } from 'node:crypto'
import { ProgressJobRepairCell } from '../data/entities'

export type ProgressRepairCellInput = {
  jobId: string
  tenantId: string
  organizationId?: string | null
  cell: string
  dueAt: Date
  reason?: string | null
}

export type ProgressRepairScope = {
  tenantId: string
  organizationId?: string | null
}

export type ClaimedRepairCells = {
  leaseToken: string
  cells: ProgressJobRepairCell[]
}

function scopedFilter(scope: ProgressRepairScope): FilterQuery<ProgressJobRepairCell> {
  return {
    tenantId: scope.tenantId,
    ...(scope.organizationId ? { organizationId: scope.organizationId } : { organizationId: null }),
  }
}

export async function upsertRepairCell(em: EntityManager, input: ProgressRepairCellInput): Promise<void> {
  // The primary key makes this a single idempotent write under at-least-once delivery.
  // A read-then-insert sequence would race when two deliveries repair the same job.
  await em.upsert(ProgressJobRepairCell, {
    jobId: input.jobId,
    tenantId: input.tenantId,
    organizationId: input.organizationId ?? null,
    cell: input.cell,
    dueAt: input.dueAt,
    reason: input.reason ?? null,
  }, { onConflictAction: 'merge' })
}

export async function removeRepairCell(em: EntityManager, jobId: string, scope: ProgressRepairScope): Promise<boolean> {
  return (await em.nativeDelete(ProgressJobRepairCell, { jobId, ...scopedFilter(scope) })) > 0
}

export async function claimDueRepairCells(
  em: EntityManager,
  scope: ProgressRepairScope,
  now: Date,
  limit: number,
  leaseMs = 30_000,
): Promise<ClaimedRepairCells> {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('repair cell limit must be a positive integer')
  if (!Number.isInteger(leaseMs) || leaseMs < 1) throw new Error('repair cell lease must be a positive integer')

  const leaseToken = randomUUID()
  const leaseUntil = new Date(now.getTime() + leaseMs)
  const cells = await em.transactional(async (tx) => {
    const due = await tx.find(ProgressJobRepairCell, {
      ...scopedFilter(scope),
      dueAt: { $lte: now },
      $or: [{ leaseUntil: null }, { leaseUntil: { $lte: now } }],
    }, {
      orderBy: { dueAt: 'asc', jobId: 'asc' },
      limit,
      lockMode: LockMode.PESSIMISTIC_PARTIAL_WRITE,
    })
    for (const cell of due) {
      cell.leaseToken = leaseToken
      cell.leaseUntil = leaseUntil
      cell.attempts += 1
    }
    await tx.flush()
    return due
  })
  return { leaseToken, cells }
}

export async function acknowledgeRepairCell(
  em: EntityManager,
  jobId: string,
  scope: ProgressRepairScope,
  leaseToken: string,
): Promise<boolean> {
  return (await em.nativeDelete(ProgressJobRepairCell, {
    jobId,
    ...scopedFilter(scope),
    leaseToken,
  })) > 0
}

export async function releaseRepairCell(
  em: EntityManager,
  jobId: string,
  scope: ProgressRepairScope,
  leaseToken: string,
  nextDueAt: Date,
  reason?: string | null,
): Promise<boolean> {
  return (await em.nativeUpdate(ProgressJobRepairCell, {
    jobId,
    ...scopedFilter(scope),
    leaseToken,
  }, {
    dueAt: nextDueAt,
    leaseToken: null,
    leaseUntil: null,
    ...(reason !== undefined ? { reason } : {}),
    updatedAt: new Date(),
  })) > 0
}
