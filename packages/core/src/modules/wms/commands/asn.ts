import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
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
  Asn,
  InventoryBalance,
  PutawayTask,
  ReceivingLine,
  Warehouse,
  WarehouseLocation,
  type AsnStatus,
  type ReceivingLineQcStatus,
} from '../data/entities'
import { requireVendorIfPresent as requireVendorIfPresentLookup } from '../lib/asnVendor'
import {
  asnCloseSchema,
  asnCreateSchema,
  asnReceiveLineSchema,
  asnUpdateSchema,
  receivingLineCreateSchema,
  receivingLineUpdateSchema,
  type AsnCloseInput,
  type AsnCreateInput,
  type AsnReceiveLineInput,
  type AsnUpdateInput,
  type InventoryReceiveInput,
  type ReceivingLineCreateInput,
  type ReceivingLineUpdateInput,
} from '../data/validators'
import { emitWmsEvent } from '../events'
import {
  assertAsnQcTransition,
  assertReceivingLineLifecycleFieldsForbidden,
  buildAsnReceivePutawayKey,
  buildAsnReceiveReferenceId,
  hasAsnDeleteBlockingLineActivity,
  isAsnCloseable,
  resolveAsnReceiveAttempt,
  resolvePutawayQuantityForAlreadyAtTargetRetry,
  shouldEnsurePutawayOnAlreadyAtTarget,
  shouldRecreatePutawayOnAlreadyAtTarget,
  shouldWriteStockOnQcPass,
} from '../lib/asnReceiving'
import {
  computeUncommittedPutawaySourceQuantity,
  selectCoveringOpenPutawayTask,
} from '../lib/putaway'
import {
  applyInventoryReceiveInTransaction,
  emitInventoryReceiveSideEffects,
  type InventoryReceiveMutationResult,
} from './inventory-actions'
import {
  asnCrudEvents,
  asnCrudIndexer,
  ensureOrganizationScope,
  ensureTenantScope,
  normalizeOptionalString,
  putawayTaskCrudEvents,
  putawayTaskCrudIndexer,
  receivingLineCrudEvents,
  receivingLineCrudIndexer,
  requireId,
  toNumericString,
  WMS_ASN_RESOURCE,
  WMS_INVENTORY_BALANCE_RESOURCE,
  WMS_RECEIVING_LINE_RESOURCE,
} from './shared'

type Scope = { tenantId: string; organizationId: string }

type AsnSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  warehouseId: string
  vendorId: string | null
  status: AsnStatus
  expectedAt: string
  referenceNumber: string | null
  notes: string | null
  metadata: JsonValue | null
  createdAt: string
  updatedAt: string
}

type ReceivingLineSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  asnId: string
  catalogVariantId: string
  expectedQty: string
  receivedQty: string
  lotNumber: string | null
  serialNumbers: string[] | null
  qcStatus: ReceivingLineQcStatus
  targetStagingLocationId: string | null
  rejectionReason: string | null
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

function toNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function toJsonValue(value: Record<string, unknown> | null | undefined): JsonValue | null | undefined {
  if (value === undefined) return undefined
  return (value ?? null) as JsonValue | null
}

function iso(value: Date | string): string {
  if (value instanceof Date) return value.toISOString()
  return new Date(value).toISOString()
}

function snapshotAsn(record: Asn): AsnSnapshot {
  const warehouseId = typeof record.warehouse === 'string' ? record.warehouse : record.warehouse.id
  return {
    id: record.id,
    organizationId: record.organizationId,
    tenantId: record.tenantId,
    warehouseId,
    vendorId: record.vendorId ?? null,
    status: record.status,
    expectedAt: iso(record.expectedAt),
    referenceNumber: record.referenceNumber ?? null,
    notes: record.notes ?? null,
    metadata: (record.metadata ?? null) as JsonValue | null,
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
  }
}

function snapshotReceivingLine(record: ReceivingLine): ReceivingLineSnapshot {
  const asnId = typeof record.asn === 'string' ? record.asn : record.asn.id
  return {
    id: record.id,
    organizationId: record.organizationId,
    tenantId: record.tenantId,
    asnId,
    catalogVariantId: record.catalogVariantId,
    expectedQty: record.expectedQty,
    receivedQty: record.receivedQty,
    lotNumber: record.lotNumber ?? null,
    serialNumbers: Array.isArray(record.serialNumbers) ? [...record.serialNumbers] : null,
    qcStatus: record.qcStatus,
    targetStagingLocationId: record.targetStagingLocationId ?? null,
    rejectionReason: record.rejectionReason ?? null,
    metadata: (record.metadata ?? null) as JsonValue | null,
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
  }
}

async function loadAsn(em: EntityManager, ctx: CommandRuntimeContext, id: string): Promise<Asn> {
  const asn = await findOneWithDecryption(em, Asn, { id, deletedAt: null }, undefined, resolveScope(ctx))
  if (!asn) throw new CrudHttpError(404, { error: 'ASN not found.' })
  ensureTenantScope(ctx, asn.tenantId)
  ensureOrganizationScope(ctx, asn.organizationId)
  return asn
}

/**
 * Load ASN under PESSIMISTIC_WRITE inside an open TX, then run `fn`.
 * Same serialization as receive-line: activity re-check + header mutate /
 * soft-delete must hold the ASN row lock so concurrent receive cannot commit
 * receipt/QC after the check but before flush under READ COMMITTED.
 */
async function withLockedAsn<T>(
  em: EntityManager,
  ctx: CommandRuntimeContext,
  id: string,
  scope: Scope,
  fn: (asn: Asn, trx: EntityManager) => Promise<T>,
): Promise<T> {
  return em.transactional(async (trx) => {
    const asn = await findOneWithDecryption(
      trx,
      Asn,
      { id, deletedAt: null },
      { lockMode: LockMode.PESSIMISTIC_WRITE },
      scope,
    )
    if (!asn) throw new CrudHttpError(404, { error: 'ASN not found.' })
    ensureTenantScope(ctx, asn.tenantId)
    ensureOrganizationScope(ctx, asn.organizationId)
    return fn(asn, trx)
  })
}

/**
 * Lock ASN then receiving line (same order as receive / update / delete execute),
 * then run `fn`. Used by receiving-line create/update/delete undo so concurrent
 * receive cannot post receipt/QC between an unlocked activity check and flush.
 * Returns null when the line is missing (or soft-deleted when `requireActiveLine`).
 */
async function withLockedAsnReceivingLine<T>(
  em: EntityManager,
  ctx: CommandRuntimeContext,
  lineId: string,
  scope: Scope,
  options: { requireActiveLine: boolean },
  fn: (args: { asn: Asn; line: ReceivingLine; trx: EntityManager }) => Promise<T>,
): Promise<T | null> {
  return em.transactional(async (trx) => {
    const unlocked = await findOneWithDecryption(trx, ReceivingLine, { id: lineId }, undefined, scope)
    if (!unlocked) return null
    if (options.requireActiveLine && unlocked.deletedAt) return null
    ensureTenantScope(ctx, unlocked.tenantId)
    ensureOrganizationScope(ctx, unlocked.organizationId)
    const asnId = typeof unlocked.asn === 'string' ? unlocked.asn : unlocked.asn.id

    const asn = await findOneWithDecryption(
      trx,
      Asn,
      { id: asnId, deletedAt: null },
      { lockMode: LockMode.PESSIMISTIC_WRITE },
      scope,
    )
    if (!asn) throw new CrudHttpError(404, { error: 'ASN not found.' })
    ensureTenantScope(ctx, asn.tenantId)
    ensureOrganizationScope(ctx, asn.organizationId)

    const locked = await findOneWithDecryption(
      trx,
      ReceivingLine,
      { id: lineId },
      { lockMode: LockMode.PESSIMISTIC_WRITE },
      scope,
    )
    if (!locked) return null
    if (options.requireActiveLine && locked.deletedAt) return null
    ensureTenantScope(ctx, locked.tenantId)
    ensureOrganizationScope(ctx, locked.organizationId)
    return fn({ asn, line: locked, trx })
  })
}

