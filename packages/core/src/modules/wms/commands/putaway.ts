import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { JsonValue } from '@open-mercato/shared/lib/json'
import {
  InventoryBalance,
  PutawayTask,
  Warehouse,
  WarehouseLocation,
  type PutawayTaskStatus,
} from '../data/entities'
import {
  putawayTaskAssignSchema,
  putawayTaskCancelSchema,
  putawayTaskCompleteSchema,
  putawayTaskCreateFromBalanceSchema,
  putawayTaskCreateSchema,
  putawayTaskStartSchema,
  putawayTaskUpdateSchema,
  type InventoryMoveInput,
  type PutawayTaskAssignInput,
  type PutawayTaskCancelInput,
  type PutawayTaskCompleteInput,
  type PutawayTaskCreateFromBalanceInput,
  type PutawayTaskCreateInput,
  type PutawayTaskStartInput,
  type PutawayTaskUpdateInput,
} from '../data/validators'
import { emitWmsEvent } from '../events'
import {
  assertPutawayAssignable,
  assertPutawayCancellable,
  computeUncommittedPutawaySourceQuantity,
  hasUncommittedPutawaySourceQuantity,
  assertPutawayCompleteAuthorized,
  assertPutawayCompletable,
  assertPutawayConfirmedQuantity,
  assertPutawayDeletable,
  assertPutawayLifecycleFieldsForbidden,
  assertPutawayStartable,
  assertPutawayTargetLocationType,
  buildPutawayCompleteReferenceId,
  putawayResidualQuantity,
} from '../lib/putaway'
import {
  applyInventoryMoveInTransaction,
  emitInventoryMoveSideEffects,
  findPutawayCompleteMovementByReference,
  type InventoryMoveMutationResult,
} from './inventory-actions'
import {
  ensureOrganizationScope,
  ensureTenantScope,
  putawayTaskCrudEvents,
  putawayTaskCrudIndexer,
  requireId,
  toNumericString,
  WMS_INVENTORY_BALANCE_RESOURCE,
  WMS_PUTAWAY_TASK_RESOURCE,
} from './shared'

type Scope = { tenantId: string; organizationId: string }

type PutawayTaskSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  warehouseId: string
  sourceLocationId: string
  targetLocationId: string | null
  catalogVariantId: string
  lotId: string | null
  quantity: string
  status: PutawayTaskStatus
  assignedTo: string | null
  priority: number
  metadata: JsonValue | null
  createdAt: string
  updatedAt: string
}

function resolveScope(
  ctx: CommandRuntimeContext,
  fallback?: { tenantId?: string | null; organizationId?: string | null },
): Scope {
  const tenantId = fallback?.tenantId ?? ctx.auth?.tenantId ?? null
  const organizationId = fallback?.organizationId ?? ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (!tenantId || !organizationId) {
    throw new CrudHttpError(400, { error: 'Tenant and organization scope are required.' })
  }
  return { tenantId, organizationId }
}

function resolveEm(ctx: CommandRuntimeContext): EntityManager {
  return (ctx.container.resolve('em') as EntityManager).fork()
}

type RbacServiceLike = {
  userHasAllFeatures?: (
    userId: string,
    features: string[],
    scope: { tenantId: string | null; organizationId: string | null },
  ) => Promise<boolean>
}

async function resolvePutawayCompleteAuthorization(
  ctx: CommandRuntimeContext,
  scope: Scope,
  assignedTo: string | null | undefined,
): Promise<void> {
  const actorUserId = typeof ctx.auth?.sub === 'string' ? ctx.auth.sub : null
  let canManagePutaway = false
  let canAdjustInventory = false
  if (actorUserId) {
    try {
      const rbacService = ctx.container.resolve('rbacService') as RbacServiceLike
      if (typeof rbacService.userHasAllFeatures === 'function') {
        ;[canManagePutaway, canAdjustInventory] = await Promise.all([
          rbacService.userHasAllFeatures(actorUserId, ['wms.manage_putaway'], scope),
          rbacService.userHasAllFeatures(actorUserId, ['wms.adjust_inventory'], scope),
        ])
      }
    } catch {
      // Fail closed when rbac is unavailable — do not fall back to raw auth feature tokens.
    }
  }
  assertPutawayCompleteAuthorized({
    canManagePutaway,
    canAdjustInventory,
    actorUserId,
    assignedTo,
  })
}

function toJsonValue(value: Record<string, unknown> | null | undefined): JsonValue | null | undefined {
  if (value === undefined) return undefined
  return (value ?? null) as JsonValue | null
}

function iso(value: Date | string): string {
  if (value instanceof Date) return value.toISOString()
  return new Date(value).toISOString()
}

