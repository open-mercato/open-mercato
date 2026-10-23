import { createHash } from 'crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  InventoryMovement,
  type PutawayTaskStatus,
  type WarehouseLocationType,
} from '../data/entities'

const TERMINAL: ReadonlySet<PutawayTaskStatus> = new Set(['done', 'cancelled'])
const FORBIDDEN_PUTAWAY_TARGET_TYPES: ReadonlySet<WarehouseLocationType> = new Set(['staging', 'dock'])
const PUTAWAY_TASK_STATUSES: ReadonlySet<PutawayTaskStatus> = new Set([
  'open',
  'in_progress',
  'done',
  'cancelled',
])

/**
 * Parse list `status` query: single value or comma-separated (e.g. `open,in_progress`).
 * Returns `$eq` / `$in` filter fragment, or undefined when empty/invalid.
 */
export function buildPutawayTaskStatusFilter(
  statusQuery: string | undefined,
): { $eq: PutawayTaskStatus } | { $in: PutawayTaskStatus[] } | undefined {
  if (typeof statusQuery !== 'string' || statusQuery.trim().length === 0) return undefined
  const statuses = [
    ...new Set(
      statusQuery
        .split(',')
        .map((value) => value.trim())
        .filter((value): value is PutawayTaskStatus =>
          PUTAWAY_TASK_STATUSES.has(value as PutawayTaskStatus),
        ),
    ),
  ]
  if (statuses.length === 0) return undefined
  if (statuses.length === 1) return { $eq: statuses[0]! }
  return { $in: statuses }
}

export function assertPutawayAssignable(status: PutawayTaskStatus): void {
  if (TERMINAL.has(status)) {
    throw new CrudHttpError(409, { error: 'invalid_putaway_state' })
  }
}

export function assertPutawayStartable(status: PutawayTaskStatus): void {
  if (status !== 'open' && status !== 'in_progress') {
    throw new CrudHttpError(409, { error: 'invalid_putaway_state' })
  }
}

export function assertPutawayCompletable(status: PutawayTaskStatus): void {
  if (status !== 'open' && status !== 'in_progress') {
    throw new CrudHttpError(409, { error: 'invalid_putaway_state' })
  }
}

export function assertPutawayCancellable(status: PutawayTaskStatus): void {
  if (TERMINAL.has(status)) {
    throw new CrudHttpError(409, { error: 'invalid_putaway_state' })
  }
}

/**
 * Soft-delete is archival cleanup for cancelled tasks only.
 * Done is permanent history: soft-deleting it would drop the row from the
 * partial unique index (`deleted_at IS NULL`) while leaving `putaway_key`,
 * letting idempotent ASN receive recreate an open putaway for already-moved stock.
 * Cancel first (clears the key); refuse open/in_progress/done delete.
 */
export function assertPutawayDeletable(status: PutawayTaskStatus): void {
  if (status === 'cancelled') return
  if (status === 'done') {
    throw new CrudHttpError(409, { error: 'putaway_delete_done_forbidden' })
  }
  throw new CrudHttpError(409, { error: 'putaway_delete_requires_terminal_status' })
}

/** Reject lifecycle fields on putaway-task CRUD before zod strips them. */
export function assertPutawayLifecycleFieldsForbidden(rawInput: unknown): void {
  if (!rawInput || typeof rawInput !== 'object') return
  const payload = rawInput as Record<string, unknown>
  // Status and assignee changes go through dedicated lifecycle endpoints.
  if ('status' in payload || 'assignedTo' in payload || 'assigned_to' in payload) {
    throw new CrudHttpError(422, { error: 'lifecycle_field_forbidden' })
  }
}

/**
 * Complete authorization: managers may complete any task; operators with
 * `wms.adjust_inventory` may complete only when the task is assigned to them.
 */
