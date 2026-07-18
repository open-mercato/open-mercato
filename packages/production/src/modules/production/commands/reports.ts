import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { ensureOrganizationScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { UniqueConstraintViolationException } from '@mikro-orm/core'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import { CatalogProductUnitConversion } from '@open-mercato/core/modules/catalog/data/entities'
import {
  ProductionReport,
  ProductionOrder,
  ProductionOrderOperation,
  ProductionOrderMaterial,
  ProductPlanningParams,
  StockItem,
  StockMovement,
} from '../data/entities.js'
import type { ReportCreateInput, ReportReverseInput } from '../data/validators.js'
import {
  InsufficientStockError,
  StockUomMismatchError,
  type ProductionStockProvider,
  type StockMovementRef,
} from '../lib/stockProvider.js'
import type { StockLedgerService } from '../services/stockLedgerService.js'
import {
  selectBackflushMaterials,
  computeBackflushIssueLines,
  convertQtyToStockUom,
  type BackflushMaterialLine,
} from '../lib/backflush.js'
import { emitProductionEvent } from '../events.js'
import { enforceProductionOrderOptimisticLock } from './shared.js'
import { transitionOrderToInProgress, transitionOrderToCompleted, reopenOrderFromReversal } from './orders.js'
import { E } from '../../../../generated/entities.ids.generated.js'

/**
 * Shop-floor report commands (spec § Data Models / Status machine, Phase 4
 * task 4.1).
 *
 * `ProductionReport` is append-only + storno (decision h) — see the entity
 * doc comment in `data/entities.ts`. Like `commands/stock.ts` and
 * `commands/orders.ts`, both commands below are `isUndoable: false`: a
 * correction is the explicit compensating "reverse" command, not a generic
 * undo.
 *
 * Concurrency (DoD: "two operators finalize the same operation, one wins,
 * second gets a translated conflict"): reports are a `ProductionOrder`
 * sub-resource guarded by the PARENT order's `updated_at`
 * (`enforceProductionOrderOptimisticLock`, spec § Status machine — same
 * aggregate-lock convention `commands/orders.ts` uses for
 * operations/materials). Every report mutates the order (status transition
 * on the first report, or at minimum a touched `updatedAt` on later ones),
 * so a second concurrent report submitted against the SAME stale
 * `updated_at` token is rejected with a translated 409 by the lock guard —
 * no separate ad hoc locking mechanism is needed.
 */

function requireScopeIds(ctx: CommandRuntimeContext): { tenantId: string; organizationId: string } {
  const tenantId = ctx.auth?.tenantId
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId
  if (!tenantId || !organizationId) {
    throw new CrudHttpError(400, { error: '[internal] Missing tenant/organization scope' })
  }
  return { tenantId, organizationId }
}

function resolveDataEngine(ctx: CommandRuntimeContext): DataEngine {
  return ctx.container.resolve<DataEngine>('dataEngine')
}

function resolveStockProvider(ctx: CommandRuntimeContext): ProductionStockProvider {
  return ctx.container.resolve<ProductionStockProvider>('productionStockProvider')
}

function resolveStockLedger(ctx: CommandRuntimeContext): Pick<StockLedgerService, 'reverseMovement'> {
  return ctx.container.resolve<Pick<StockLedgerService, 'reverseMovement'>>('productionStockProvider')
}

const reportCrudIndexer: CrudIndexerConfig<ProductionReport> = { entityType: E.production.production_report }
const reportCrudEvents: CrudEventsConfig<ProductionReport> = { module: 'production', entity: 'report', persistent: true }

export type BackflushWarningReason = 'no_stock_item' | 'uom_mismatch' | 'insufficient_stock' | 'missing_conversion'

export type BackflushWarning = {
  materialId: string
  componentProductId: string
  variantId: string | null
  qty: number
  uom: string
  reason: BackflushWarningReason
}

/**
 * Resolves whether `productId`/`variantId` has backflush enabled (spec §
 * Data Models: `ProductPlanningParams.backflush bool default true`).
 *
 * Decision (task 4.1, documented since there is no separate ADR yet): when
 * NO `ProductPlanningParams` row exists for the product/variant, backflush
 * is treated as DISABLED (manual issue expected) rather than falling back to
 * the entity column's own `default: true`. Planning params are themselves
 * opt-in master data (Phase 1 CRUD); a product nobody has configured should
 * never have its components silently auto-consumed. This is the more
 * conservative of two readings and is called out explicitly here because
 * the alternative (entity default) is equally defensible.
 */
async function resolveBackflushEnabled(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  productId: string,
  variantId: string | null,
): Promise<boolean> {
  const params = await em.findOne(ProductPlanningParams, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    productId,
    variantId,
    deletedAt: null,
  })
  return params ? params.backflush : false
}

