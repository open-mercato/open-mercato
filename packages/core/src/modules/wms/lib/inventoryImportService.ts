import { createHash, randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { E } from '#generated/entities.ids.generated'
import {
  InventoryBalance,
  InventoryLot,
  InventoryMovement,
  Warehouse,
  WarehouseLocation,
} from '../data/entities'
import type {
  InventoryImportApplyInput,
  InventoryImportApplyRowInput,
  InventoryImportMode,
  InventoryImportValidateInput,
} from '../data/validators'
import { ensureOrganizationScope, ensureTenantScope } from '../commands/shared'
import type { InventoryImportRawRow } from './inventoryImportCsv'

type ImportScope = {
  tenantId: string
  organizationId: string
}

type ResolvedImportRow = {
  rowNumber: number
  warehouseId: string
  warehouseCode: string
  locationId: string
  locationCode: string
  catalogVariantId: string
  sku: string
  quantity: number
  lotId?: string
  lotNumber?: string
  serialNumber?: string
  currentOnHand: number
  delta: number
}

export type InventoryImportRowResult = {
  rowNumber: number
  status: 'valid' | 'error' | 'warning' | 'skip'
  errors: string[]
  warnings: string[]
  input: InventoryImportRawRow
  resolved?: ResolvedImportRow
}

export type InventoryImportValidationResult = {
  ok: boolean
  importBatchId: string
  summary: {
    totalRows: number
    validRows: number
    errorRows: number
    warningRows: number
    skipRows: number
  }
  rows: InventoryImportRowResult[]
}

export type InventoryImportApplyResult = {
  ok: boolean
  importBatchId: string
  summary: {
    applied: number
    skipped: number
    failed: number
  }
  rows: Array<{
    rowNumber: number
    status: 'applied' | 'skipped' | 'failed'
    movementId?: string
    error?: string
  }>
}

function toNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function buildBucketKey(input: {
  warehouseId: string
  locationId: string
  catalogVariantId: string
  lotId?: string | null
  serialNumber?: string | null
}): string {
  return [
    input.warehouseId,
    input.locationId,
    input.catalogVariantId,
    input.lotId ?? '',
    input.serialNumber ?? '',
  ].join('::')
}

async function resolveWarehouse(
  em: EntityManager,
  scope: ImportScope,
  row: InventoryImportRawRow,
): Promise<{ id: string; code: string } | null> {
  if (row.warehouseId) {
    const warehouse = await findOneWithDecryption(
      em,
      Warehouse,
      { id: row.warehouseId, deletedAt: null },
      undefined,
      scope,
    )
    if (!warehouse) return null
    return { id: warehouse.id, code: warehouse.code }
  }
  const code = row.warehouseCode?.trim()
  if (!code) return null
  const warehouse = await findOneWithDecryption(
    em,
    Warehouse,
    { code, deletedAt: null },
    undefined,
    scope,
  )
  if (!warehouse) return null
  return { id: warehouse.id, code: warehouse.code }
}

async function resolveLocation(
  em: EntityManager,
  scope: ImportScope,
  warehouseId: string,
  row: InventoryImportRawRow,
): Promise<{ id: string; code: string } | null> {
  if (row.locationId) {
    const location = await findOneWithDecryption(
      em,
      WarehouseLocation,
      { id: row.locationId, deletedAt: null },
      undefined,
      scope,
    )
    if (!location) return null
    const locationWarehouseId =
      typeof location.warehouse === 'string' ? location.warehouse : location.warehouse.id
    if (locationWarehouseId !== warehouseId) return null
    return { id: location.id, code: location.code }
  }
  const code = row.locationCode?.trim()
  if (!code) return null
  const location = await findOneWithDecryption(
    em,
    WarehouseLocation,
    { warehouse: warehouseId, code, deletedAt: null },
    undefined,
    scope,
  )
  if (!location) return null
  return { id: location.id, code: location.code }
}

type ResolvedCatalogVariant = { id: string; sku: string }

type VariantResolveResult =
  | { status: 'found'; variant: ResolvedCatalogVariant }
  | { status: 'failed'; code: 'catalog_variant_not_found' | 'sku_not_found' | 'sku_ambiguous' }

async function resolveVariantBySku(
  queryEngine: QueryEngine,
  scope: ImportScope,
  sku: string,
): Promise<VariantResolveResult> {
  const normalizedSku = sku.trim()
  if (!normalizedSku) return { status: 'failed', code: 'sku_not_found' }
  const result = await queryEngine.query<{ id?: string | null; sku?: string | null }>(
    E.catalog.catalog_product_variant,
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      filters: { sku: { $eq: normalizedSku } },
      fields: ['id', 'sku'],
      page: { page: 1, pageSize: 2 },
    },
  )
  const items = result.items ?? []
  if (items.length === 0) return { status: 'failed', code: 'sku_not_found' }
  if (items.length > 1) return { status: 'failed', code: 'sku_ambiguous' }
  const id = items[0]?.id
  if (typeof id !== 'string' || !id) return { status: 'failed', code: 'sku_not_found' }
  return {
    status: 'found',
    variant: { id, sku: items[0]?.sku?.trim() || normalizedSku },
  }
}

