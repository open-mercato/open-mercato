import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { FeatureTogglesService } from '@open-mercato/core/modules/feature_toggles/lib/feature-flag-check'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Asn } from '../data/entities'
import { resolveWmsIntegrationToggleEnabled } from '../lib/wmsIntegrationToggles'

const logger = createLogger('wms')

export const metadata = {
  event: 'procurement.goods_receipt.created',
  persistent: true,
  id: 'wms:procurement-goods-receipt-created',
}

type SubscriberContext = {
  resolve: <T = unknown>(name: string) => T
}

/**
 * Assumed procurement.goods_receipt.created payload (procurement module is
 * optional / thin today). Fields beyond id + scope are best-effort:
 *
 * - id / goodsReceiptId: required for idempotent create via Asn.sourceKey
 * - warehouseId (required to create): destination warehouse UUID
 * - vendorId?: customers UUID
 * - expectedAt?: ISO date (defaults to now)
 * - referenceNumber?: external PO/GRN display reference (falls back to goods receipt id;
 *   not used as the uniqueness key — free-form refs may legitimately collide)
 * - tenantId / organizationId: required scope
 * - lines?: [{ catalogVariantId, expectedQty, lotNumber? }]
 *
 * When the toggle is off, required fields are missing, or peers are absent,
 * this subscriber no-ops.
 */
type GoodsReceiptCreatedPayload = {
  id?: string | null
  goodsReceiptId?: string | null
  warehouseId?: string | null
  vendorId?: string | null
  expectedAt?: string | Date | null
  referenceNumber?: string | null
  tenantId?: string | null
  organizationId?: string | null
  lines?: Array<{
    catalogVariantId?: string | null
    expectedQty?: string | number | null
    lotNumber?: string | null
  }> | null
}

export function buildProcurementGoodsReceiptSourceKey(goodsReceiptId: string): string {
  return `procurement.goods_receipt:${goodsReceiptId}`
}

function tryResolve<T>(ctx: SubscriberContext, name: string): T | undefined {
  try {
    return ctx.resolve<T>(name)
  } catch {
    return undefined
  }
}

function asUuid(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function toPositiveQuantity(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isFinite(numeric) || numeric <= 0) return null
  return numeric
}

function isUniqueConstraintError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const code = (error as { code?: string }).code
  if (code === '23505') return true
  const name = (error as { name?: string }).name
  if (name === 'UniqueConstraintViolationException') return true
  const cause = (error as { cause?: unknown }).cause
  if (cause && cause !== error) return isUniqueConstraintError(cause)
  const driverError = (error as { driverError?: unknown }).driverError
  if (driverError && driverError !== error) return isUniqueConstraintError(driverError)
  return false
}

async function findExistingAsnForGoodsReceipt(
  em: EntityManager,
  scope: { organizationId: string; tenantId: string },
  goodsReceiptId: string,
  sourceKey: string,
): Promise<Asn | null> {
  const bySourceKey = await findOneWithDecryption(
    em,
    Asn,
    {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      sourceKey,
      deletedAt: null,
    },
    undefined,
    scope,
  )
  if (bySourceKey) return bySourceKey

  // Legacy Story-4 ASNs keyed only by referenceNumber = goodsReceiptId (no source_key).
  return findOneWithDecryption(
    em,
    Asn,
    {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      referenceNumber: goodsReceiptId,
      deletedAt: null,
    },
    undefined,
    scope,
  )
}

export default async function handle(payload: GoodsReceiptCreatedPayload, ctx: SubscriberContext) {
  const tenantId = asUuid(payload.tenantId)
  const organizationId = asUuid(payload.organizationId)
  if (!tenantId || !organizationId) return

  const featureTogglesService = tryResolve<FeatureTogglesService>(ctx, 'featureTogglesService')
  const emRoot = tryResolve<EntityManager>(ctx, 'em')
  const commandBus = tryResolve<CommandBus>(ctx, 'commandBus')
  if (!featureTogglesService || !emRoot || !commandBus) return

  const enabled = await resolveWmsIntegrationToggleEnabled(
    featureTogglesService,
    emRoot,
    'wms_integration_procurement_goods_receipt',
    tenantId,
  )
  if (!enabled) return

  const warehouseId = asUuid(payload.warehouseId)
  if (!warehouseId) {
    logger.debug('procurement goods receipt skipped: missing warehouseId', {
      goodsReceiptId: payload.id ?? payload.goodsReceiptId ?? null,
    })
    return
  }

  const goodsReceiptId = asUuid(payload.goodsReceiptId) ?? asUuid(payload.id)
  if (!goodsReceiptId) {
    logger.debug('procurement goods receipt skipped: missing goodsReceiptId')
    return
  }

  const sourceKey = buildProcurementGoodsReceiptSourceKey(goodsReceiptId)
  const referenceNumber =
    (typeof payload.referenceNumber === 'string' && payload.referenceNumber.trim().length > 0
      ? payload.referenceNumber.trim()
      : null) ?? goodsReceiptId

  const em = emRoot.fork()
  const scope = { organizationId, tenantId }
  // Match by sourceKey (any status) so retries never create a second ASN.
  const existing = await findExistingAsnForGoodsReceipt(em, scope, goodsReceiptId, sourceKey)
  if (existing) return

  const expectedAt =
    payload.expectedAt instanceof Date
      ? payload.expectedAt
      : typeof payload.expectedAt === 'string' && payload.expectedAt.trim().length > 0
        ? new Date(payload.expectedAt)
        : new Date()

  const lines = (payload.lines ?? [])
    .map((line) => {
      const catalogVariantId = asUuid(line.catalogVariantId)
      const expectedQty = toPositiveQuantity(line.expectedQty)
      if (!catalogVariantId || expectedQty == null) return null
      return {
        catalogVariantId,
        expectedQty,
        lotNumber:
          typeof line.lotNumber === 'string' && line.lotNumber.trim().length > 0
            ? line.lotNumber.trim()
            : null,
      }
    })
    .filter((line): line is NonNullable<typeof line> => line !== null)

  const commandCtx: CommandRuntimeContext = {
    container: { resolve: ctx.resolve } as CommandRuntimeContext['container'],
    auth: null,
    organizationScope: null,
    selectedOrganizationId: organizationId,
    organizationIds: [organizationId],
  }

  try {
    await commandBus.execute('wms.asns.create', {
      input: {
        organizationId,
        tenantId,
        warehouseId,
        vendorId: asUuid(payload.vendorId),
        status: 'draft',
        expectedAt,
        referenceNumber,
        sourceKey,
        notes: `Created from procurement goods receipt ${goodsReceiptId}`,
        lines,
        metadata: {
          source: 'procurement.goods_receipt.created',
          goodsReceiptId,
        },
      },
      ctx: commandCtx,
    })
  } catch (err) {
    // Concurrent duplicate events: unique (organization_id, source_key) wins; loser is idempotent.
    if (isUniqueConstraintError(err)) return
    logger.warn('procurement goods receipt ASN create failed', { err, goodsReceiptId })
  }
}