async function loadReceivingLine(
  em: EntityManager,
  ctx: CommandRuntimeContext,
  id: string,
): Promise<ReceivingLine> {
  const line = await findOneWithDecryption(
    em,
    ReceivingLine,
    { id, deletedAt: null },
    undefined,
    resolveScope(ctx),
  )
  if (!line) throw new CrudHttpError(404, { error: 'Receiving line not found.' })
  ensureTenantScope(ctx, line.tenantId)
  ensureOrganizationScope(ctx, line.organizationId)
  return line
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

async function requireStagingLocation(
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
  if (location.type !== 'staging' && location.type !== 'dock') {
    throw new CrudHttpError(422, { error: 'invalid_staging_location' })
  }
  if (!location.isActive) {
    throw new CrudHttpError(422, { error: 'inactive_location' })
  }
  return location
}

async function requireVendorIfPresent(
  ctx: CommandRuntimeContext,
  vendorId: string | null | undefined,
  scope: Scope,
) {
  await requireVendorIfPresentLookup(ctx.container, vendorId, scope)
}

function isUniqueConstraintError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const code = (error as { code?: string }).code
  if (code === '23505') return true
  const name = (error as { name?: string }).name
  return name === 'UniqueConstraintViolationException'
}

async function findExistingPutawayForReceipt(
  em: EntityManager,
  scope: Scope,
  putawayKey: string,
): Promise<PutawayTask | null> {
  return findOneWithDecryption(
    em,
    PutawayTask,
    {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      putawayKey,
      deletedAt: null,
      status: { $in: ['open', 'in_progress', 'done'] },
    },
    undefined,
    scope,
  )
}

/** Cancel nulls putaway_key; recover qty/lot via metadata.putawayKey (not a capped scan). */
async function findCancelledPutawayForReceipt(
  em: EntityManager,
  scope: Scope,
  putawayKey: string,
): Promise<PutawayTask | null> {
  const rows = await em.getConnection().execute<Array<{ id: string }>>(
    `select id
     from wms_putaway_tasks
     where organization_id = ?
       and tenant_id = ?
       and deleted_at is null
       and status = 'cancelled'
       and metadata->>'putawayKey' = ?
     order by updated_at desc
     limit 1`,
    [scope.organizationId, scope.tenantId, putawayKey],
  )
  const id = rows[0]?.id
  if (!id) return null
  return findOneWithDecryption(
    em,
    PutawayTask,
    { id, deletedAt: null, status: 'cancelled' },
    undefined,
    scope,
  )
}

/**
 * Staging floor for already-at-target putaway recreate: on-hand minus
 * reserved/allocated minus open/in_progress putaway commitments. Returns null
 * when there is no balance row (nothing left to put away).
 */
async function resolveUncommittedStagingPutawayQuantity(
  em: EntityManager,
  scope: Scope,
  input: {
    warehouseId: string
    sourceLocationId: string
    catalogVariantId: string
    lotId: string | null
  },
): Promise<{ remaining: number; openTasks: PutawayTask[] } | null> {
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
    undefined,
    scope,
  )
  if (!balance) return null
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
  return {
    remaining: computeUncommittedPutawaySourceQuantity({
      quantityOnHand: toNumber(balance.quantityOnHand),
      quantityReserved: toNumber(balance.quantityReserved),
      quantityAllocated: toNumber(balance.quantityAllocated),
      openPutawayQuantities: openTasks.map((task) => toNumber(task.quantity)),
    }),
    openTasks,
  }
}

async function findOrCreatePutawayForReceipt(
  em: EntityManager,
  scope: Scope,
  putawayKey: string,
  input: {
    warehouseId: string
    sourceLocationId: string
    catalogVariantId: string
    lotId: string | null
    quantity: number
    asnId: string
    lineId: string
    metadata?: Record<string, unknown> | null
  },
): Promise<{ task: PutawayTask; created: boolean }> {
  const existing = await findExistingPutawayForReceipt(em, scope, putawayKey)
  if (existing) return { task: existing, created: false }
  const task = em.create(PutawayTask, {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    warehouse: em.getReference(Warehouse, input.warehouseId),
    sourceLocationId: input.sourceLocationId,
    targetLocationId: null,
    catalogVariantId: input.catalogVariantId,
    lotId: input.lotId,
    quantity: toNumericString(input.quantity),
    status: 'open',
    assignedTo: null,
    priority: 5,
    putawayKey,
    metadata: {
      ...(input.metadata ?? {}),
      asnId: input.asnId,
      receivingLineId: input.lineId,
      putawayKey,
      source: 'asn_receive',
    } as JsonValue,
  })
  try {
    await em.persist(task).flush()
    return { task, created: true }
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error
    const raced = await findExistingPutawayForReceipt(em, scope, putawayKey)
    if (raced) return { task: raced, created: false }
    throw error
  }
}

async function emitAsnReceivePutawayCreatedSideEffects(
  ctx: CommandRuntimeContext,
  scope: Scope,
  putaway: PutawayTask,
  warehouseId: string,
): Promise<void> {
  let de: DataEngine | null = null
  try {
    de = ctx.container.resolve('dataEngine') as DataEngine
  } catch {
    de = null
  }
  if (de) {
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'created',
      entity: putaway,
      identifiers: {
        id: putaway.id,
        organizationId: putaway.organizationId,
        tenantId: putaway.tenantId,
      },
      indexer: putawayTaskCrudIndexer,
      events: putawayTaskCrudEvents,
    })
  }
  void emitWmsEvent('wms.putaway.created', {
    id: putaway.id,
    warehouseId,
    sourceLocationId: putaway.sourceLocationId,
    targetLocationId: putaway.targetLocationId ?? null,
    catalogVariantId: putaway.catalogVariantId,
    quantity: putaway.quantity,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  }).catch(() => undefined)
}

async function buildCrudLog(
  ctx: CommandRuntimeContext,
  input: { tenantId?: string | null; organizationId?: string | null; id?: string | null } | undefined,
  resultId: string | null,
  actionKey: string,
  fallbackLabel: string,
  resourceKind: string,
) {
  const { translate } = await resolveTranslations()
  return {
    actionLabel: translate(actionKey, fallbackLabel),
    resourceKind,
    resourceId: resultId ?? input?.id ?? null,
    tenantId: input?.tenantId ?? ctx.auth?.tenantId ?? null,
    organizationId: input?.organizationId ?? ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
  }
}

function assertAsnMutable(asn: Asn) {
  if (asn.status === 'closed' || asn.status === 'received') {
    throw new CrudHttpError(409, { error: 'invalid_receipt_state' })
  }
}

/** Open/in-progress putaway linked to this ASN via metadata.asnId (ASN receive path). */
async function hasOpenPutawayForAsn(
  em: EntityManager,
  scope: Scope,
  asnId: string,
): Promise<boolean> {
  const rows = await em.getConnection().execute<Array<{ hit: number }>>(
    `select 1 as hit
     from wms_putaway_tasks
     where organization_id = ?
       and tenant_id = ?
       and deleted_at is null
       and status in ('open', 'in_progress')
       and metadata->>'asnId' = ?
     limit 1`,
    [scope.organizationId, scope.tenantId, asnId],
  )
  return rows.length > 0
}

function resolveSerialNumbers(input: AsnReceiveLineInput): string[] {
  if (!input.serialNumbers?.length) return []
  return input.serialNumbers.map((value) => value.trim()).filter((value) => value.length > 0)
}

async function emitAsnSideEffects(
  ctx: CommandRuntimeContext,
  affected: {
    asns?: Array<{ entity: Asn; action: 'created' | 'updated' | 'deleted' }>
    lines?: Array<{ entity: ReceivingLine; action: 'created' | 'updated' | 'deleted' }>
  },
) {
  let de: DataEngine | null = null
  try {
    de = ctx.container.resolve('dataEngine') as DataEngine
  } catch {
    de = null
  }
  if (!de) return
  for (const { entity, action } of affected.asns ?? []) {
    await emitCrudSideEffects({
      dataEngine: de,
      action,
      entity,
      identifiers: {
        id: entity.id,
        organizationId: entity.organizationId,
        tenantId: entity.tenantId,
      },
      indexer: asnCrudIndexer,
      events: asnCrudEvents,
    })
  }
  for (const { entity, action } of affected.lines ?? []) {
    await emitCrudSideEffects({
      dataEngine: de,
      action,
      entity,
      identifiers: {
        id: entity.id,
        organizationId: entity.organizationId,
        tenantId: entity.tenantId,
      },
      indexer: receivingLineCrudIndexer,
      events: receivingLineCrudEvents,
    })
  }
}