async function resolveVariant(
  queryEngine: QueryEngine,
  scope: ImportScope,
  row: InventoryImportRawRow,
): Promise<VariantResolveResult> {
  if (row.catalogVariantId?.trim()) {
    const result = await queryEngine.query<{ id?: string | null; sku?: string | null }>(
      E.catalog.catalog_product_variant,
      {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        filters: { id: { $eq: row.catalogVariantId.trim() } },
        fields: ['id', 'sku'],
        page: { page: 1, pageSize: 1 },
      },
    )
    const item = result.items?.[0]
    if (!item?.id) return { status: 'failed', code: 'catalog_variant_not_found' }
    return {
      status: 'found',
      variant: { id: item.id, sku: item.sku?.trim() || row.sku?.trim() || item.id },
    }
  }
  const sku = row.sku?.trim()
  if (!sku) return { status: 'failed', code: 'sku_not_found' }
  return resolveVariantBySku(queryEngine, scope, sku)
}

async function resolveLot(
  em: EntityManager,
  scope: ImportScope,
  catalogVariantId: string,
  row: InventoryImportRawRow,
): Promise<{ id: string; lotNumber: string } | null> {
  if (row.lotId) {
    const lot = await findOneWithDecryption(
      em,
      InventoryLot,
      { id: row.lotId, deletedAt: null },
      undefined,
      scope,
    )
    if (!lot || lot.catalogVariantId !== catalogVariantId) return null
    return { id: lot.id, lotNumber: lot.lotNumber }
  }
  const lotNumber = row.lotNumber?.trim()
  if (!lotNumber) return null
  const lot = await findOneWithDecryption(
    em,
    InventoryLot,
    { catalogVariantId, lotNumber, deletedAt: null },
    undefined,
    scope,
  )
  if (!lot) return null
  return { id: lot.id, lotNumber: lot.lotNumber }
}

async function loadCurrentOnHand(
  em: EntityManager,
  scope: ImportScope,
  input: {
    warehouseId: string
    locationId: string
    catalogVariantId: string
    lotId?: string
    serialNumber?: string
  },
): Promise<number> {
  const balance = await findOneWithDecryption(
    em,
    InventoryBalance,
    {
      warehouse: input.warehouseId,
      location: input.locationId,
      catalogVariantId: input.catalogVariantId,
      lot: input.lotId ?? null,
      serialNumber: input.serialNumber ?? null,
      deletedAt: null,
    },
    undefined,
    scope,
  )
  return balance ? toNumber(balance.quantityOnHand) : 0
}