/**
 * Resolves the `unitCode -> toBaseFactor` conversion map for a set of
 * component product ids (spec § Data Models: "conversions go through
 * catalog's `catalog_product_unit_conversions`"). Mirrors the
 * `boms/[id]/cost-rollup/route.ts` query shape — a plain cross-module READ
 * (no ORM relation is declared on any production entity), which is the
 * sanctioned way core-hard-dependency data (catalog is always present) is
 * consulted from a command.
 */
async function loadUnitConversions(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  productIds: string[],
): Promise<Map<string, number>> {
  const byProductAndUnit = new Map<string, number>()
  if (productIds.length === 0) return byProductAndUnit
  const rows = await em.find(CatalogProductUnitConversion, {
    product: { $in: productIds },
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
    isActive: true,
  } as never)
  for (const row of rows) {
    const productRef = row.product as unknown as string | { id?: string }
    const productId = typeof productRef === 'string' ? productRef : (productRef?.id ?? null)
    if (!productId) continue
    const factor = Number(row.toBaseFactor)
    if (!Number.isFinite(factor) || factor <= 0) continue
    byProductAndUnit.set(`${productId}:${row.unitCode.trim().toLowerCase()}`, factor)
  }
  return byProductAndUnit
}

function toMaterialLines(materials: ProductionOrderMaterial[]): BackflushMaterialLine[] {
  return materials.map((m) => ({
    id: m.id,
    componentProductId: m.componentProductId,
    componentVariantId: m.componentVariantId ?? null,
    operationSequence: m.operationSequence ?? null,
    qtyPerUnit: Number(m.qtyRequired),
    scrapFactor: Number(m.scrapFactor),
    uom: m.uom,
  }))
}

/**
 * Backflush issue pass for a single report (spec § Status machine:
 * "configurable backflush ... per product"). Never throws for a stock-side
 * failure (missing stock item, UoM mismatch, insufficient stock, missing
 * conversion) — every such case is collected into `warnings` instead,
 * mirroring `commands/orders.ts#reserveMaterialsForOrder`'s "release never
 * blocks on a shortage" philosophy applied to reporting. `qtyIssued` is only
 * incremented for lines that actually succeeded.
 */