const createAsnCommand: CommandHandler<AsnCreateInput, { asnId: string; lineIds: string[] }> = {
  id: 'wms.asns.create',
  async execute(rawInput, ctx) {
    const input = asnCreateSchema.parse(rawInput ?? {})
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)
    const em = resolveEm(ctx)
    const scope = resolveScope(ctx, input)
    await requireWarehouse(em, ctx, input.warehouseId, scope)
    await requireVendorIfPresent(ctx, input.vendorId, scope)
    // Terminal received/closed are rejected by asnWritableStatusSchema at parse time.
    const status = input.status ?? 'draft'

    const createdLines: ReceivingLine[] = []
    let asn!: Asn
    await withAtomicFlush(
      em,
      [
        () => {
          asn = em.create(Asn, {
            organizationId: scope.organizationId,
            tenantId: scope.tenantId,
            warehouse: em.getReference(Warehouse, input.warehouseId),
            vendorId: input.vendorId ?? null,
            status,
            expectedAt: input.expectedAt,
            referenceNumber: normalizeOptionalString(input.referenceNumber ?? undefined),
            // sourceKey is server/system-only (auth null). Authenticated HTTP creates ignore it.
            sourceKey:
              ctx.auth == null
                ? normalizeOptionalString(input.sourceKey ?? undefined)
                : null,
            notes: normalizeOptionalString(input.notes ?? undefined),
            metadata: toJsonValue(input.metadata ?? null) ?? null,
          })
          em.persist(asn)
        },
        () => {
          for (const lineInput of input.lines ?? []) {
            const line = em.create(ReceivingLine, {
              organizationId: scope.organizationId,
              tenantId: scope.tenantId,
              asn,
              catalogVariantId: lineInput.catalogVariantId,
              expectedQty: toNumericString(lineInput.expectedQty),
              receivedQty: '0',
              lotNumber: normalizeOptionalString(lineInput.lotNumber ?? undefined),
              serialNumbers: lineInput.serialNumbers ?? null,
              qcStatus: 'pending',
              targetStagingLocationId: lineInput.targetStagingLocationId ?? null,
              metadata: toJsonValue(lineInput.metadata ?? null) ?? null,
            })
            em.persist(line)
            createdLines.push(line)
          }
        },
      ],
      { transaction: true, label: 'wms.asns.create' },
    )

    await emitAsnSideEffects(ctx, {
      asns: [{ entity: asn, action: 'created' }],
      lines: createdLines.map((entity) => ({ entity, action: 'created' as const })),
    })

    void emitWmsEvent('wms.asn.created', {
      id: asn.id,
      warehouseId: input.warehouseId,
      vendorId: input.vendorId ?? null,
      status: asn.status,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }).catch(() => undefined)

    return { asnId: asn.id, lineIds: createdLines.map((line) => line.id) }
  },
  captureAfter: async (_input, result, ctx) => {
    if (!result?.asnId) return null
    const em = resolveEm(ctx)
    const asn = await loadAsn(em, ctx, result.asnId)
    return snapshotAsn(asn)
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<{
      after?: AsnSnapshot | null
      lineIds?: string[] | null
    }>(logEntry)
    const after = payload?.after
    if (!after?.id) return
    const em = resolveEm(ctx)
    const scope = { tenantId: after.tenantId, organizationId: after.organizationId }
    // Idempotent when already soft-deleted (unlocked probe); lock only the active path.
    const existing = await findOneWithDecryption(em, Asn, { id: after.id }, undefined, scope)
    if (!existing || existing.deletedAt) return
    // Hold ASN row lock through activity re-check + soft-delete (same race as delete execute).
    const locked = await withLockedAsn(em, ctx, after.id, scope, async (asn, trx) => {
      // Refuse soft-delete undo after receipt/complete (same floor as delete execute).
      assertAsnMutable(asn)
      const lineIds = Array.isArray(payload?.lineIds) ? payload.lineIds : []
      const lines =
        lineIds.length > 0
          ? await findWithDecryption(
              trx,
              ReceivingLine,
              { id: { $in: lineIds }, asn: asn.id, deletedAt: null },
              undefined,
              scope,
            )
          : await findWithDecryption(
              trx,
              ReceivingLine,
              { asn: asn.id, deletedAt: null },
              undefined,
              scope,
            )
      if (hasAsnDeleteBlockingLineActivity(lines)) {
        throw new CrudHttpError(409, { error: 'invalid_receipt_state' })
      }
      const deletedAt = new Date()
      asn.deletedAt = deletedAt
      for (const line of lines) {
        line.deletedAt = deletedAt
      }
      await trx.flush()
      return { asn, lines }
    })
    await emitAsnSideEffects(ctx, {
      asns: [{ entity: locked.asn, action: 'deleted' }],
      lines: locked.lines.map((entity) => ({ entity, action: 'deleted' as const })),
    })
  },
  buildLog: async ({ input, result, ctx, snapshots }) => {
    const base = await buildCrudLog(
      ctx,
      input,
      result?.asnId ?? null,
      'wms.audit.asn.create',
      'Create ASN',
      WMS_ASN_RESOURCE,
    )
    const after = snapshots?.after as AsnSnapshot | undefined
    return {
      ...base,
      snapshotAfter: after,
      payload: { undo: { after, lineIds: result?.lineIds ?? [] } },
    }
  },
}