async function verifyApplyRowDeltas(
  em: EntityManager,
  scope: ImportScope,
  mode: InventoryImportMode,
  rows: InventoryImportApplyRowInput[],
): Promise<InventoryImportApplyRowInput[]> {
  if (mode === 'additive') {
    // Additive mode: the delta posted to the ledger always equals the row's
    // quantity (the amount received), regardless of the current on-hand balance.
    return rows.map((row) => {
      if (Math.abs(row.quantity - row.delta) > 0.000001) {
        throw new CrudHttpError(400, {
          error: 'import_delta_tampering',
          rowNumber: row.rowNumber,
          expectedDelta: row.quantity,
          providedDelta: row.delta,
        })
      }
      return row
    })
  }
  // Reconcile mode (opt-in, requires the "reconcile to exact balance" checkbox):
  // quantity is the target on-hand balance, so the delta must be recalculated
  // against the current balance to guard against staleness between validate/apply.
  const recalculated: InventoryImportApplyRowInput[] = []
  for (const row of rows) {
    const currentOnHand = await loadCurrentOnHand(em, scope, {
      warehouseId: row.warehouseId,
      locationId: row.locationId,
      catalogVariantId: row.catalogVariantId,
      lotId: row.lotId,
      serialNumber: row.serialNumber,
    })
    const serverDelta = row.quantity - currentOnHand
    if (Math.abs(serverDelta - row.delta) > 0.000001) {
      throw new CrudHttpError(400, {
        error: 'import_delta_tampering',
        rowNumber: row.rowNumber,
        expectedDelta: serverDelta,
        providedDelta: row.delta,
      })
    }
    recalculated.push({ ...row, delta: serverDelta })
  }
  return recalculated
}