async function runBackflush(
  ctx: CommandRuntimeContext,
  em: EntityManager,
  order: ProductionOrder,
  operation: ProductionOrderOperation,
  report: ProductionReport,
  isLastReportingOperation: boolean,
): Promise<BackflushWarning[]> {
  const scope = { tenantId: order.tenantId, organizationId: order.organizationId }
  const warnings: BackflushWarning[] = []

  const backflushEnabled = await resolveBackflushEnabled(em, scope, order.productId, order.variantId ?? null)
  if (!backflushEnabled) return warnings

  const allMaterials = await em.find(ProductionOrderMaterial, { orderId: order.id, deletedAt: null })
  const materialLines = toMaterialLines(allMaterials)

  const selected = selectBackflushMaterials(materialLines, operation.sequence, isLastReportingOperation)
  if (selected.length === 0) return warnings

  const issueLines = computeBackflushIssueLines(selected, Number(report.qtyGood), Number(report.qtyScrap))
  const materialById = new Map(allMaterials.map((m) => [m.id, m]))

  const productIds = [...new Set(selected.map((m) => m.componentProductId))]
  const conversions = await loadUnitConversions(em, scope, productIds)

  const stockProvider = resolveStockProvider(ctx)
  const ref: StockMovementRef = { scope, sourceType: 'report', sourceId: report.id }

  const dirtyMaterials: ProductionOrderMaterial[] = []

  for (const line of issueLines) {
    const material = materialById.get(line.materialId)
    if (!material || line.qtyInMaterialUom <= 0) continue

    const stockItem = await em.findOne(StockItem, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      productId: line.componentProductId,
      variantId: line.componentVariantId,
    })
    if (!stockItem) {
      warnings.push({
        materialId: line.materialId,
        componentProductId: line.componentProductId,
        variantId: line.componentVariantId,
        qty: line.qtyInMaterialUom,
        uom: line.uom,
        reason: 'no_stock_item',
      })
      continue
    }

    const factor = conversions.get(`${line.componentProductId}:${line.uom.trim().toLowerCase()}`)
    const converted = convertQtyToStockUom(line.qtyInMaterialUom, line.uom, stockItem.uom, factor)
    if ('error' in converted) {
      warnings.push({
        materialId: line.materialId,
        componentProductId: line.componentProductId,
        variantId: line.componentVariantId,
        qty: line.qtyInMaterialUom,
        uom: line.uom,
        reason: 'missing_conversion',
      })
      continue
    }

    try {
      await stockProvider.issue(
        [{ productId: line.componentProductId, variantId: line.componentVariantId, qty: converted.qty, uom: stockItem.uom }],
        ref,
      )
    } catch (err) {
      if (err instanceof InsufficientStockError) {
        warnings.push({
          materialId: line.materialId,
          componentProductId: line.componentProductId,
          variantId: line.componentVariantId,
          qty: line.qtyInMaterialUom,
          uom: line.uom,
          reason: 'insufficient_stock',
        })
        continue
      }
      if (err instanceof StockUomMismatchError) {
        warnings.push({
          materialId: line.materialId,
          componentProductId: line.componentProductId,
          variantId: line.componentVariantId,
          qty: line.qtyInMaterialUom,
          uom: line.uom,
          reason: 'uom_mismatch',
        })
        continue
      }
      throw err
    }

    material.qtyIssued = String(Number(material.qtyIssued) + line.qtyInMaterialUom)
    material.updatedAt = new Date()
    dirtyMaterials.push(material)
  }

  if (dirtyMaterials.length > 0) {
    await withAtomicFlush(em, [() => {}], { transaction: true, label: 'production.reports.backflush' })
  }

  return warnings
}

// ---------------------------------------------------------------------------
// production.reports.create
// ---------------------------------------------------------------------------

export type ReportCreateResult = { id: string; warnings: BackflushWarning[] }