function snapshotPutawayTask(record: PutawayTask): PutawayTaskSnapshot {
  const warehouseId = typeof record.warehouse === 'string' ? record.warehouse : record.warehouse.id
  return {
    id: record.id,
    organizationId: record.organizationId,
    tenantId: record.tenantId,
    warehouseId,
    sourceLocationId: record.sourceLocationId,
    targetLocationId: record.targetLocationId ?? null,
    catalogVariantId: record.catalogVariantId,
    lotId: record.lotId ?? null,
    quantity: record.quantity,
    status: record.status,
    assignedTo: record.assignedTo ?? null,
    priority: Number(record.priority),
    metadata: (record.metadata ?? null) as JsonValue | null,
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
  }
}

async function loadPutawayTask(
  em: EntityManager,
  ctx: CommandRuntimeContext,
  id: string,
): Promise<PutawayTask> {
  const task = await findOneWithDecryption(
    em,
    PutawayTask,
    { id, deletedAt: null },
    undefined,
    resolveScope(ctx),
  )
  if (!task) throw new CrudHttpError(404, { error: 'Putaway task not found.' })
  ensureTenantScope(ctx, task.tenantId)
  ensureOrganizationScope(ctx, task.organizationId)
  return task
}

/**
 * Load putaway task under PESSIMISTIC_WRITE inside an open TX, then run `fn`.
 * Re-assert lifecycle status inside `fn` after the lock — unlocked read → mutate
 * races with complete under READ COMMITTED (cancel can overwrite `done` and clear
 * putawayKey, letting ASN recreate putaway for already-moved stock).
 */
async function withLockedPutawayTask<T>(
  em: EntityManager,
  ctx: CommandRuntimeContext,
  id: string,
  scope: Scope,
  fn: (task: PutawayTask, trx: EntityManager) => Promise<T>,
): Promise<T> {
  return em.transactional(async (trx) => {
    const task = await findOneWithDecryption(
      trx,
      PutawayTask,
      { id, deletedAt: null },
      { lockMode: LockMode.PESSIMISTIC_WRITE },
      scope,
    )
    if (!task) throw new CrudHttpError(404, { error: 'Putaway task not found.' })
    ensureTenantScope(ctx, task.tenantId)
    ensureOrganizationScope(ctx, task.organizationId)
    await enforceCommandOptimisticLockWithGuards(ctx.container, {
      resourceKind: WMS_PUTAWAY_TASK_RESOURCE,
      resourceId: task.id,
      current: task.updatedAt,
      request: ctx.request ?? null,
    })
    return fn(task, trx)
  })
}

async function requireWarehouse(em: EntityManager, ctx: CommandRuntimeContext, warehouseId: string, scope: Scope) {
  const warehouse = await findOneWithDecryption(
    em,
    Warehouse,
    { id: warehouseId, deletedAt: null },
    undefined,
    scope,
  )
  if (!warehouse) throw new CrudHttpError(404, { error: 'Warehouse not found.' })
  ensureTenantScope(ctx, warehouse.tenantId)
  ensureOrganizationScope(ctx, warehouse.organizationId)
  return warehouse
}

async function requireActiveLocation(
  em: EntityManager,
  ctx: CommandRuntimeContext,
  locationId: string,
  warehouseId: string,
  scope: Scope,
) {
  const location = await findOneWithDecryption(
    em,
    WarehouseLocation,
    { id: locationId, deletedAt: null },
    undefined,
    scope,
  )
  if (!location) throw new CrudHttpError(404, { error: 'Warehouse location not found.' })
  ensureTenantScope(ctx, location.tenantId)
  ensureOrganizationScope(ctx, location.organizationId)
  const locationWarehouseId = typeof location.warehouse === 'string' ? location.warehouse : location.warehouse.id
  if (locationWarehouseId !== warehouseId) {
    throw new CrudHttpError(422, { error: 'invalid_location' })
  }
  if (!location.isActive) {
    throw new CrudHttpError(422, { error: 'inactive_location' })
  }
  return location
}

function toNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

async function requireAvailableBalanceQuantity(
  em: EntityManager,
  ctx: CommandRuntimeContext,
  input: {
    warehouseId: string
    sourceLocationId: string
    catalogVariantId: string
    lotId?: string | null
    quantity: number
  },
  scope: Scope,
  options?: { lock?: boolean; excludeTaskId?: string },
) {
  const balance = await findOneWithDecryption(
    em,
    InventoryBalance,
    {
      warehouse: input.warehouseId,
      location: input.sourceLocationId,
      catalogVariantId: input.catalogVariantId,
      lot: input.lotId ?? null,
      deletedAt: null,
    },
    options?.lock ? { lockMode: LockMode.PESSIMISTIC_WRITE } : undefined,
    scope,
  )
  if (!balance) {
    throw new CrudHttpError(409, { error: 'insufficient_stock' })
  }
  ensureTenantScope(ctx, balance.tenantId)
  ensureOrganizationScope(ctx, balance.organizationId)

  // Subtract open/in-progress putaway commitments so concurrent create-from-balance
  // cannot oversubscribe the same staging bucket (TOCTOU). When updating an
  // existing task, exclude it so its new quantity is compared against peers only.
  const openTasks = await findWithDecryption(
    em,
    PutawayTask,
    {
      warehouse: input.warehouseId,
      sourceLocationId: input.sourceLocationId,
      catalogVariantId: input.catalogVariantId,
      lotId: input.lotId ?? null,
      status: { $in: ['open', 'in_progress'] },
      deletedAt: null,
    },
    undefined,
    scope,
  )
  const remaining = computeUncommittedPutawaySourceQuantity({
    quantityOnHand: toNumber(balance.quantityOnHand),
    quantityReserved: toNumber(balance.quantityReserved),
    quantityAllocated: toNumber(balance.quantityAllocated),
    openPutawayQuantities: openTasks
      .filter((task) => !(options?.excludeTaskId && task.id === options.excludeTaskId))
      .map((task) => toNumber(task.quantity)),
  })
  if (!hasUncommittedPutawaySourceQuantity(remaining, input.quantity)) {
    throw new CrudHttpError(409, { error: 'insufficient_stock' })
  }
  return balance
}

