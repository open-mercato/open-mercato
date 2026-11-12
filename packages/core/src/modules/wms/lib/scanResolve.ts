import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { Asn, InventoryLot, PutawayTask, WarehouseLocation } from '../data/entities'
import type {
  AsnReceiveLineInput,
  PutawayTaskCompleteInput,
  ScanPutawayInput,
  ScanReceiveInput,
  ScanResolveLocationInput,
  ScanResolveLotInput,
} from '../data/validators'

type Scope = { organizationId: string; tenantId: string }

export type ResolvedScanLocation = {
  locationId: string
  code: string
  type: string
}

export type ResolvedScanLot = {
  lotId: string
  lotNumber: string
  expiresAt: string | null
}

function resolveWarehouseId(warehouse: WarehouseLocation['warehouse'] | Asn['warehouse'] | PutawayTask['warehouse']): string | null {
  if (typeof warehouse === 'string') return warehouse
  return typeof warehouse?.id === 'string' ? warehouse.id : null
}

export async function resolveLocationByCode(
  em: EntityManager,
  input: ScanResolveLocationInput,
): Promise<ResolvedScanLocation> {
  const scope: Scope = { organizationId: input.organizationId, tenantId: input.tenantId }
  const location = await findOneWithDecryption(
    em,
    WarehouseLocation,
    {
      code: input.code.trim(),
      warehouse: input.warehouseId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    },
    undefined,
    scope,
  )
  if (!location) {
    throw new CrudHttpError(404, { error: 'not_found' })
  }
  return {
    locationId: location.id,
    code: location.code,
    type: location.type,
  }
}

export async function resolveLotByNumber(
  em: EntityManager,
  input: ScanResolveLotInput,
): Promise<ResolvedScanLot> {
  const scope: Scope = { organizationId: input.organizationId, tenantId: input.tenantId }
  const lot = await findOneWithDecryption(
    em,
    InventoryLot,
    {
      catalogVariantId: input.catalogVariantId,
      lotNumber: input.lotNumber.trim(),
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    },
    undefined,
    scope,
  )
  if (!lot) {
    throw new CrudHttpError(404, { error: 'not_found' })
  }
  return {
    lotId: lot.id,
    lotNumber: lot.lotNumber,
    expiresAt: lot.expiresAt ? lot.expiresAt.toISOString() : null,
  }
}

export async function resolveScanReceiveCommandInput(
  em: EntityManager,
  input: ScanReceiveInput,
): Promise<AsnReceiveLineInput> {
  const scope: Scope = { organizationId: input.organizationId, tenantId: input.tenantId }
  const asn = await findOneWithDecryption(
    em,
    Asn,
    {
      id: input.asnId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    },
    undefined,
    scope,
  )
  if (!asn) {
    throw new CrudHttpError(404, { error: 'not_found' })
  }
  const warehouseId = resolveWarehouseId(asn.warehouse)
  if (!warehouseId) {
    throw new CrudHttpError(422, { error: 'invalid_asn_warehouse' })
  }
  const location = await resolveLocationByCode(em, {
    organizationId: input.organizationId,
    tenantId: input.tenantId,
    warehouseId,
    code: input.locationCode,
  })

  // Pass through client absolute target / optional idempotencyKey only.
  // Do NOT derive target as prior+delta here — that re-advances on retry after
  // success (outside the receive-line lock). Both QC outcomes require absolute
  // target via scanReceiveSchema / asnReceiveLineSchema.
  return {
    organizationId: input.organizationId,
    tenantId: input.tenantId,
    asnId: input.asnId,
    lineId: input.lineId,
    receivedQty: input.receivedQty,
    targetReceivedQty: input.targetReceivedQty,
    idempotencyKey: input.idempotencyKey,
    targetStagingLocationId: location.locationId,
    lotNumber: input.lotNumber,
    serialNumbers: input.serialNumbers,
    qcStatus: input.qcStatus,
    rejectionReason: input.rejectionReason,
    performedBy: input.performedBy,
    receivedAt: input.receivedAt,
    metadata: input.metadata,
  }
}

export async function resolveScanPutawayCommandInput(
  em: EntityManager,
  input: ScanPutawayInput,
): Promise<PutawayTaskCompleteInput> {
  const scope: Scope = { organizationId: input.organizationId, tenantId: input.tenantId }
  const task = await findOneWithDecryption(
    em,
    PutawayTask,
    {
      id: input.taskId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    },
    undefined,
    scope,
  )
  if (!task) {
    throw new CrudHttpError(404, { error: 'not_found' })
  }
  const warehouseId = resolveWarehouseId(task.warehouse)
  if (!warehouseId) {
    throw new CrudHttpError(422, { error: 'invalid_putaway_warehouse' })
  }
  const location = await resolveLocationByCode(em, {
    organizationId: input.organizationId,
    tenantId: input.tenantId,
    warehouseId,
    code: input.targetLocationCode,
  })
  return {
    organizationId: input.organizationId,
    tenantId: input.tenantId,
    id: input.taskId,
    confirmedQuantity: input.confirmedQuantity,
    targetLocationId: location.locationId,
    lotId: input.lotId,
    performedBy: input.performedBy,
    performedAt: input.performedAt,
    reason: input.reason,
    metadata: input.metadata,
  }
}