const updateAsnCommand: CommandHandler<AsnUpdateInput, { asnId: string }> = {
  id: 'wms.asns.update',
  async prepare(rawInput, ctx) {
    const id = requireId((rawInput as { id?: string } | null)?.id, 'ASN')
    const em = resolveEm(ctx)
    const asn = await loadAsn(em, ctx, id)
    // Same floor as receive / line CRUD / delete — received/closed headers are immutable.
    assertAsnMutable(asn)
    return { before: snapshotAsn(asn) }
  },
  async execute(rawInput, ctx) {
    const input = asnUpdateSchema.parse(rawInput ?? {})
    ensureTenantScope(ctx, input.tenantId ?? ctx.auth?.tenantId ?? '')
    if (input.organizationId) ensureOrganizationScope(ctx, input.organizationId)
    const em = resolveEm(ctx)
    // Lock ASN through activity re-check + header mutate so concurrent receive-line
    // cannot post receipt/QC after the check but before flush.
    const asn = await withLockedAsn(em, ctx, input.id, resolveScope(ctx), async (asn, trx) => {
      // Refuse received/closed before any field write so PUT cannot demote status or
      // move warehouseId after stock/lines have been posted.
      assertAsnMutable(asn)
      await enforceCommandOptimisticLockWithGuards(ctx.container, {
        resourceKind: WMS_ASN_RESOURCE,
        resourceId: asn.id,
        current: asn.updatedAt,
        request: ctx.request ?? null,
      })
      const scope = resolveScope(ctx, {
        tenantId: asn.tenantId,
        organizationId: asn.organizationId,
      })
      // Same floor as delete: after any line receipt/QC, refuse header edits
      // (warehouseId would desync staged stock / later receives).
      const lines = await findWithDecryption(
        trx,
        ReceivingLine,
        { asn: asn.id, deletedAt: null },
        undefined,
        scope,
      )
      if (hasAsnDeleteBlockingLineActivity(lines)) {
        throw new CrudHttpError(409, { error: 'invalid_receipt_state' })
      }
      if (input.warehouseId) {
        await requireWarehouse(trx, ctx, input.warehouseId, scope)
        asn.warehouse = trx.getReference(Warehouse, input.warehouseId)
      }
      if (input.vendorId !== undefined) {
        await requireVendorIfPresent(ctx, input.vendorId, scope)
        asn.vendorId = input.vendorId
      }
      if (input.status !== undefined) {
        // Terminal received/closed are rejected by asnWritableStatusSchema at parse time.
        asn.status = input.status
      }
      if (input.expectedAt !== undefined) asn.expectedAt = input.expectedAt
      if (input.referenceNumber !== undefined) {
        asn.referenceNumber = normalizeOptionalString(input.referenceNumber ?? undefined)
      }
      if (input.notes !== undefined) asn.notes = normalizeOptionalString(input.notes ?? undefined)
      if (input.metadata !== undefined) asn.metadata = toJsonValue(input.metadata) ?? null
      await trx.flush()
      return asn
    })
    await emitAsnSideEffects(ctx, { asns: [{ entity: asn, action: 'updated' }] })
    void emitWmsEvent('wms.asn.updated', {
      id: asn.id,
      status: asn.status,
      tenantId: asn.tenantId,
      organizationId: asn.organizationId,
    }).catch(() => undefined)
    return { asnId: asn.id }
  },
  captureAfter: async (_input, result, ctx) => {
    if (!result?.asnId) return null
    const em = resolveEm(ctx)
    const asn = await loadAsn(em, ctx, result.asnId)
    return snapshotAsn(asn)
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<{ before?: AsnSnapshot | null }>(logEntry)
    const before = payload?.before
    if (!before?.id) return
    const em = resolveEm(ctx)
    const scope = { tenantId: before.tenantId, organizationId: before.organizationId }
    // Hold ASN row lock through activity re-check + snapshot restore (same race as execute).
    const asn = await withLockedAsn(em, ctx, before.id, scope, async (asn, trx) => {
      // Refuse restoring header snapshot after receipt/complete — would demote
      // received/closed → draft/in_transit and/or rewrite warehouseId past stock.
      assertAsnMutable(asn)
      const lines = await findWithDecryption(
        trx,
        ReceivingLine,
        { asn: asn.id, deletedAt: null },
        undefined,
        scope,
      )
      if (hasAsnDeleteBlockingLineActivity(lines)) {
        throw new CrudHttpError(409, { error: 'invalid_receipt_state' })
      }
      asn.warehouse = trx.getReference(Warehouse, before.warehouseId)
      asn.vendorId = before.vendorId
      asn.status = before.status
      asn.expectedAt = new Date(before.expectedAt)
      asn.referenceNumber = before.referenceNumber
      asn.notes = before.notes
      asn.metadata = before.metadata
      asn.deletedAt = null
      await trx.flush()
      return asn
    })
    await emitAsnSideEffects(ctx, { asns: [{ entity: asn, action: 'updated' }] })
  },
  buildLog: async ({ input, result, ctx, snapshots }) => {
    const base = await buildCrudLog(
      ctx,
      input,
      result?.asnId ?? null,
      'wms.audit.asn.update',
      'Update ASN',
      WMS_ASN_RESOURCE,
    )
    const before = snapshots?.before as AsnSnapshot | undefined
    const after = snapshots?.after as AsnSnapshot | undefined
    return {
      ...base,
      snapshotBefore: before,
      snapshotAfter: after,
      payload: { undo: { before, after } },
    }
  },
}

const deleteAsnCommand: CommandHandler<{ id: string }, { asnId: string }> = {
  id: 'wms.asns.delete',
  async prepare(rawInput, ctx) {
    const id = requireId((rawInput as { id?: string } | null)?.id, 'ASN')
    const em = resolveEm(ctx)
    const asn = await loadAsn(em, ctx, id)
    const lines = await findWithDecryption(
      em,
      ReceivingLine,
      { asn: asn.id, deletedAt: null },
      undefined,
      { tenantId: asn.tenantId, organizationId: asn.organizationId },
    )
    return {
      before: snapshotAsn(asn),
      lineIds: lines.map((line) => line.id),
    }
  },
  async execute(rawInput, ctx) {
    const id = requireId((rawInput as { id?: string } | null)?.id, 'ASN')
    const em = resolveEm(ctx)
    // Lock ASN through activity/putaway re-check + soft-delete so concurrent
    // receive-line cannot stage stock after the check but before flush.
    const locked = await withLockedAsn(em, ctx, id, resolveScope(ctx), async (asn, trx) => {
      assertAsnMutable(asn)
      await enforceCommandOptimisticLockWithGuards(ctx.container, {
        resourceKind: WMS_ASN_RESOURCE,
        resourceId: asn.id,
        current: asn.updatedAt,
        request: ctx.request ?? null,
      })
      const scope = { tenantId: asn.tenantId, organizationId: asn.organizationId }
      // Re-query active lines under the ASN lock (create also locks ASN) so a line
      // inserted after prepare cannot remain active on a soft-deleted ASN.
      const lines = await findWithDecryption(
        trx,
        ReceivingLine,
        { asn: asn.id, deletedAt: null },
        undefined,
        scope,
      )
      // Refuse when any line has receipt/QC activity (same floor as receiving-line delete)
      // so soft-delete cannot free source_key while staging stock/movements remain.
      if (hasAsnDeleteBlockingLineActivity(lines)) {
        throw new CrudHttpError(409, { error: 'invalid_receipt_state' })
      }
      if (await hasOpenPutawayForAsn(trx, scope, asn.id)) {
        throw new CrudHttpError(409, { error: 'asn_has_open_putaway' })
      }
      const deletedAt = new Date()
      asn.deletedAt = deletedAt
      for (const line of lines) {
        line.deletedAt = deletedAt
      }
      await trx.flush()
      return { asn, lines }
    })
    await emitAsnSideEffects(ctx, {
      asns: [{ entity: locked.asn, action: 'deleted' }],
      lines: locked.lines.map((entity) => ({ entity, action: 'deleted' as const })),
    })
    return { asnId: locked.asn.id }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<{
      before?: AsnSnapshot | null
      lineIds?: string[] | null
    }>(logEntry)
    const before = payload?.before
    if (!before?.id) return
    const em = resolveEm(ctx)
    const scope = { tenantId: before.tenantId, organizationId: before.organizationId }
    const asn = await findOneWithDecryption(em, Asn, { id: before.id }, undefined, scope)
    if (!asn) return
    // Soft-delete frees (organization_id, source_key); procurement may create a
    // replacement. Refuse undelete when another active ASN already holds the key.
    const sourceKey = normalizeOptionalString(asn.sourceKey ?? undefined)
    if (sourceKey) {
      const clash = await findOneWithDecryption(
        em,
        Asn,
        {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          sourceKey,
          deletedAt: null,
          id: { $ne: asn.id },
        },
        undefined,
        scope,
      )
      if (clash) {
        throw new CrudHttpError(409, { error: 'asn_source_key_conflict' })
      }
    }
    asn.deletedAt = null
    const lineIds = Array.isArray(payload?.lineIds) ? payload.lineIds : []
    const restoredLines: ReceivingLine[] = []
    if (lineIds.length > 0) {
      const lines = await findWithDecryption(
        em,
        ReceivingLine,
        { id: { $in: lineIds }, asn: asn.id },
        undefined,
        scope,
      )
      for (const line of lines) {
        line.deletedAt = null
        restoredLines.push(line)
      }
    }
    try {
      await em.flush()
    } catch (error) {
      if (sourceKey && isUniqueConstraintError(error)) {
        throw new CrudHttpError(409, { error: 'asn_source_key_conflict' })
      }
      throw error
    }
    await emitAsnSideEffects(ctx, {
      asns: [{ entity: asn, action: 'updated' }],
      lines: restoredLines.map((entity) => ({ entity, action: 'updated' as const })),
    })
  },
  buildLog: async ({ input, result, ctx, snapshots }) => {
    const base = await buildCrudLog(
      ctx,
      input as { id?: string },
      result?.asnId ?? null,
      'wms.audit.asn.delete',
      'Delete ASN',
      WMS_ASN_RESOURCE,
    )
    const before = snapshots?.before as AsnSnapshot | undefined
    const lineIds = (snapshots as { lineIds?: string[] } | undefined)?.lineIds
    return {
      ...base,
      snapshotBefore: before,
      payload: { undo: { before, lineIds: lineIds ?? [] } },
    }
  },
}