async function emitPutawaySideEffects(
  ctx: CommandRuntimeContext,
  tasks: Array<{ entity: PutawayTask; action: 'created' | 'updated' | 'deleted' }>,
) {
  const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
  for (const entry of tasks) {
    await emitCrudSideEffects({
      dataEngine,
      action: entry.action,
      entity: entry.entity,
      identifiers: {
        id: entry.entity.id,
        organizationId: entry.entity.organizationId,
        tenantId: entry.entity.tenantId,
      },
      events: putawayTaskCrudEvents,
      indexer: putawayTaskCrudIndexer,
    })
  }
}

async function buildCrudLog(
  ctx: CommandRuntimeContext,
  input: { tenantId?: string | null; organizationId?: string | null; id?: string | null } | undefined,
  resultId: string | null,
  actionKey: string,
  fallbackLabel: string,
) {
  const { translate } = await resolveTranslations()
  return {
    actionLabel: translate(actionKey, fallbackLabel),
    resourceKind: WMS_PUTAWAY_TASK_RESOURCE,
    resourceId: resultId ?? input?.id ?? null,
    tenantId: input?.tenantId ?? ctx.auth?.tenantId ?? null,
    organizationId: input?.organizationId ?? ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
  }
}

async function createOpenPutawayTask(
  em: EntityManager,
  ctx: CommandRuntimeContext,
  input: PutawayTaskCreateInput & { putawayKey?: string | null },
): Promise<PutawayTask> {
  const scope = resolveScope(ctx, input)
  await requireWarehouse(em, ctx, input.warehouseId, scope)
  await requireActiveLocation(em, ctx, input.sourceLocationId, input.warehouseId, scope)
  if (input.targetLocationId) {
    await requireActiveLocation(em, ctx, input.targetLocationId, input.warehouseId, scope)
  }
  const task = em.create(PutawayTask, {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    warehouse: em.getReference(Warehouse, input.warehouseId),
    sourceLocationId: input.sourceLocationId,
    targetLocationId: input.targetLocationId ?? null,
    catalogVariantId: input.catalogVariantId,
    lotId: input.lotId ?? null,
    quantity: toNumericString(input.quantity),
    status: 'open',
    assignedTo: input.assignedTo ?? null,
    priority: input.priority ?? 5,
    putawayKey: input.putawayKey ?? null,
    metadata: toJsonValue(input.metadata) ?? null,
  })
  await em.persist(task).flush()
  return task
}

async function ensureResidualPutawayTask(
  em: EntityManager,
  ctx: CommandRuntimeContext,
  input: {
    scope: Scope
    warehouseId: string
    parent: PutawayTask
    residual: number
  },
): Promise<void> {
  const residualKey = `wms:putaway-residual:${input.parent.id}`
  const existing = await findOneWithDecryption(
    em,
    PutawayTask,
    {
      organizationId: input.scope.organizationId,
      tenantId: input.scope.tenantId,
      putawayKey: residualKey,
      deletedAt: null,
      status: { $in: ['open', 'in_progress', 'done'] },
    },
    undefined,
    input.scope,
  )
  if (existing) return
  try {
    await createOpenPutawayTask(em, ctx, {
      organizationId: input.scope.organizationId,
      tenantId: input.scope.tenantId,
      warehouseId: input.warehouseId,
      sourceLocationId: input.parent.sourceLocationId,
      targetLocationId: null,
      catalogVariantId: input.parent.catalogVariantId,
      lotId: input.parent.lotId,
      quantity: input.residual,
      assignedTo: input.parent.assignedTo,
      priority: input.parent.priority,
      putawayKey: residualKey,
      metadata: {
        source: 'putaway_residual',
        parentPutawayTaskId: input.parent.id,
      },
    })
  } catch (error) {
    const code = error && typeof error === 'object' ? (error as { code?: string }).code : undefined
    const name = error && typeof error === 'object' ? (error as { name?: string }).name : undefined
    if (code !== '23505' && name !== 'UniqueConstraintViolationException') throw error
  }
}