const createReportCommand: CommandHandler<ReportCreateInput, ReportCreateResult> = {
  id: 'production.reports.create',
  isUndoable: false,

  async execute(input, ctx) {
    const { tenantId, organizationId } = requireScopeIds(ctx)
    const { translate } = await resolveTranslations()
    const em = ctx.container.resolve<EntityManager>('em').fork()

    const operation = await em.findOne(ProductionOrderOperation, {
      id: input.orderOperationId,
      tenantId,
      organizationId,
      deletedAt: null,
    })
    if (!operation) {
      throw new CrudHttpError(404, { error: '[internal] Production order operation not found' })
    }

    const order = await em.findOne(ProductionOrder, { id: operation.orderId, tenantId, organizationId, deletedAt: null })
    if (!order) {
      throw new CrudHttpError(404, { error: '[internal] Production order not found' })
    }

    ensureTenantScope(ctx, order.tenantId)
    ensureOrganizationScope(ctx, order.organizationId)
    await enforceProductionOrderOptimisticLock(ctx, order)

    if (order.status !== 'released' && order.status !== 'in_progress') {
      throw new CrudHttpError(422, {
        error: translate(
          'production.errors.report_order_not_active',
          'Reports can only be recorded while the production order is released or in progress.',
        ),
      })
    }
    if (!operation.isReportingPoint) {
      throw new CrudHttpError(422, {
        error: translate('production.errors.report_not_reporting_point', 'This operation is not a reporting point.'),
      })
    }
    if (operation.status === 'done') {
      throw new CrudHttpError(409, {
        error: translate(
          'production.errors.report_operation_already_done',
          'This operation has already been finalized by another report.',
        ),
      })
    }

    const allOperations = await em.find(ProductionOrderOperation, { orderId: order.id, deletedAt: null })
    const reportingOps = allOperations.filter((o) => o.isReportingPoint).sort((a, b) => a.sequence - b.sequence)
    const isLastReportingOp = reportingOps.length > 0 && reportingOps[reportingOps.length - 1].id === operation.id

    const reporterUserId = ctx.auth?.sub
    if (!reporterUserId) {
      throw new CrudHttpError(401, { error: translate('production.errors.unauthorized', 'Unauthorized') })
    }

    let report!: ProductionReport
    const wasReleased = order.status === 'released'
    // Tracked explicitly (rather than re-reading `order.status === 'completed'`
    // after the mutation closure below) because TypeScript's control-flow
    // narrowing keeps `order.status` pinned to the `'released' | 'in_progress'`
    // literal union established by the guard above — it cannot see through
    // `transitionOrderToCompleted`'s internal mutation of the same object.
    let becameCompleted = false

    await withAtomicFlush(
      em,
      [
        () => {
          report = em.create(ProductionReport, {
            tenantId,
            organizationId,
            orderOperationId: operation.id,
            reporterUserId,
            qtyGood: String(input.qtyGood),
            qtyScrap: String(input.qtyScrap),
            scrapReasonEntryId: input.scrapReasonEntryId ?? null,
            startedAt: input.startedAt ?? null,
            finishedAt: input.finishedAt ?? null,
            reportType: input.reportType,
            reversesReportId: null,
          } as never)

          operation.qtyGood = String(Number(operation.qtyGood) + input.qtyGood)
          operation.qtyScrap = String(Number(operation.qtyScrap) + input.qtyScrap)
          operation.status = input.reportType === 'final' ? 'done' : 'in_progress'
          operation.updatedAt = new Date()

          if (wasReleased) {
            transitionOrderToInProgress(order)
          } else {
            order.updatedAt = new Date()
          }

          // Reviewer finding (task 4.1): these order-level totals — and the
          // FG receipt this triggers just below — must ONLY happen on the
          // TRUE completion event (final report on the LAST reporting-point
          // operation). A routing with >=1 reporting points BEFORE the last
          // one can also receive a `final` report against a non-last
          // operation (that operation is simply "done", the order stays
          // in_progress); gating on `input.reportType === 'final'` alone
          // would double/over-count qtyCompleted and over-receive finished
          // goods for every such intermediate final report.
          if (isLastReportingOp && input.reportType === 'final') {
            order.qtyCompleted = String(Number(order.qtyCompleted) + input.qtyGood)
            order.qtyScrapped = String(Number(order.qtyScrapped) + input.qtyScrap)
            transitionOrderToCompleted(order)
            becameCompleted = true
          }
        },
      ],
      { transaction: true, label: 'production.reports.create' },
    )

    const warnings = await runBackflush(ctx, em, order, operation, report, isLastReportingOp)

    // Finished-goods receipt (spec § API Contracts: "final report on last
    // reporting point triggers FG receipt"). This is the ONLY point in the
    // order's lifecycle a finished-goods receipt is ever created (no earlier
    // partial report receives anything), so the receipt quantity is simply
    // `order.qtyCompleted` as of THIS report (there is no "previously
    // received" amount to subtract — documented precisely per the task
    // brief). Never fails the already-committed report/order transition —
    // any provider error here is collected as a warning, matching the
    // backflush philosophy above.
    if (isLastReportingOp && input.reportType === 'final') {
      const stockProvider = resolveStockProvider(ctx)
      const ref: StockMovementRef = {
        scope: { tenantId, organizationId },
        sourceType: 'report',
        sourceId: report.id,
      }
      try {
        await stockProvider.receive(
          [{ productId: order.productId, variantId: order.variantId ?? null, qty: Number(order.qtyCompleted), uom: order.uom }],
          ref,
        )
      } catch (err) {
        if (err instanceof InsufficientStockError || err instanceof StockUomMismatchError) {
          warnings.push({
            materialId: order.id,
            componentProductId: order.productId,
            variantId: order.variantId ?? null,
            qty: Number(order.qtyCompleted),
            uom: order.uom,
            reason: err instanceof StockUomMismatchError ? 'uom_mismatch' : 'insufficient_stock',
          })
        } else {
          throw err
        }
      }
    }

    await emitCrudSideEffects({
      dataEngine: resolveDataEngine(ctx),
      action: 'created',
      entity: report,
      identifiers: { id: report.id, organizationId, tenantId },
      indexer: reportCrudIndexer,
      events: reportCrudEvents,
    })
    await emitProductionEvent('production.report.created', { id: report.id, tenantId, organizationId })

    // Note: the order's released -> in_progress transition (first report)
    // does NOT re-emit `production.order.released` — that event already
    // fired once, at actual release time (`commands/orders.ts#releaseOrderCommand`).
    // The events.ts contract has no dedicated "order started" event; only
    // `completed` is emitted here.
    if (becameCompleted) {
      await emitProductionEvent('production.order.completed', { id: order.id, tenantId, organizationId })
    }

    return { id: report.id, warnings }
  },

  async buildLog({ input, result }) {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('production.audit.report.create', 'Record production report'),
      resourceKind: 'production.report',
      resourceId: result.id,
      payload: { input, warnings: result.warnings },
    }
  },
}