export function assertPutawayCompleteAuthorized(input: {
  canManagePutaway: boolean
  canAdjustInventory: boolean
  actorUserId: string | null | undefined
  assignedTo: string | null | undefined
}): void {
  if (input.canManagePutaway) return
  if (
    input.canAdjustInventory
    && typeof input.actorUserId === 'string'
    && input.actorUserId.length > 0
    && input.assignedTo === input.actorUserId
  ) {
    return
  }
  throw new CrudHttpError(403, { error: 'Forbidden' })
}

/** Reject completing with more than the open task quantity. */
export function assertPutawayConfirmedQuantity(
  taskQuantity: number,
  confirmedQuantity: number,
): void {
  if (!(confirmedQuantity > 0) || !Number.isFinite(confirmedQuantity)) {
    throw new CrudHttpError(422, { error: 'invalid_putaway_quantity' })
  }
  if (confirmedQuantity > taskQuantity + 0.000001) {
    throw new CrudHttpError(422, { error: 'putaway_quantity_exceeds_task' })
  }
}

export function putawayResidualQuantity(taskQuantity: number, confirmedQuantity: number): number {
  const residual = taskQuantity - confirmedQuantity
  return residual > 0.000001 ? residual : 0
}

/**
 * Staging floor for new putaway: on-hand minus reserved/allocated minus open
 * and in-progress putaway commitments (optionally excluding one task being updated).
 */
export function computeUncommittedPutawaySourceQuantity(input: {
  quantityOnHand: number
  quantityReserved: number
  quantityAllocated: number
  openPutawayQuantities: number[]
}): number {
  const available =
    input.quantityOnHand - input.quantityReserved - input.quantityAllocated
  const committed = input.openPutawayQuantities.reduce((sum, qty) => sum + qty, 0)
  return available - committed
}

/** True when requested qty fits the uncommitted staging floor (epsilon-tolerant). */
export function hasUncommittedPutawaySourceQuantity(
  remainingAvailable: number,
  requestedQuantity: number,
): boolean {
  return requestedQuantity <= remainingAvailable + 0.000001
}

/**
 * Prefer an open/in_progress peer whose quantity covers the receipt when
 * recreate would oversubscribe staging stock already queued elsewhere.
 */
export function selectCoveringOpenPutawayTask<T extends { quantity: number }>(
  tasks: T[],
  requestedQuantity: number,
): T | null {
  if (!(requestedQuantity > 0.000001) || tasks.length === 0) return null
  let best: T | null = null
  for (const task of tasks) {
    if (task.quantity + 0.000001 < requestedQuantity) continue
    if (!best || task.quantity < best.quantity) best = task
  }
  return best
}

/**
 * Stable movement reference for putaway complete — task id only (not confirmed qty).
 * Retries with the same or different confirmedQuantity must not open a second
 * stock move under a different idempotency signature; quantity conflicts are
 * detected by looking up this reference before moving.
 */
export function buildPutawayCompleteReferenceId(taskId: string): string {
  const hex = createHash('sha256').update(`wms:putaway-complete:${taskId}`).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

export function assertPutawayTargetLocationType(type: WarehouseLocationType): void {
  if (FORBIDDEN_PUTAWAY_TARGET_TYPES.has(type)) {
    throw new CrudHttpError(422, { error: 'invalid_putaway_target_location' })
  }
}

export async function resolveLotIdFromMovement(
  em: EntityManager,
  ctx: CommandRuntimeContext,
  movementId: string,
): Promise<string | null> {
  const tenantId = ctx.auth?.tenantId ?? null
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (!tenantId || !organizationId) return null
  const movement = await findOneWithDecryption(
    em,
    InventoryMovement,
    { id: movementId, deletedAt: null },
    undefined,
    { tenantId, organizationId },
  )
  if (!movement) return null
  const lotRaw = movement.lot ?? null
  if (!lotRaw) return null
  return typeof lotRaw === 'string' ? lotRaw : lotRaw.id
}