export async function validateInventoryImport(
  ctx: CommandRuntimeContext,
  input: InventoryImportValidateInput,
): Promise<InventoryImportValidationResult> {
  ensureTenantScope(ctx, input.tenantId)
  ensureOrganizationScope(ctx, input.organizationId)
  const mode: InventoryImportMode = input.mode ?? 'additive'
  const scope: ImportScope = {
    tenantId: input.tenantId,
    organizationId: input.organizationId,
  }
  const em = ctx.container.resolve('em') as EntityManager
  const queryEngine = ctx.container.resolve('queryEngine') as QueryEngine
  const importBatchId = input.importBatchId ?? randomUUID()
  const seenBuckets = new Map<string, number>()
  const rows: InventoryImportRowResult[] = []

  for (let index = 0; index < input.rows.length; index += 1) {
    const raw = input.rows[index]
    const rowNumber = index + 1
    const errors: string[] = []
    const warnings: string[] = []

    const quantity = Number(raw.quantity)
    if (raw.quantity === undefined || raw.quantity.trim().length === 0) {
      errors.push('quantity_required')
    } else if (!Number.isFinite(quantity) || quantity < 0) {
      errors.push('quantity_invalid')
    }

    const hasWarehouse = Boolean(raw.warehouseId?.trim() || raw.warehouseCode?.trim())
    const hasLocation = Boolean(raw.locationId?.trim() || raw.locationCode?.trim())
    const hasVariant = Boolean(raw.catalogVariantId?.trim() || raw.sku?.trim())

    if (!hasWarehouse) errors.push('warehouse_required')
    if (!hasLocation) errors.push('location_required')
    if (!hasVariant) errors.push('sku_required')

    if (errors.length > 0) {
      rows.push({ rowNumber, status: 'error', errors, warnings, input: raw })
      continue
    }

    const warehouse = await resolveWarehouse(em, scope, raw)
    if (!warehouse) {
      errors.push('warehouse_not_found')
      rows.push({ rowNumber, status: 'error', errors, warnings, input: raw })
      continue
    }

    const location = await resolveLocation(em, scope, warehouse.id, raw)
    if (!location) {
      errors.push('location_not_found')
      rows.push({ rowNumber, status: 'error', errors, warnings, input: raw })
      continue
    }

    const variantResult = await resolveVariant(queryEngine, scope, raw)
    if (variantResult.status === 'failed') {
      errors.push(variantResult.code)
      rows.push({ rowNumber, status: 'error', errors, warnings, input: raw })
      continue
    }
    const variant = variantResult.variant

    let lot: { id: string; lotNumber: string } | null = null
    if (raw.lotId?.trim() || raw.lotNumber?.trim()) {
      lot = await resolveLot(em, scope, variant.id, raw)
      if (!lot) {
        errors.push('lot_not_found')
        rows.push({ rowNumber, status: 'error', errors, warnings, input: raw })
        continue
      }
    }

    const serialNumber = raw.serialNumber?.trim() || undefined
    const currentOnHand = await loadCurrentOnHand(em, scope, {
      warehouseId: warehouse.id,
      locationId: location.id,
      catalogVariantId: variant.id,
      lotId: lot?.id,
      serialNumber,
    })
    const bucketKey = buildBucketKey({
      warehouseId: warehouse.id,
      locationId: location.id,
      catalogVariantId: variant.id,
      lotId: lot?.id,
      serialNumber,
    })
    const duplicateRow = seenBuckets.get(bucketKey)
    if (duplicateRow) {
      if (input.skipDuplicates) {
        warnings.push('duplicate_row')
        warnings.push(`duplicate_of_row_${duplicateRow}`)
        rows.push({
          rowNumber,
          status: 'skip',
          errors,
          warnings,
          input: raw,
          resolved: {
            rowNumber,
            warehouseId: warehouse.id,
            warehouseCode: warehouse.code,
            locationId: location.id,
            locationCode: location.code,
            catalogVariantId: variant.id,
            sku: variant.sku,
            quantity,
            lotId: lot?.id,
            lotNumber: lot?.lotNumber,
            serialNumber,
            currentOnHand,
            delta: 0,
          },
        })
        continue
      }
      errors.push('duplicate_row')
      warnings.push(`duplicate_of_row_${duplicateRow}`)
      rows.push({ rowNumber, status: 'error', errors, warnings, input: raw })
      continue
    }
    seenBuckets.set(bucketKey, rowNumber)

    // Additive mode (default): quantity is the amount to receive into this bucket,
    // so the delta never depends on currentOnHand. Reconcile mode (opt-in) treats
    // quantity as the target on-hand balance instead, so it can also reduce stock.
    const delta = mode === 'additive' ? quantity : quantity - currentOnHand

    if (mode === 'reconcile') {
      if (delta < 0 && currentOnHand < Math.abs(delta) - 0.000001) {
        warnings.push('insufficient_available_for_negative_delta')
      }
      if (currentOnHand > 0 && Math.sign(delta) !== 0) {
        warnings.push('overwriting_existing_balance')
      }
    }

    if (Math.abs(delta) < 0.000001) {
      rows.push({
        rowNumber,
        status: 'skip',
        errors,
        warnings,
        input: raw,
        resolved: {
          rowNumber,
          warehouseId: warehouse.id,
          warehouseCode: warehouse.code,
          locationId: location.id,
          locationCode: location.code,
          catalogVariantId: variant.id,
          sku: variant.sku,
          quantity,
          lotId: lot?.id,
          lotNumber: lot?.lotNumber,
          serialNumber,
          currentOnHand,
          delta: 0,
        },
      })
      continue
    }

    rows.push({
      rowNumber,
      status: warnings.length > 0 ? 'warning' : 'valid',
      errors,
      warnings,
      input: raw,
      resolved: {
        rowNumber,
        warehouseId: warehouse.id,
        warehouseCode: warehouse.code,
        locationId: location.id,
        locationCode: location.code,
        catalogVariantId: variant.id,
        sku: variant.sku,
        quantity,
        lotId: lot?.id,
        lotNumber: lot?.lotNumber,
        serialNumber,
        currentOnHand,
        delta,
      },
    })
  }

  const errorRows = rows.filter((row) => row.status === 'error').length
  const warningRows = rows.filter((row) => row.status === 'warning').length
  const skipRows = rows.filter((row) => row.status === 'skip').length
  const validRows = rows.filter((row) => row.status === 'valid' || row.status === 'warning').length

  return {
    ok: errorRows === 0,
    importBatchId,
    summary: {
      totalRows: rows.length,
      validRows,
      errorRows,
      warningRows,
      skipRows,
    },
    rows,
  }
}