const createPutawayTaskCommand: CommandHandler<PutawayTaskCreateInput, { taskId: string }> = {
  id: 'wms.putaway-tasks.create',
  async execute(rawInput, ctx) {
    const input = putawayTaskCreateSchema.parse(rawInput ?? {})
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)
    const em = resolveEm(ctx)
    const scope = resolveScope(ctx, input)
    // Same staging availability floor as create-from-balance: lock balance and
    // subtract open/in_progress putaway commitments before inserting.
    const task = await em.transactional(async (trx) => {
      await requireAvailableBalanceQuantity(
        trx,
        ctx,
        {
          warehouseId: input.warehouseId,
          sourceLocationId: input.sourceLocationId,
          catalogVariantId: input.catalogVariantId,
          lotId: input.lotId,
          quantity: input.quantity,
        },
        scope,
        { lock: true },
      )
      return createOpenPutawayTask(trx, ctx, input)
    })
    await emitPutawaySideEffects(ctx, [{ entity: task, action: 'created' }])
    void emitWmsEvent('wms.putaway.created', {
      id: task.id,
      warehouseId: input.warehouseId,
      sourceLocationId: task.sourceLocationId,
      targetLocationId: task.targetLocationId ?? null,
      catalogVariantId: task.catalogVariantId,
      quantity: task.quantity,
      tenantId: task.tenantId,
      organizationId: task.organizationId,
    }).catch(() => undefined)
    return { taskId: task.id }
  },
  captureAfter: async (_input, result, ctx) => {
    if (!result?.taskId) return null
    const task = await loadPutawayTask(resolveEm(ctx), ctx, result.taskId)
    return snapshotPutawayTask(task)
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<{ after?: PutawayTaskSnapshot | null }>(logEntry)
    const after = payload?.after
    if (!after?.id) return
    const em = resolveEm(ctx)
    const scope = { tenantId: after.tenantId, organizationId: after.organizationId }
    // Only reverse pristine open creates — soft-deleting done frees putaway_key
    // uniqueness while stock already moved; in_progress/cancelled need lifecycle cmds.
    const task = await withLockedPutawayTask(em, ctx, after.id, scope, async (locked, trx) => {
      if (locked.status !== 'open') {
        throw new CrudHttpError(409, { error: 'invalid_putaway_state' })
      }
      locked.deletedAt = new Date()
      await trx.flush()
      return locked
    })
    await emitPutawaySideEffects(ctx, [{ entity: task, action: 'deleted' }])
  },
  buildLog: async ({ snapshots, input, result, ctx }) => {
    const after = snapshots?.after as PutawayTaskSnapshot | undefined
    return {
      ...(await buildCrudLog(ctx, input, result?.taskId ?? null, 'wms.audit.putaway.create', 'Create putaway task')),
      snapshotAfter: after,
      payload: { undo: { after } },
    }
  },
}

