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
  leaseEpoch?: number
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
  const leaseEpoch = input.leaseEpoch ?? 0
  if (!Number.isInteger(leaseEpoch) || leaseEpoch < 0) throw new Error('repair cell lease epoch must be a non-negative integer')
  await em.getConnection().execute(`
    insert into "progress_job_repair_cells"
      ("job_id", "tenant_id", "organization_id", "cell", "due_at", "attempts", "lease_epoch", "reason", "created_at", "updated_at")
    values (?, ?, ?, ?, ?, 0, ?, ?, now(), now())
    on conflict ("job_id") do update set
      "tenant_id" = excluded."tenant_id",
      "organization_id" = excluded."organization_id",
      "cell" = excluded."cell",
      "due_at" = excluded."due_at",
      "lease_epoch" = excluded."lease_epoch",
      "reason" = excluded."reason",
      "updated_at" = now()
    where excluded."lease_epoch" >= "progress_job_repair_cells"."lease_epoch"
  `, [input.jobId, input.tenantId, input.organizationId ?? null, input.cell, input.dueAt, leaseEpoch, input.reason ?? null])
}

export async function removeRepairCell(em: EntityManager, jobId: string, scope: ProgressRepairScope): Promise<boolean> {
  return (await em.nativeDelete(ProgressJobRepairCell, { jobId, ...scopedFilter(scope) })) > 0
}

async function claimDueRepairCellsInTransaction(
  tx: EntityManager,
  scope: ProgressRepairScope,
  now: Date,
  limit: number,
  leaseMs = 30_000,
): Promise<ClaimedRepairCells> {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('repair cell limit must be a positive integer')
  if (!Number.isInteger(leaseMs) || leaseMs < 1) throw new Error('repair cell lease must be a positive integer')

  const leaseToken = randomUUID()
  const leaseUntil = new Date(now.getTime() + leaseMs)
  const cells = await tx.find(ProgressJobRepairCell, {
    ...scopedFilter(scope),
    dueAt: { $lte: now },
    $or: [{ leaseUntil: null }, { leaseUntil: { $lte: now } }],
  }, {
    orderBy: { dueAt: 'asc', jobId: 'asc' },
    limit,
    lockMode: LockMode.PESSIMISTIC_PARTIAL_WRITE,
  })
  for (const cell of cells) {
    cell.leaseToken = leaseToken
    cell.leaseUntil = leaseUntil
    cell.attempts += 1
    cell.leaseEpoch = (cell.leaseEpoch ?? 0) + 1
  }
  await tx.flush()
  return { leaseToken, cells }
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
  return em.transactional((tx) => claimDueRepairCellsInTransaction(tx, scope, now, limit, leaseMs))
}

/** Keep the claim lock and the caller's repair mutation in one transaction. */
export async function withClaimedRepairCells<T>(
  em: EntityManager,
  scope: ProgressRepairScope,
  now: Date,
  limit: number,
  work: (tx: EntityManager, claim: ClaimedRepairCells) => Promise<T>,
  leaseMs = 30_000,
): Promise<T> {
  return em.transactional(async (tx) => {
    const claim = await claimDueRepairCellsInTransaction(tx, scope, now, limit, leaseMs)
    return work(tx, claim)
  })
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