// ---------------------------------------------------------------------------
// production.reports.reverse — storno (compensating report)
// ---------------------------------------------------------------------------

export type ReportReverseResult = { id: string; reversedMovementIds: string[] }

const reverseReportCommand: CommandHandler<ReportReverseInput, ReportReverseResult> = {
  id: 'production.reports.reverse',
  isUndoable: false,

  async execute(input, ctx) {
    const { tenantId, organizationId } = requireScopeIds(ctx)
    const { translate } = await resolveTranslations()
    const em = ctx.container.resolve<EntityManager>('em').fork()

    const original = await em.findOne(ProductionReport, { id: input.id, tenantId, organizationId })
    if (!original) {
      throw new CrudHttpError(404, { error: '[internal] Production report not found' })
    }
    if (original.reversesReportId) {
      throw new CrudHttpError(422, {
        error: translate(
          'production.errors.report_reverse_of_reversal_not_allowed',
          'A compensating (storno) report cannot itself be reversed.',
        ),
      })
    }

    const existingReversal = await em.findOne(ProductionReport, {
      reversesReportId: original.id,
      tenantId,
      organizationId,
    })
    if (existingReversal) {
      throw new CrudHttpError(409, {
        error: translate('production.errors.report_already_reversed', 'This report has already been reversed.'),
      })
    }

    const operation = await em.findOne(ProductionOrderOperation, {
      id: original.orderOperationId,
      tenantId,
      organizationId,
      deletedAt: null,
    })
    if (!operation) {
      throw new CrudHttpError(404, { error: '[internal] Production order operation not found' })
    }
    const order = await em.findOne(ProductionOrder, { id: operation.orderId, tenantId, organizationId, deletedAt: null })
    if (!order) {
      throw new CrudHttpError(404, { error: '[internal] Production order not found' })
    }

    ensureTenantScope(ctx, order.tenantId)
    ensureOrganizationScope(ctx, order.organizationId)
    await enforceProductionOrderOptimisticLock(ctx, order)

    const reporterUserId = ctx.auth?.sub
    if (!reporterUserId) {
      throw new CrudHttpError(401, { error: translate('production.errors.unauthorized', 'Unauthorized') })
    }

    // Storno of every stock movement THIS report originated (both backflush
    // issues and, for a final report, the finished-goods receipt all share
    // `sourceType: 'report'` + `sourceId: original.id` — see `runBackflush`
    // and the FG-receipt call in `createReportCommand`). Only originals
    // (`reversesMovementId: null`) are reversed — an already-reversed
    // movement is skipped, not re-reversed.
    const movements = await em.find(StockMovement, {
      tenantId,
      organizationId,
      sourceType: 'report',
      sourceId: original.id,
      reversesMovementId: null,
    })
    const stockLedger = resolveStockLedger(ctx)
    const reversedMovementIds: string[] = []

    // `isLastReportingOp` is needed regardless of whether backflush is
    // enabled — it also gates the order-level qtyCompleted/qtyScrapped
    // decrement and the completed->in_progress reopen below (reviewer
    // finding: it must NOT live only inside the backflush-only branch).
    const allOperations = await em.find(ProductionOrderOperation, { orderId: order.id, deletedAt: null })
    const reportingOps = allOperations.filter((o) => o.isReportingPoint).sort((a, b) => a.sequence - b.sequence)
    const isLastReportingOp = reportingOps.length > 0 && reportingOps[reportingOps.length - 1].id === operation.id

    // Re-derive the SAME per-material backflush deltas this report
    // originally produced (deterministic given the immutable order/material
    // snapshot rows — see `lib/backflush.ts` module doc) so `qtyIssued` can
    // be decremented without a separate persisted per-report/per-material
    // ledger. Loaded BEFORE the atomic phase below so the mutation closure
    // stays synchronous.
    const backflushEnabled = await resolveBackflushEnabled(em, { tenantId, organizationId }, order.productId, order.variantId ?? null)
    const allMaterials = await em.find(ProductionOrderMaterial, { orderId: order.id, deletedAt: null })
    const materialDeltas = new Map<string, number>()
    if (backflushEnabled) {
      const materialLines = toMaterialLines(allMaterials)
      const selected = selectBackflushMaterials(materialLines, operation.sequence, isLastReportingOp)
      const issueLines = computeBackflushIssueLines(selected, Number(original.qtyGood), Number(original.qtyScrap))
      for (const line of issueLines) materialDeltas.set(line.materialId, line.qtyInMaterialUom)
    }
    const materialById = new Map(allMaterials.map((m) => [m.id, m]))

    let compensating!: ProductionReport
    try {
      for (const movement of movements) {
        const { movementId } = await stockLedger.reverseMovement(movement.id, { tenantId, organizationId })
        reversedMovementIds.push(movementId)
      }

      await withAtomicFlush(
        em,
        [
          () => {
            compensating = em.create(ProductionReport, {
              tenantId,
              organizationId,
              orderOperationId: original.orderOperationId,
              reporterUserId,
              qtyGood: String(-Number(original.qtyGood)),
              qtyScrap: String(-Number(original.qtyScrap)),
              scrapReasonEntryId: original.scrapReasonEntryId ?? null,
              startedAt: null,
              finishedAt: null,
              reportType: original.reportType,
              reversesReportId: original.id,
            } as never)

            operation.qtyGood = String(Math.max(0, Number(operation.qtyGood) - Number(original.qtyGood)))
            operation.qtyScrap = String(Math.max(0, Number(operation.qtyScrap) - Number(original.qtyScrap)))
            if (operation.status === 'done') operation.status = 'in_progress'
            operation.updatedAt = new Date()

            // Symmetric with the create-side gate above: only the TRUE
            // completion event (final report on the LAST reporting-point
            // operation) touched qtyCompleted/qtyScrapped and completed the
            // order, so only reversing THAT report undoes them (and reopens
            // the order — see `reopenOrderFromReversal`'s doc comment for the
            // full rationale; `ProductionOrder` has no `completedAt`-style
            // column to also revert, only `releasedAt`, untouched here).
            if (isLastReportingOp && original.reportType === 'final') {
              order.qtyCompleted = String(Math.max(0, Number(order.qtyCompleted) - Number(original.qtyGood)))
              order.qtyScrapped = String(Math.max(0, Number(order.qtyScrapped) - Number(original.qtyScrap)))
              if (order.status === 'completed') {
                reopenOrderFromReversal(order)
              }
            }
            order.updatedAt = new Date()

            for (const [materialId, delta] of materialDeltas) {
              const material = materialById.get(materialId)
              if (!material) continue
              material.qtyIssued = String(Math.max(0, Number(material.qtyIssued) - delta))
              material.updatedAt = new Date()
            }
          },
        ],
        { transaction: true, label: 'production.reports.reverse' },
      )
    } catch (err) {
      if (err instanceof UniqueConstraintViolationException) {
        throw new CrudHttpError(409, {
          error: translate('production.errors.report_already_reversed', 'This report has already been reversed.'),
        })
      }
      throw err
    }

    await emitCrudSideEffects({
      dataEngine: resolveDataEngine(ctx),
      action: 'created',
      entity: compensating,
      identifiers: { id: compensating.id, organizationId, tenantId },
      indexer: reportCrudIndexer,
    })
    await emitProductionEvent('production.report.reversed', { id: original.id, tenantId, organizationId })

    return { id: compensating.id, reversedMovementIds }
  },

  async buildLog({ input, result }) {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('production.audit.report.reverse', 'Reverse production report'),
      resourceKind: 'production.report',
      resourceId: result.id,
      relatedResourceKind: 'production.report',
      relatedResourceId: input.id,
      payload: { input, result },
    }
  },
}

registerCommand(createReportCommand)
registerCommand(reverseReportCommand)