const updatePutawayTaskCommand: CommandHandler<PutawayTaskUpdateInput, { taskId: string }> = {
  id: 'wms.putaway-tasks.update',
  async prepare(rawInput, ctx) {
    const id = requireId((rawInput as { id?: string } | null)?.id, 'Putaway task')
    const task = await loadPutawayTask(resolveEm(ctx), ctx, id)
    return { before: snapshotPutawayTask(task) }
  },
  async execute(rawInput, ctx) {
    assertPutawayLifecycleFieldsForbidden(rawInput)
    const input = putawayTaskUpdateSchema.parse(rawInput ?? {})
    const em = resolveEm(ctx)
    const scope = resolveScope(ctx)
    // Same lock + re-assert as lifecycle cmds — unlocked load races with complete
    // and can rewrite quantity/locations/metadata on a done task.
    const task = await withLockedPutawayTask(em, ctx, input.id, scope, async (locked, trx) => {
      if (locked.status === 'done' || locked.status === 'cancelled') {
        throw new CrudHttpError(409, { error: 'invalid_putaway_state' })
      }
      const warehouseId =
        input.warehouseId ??
        (typeof locked.warehouse === 'string' ? locked.warehouse : locked.warehouse.id)
      const taskScope = resolveScope(ctx, {
        tenantId: locked.tenantId,
        organizationId: locked.organizationId,
      })
      if (input.warehouseId) {
        await requireWarehouse(trx, ctx, input.warehouseId, taskScope)
        locked.warehouse = trx.getReference(Warehouse, input.warehouseId)
      }
      if (input.sourceLocationId) {
        await requireActiveLocation(trx, ctx, input.sourceLocationId, warehouseId, taskScope)
        locked.sourceLocationId = input.sourceLocationId
      }
      if (input.targetLocationId !== undefined) {
        if (input.targetLocationId) {
          await requireActiveLocation(trx, ctx, input.targetLocationId, warehouseId, taskScope)
        }
        locked.targetLocationId = input.targetLocationId
      }
      if (input.catalogVariantId !== undefined) locked.catalogVariantId = input.catalogVariantId
      if (input.lotId !== undefined) locked.lotId = input.lotId
      if (input.quantity !== undefined) {
        const nextQty = Number(input.quantity)
        const sourceLocationId = input.sourceLocationId ?? locked.sourceLocationId
        const catalogVariantId = input.catalogVariantId ?? locked.catalogVariantId
        const lotId = input.lotId !== undefined ? input.lotId : locked.lotId
        // Raising qty must not oversubscribe staging vs peer open/in_progress tasks.
        if (nextQty > toNumber(locked.quantity) + 0.000001) {
          await requireAvailableBalanceQuantity(
            trx,
            ctx,
            {
              warehouseId,
              sourceLocationId,
              catalogVariantId,
              lotId,
              quantity: nextQty,
            },
            taskScope,
            { lock: true, excludeTaskId: locked.id },
          )
        }
        locked.quantity = toNumericString(input.quantity)
      }
      if (input.priority !== undefined) locked.priority = input.priority
      if (input.metadata !== undefined) locked.metadata = toJsonValue(input.metadata) ?? null
      await trx.flush()
      return locked
    })
    await emitPutawaySideEffects(ctx, [{ entity: task, action: 'updated' }])
    return { taskId: task.id }
  },
  captureAfter: async (_input, result, ctx) => {
    if (!result?.taskId) return null
    const task = await loadPutawayTask(resolveEm(ctx), ctx, result.taskId)
    return snapshotPutawayTask(task)
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<{ before?: PutawayTaskSnapshot | null }>(logEntry)
    const before = payload?.before
    if (!before?.id) return
    const em = resolveEm(ctx)
    const scope = { tenantId: before.tenantId, organizationId: before.organizationId }
    // Lock + re-assert: refuse reopening done/cancelled (movement already posted).
    const task = await withLockedPutawayTask(em, ctx, before.id, scope, async (locked, trx) => {
      if (locked.status === 'done' || locked.status === 'cancelled') {
        throw new CrudHttpError(409, { error: 'invalid_putaway_state' })
      }
      if (before.status === 'done' || before.status === 'cancelled') {
        throw new CrudHttpError(409, { error: 'invalid_putaway_state' })
      }
      locked.warehouse = trx.getReference(Warehouse, before.warehouseId)
      locked.sourceLocationId = before.sourceLocationId
      locked.targetLocationId = before.targetLocationId
      locked.catalogVariantId = before.catalogVariantId
      locked.lotId = before.lotId
      locked.quantity = before.quantity
      locked.status = before.status
      locked.assignedTo = before.assignedTo
      locked.priority = before.priority
      locked.metadata = before.metadata
      locked.deletedAt = null
      await trx.flush()
      return locked
    })
    await emitPutawaySideEffects(ctx, [{ entity: task, action: 'updated' }])
  },
  buildLog: async ({ snapshots, input, result, ctx }) => {
    const before = snapshots?.before as PutawayTaskSnapshot | undefined
    const after = snapshots?.after as PutawayTaskSnapshot | undefined
    return {
      ...(await buildCrudLog(ctx, input, result?.taskId ?? null, 'wms.audit.putaway.update', 'Update putaway task')),
      snapshotBefore: before,
      snapshotAfter: after,
      payload: { undo: { before, after } },
    }
  },
}

const deletePutawayTaskCommand: CommandHandler<{ id: string }, { taskId: string }> = {
  id: 'wms.putaway-tasks.delete',
  async prepare(rawInput, ctx) {
    const id = requireId((rawInput as { id?: string } | null)?.id, 'Putaway task')
    const task = await loadPutawayTask(resolveEm(ctx), ctx, id)
    return { before: snapshotPutawayTask(task) }
  },
  async execute(rawInput, ctx) {
    const id = requireId((rawInput as { id?: string } | null)?.id, 'Putaway task')
    const em = resolveEm(ctx)
    const scope = resolveScope(ctx)
    const task = await withLockedPutawayTask(em, ctx, id, scope, async (locked, trx) => {
      // Re-assert after lock — only cancelled is deletable. Done is permanent
      // history (soft-delete would free putaway_key uniqueness and allow ASN
      // receive to recreate an open putaway for already-moved stock).
      assertPutawayDeletable(locked.status)
      locked.deletedAt = new Date()
      await trx.flush()
      return locked
    })
    await emitPutawaySideEffects(ctx, [{ entity: task, action: 'deleted' }])
    return { taskId: task.id }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<{ before?: PutawayTaskSnapshot | null }>(logEntry)
    const before = payload?.before
    if (!before?.id) return
    const em = resolveEm(ctx)
    const scope = { tenantId: before.tenantId, organizationId: before.organizationId }
    // Soft-deleted rows are excluded from withLockedPutawayTask; lock the
    // deleted row directly and re-assert cancelled before undelete.
    const task = await em.transactional(async (trx) => {
      const locked = await findOneWithDecryption(
        trx,
        PutawayTask,
        { id: before.id },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
        scope,
      )
      if (!locked) return null
      ensureTenantScope(ctx, locked.tenantId)
      ensureOrganizationScope(ctx, locked.organizationId)
      // Only cancelled tasks may be soft-deleted; refuse undelete if status drifted.
      if (locked.status !== 'cancelled') {
        throw new CrudHttpError(409, { error: 'invalid_putaway_state' })
      }
      if (!locked.deletedAt) return locked
      locked.deletedAt = null
      await trx.flush()
      return locked
    })
    if (!task) return
    await emitPutawaySideEffects(ctx, [{ entity: task, action: 'updated' }])
  },
  buildLog: async ({ snapshots, input, result, ctx }) => {
    const before = snapshots?.before as PutawayTaskSnapshot | undefined
    return {
      ...(await buildCrudLog(ctx, input, result?.taskId ?? null, 'wms.audit.putaway.delete', 'Delete putaway task')),
      snapshotBefore: before,
      payload: { undo: { before } },
    }
  },
}