const createReceivingLineCommand: CommandHandler<ReceivingLineCreateInput, { lineId: string }> = {
  id: 'wms.receiving-lines.create',
  async execute(rawInput, ctx) {
    const input = receivingLineCreateSchema.parse(rawInput ?? {})
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)
    const em = resolveEm(ctx)
    // Hold ASN row lock through mutable assert + insert so concurrent ASN delete
    // cannot soft-delete the header after an unlocked snapshot and leave an orphan line.
    const line = await withLockedAsn(em, ctx, input.asnId, resolveScope(ctx, input), async (asn, trx) => {
      assertAsnMutable(asn)
      const created = trx.create(ReceivingLine, {
        organizationId: asn.organizationId,
        tenantId: asn.tenantId,
        asn,
        catalogVariantId: input.catalogVariantId,
        expectedQty: toNumericString(input.expectedQty),
        receivedQty: '0',
        lotNumber: normalizeOptionalString(input.lotNumber ?? undefined),
        serialNumbers: input.serialNumbers ?? null,
        qcStatus: 'pending',
        targetStagingLocationId: input.targetStagingLocationId ?? null,
        metadata: toJsonValue(input.metadata ?? null) ?? null,
      })
      trx.persist(created)
      await trx.flush()
      return created
    })
    await emitAsnSideEffects(ctx, { lines: [{ entity: line, action: 'created' }] })
    return { lineId: line.id }
  },
  captureAfter: async (_input, result, ctx) => {
    if (!result?.lineId) return null
    const em = resolveEm(ctx)
    const line = await loadReceivingLine(em, ctx, result.lineId)
    return snapshotReceivingLine(line)
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<{ after?: ReceivingLineSnapshot | null }>(logEntry)
    const after = payload?.after
    if (!after?.id) return
    const em = resolveEm(ctx)
    const scope = { tenantId: after.tenantId, organizationId: after.organizationId }
    // Lock ASN then line (same order as delete execute) and re-check activity
    // under the locks so concurrent receive cannot post stock then lose the line.
    const line = await withLockedAsnReceivingLine(
      em,
      ctx,
      after.id,
      scope,
      { requireActiveLine: true },
      async ({ asn, line, trx }) => {
        assertAsnMutable(asn)
        // Same floor as line delete — refuse soft-delete after receipt/QC.
        if (hasAsnDeleteBlockingLineActivity([line])) {
          throw new CrudHttpError(409, { error: 'invalid_receipt_state' })
        }
        line.deletedAt = new Date()
        await trx.flush()
        return line
      },
    )
    if (!line) return
    await emitAsnSideEffects(ctx, { lines: [{ entity: line, action: 'deleted' }] })
  },
  buildLog: async ({ input, result, ctx, snapshots }) => {
    const base = await buildCrudLog(
      ctx,
      input,
      result?.lineId ?? null,
      'wms.audit.receivingLine.create',
      'Create receiving line',
      WMS_RECEIVING_LINE_RESOURCE,
    )
    const after = snapshots?.after as ReceivingLineSnapshot | undefined
    return { ...base, snapshotAfter: after, payload: { undo: { after } } }
  },
}

const updateReceivingLineCommand: CommandHandler<ReceivingLineUpdateInput, { lineId: string }> = {
  id: 'wms.receiving-lines.update',
  async prepare(rawInput, ctx) {
    const id = requireId((rawInput as { id?: string } | null)?.id, 'Receiving line')
    const em = resolveEm(ctx)
    const line = await loadReceivingLine(em, ctx, id)
    return { before: snapshotReceivingLine(line) }
  },
  async execute(rawInput, ctx) {
    assertReceivingLineLifecycleFieldsForbidden(rawInput)
    const input = receivingLineUpdateSchema.parse(rawInput ?? {})
    const rootEm = resolveEm(ctx)

    // Lock ASN then line (same order as receive) and re-check activity under
    // the locks so concurrent receive cannot post stock while we rewrite variant/qty/staging.
    const line = await rootEm.transactional(async (trx) => {
      const unlocked = await findOneWithDecryption(
        trx,
        ReceivingLine,
        { id: input.id, deletedAt: null },
        undefined,
        resolveScope(ctx),
      )
      if (!unlocked) throw new CrudHttpError(404, { error: 'Receiving line not found.' })
      ensureTenantScope(ctx, unlocked.tenantId)
      ensureOrganizationScope(ctx, unlocked.organizationId)
      const asnId = typeof unlocked.asn === 'string' ? unlocked.asn : unlocked.asn.id
      const scope = { tenantId: unlocked.tenantId, organizationId: unlocked.organizationId }

      const asn = await findOneWithDecryption(
        trx,
        Asn,
        { id: asnId, deletedAt: null },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
        scope,
      )
      if (!asn) throw new CrudHttpError(404, { error: 'ASN not found.' })
      ensureTenantScope(ctx, asn.tenantId)
      ensureOrganizationScope(ctx, asn.organizationId)
      assertAsnMutable(asn)

      const locked = await findOneWithDecryption(
        trx,
        ReceivingLine,
        { id: input.id, deletedAt: null },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
        scope,
      )
      if (!locked) throw new CrudHttpError(404, { error: 'Receiving line not found.' })
      ensureTenantScope(ctx, locked.tenantId)
      ensureOrganizationScope(ctx, locked.organizationId)
      await enforceCommandOptimisticLockWithGuards(ctx.container, {
        resourceKind: WMS_RECEIVING_LINE_RESOURCE,
        resourceId: locked.id,
        current: locked.updatedAt,
        request: ctx.request ?? null,
      })
      // Same floor as receiving-line delete — refuse mutating lines after receipt/QC.
      if (hasAsnDeleteBlockingLineActivity([locked])) {
        throw new CrudHttpError(409, { error: 'invalid_receipt_state' })
      }
      if (input.catalogVariantId !== undefined) locked.catalogVariantId = input.catalogVariantId
      if (input.expectedQty !== undefined) locked.expectedQty = toNumericString(input.expectedQty)
      if (input.lotNumber !== undefined) {
        locked.lotNumber = normalizeOptionalString(input.lotNumber ?? undefined)
      }
      if (input.serialNumbers !== undefined) locked.serialNumbers = input.serialNumbers
      if (input.targetStagingLocationId !== undefined) {
        locked.targetStagingLocationId = input.targetStagingLocationId
      }
      if (input.metadata !== undefined) locked.metadata = toJsonValue(input.metadata) ?? null
      await trx.flush()
      return locked
    })

    await emitAsnSideEffects(ctx, { lines: [{ entity: line, action: 'updated' }] })
    return { lineId: line.id }
  },
  captureAfter: async (_input, result, ctx) => {
    if (!result?.lineId) return null
    const em = resolveEm(ctx)
    const line = await loadReceivingLine(em, ctx, result.lineId)
    return snapshotReceivingLine(line)
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<{ before?: ReceivingLineSnapshot | null }>(logEntry)
    const before = payload?.before
    if (!before?.id) return
    const em = resolveEm(ctx)
    const scope = { tenantId: before.tenantId, organizationId: before.organizationId }
    // Lock ASN then line (same order as execute/receive) and re-check activity
    // under the locks so concurrent receive cannot commit then undo demote qty/QC.
    const line = await withLockedAsnReceivingLine(
      em,
      ctx,
      before.id,
      scope,
      { requireActiveLine: false },
      async ({ asn, line, trx }) => {
        assertAsnMutable(asn)
        // Refuse restoring snapshot that would clear receipt/QC while stock remains
        // (same floor as receiving-line delete).
        if (hasAsnDeleteBlockingLineActivity([line])) {
          throw new CrudHttpError(409, { error: 'invalid_receipt_state' })
        }
        if (hasAsnDeleteBlockingLineActivity([before])) {
          throw new CrudHttpError(409, { error: 'invalid_receipt_state' })
        }
        line.catalogVariantId = before.catalogVariantId
        line.expectedQty = before.expectedQty
        line.receivedQty = before.receivedQty
        line.lotNumber = before.lotNumber
        line.serialNumbers = before.serialNumbers
        line.qcStatus = before.qcStatus
        line.targetStagingLocationId = before.targetStagingLocationId
        line.rejectionReason = before.rejectionReason
        line.metadata = before.metadata
        line.deletedAt = null
        await trx.flush()
        return line
      },
    )
    if (!line) return
    await emitAsnSideEffects(ctx, { lines: [{ entity: line, action: 'updated' }] })
  },
  buildLog: async ({ input, result, ctx, snapshots }) => {
    const base = await buildCrudLog(
      ctx,
      input,
      result?.lineId ?? null,
      'wms.audit.receivingLine.update',
      'Update receiving line',
      WMS_RECEIVING_LINE_RESOURCE,
    )
    const before = snapshots?.before as ReceivingLineSnapshot | undefined
    const after = snapshots?.after as ReceivingLineSnapshot | undefined
    return {
      ...base,
      snapshotBefore: before,
      snapshotAfter: after,
      payload: { undo: { before, after } },
    }
  },
}