function buildImportRowReferenceId(importBatchId: string, rowNumber: number): string {
  const seed = `wms:csv-import:${importBatchId.toLowerCase()}:${rowNumber}`
  const bytes = createHash('sha256').update(seed).digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

function resolveRelationId(value: { id?: string } | string | null | undefined): string | null {
  if (typeof value === 'string') return value
  return typeof value?.id === 'string' ? value.id : null
}

const MOVEMENT_QUANTITY_SCALE = 4

// wms_inventory_movements.quantity is numeric(16,4); Postgres rounds to that scale on
// insert, so a raw delta with more fractional digits must be rounded the same way before
// comparing against a persisted movement, or an identical retry reports a false mismatch.
function roundToMovementScale(value: number): number {
  const factor = 10 ** MOVEMENT_QUANTITY_SCALE
  return Math.round(value * factor) / factor
}

/**
 * A replayed row must have posted the same target bucket and amount as the current row;
 * a CSV edited between a failed apply and its retry (same importBatchId/rowNumber) must
 * not be reported as applied against a stale movement.
 */
function movementMatchesRow(
  movement: InventoryMovement,
  row: { warehouseId: string; locationId: string; catalogVariantId: string; lotId?: string | null; serialNumber?: string | null; delta: number },
): boolean {
  return (
    resolveRelationId(movement.warehouse) === row.warehouseId &&
    resolveRelationId(movement.locationTo) === row.locationId &&
    movement.catalogVariantId === row.catalogVariantId &&
    resolveRelationId(movement.lot) === (row.lotId ?? null) &&
    (movement.serialNumber ?? null) === (row.serialNumber ?? null) &&
    Math.abs(toNumber(movement.quantity) - roundToMovementScale(row.delta)) < 0.00001
  )
}

/**
 * Pre-fix rows (posted before buildImportRowReferenceId existed) carry no deterministic
 * referenceId, so they can only be recognized by their import batch/row metadata. The
 * movement table has no index on those JSON fields, so this is loaded once per batch
 * instead of once per row — a per-row scan does not scale to a multi-thousand-row import.
 */
async function loadLegacyImportRowMovementIds(
  em: EntityManager,
  scope: ImportScope,
  importBatchId: string,
): Promise<Map<number, string>> {
  const rows = await em.getConnection().execute<Array<{ id: string; row_number: string | null }>>(
    `select id, metadata->>'importRowNumber' as row_number
     from wms_inventory_movements
     where organization_id = ?
       and tenant_id = ?
       and deleted_at is null
       and reference_type = 'manual'
       and metadata->>'source' = 'csv_import'
       and metadata->>'importBatchId' = ?
     order by created_at asc`,
    [scope.organizationId, scope.tenantId, importBatchId],
  )
  const byRow = new Map<number, string>()
  for (const row of rows) {
    const rowNumber = Number(row.row_number)
    if (!Number.isFinite(rowNumber) || byRow.has(rowNumber)) continue
    byRow.set(rowNumber, row.id)
  }
  return byRow
}

const IMPORT_ROW_LOCK_SQL = 'select pg_advisory_xact_lock(hashtextextended(?, 0))'

// Serializes the check-then-adjust section below per tenant/organization/batch/row, so two
// overlapping apply requests for the same CSV row cannot both miss the existing-movement
// lookup and post two movements for it.
function buildImportRowLockKey(scope: ImportScope, importBatchId: string, rowNumber: number): string {
  return [
    'wms:csv-import-row',
    scope.tenantId.toLowerCase(),
    scope.organizationId.toLowerCase(),
    importBatchId.toLowerCase(),
    String(rowNumber),
  ].join(':')
}

async function runInTransaction<TResult>(
  em: EntityManager,
  operation: (trx: EntityManager) => Promise<TResult>,
): Promise<TResult> {
  const transactionalEm = em as EntityManager & {
    transactional?: (callback: (trx: EntityManager) => Promise<TResult>) => Promise<TResult>
  }
  if (typeof transactionalEm.transactional === 'function') {
    return transactionalEm.transactional((trx) => operation(trx))
  }
  return operation(em)
}

export async function applyInventoryImport(
  ctx: CommandRuntimeContext,
  input: InventoryImportApplyInput,
): Promise<InventoryImportApplyResult> {
  ensureTenantScope(ctx, input.tenantId)
  ensureOrganizationScope(ctx, input.organizationId)
  const mode: InventoryImportMode = input.mode ?? 'additive'
  const commandBus = ctx.container.resolve('commandBus') as CommandBus
  const em = ctx.container.resolve('em') as EntityManager
  const scope: ImportScope = {
    tenantId: input.tenantId,
    organizationId: input.organizationId,
  }
  const applyRows = await verifyApplyRowDeltas(em, scope, mode, input.rows)
  const resultRows: InventoryImportApplyResult['rows'] = []
  let applied = 0
  let skipped = 0
  let failed = 0

  let legacyMovementIdsByRow: Map<number, string> | Error
  try {
    legacyMovementIdsByRow = await loadLegacyImportRowMovementIds(em, scope, input.importBatchId)
  } catch (error) {
    legacyMovementIdsByRow = error instanceof Error ? error : new Error('apply_failed')
  }

  for (const row of applyRows) {
    if (Math.abs(row.delta) < 0.000001) {
      skipped += 1
      resultRows.push({ rowNumber: row.rowNumber, status: 'skipped' })
      continue
    }

    try {
      if (legacyMovementIdsByRow instanceof Error) throw legacyMovementIdsByRow
      const referenceId = buildImportRowReferenceId(input.importBatchId, row.rowNumber)
      const legacyMovementId = legacyMovementIdsByRow.get(row.rowNumber)

      const outcome = await runInTransaction(em, async (trx) => {
        // Holds the row's lock for the whole check-then-adjust section below, including
        // the wms.inventory.adjust call, so a concurrent retry blocks until this one commits.
        // Must go through em.execute (not em.getConnection().execute), which binds to trx's
        // active transaction — otherwise pg_advisory_xact_lock runs on its own auto-committed
        // statement and releases the lock immediately instead of holding it for the section.
        await trx.execute(IMPORT_ROW_LOCK_SQL, [buildImportRowLockKey(scope, input.importBatchId, row.rowNumber)])

        const indexedMovement = await findOneWithDecryption(
          trx,
          InventoryMovement,
          { organizationId: scope.organizationId, referenceType: 'manual', referenceId, deletedAt: null },
          undefined,
          scope,
        )
        const existingMovement =
          indexedMovement ??
          (legacyMovementId
            ? await findOneWithDecryption(
                trx,
                InventoryMovement,
                { id: legacyMovementId, organizationId: scope.organizationId, deletedAt: null },
                undefined,
                scope,
              )
            : null)

        if (existingMovement) {
          if (!movementMatchesRow(existingMovement, row)) {
            throw new CrudHttpError(409, { error: 'import_row_replay_mismatch', rowNumber: row.rowNumber })
          }
          return { movementId: existingMovement.id }
        }

        const execution = await commandBus.execute('wms.inventory.adjust', {
          input: {
            organizationId: input.organizationId,
            tenantId: input.tenantId,
            warehouseId: row.warehouseId,
            locationId: row.locationId,
            catalogVariantId: row.catalogVariantId,
            lotId: row.lotId,
            serialNumber: row.serialNumber,
            delta: row.delta,
            reason: input.reason,
            referenceType: 'manual' as const,
            referenceId,
            performedBy: input.performedBy,
            metadata: {
              importBatchId: input.importBatchId,
              importRowNumber: row.rowNumber,
              source: 'csv_import',
              ...(mode === 'reconcile' ? { targetQuantity: row.quantity } : {}),
            },
          },
          ctx,
        })
        return { movementId: (execution.result as { movementId?: string }).movementId }
      })

      applied += 1
      resultRows.push({ rowNumber: row.rowNumber, status: 'applied', movementId: outcome.movementId })
    } catch (error) {
      failed += 1
      const message =
        error instanceof CrudHttpError
          ? String((error.body as { error?: unknown })?.error ?? 'apply_failed')
          : 'apply_failed'
      resultRows.push({
        rowNumber: row.rowNumber,
        status: 'failed',
        error: message,
      })
      if (!input.continueOnError) {
        throw new CrudHttpError(409, {
          error: 'import_apply_partial_failure',
          importBatchId: input.importBatchId,
          summary: { applied, skipped, failed },
          rows: resultRows,
        })
      }
    }
  }

  return {
    ok: failed === 0,
    importBatchId: input.importBatchId,
    summary: { applied, skipped, failed },
    rows: resultRows,
  }
}