const createPutawayTaskFromBalanceCommand: CommandHandler<
  PutawayTaskCreateFromBalanceInput,
  { taskId: string }
> = {
  id: 'wms.putaway-tasks.create-from-balance',
  async execute(rawInput, ctx) {
    const input = putawayTaskCreateFromBalanceSchema.parse(rawInput ?? {})
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)
    const em = resolveEm(ctx)
    const scope = resolveScope(ctx, input)
    // One TX: lock balance row, re-check available minus open putaway commitments,
    // then create — closes the TOCTOU oversubscribe window.
    const task = await em.transactional(async (trx) => {
      await requireAvailableBalanceQuantity(
        trx,
        ctx,
        {
          warehouseId: input.warehouseId,
          sourceLocationId: input.sourceLocationId,
          catalogVariantId: input.catalogVariantId,
          lotId: input.lotId,
          quantity: input.quantity,
        },
        scope,
        { lock: true },
      )
      return createOpenPutawayTask(trx, ctx, {
        organizationId: input.organizationId,
        tenantId: input.tenantId,
        warehouseId: input.warehouseId,
        sourceLocationId: input.sourceLocationId,
        targetLocationId: input.targetLocationId,
        catalogVariantId: input.catalogVariantId,
        lotId: input.lotId,
        quantity: input.quantity,
        priority: input.priority,
        assignedTo: input.assignedTo,
        metadata: {
          ...(input.metadata ?? {}),
          source: 'create_from_balance',
        },
      })
    })
    await emitPutawaySideEffects(ctx, [{ entity: task, action: 'created' }])
    void emitWmsEvent('wms.putaway.created', {
      id: task.id,
      warehouseId: input.warehouseId,
      sourceLocationId: task.sourceLocationId,
      targetLocationId: task.targetLocationId ?? null,
      catalogVariantId: task.catalogVariantId,
      quantity: task.quantity,
      tenantId: task.tenantId,
      organizationId: task.organizationId,
    }).catch(() => undefined)
    return { taskId: task.id }
  },
  buildLog: async ({ input, result, ctx }) =>
    buildCrudLog(
      ctx,
      input,
      result?.taskId ?? null,
      'wms.audit.putaway.createFromBalance',
      'Create putaway task from balance',
    ),
}

const assignPutawayTaskCommand: CommandHandler<PutawayTaskAssignInput, { taskId: string }> = {
  id: 'wms.putaway-tasks.assign',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const input = putawayTaskAssignSchema.parse(rawInput ?? {})
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)
    const em = resolveEm(ctx)
    const scope = resolveScope(ctx, input)
    const task = await withLockedPutawayTask(em, ctx, input.id, scope, async (locked, trx) => {
      assertPutawayAssignable(locked.status)
      locked.assignedTo = input.assignedTo
      await trx.flush()
      return locked
    })
    await emitPutawaySideEffects(ctx, [{ entity: task, action: 'updated' }])
    void emitWmsEvent('wms.putaway.assigned', {
      id: task.id,
      assignedTo: task.assignedTo,
      tenantId: task.tenantId,
      organizationId: task.organizationId,
    }).catch(() => undefined)
    return { taskId: task.id }
  },
  buildLog: async ({ input, result, ctx }) =>
    buildCrudLog(ctx, input, result?.taskId ?? null, 'wms.audit.putaway.assign', 'Assign putaway task'),
}