const deleteReceivingLineCommand: CommandHandler<{ id: string }, { lineId: string }> = {
  id: 'wms.receiving-lines.delete',
  async prepare(rawInput, ctx) {
    const id = requireId((rawInput as { id?: string } | null)?.id, 'Receiving line')
    const em = resolveEm(ctx)
    const line = await loadReceivingLine(em, ctx, id)
    return { before: snapshotReceivingLine(line) }
  },
  async execute(rawInput, ctx) {
    const id = requireId((rawInput as { id?: string } | null)?.id, 'Receiving line')
    const rootEm = resolveEm(ctx)

    // Lock ASN then line (same order as update/receive) and re-check activity under
    // the locks so concurrent QC-pass cannot post stock between the guard and flush.
    const line = await rootEm.transactional(async (trx) => {
      const unlocked = await findOneWithDecryption(
        trx,
        ReceivingLine,
        { id, deletedAt: null },
        undefined,
        resolveScope(ctx),
      )
      if (!unlocked) throw new CrudHttpError(404, { error: 'Receiving line not found.' })
      ensureTenantScope(ctx, unlocked.tenantId)
      ensureOrganizationScope(ctx, unlocked.organizationId)
      const asnId = typeof unlocked.asn === 'string' ? unlocked.asn : unlocked.asn.id
      const scope = { tenantId: unlocked.tenantId, organizationId: unlocked.organizationId }

      const asn = await findOneWithDecryption(
        trx,
        Asn,
        { id: asnId, deletedAt: null },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
        scope,
      )
      if (!asn) throw new CrudHttpError(404, { error: 'ASN not found.' })
      ensureTenantScope(ctx, asn.tenantId)
      ensureOrganizationScope(ctx, asn.organizationId)
      assertAsnMutable(asn)

      const locked = await findOneWithDecryption(
        trx,
        ReceivingLine,
        { id, deletedAt: null },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
        scope,
      )
      if (!locked) throw new CrudHttpError(404, { error: 'Receiving line not found.' })
      ensureTenantScope(ctx, locked.tenantId)
      ensureOrganizationScope(ctx, locked.organizationId)
      await enforceCommandOptimisticLockWithGuards(ctx.container, {
        resourceKind: WMS_RECEIVING_LINE_RESOURCE,
        resourceId: locked.id,
        current: locked.updatedAt,
        request: ctx.request ?? null,
      })
      if (hasAsnDeleteBlockingLineActivity([locked])) {
        throw new CrudHttpError(409, { error: 'invalid_receipt_state' })
      }
      locked.deletedAt = new Date()
      await trx.flush()
      return locked
    })

    await emitAsnSideEffects(ctx, { lines: [{ entity: line, action: 'deleted' }] })
    return { lineId: line.id }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<{ before?: ReceivingLineSnapshot | null }>(logEntry)
    const before = payload?.before
    if (!before?.id) return
    const em = resolveEm(ctx)
    const scope = { tenantId: before.tenantId, organizationId: before.organizationId }
    // Lock ASN then line (same order as execute/create undo) through mutability
    // + undelete so concurrent ASN receive/complete cannot race undelete.
    const line = await withLockedAsnReceivingLine(
      em,
      ctx,
      before.id,
      scope,
      { requireActiveLine: false },
      async ({ asn, line, trx }) => {
        assertAsnMutable(asn)
        // Refuse undeleting onto a line that somehow gained receipt/QC activity.
        if (hasAsnDeleteBlockingLineActivity([line])) {
          throw new CrudHttpError(409, { error: 'invalid_receipt_state' })
        }
        if (hasAsnDeleteBlockingLineActivity([before])) {
          throw new CrudHttpError(409, { error: 'invalid_receipt_state' })
        }
        line.deletedAt = null
        await trx.flush()
        return line
      },
    )
    if (!line) return
    await emitAsnSideEffects(ctx, { lines: [{ entity: line, action: 'updated' }] })
  },
  buildLog: async ({ input, result, ctx, snapshots }) => {
    const base = await buildCrudLog(
      ctx,
      input as { id?: string },
      result?.lineId ?? null,
      'wms.audit.receivingLine.delete',
      'Delete receiving line',
      WMS_RECEIVING_LINE_RESOURCE,
    )
    const before = snapshots?.before as ReceivingLineSnapshot | undefined
    return { ...base, snapshotBefore: before, payload: { undo: { before } } }
  },
}

type ReceiveAsnLineResult = {
  movementIds: string[]
  putawayTaskIds: string[]
  lineId: string
  asnId: string
  receivedQty: number
  asnUpdatedAt: string
}