const startPutawayTaskCommand: CommandHandler<PutawayTaskStartInput, { taskId: string }> = {
  id: 'wms.putaway-tasks.start',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const input = putawayTaskStartSchema.parse(rawInput ?? {})
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)
    const em = resolveEm(ctx)
    const scope = resolveScope(ctx, input)
    const task = await withLockedPutawayTask(em, ctx, input.id, scope, async (locked, trx) => {
      assertPutawayStartable(locked.status)
      locked.status = 'in_progress'
      await trx.flush()
      return locked
    })
    await emitPutawaySideEffects(ctx, [{ entity: task, action: 'updated' }])
    void emitWmsEvent('wms.putaway.started', {
      id: task.id,
      tenantId: task.tenantId,
      organizationId: task.organizationId,
    }).catch(() => undefined)
    return { taskId: task.id }
  },
  buildLog: async ({ input, result, ctx }) =>
    buildCrudLog(ctx, input, result?.taskId ?? null, 'wms.audit.putaway.start', 'Start putaway task'),
}

const completePutawayTaskCommand: CommandHandler<
  PutawayTaskCompleteInput,
  { taskId: string; movementId: string }
> = {
  id: 'wms.putaway-tasks.complete',
  // Stock-affecting — align with Phase 1 inventory undo policy.
  isUndoable: false,
  async execute(rawInput, ctx) {
    const input = putawayTaskCompleteSchema.parse(rawInput ?? {})
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)
    const rootEm = resolveEm(ctx)
    const scope = resolveScope(ctx, input)
    const referenceId = buildPutawayCompleteReferenceId(input.id)

    type CompleteOutcome = {
      task: PutawayTask
      warehouseId: string
      taskQuantity: number
      moveResult: InventoryMoveMutationResult
      residual: number
      alreadyDone: boolean
      /** False when movement already existed and only status was finalized (retry-safe). */
      emitCompletedEvent: boolean
    }

    // One TX holds PESSIMISTIC_WRITE on the putaway task through move + status
    // update — nested unlocked commandBus move cannot share that lock.
    const outcome = await rootEm.transactional(async (trx): Promise<CompleteOutcome> => {
      const task = await findOneWithDecryption(
        trx,
        PutawayTask,
        { id: input.id, deletedAt: null },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
        scope,
      )
      if (!task) throw new CrudHttpError(404, { error: 'Putaway task not found.' })
      ensureTenantScope(ctx, task.tenantId)
      ensureOrganizationScope(ctx, task.organizationId)
      await resolvePutawayCompleteAuthorization(ctx, scope, task.assignedTo)
      await enforceCommandOptimisticLockWithGuards(ctx.container, {
        resourceKind: WMS_PUTAWAY_TASK_RESOURCE,
        resourceId: task.id,
        current: task.updatedAt,
        request: ctx.request ?? null,
      })

      const warehouseId = typeof task.warehouse === 'string' ? task.warehouse : task.warehouse.id
      const taskQuantity = toNumber(task.quantity)
      const existingByRef = await findPutawayCompleteMovementByReference(trx, scope, referenceId)

      if (task.status === 'done') {
        if (!existingByRef) {
          throw new CrudHttpError(409, { error: 'invalid_putaway_state' })
        }
        const existingQty = toNumber(existingByRef.quantity)
        if (Math.abs(existingQty - input.confirmedQuantity) > 0.000001) {
          throw new CrudHttpError(409, { error: 'putaway_complete_quantity_conflict' })
        }
        return {
          task,
          warehouseId,
          taskQuantity,
          moveResult: {
            movementId: existingByRef.id,
            warehouseId,
            catalogVariantId: task.catalogVariantId,
            quantity: existingQty,
            tenantId: scope.tenantId,
            organizationId: scope.organizationId,
            movementEntity: existingByRef,
            balances: [],
            idempotentReplay: true,
          },
          residual: 0,
          alreadyDone: true,
          emitCompletedEvent: false,
        }
      }

      assertPutawayCompletable(task.status)
      assertPutawayConfirmedQuantity(taskQuantity, input.confirmedQuantity)

      if (existingByRef) {
        const existingQty = toNumber(existingByRef.quantity)
        if (Math.abs(existingQty - input.confirmedQuantity) > 0.000001) {
          // Move already posted for this task with a different qty — refuse silent
          // double-move under a qty-dependent idempotency key.
          throw new CrudHttpError(409, { error: 'putaway_complete_quantity_conflict' })
        }
        // Move succeeded previously; finish status update on this retry.
        // Suppress wms.putaway.completed — movement already existed; only status is finalized.
        task.targetLocationId = input.targetLocationId
        task.status = 'done'
        task.quantity = toNumericString(input.confirmedQuantity)
        if (input.lotId) task.lotId = input.lotId
        await trx.flush()
        const residual = putawayResidualQuantity(taskQuantity, input.confirmedQuantity)
        if (residual > 0) {
          await ensureResidualPutawayTask(trx, ctx, {
            scope,
            warehouseId,
            parent: task,
            residual,
          })
        }
        return {
          task,
          warehouseId,
          taskQuantity,
          moveResult: {
            movementId: existingByRef.id,
            warehouseId,
            catalogVariantId: task.catalogVariantId,
            quantity: existingQty,
            tenantId: scope.tenantId,
            organizationId: scope.organizationId,
            movementEntity: existingByRef,
            balances: [],
            idempotentReplay: true,
          },
          residual,
          alreadyDone: false,
          emitCompletedEvent: false,
        }
      }

      await requireActiveLocation(trx, ctx, task.sourceLocationId, warehouseId, scope)
      const targetLocation = await requireActiveLocation(
        trx,
        ctx,
        input.targetLocationId,
        warehouseId,
        scope,
      )
      assertPutawayTargetLocationType(targetLocation.type)

      const moveInput: InventoryMoveInput = {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        warehouseId,
        fromLocationId: task.sourceLocationId,
        toLocationId: input.targetLocationId,
        catalogVariantId: task.catalogVariantId,
        lotId: input.lotId ?? task.lotId ?? undefined,
        quantity: input.confirmedQuantity,
        type: 'putaway',
        reason: input.reason ?? 'Putaway task completion',
        referenceType: 'manual',
        referenceId,
        performedBy: input.performedBy,
        performedAt: input.performedAt,
        metadata: {
          ...(input.metadata ?? {}),
          putawayTaskId: task.id,
          source: 'putaway_task_complete',
        },
      }
      const moveResult = await applyInventoryMoveInTransaction(trx, ctx, moveInput)

      task.targetLocationId = input.targetLocationId
      task.status = 'done'
      task.quantity = toNumericString(input.confirmedQuantity)
      if (input.lotId) task.lotId = input.lotId
      await trx.flush()

      const residual = putawayResidualQuantity(taskQuantity, input.confirmedQuantity)
      if (residual > 0) {
        await ensureResidualPutawayTask(trx, ctx, {
          scope,
          warehouseId,
          parent: task,
          residual,
        })
      }

      return {
        task,
        warehouseId,
        taskQuantity,
        moveResult,
        residual,
        alreadyDone: false,
        emitCompletedEvent: true,
      }
    })

    if (!outcome.alreadyDone) {
      await emitPutawaySideEffects(ctx, [{ entity: outcome.task, action: 'updated' }])
    }
    await emitInventoryMoveSideEffects(ctx, outcome.moveResult)

    if (outcome.emitCompletedEvent) {
      void emitWmsEvent('wms.putaway.completed', {
        id: outcome.task.id,
        movementId: outcome.moveResult.movementId,
        warehouseId: outcome.warehouseId,
        sourceLocationId: outcome.task.sourceLocationId,
        targetLocationId: outcome.task.targetLocationId,
        catalogVariantId: outcome.task.catalogVariantId,
        quantity: toNumericString(input.confirmedQuantity),
        tenantId: outcome.task.tenantId,
        organizationId: outcome.task.organizationId,
      }).catch(() => undefined)
    }

    return { taskId: outcome.task.id, movementId: outcome.moveResult.movementId }
  },
  buildLog: async ({ input, result, ctx }) => ({
    ...(await buildCrudLog(
      ctx,
      input,
      result?.taskId ?? null,
      'wms.audit.putaway.complete',
      'Complete putaway task',
    )),
    context: { cacheAliases: [WMS_INVENTORY_BALANCE_RESOURCE, WMS_PUTAWAY_TASK_RESOURCE] },
  }),
}