const receiveAsnLineCommand: CommandHandler<AsnReceiveLineInput, ReceiveAsnLineResult> = {
  id: 'wms.asns.receive-line',
  // Stock-affecting on QC pass — align with Phase 1 inventory undo policy.
  isUndoable: false,
  async execute(rawInput, ctx) {
    const input = asnReceiveLineSchema.parse(rawInput ?? {})
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)
    const rootEm = resolveEm(ctx)
    const scope = resolveScope(ctx, input)
    const serialNumbers = resolveSerialNumbers(input)

    // QC-fail: audit-only path (no stock). Still serialize on ASN/line row locks.
    if (!shouldWriteStockOnQcPass(input.qcStatus)) {
      const locked = await rootEm.transactional(async (trx) => {
        const asn = await findOneWithDecryption(
          trx,
          Asn,
          { id: input.asnId, deletedAt: null },
          { lockMode: LockMode.PESSIMISTIC_WRITE },
          scope,
        )
        if (!asn) throw new CrudHttpError(404, { error: 'ASN not found.' })
        ensureTenantScope(ctx, asn.tenantId)
        ensureOrganizationScope(ctx, asn.organizationId)
        assertAsnMutable(asn)
        await enforceCommandOptimisticLockWithGuards(ctx.container, {
          resourceKind: WMS_ASN_RESOURCE,
          resourceId: asn.id,
          current: asn.updatedAt,
          request: ctx.request ?? null,
        })

        const line = await findOneWithDecryption(
          trx,
          ReceivingLine,
          { id: input.lineId, deletedAt: null },
          { lockMode: LockMode.PESSIMISTIC_WRITE },
          scope,
        )
        if (!line) throw new CrudHttpError(404, { error: 'Receiving line not found.' })
        ensureTenantScope(ctx, line.tenantId)
        ensureOrganizationScope(ctx, line.organizationId)

        const lineAsnId = typeof line.asn === 'string' ? line.asn : line.asn.id
        if (lineAsnId !== asn.id) {
          throw new CrudHttpError(422, { error: 'line_asn_mismatch' })
        }
        assertAsnQcTransition(line.qcStatus, input.qcStatus)

        const priorReceivedQty = toNumber(line.receivedQty)
        const attempt = resolveAsnReceiveAttempt({
          lineId: line.id,
          priorReceivedQty,
          receivedQty: input.receivedQty,
          targetReceivedQty: input.targetReceivedQty,
          idempotencyKey: input.idempotencyKey,
        })
        const warehouseId = typeof asn.warehouse === 'string' ? asn.warehouse : asn.warehouse.id
        const previousStatus = asn.status
        const receivingStarted = asn.status === 'draft' || asn.status === 'in_transit'
        let lineUpdated = false
        if (attempt.applyQty > 0.000001 && priorReceivedQty === toNumber(line.receivedQty)) {
          line.receivedQty = toNumericString(attempt.targetReceivedQty)
          line.qcStatus = 'failed'
          line.rejectionReason =
            normalizeOptionalString(input.rejectionReason) ?? line.rejectionReason ?? null
          if (input.lotNumber !== undefined) {
            line.lotNumber = normalizeOptionalString(input.lotNumber) ?? line.lotNumber ?? null
          }
          if (serialNumbers.length) line.serialNumbers = serialNumbers
          if (asn.status === 'draft') asn.status = 'in_transit'
          // Bump ASN version only with the successful line write (not before).
          asn.updatedAt = new Date()
          line.updatedAt = new Date()
          await trx.flush()
          lineUpdated = true
        }
        return {
          asn,
          line,
          warehouseId,
          previousStatus,
          receivingStarted,
          lineUpdated,
        }
      })

      if (locked.lineUpdated) {
        await emitAsnSideEffects(ctx, {
          asns: [{ entity: locked.asn, action: 'updated' }],
          lines: [{ entity: locked.line, action: 'updated' }],
        })
      }
      if (locked.lineUpdated && locked.receivingStarted && locked.previousStatus === 'draft') {
        void emitWmsEvent('wms.asn.receiving_started', {
          id: locked.asn.id,
          warehouseId: locked.warehouseId,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
        }).catch(() => undefined)
      }
      // Identical absolute-target retry is a no-op (lineUpdated=false); do not re-emit.
      if (locked.lineUpdated) {
        void emitWmsEvent('wms.inventory.receipt_qc_failed', {
          id: locked.line.id,
          asnId: locked.asn.id,
          lineId: locked.line.id,
          catalogVariantId: locked.line.catalogVariantId,
          receivedQty: toNumericString(input.receivedQty),
          rejectionReason: locked.line.rejectionReason,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
        }).catch(() => undefined)
      }
      return {
        movementIds: [],
        putawayTaskIds: [],
        lineId: locked.line.id,
        asnId: locked.asn.id,
        receivedQty: toNumber(locked.line.receivedQty),
        asnUpdatedAt: locked.asn.updatedAt.toISOString(),
      }
    }

    // QC-pass: one transactional boundary holds ASN/line pessimistic locks through
    // inventory receive + line qty + putaway create. Nested commandBus receives
    // cannot share that TX; inlined applyInventoryReceiveInTransaction does.
    // Concurrent overlapping receives therefore cannot both observe prior=0 and
    // both post stock — the second waits on the row lock and then sees advanced
    // receivedQty (applyQty=0) or a higher absolute target.
    if (!input.targetStagingLocationId) {
      throw new CrudHttpError(422, { error: 'staging_location_required' })
    }

    type QcPassOutcome = {
      movementResults: InventoryReceiveMutationResult[]
      putaway: PutawayTask | null
      putawayCreated: boolean
      lineUpdated: boolean
      asn: Asn
      line: ReceivingLine
      warehouseId: string
      previousStatus: AsnStatus
      receivingStarted: boolean
      applyQty: number
      alreadyAtTarget: boolean
      existingPutawayId: string | null
      currentReceivedQty: number
    }

    const outcome = await rootEm.transactional(async (trx): Promise<QcPassOutcome> => {
      const asn = await findOneWithDecryption(
        trx,
        Asn,
        { id: input.asnId, deletedAt: null },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
        scope,
      )
      if (!asn) throw new CrudHttpError(404, { error: 'ASN not found.' })
      ensureTenantScope(ctx, asn.tenantId)
      ensureOrganizationScope(ctx, asn.organizationId)
      assertAsnMutable(asn)
      await enforceCommandOptimisticLockWithGuards(ctx.container, {
        resourceKind: WMS_ASN_RESOURCE,
        resourceId: asn.id,
        current: asn.updatedAt,
        request: ctx.request ?? null,
      })

      const line = await findOneWithDecryption(
        trx,
        ReceivingLine,
        { id: input.lineId, deletedAt: null },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
        scope,
      )
      if (!line) throw new CrudHttpError(404, { error: 'Receiving line not found.' })
      ensureTenantScope(ctx, line.tenantId)
      ensureOrganizationScope(ctx, line.organizationId)

      const lineAsnId = typeof line.asn === 'string' ? line.asn : line.asn.id
      if (lineAsnId !== asn.id) {
        throw new CrudHttpError(422, { error: 'line_asn_mismatch' })
      }
      assertAsnQcTransition(line.qcStatus, input.qcStatus)

      const warehouseId = typeof asn.warehouse === 'string' ? asn.warehouse : asn.warehouse.id
      await requireStagingLocation(trx, ctx, input.targetStagingLocationId!, warehouseId, scope)

      const priorReceivedQty = toNumber(line.receivedQty)
      const attempt = resolveAsnReceiveAttempt({
        lineId: line.id,
        priorReceivedQty,
        receivedQty: input.receivedQty,
        targetReceivedQty: input.targetReceivedQty,
        idempotencyKey: input.idempotencyKey,
      })
      const previousStatus = asn.status
      const receivingStarted = asn.status === 'draft' || asn.status === 'in_transit'
      const putawayKey = buildAsnReceivePutawayKey({ attemptKey: attempt.attemptKey })
      const existingPutaway = await findExistingPutawayForReceipt(trx, scope, putawayKey)
      const alreadyAtTarget = attempt.applyQty <= 0.000001

      if (alreadyAtTarget) {
        // Cancel clears putaway_key; identical absolute-target retry must recreate
        // so staging stock is not left without a queue task — but only when
        // uncommitted staging qty remains. If a manual putaway already covers
        // the bucket, reuse that open task instead of oversubscribing.
        let putaway = existingPutaway
        let putawayCreated = false
        if (shouldEnsurePutawayOnAlreadyAtTarget(existingPutaway)) {
          const cancelled = await findCancelledPutawayForReceipt(trx, scope, putawayKey)
          const lotId = input.lotId ?? cancelled?.lotId ?? null
          const quantity = resolvePutawayQuantityForAlreadyAtTargetRetry({
            cancelledTaskQuantity: cancelled ? toNumber(cancelled.quantity) : null,
            absoluteTargetQty: attempt.targetReceivedQty,
          })
          if (quantity > 0.000001) {
            const availability = await resolveUncommittedStagingPutawayQuantity(trx, scope, {
              warehouseId,
              sourceLocationId: input.targetStagingLocationId!,
              catalogVariantId: line.catalogVariantId,
              lotId,
            })
            if (
              availability &&
              shouldRecreatePutawayOnAlreadyAtTarget({
                requestedQuantity: quantity,
                remainingAvailable: availability.remaining,
              })
            ) {
              const putawayResult = await findOrCreatePutawayForReceipt(trx, scope, putawayKey, {
                warehouseId,
                sourceLocationId: input.targetStagingLocationId!,
                catalogVariantId: line.catalogVariantId,
                lotId,
                quantity,
                asnId: asn.id,
                lineId: line.id,
                metadata: input.metadata ?? null,
              })
              putaway = putawayResult.task
              putawayCreated = putawayResult.created
            } else if (availability) {
              putaway = selectCoveringOpenPutawayTask(
                availability.openTasks.map((task) => ({
                  task,
                  quantity: toNumber(task.quantity),
                })),
                quantity,
              )?.task ?? null
            }
          }
        }
        return {
          movementResults: [],
          putaway,
          putawayCreated,
          lineUpdated: false,
          asn,
          line,
          warehouseId,
          previousStatus,
          receivingStarted,
          applyQty: 0,
          alreadyAtTarget: true,
          existingPutawayId: putaway?.id ?? null,
          currentReceivedQty: toNumber(line.receivedQty),
        }
      }

      if (serialNumbers.length > 0 && serialNumbers.length !== attempt.applyQty) {
        throw new CrudHttpError(422, { error: 'tracking_required' })
      }

      const movementResults: InventoryReceiveMutationResult[] = []
      const receiveOnce = async (quantity: number, serialNumber?: string) => {
        const receiveInput: InventoryReceiveInput = {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          warehouseId,
          locationId: input.targetStagingLocationId!,
          catalogVariantId: line.catalogVariantId,
          lotId: input.lotId,
          lotNumber: input.lotNumber ?? line.lotNumber ?? undefined,
          serialNumber,
          quantity,
          referenceType: 'po',
          referenceId: buildAsnReceiveReferenceId({
            attemptKey: attempt.attemptKey,
            serialNumber,
          }),
          performedBy: input.performedBy,
          receivedAt: input.receivedAt,
          reasonCode: 'asn_receive',
          metadata: {
            ...(input.metadata ?? {}),
            asnId: asn.id,
            asnReferenceNumber: asn.referenceNumber ?? null,
            receivingLineId: line.id,
            putawayKey,
            source: 'asn_receive',
          },
        }
        movementResults.push(await applyInventoryReceiveInTransaction(trx, ctx, receiveInput))
      }

      if (serialNumbers.length > 0) {
        for (const serialNumber of serialNumbers) {
          await receiveOnce(1, serialNumber)
        }
      } else {
        await receiveOnce(attempt.applyQty)
      }

      const lotId =
        input.lotId ?? movementResults.find((result) => result.lotId)?.lotId ?? null

      const putawayResult = await findOrCreatePutawayForReceipt(trx, scope, putawayKey, {
        warehouseId,
        sourceLocationId: input.targetStagingLocationId!,
        catalogVariantId: line.catalogVariantId,
        lotId,
        quantity: attempt.applyQty,
        asnId: asn.id,
        lineId: line.id,
        metadata: input.metadata ?? null,
      })

      const currentReceived = toNumber(line.receivedQty)
      let lineUpdated = false
      if (currentReceived + 0.000001 < attempt.targetReceivedQty) {
        line.receivedQty = toNumericString(attempt.targetReceivedQty)
        line.qcStatus = 'passed'
        line.targetStagingLocationId = input.targetStagingLocationId
        line.rejectionReason = null
        if (input.lotNumber !== undefined) {
          line.lotNumber = normalizeOptionalString(input.lotNumber) ?? line.lotNumber ?? null
        }
        if (serialNumbers.length) line.serialNumbers = serialNumbers
        if (asn.status === 'draft') asn.status = 'in_transit'
        // Bump ASN version only after stock + line write succeed in this TX.
        asn.updatedAt = new Date()
        line.updatedAt = new Date()
        await trx.flush()
        lineUpdated = true
      }

      return {
        movementResults,
        putaway: putawayResult.task,
        putawayCreated: putawayResult.created,
        lineUpdated,
        asn,
        line,
        warehouseId,
        previousStatus,
        receivingStarted,
        applyQty: attempt.applyQty,
        alreadyAtTarget: false,
        existingPutawayId: existingPutaway?.id ?? null,
        currentReceivedQty: toNumber(line.receivedQty),
      }
    })

    if (outcome.alreadyAtTarget) {
      if (outcome.putawayCreated && outcome.putaway) {
        await emitAsnReceivePutawayCreatedSideEffects(
          ctx,
          scope,
          outcome.putaway,
          outcome.warehouseId,
        )
      }
      return {
        movementIds: [],
        putawayTaskIds: outcome.putaway?.id ? [outcome.putaway.id] : [],
        lineId: outcome.line.id,
        asnId: outcome.asn.id,
        receivedQty: outcome.currentReceivedQty,
        asnUpdatedAt: outcome.asn.updatedAt.toISOString(),
      }
    }

    for (const movementResult of outcome.movementResults) {
      await emitInventoryReceiveSideEffects(ctx, movementResult)
    }

    if (outcome.putawayCreated && outcome.putaway) {
      await emitAsnReceivePutawayCreatedSideEffects(
        ctx,
        scope,
        outcome.putaway,
        outcome.warehouseId,
      )
    }

    if (outcome.lineUpdated) {
      await emitAsnSideEffects(ctx, {
        asns: [{ entity: outcome.asn, action: 'updated' }],
        lines: [{ entity: outcome.line, action: 'updated' }],
      })

      if (outcome.receivingStarted && outcome.previousStatus === 'draft') {
        void emitWmsEvent('wms.asn.receiving_started', {
          id: outcome.asn.id,
          warehouseId: outcome.warehouseId,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
        }).catch(() => undefined)
      }
      void emitWmsEvent('wms.asn.line_received', {
        id: outcome.line.id,
        asnId: outcome.asn.id,
        lineId: outcome.line.id,
        movementIds: outcome.movementResults.map((result) => result.movementId),
        catalogVariantId: outcome.line.catalogVariantId,
        receivedQty: toNumericString(outcome.applyQty),
        locationId: input.targetStagingLocationId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      }).catch(() => undefined)
    }

    if (!outcome.putaway) {
      throw new CrudHttpError(500, { error: '[internal] putaway missing after QC-pass receive' })
    }

    return {
      movementIds: outcome.movementResults.map((result) => result.movementId),
      putawayTaskIds: [outcome.putaway.id],
      lineId: outcome.line.id,
      asnId: outcome.asn.id,
      receivedQty: toNumber(outcome.line.receivedQty),
      asnUpdatedAt: outcome.asn.updatedAt.toISOString(),
    }
  },
  buildLog: async ({ input, result, ctx }) => {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('wms.audit.asn.receiveLine', 'Receive ASN line'),
      resourceKind: WMS_ASN_RESOURCE,
      resourceId: result?.asnId ?? input?.asnId ?? null,
      parentResourceKind: WMS_RECEIVING_LINE_RESOURCE,
      parentResourceId: result?.lineId ?? input?.lineId ?? null,
      tenantId: input?.tenantId ?? ctx.auth?.tenantId ?? null,
      organizationId: input?.organizationId ?? ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
      context: { cacheAliases: [WMS_INVENTORY_BALANCE_RESOURCE, WMS_RECEIVING_LINE_RESOURCE] },
    }
  },
}

const closeAsnCommand: CommandHandler<AsnCloseInput, { asnId: string; status: AsnStatus }> = {
  id: 'wms.asns.close',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const input = asnCloseSchema.parse(rawInput ?? {})
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)
    const em = resolveEm(ctx)
    const scope = resolveScope(ctx, input)

    const locked = await em.transactional(async (trx) => {
      const asn = await findOneWithDecryption(
        trx,
        Asn,
        { id: input.id, deletedAt: null },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
        scope,
      )
      if (!asn) throw new CrudHttpError(404, { error: 'ASN not found.' })
      ensureTenantScope(ctx, asn.tenantId)
      ensureOrganizationScope(ctx, asn.organizationId)
      await enforceCommandOptimisticLockWithGuards(ctx.container, {
        resourceKind: WMS_ASN_RESOURCE,
        resourceId: asn.id,
        current: asn.updatedAt,
        request: ctx.request ?? null,
      })
      if (asn.status === 'closed') {
        return { asn, transitioned: false as const, emitReceived: false as const }
      }
      if (asn.status === 'received') {
        asn.status = 'closed'
        await trx.flush()
        return { asn, transitioned: true as const, emitReceived: false as const }
      }

      const lines = await findWithDecryption(
        trx,
        ReceivingLine,
        { asn: asn.id, deletedAt: null },
        undefined,
        { tenantId: asn.tenantId, organizationId: asn.organizationId },
      )
      if (!isAsnCloseable(lines, !!input.closeWhenShort)) {
        throw new CrudHttpError(409, { error: 'invalid_receipt_state' })
      }
      asn.status = 'received'
      await trx.flush()
      return { asn, transitioned: true as const, emitReceived: true as const }
    })

    if (locked.transitioned) {
      await emitAsnSideEffects(ctx, { asns: [{ entity: locked.asn, action: 'updated' }] })
    }
    if (locked.emitReceived) {
      void emitWmsEvent('wms.asn.received', {
        id: locked.asn.id,
        status: locked.asn.status,
        closeWhenShort: !!input.closeWhenShort,
        tenantId: locked.asn.tenantId,
        organizationId: locked.asn.organizationId,
      }).catch(() => undefined)
    }
    return { asnId: locked.asn.id, status: locked.asn.status }
  },
  buildLog: async ({ input, result, ctx }) =>
    buildCrudLog(ctx, input, result?.asnId ?? null, 'wms.audit.asn.close', 'Complete ASN', WMS_ASN_RESOURCE),
}

registerCommand(createAsnCommand)
registerCommand(updateAsnCommand)
registerCommand(deleteAsnCommand)
registerCommand(createReceivingLineCommand)
registerCommand(updateReceivingLineCommand)
registerCommand(deleteReceivingLineCommand)
registerCommand(receiveAsnLineCommand)
registerCommand(closeAsnCommand)