const cancelPutawayTaskCommand: CommandHandler<PutawayTaskCancelInput, { taskId: string }> = {
  id: 'wms.putaway-tasks.cancel',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const input = putawayTaskCancelSchema.parse(rawInput ?? {})
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)
    const em = resolveEm(ctx)
    const scope = resolveScope(ctx, input)
    const task = await withLockedPutawayTask(em, ctx, input.id, scope, async (locked, trx) => {
      // Re-assert after PESSIMISTIC_WRITE — concurrent complete may have set `done`.
      assertPutawayCancellable(locked.status)
      locked.status = 'cancelled'
      // Free the unique putaway_key so ASN receive can recreate for the same attempt
      // without unique violation / stranded staging stock.
      locked.putawayKey = null
      await trx.flush()
      return locked
    })
    await emitPutawaySideEffects(ctx, [{ entity: task, action: 'updated' }])
    void emitWmsEvent('wms.putaway.cancelled', {
      id: task.id,
      tenantId: task.tenantId,
      organizationId: task.organizationId,
    }).catch(() => undefined)
    return { taskId: task.id }
  },
  buildLog: async ({ input, result, ctx }) =>
    buildCrudLog(ctx, input, result?.taskId ?? null, 'wms.audit.putaway.cancel', 'Cancel putaway task'),
}

registerCommand(createPutawayTaskCommand)
registerCommand(updatePutawayTaskCommand)
registerCommand(deletePutawayTaskCommand)
registerCommand(createPutawayTaskFromBalanceCommand)
registerCommand(assignPutawayTaskCommand)
registerCommand(startPutawayTaskCommand)
registerCommand(completePutawayTaskCommand)
registerCommand(cancelPutawayTaskCommand)
