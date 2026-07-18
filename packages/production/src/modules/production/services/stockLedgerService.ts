import type { EntityManager } from '@mikro-orm/postgresql'
import { UniqueConstraintViolationException } from '@mikro-orm/core'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import { StockItem, StockBatch, StockMovement, MaterialReservation } from '../data/entities.js'
import {
  StockUomMismatchError,
  InsufficientStockError,
  DoubleReversalError,
  type ProductionStockProvider,
  type StockScope,
  type StockLine,
  type StockMovementRef,
  type StockBatchSummary,
} from '../lib/stockProvider.js'
import { E } from '../../../../generated/entities.ids.generated.js'

/**
 * Default `productionStockProvider` implementation (spec decision i),
 * backed by the module-owned `production_stock_*` tables. Only the
 * {@link ProductionStockProvider} interface + the `production.stock_movement.created`
 * event are contract surfaces; these tables/methods beyond the interface
 * (e.g. `reverseMovement`) are an implementation detail a future warehouse
 * module can replace wholesale.
 *
 * Every mutation runs inside `withAtomicFlush({ transaction: true })` so the
 * movement row and the on-hand/reserved/batch updates it implies commit or
 * roll back together (decision h — append-only ledger, no negative stock).
 *
 * Side-effect flush contract: every mutating method here calls
 * `emitCrudSideEffects` itself (inline, right after the atomic phase commits)
 * rather than deferring reindex/event emission to the caller. This means the
 * flush happens the same way whether a method is invoked through the command
 * bus (`commands/stock.ts`) or from a raw, non-command route — callers of
 * *this* provider never need `flushOrmEntityChanges`. This is an
 * implementation choice of `StockLedgerService`, not a guarantee of the
 * `ProductionStockProvider` interface: a future implementation that instead
 * batches/defers its side effects would need callers reached via a raw route
 * (i.e. not through `commandBus.execute`, which flushes on its own) to call
 * `flushOrmEntityChanges` explicitly after the mutation.
 */
export class StockLedgerService implements ProductionStockProvider {
  constructor(
    private em: () => EntityManager,
    private dataEngine: DataEngine,
  ) {}

  private resolveEm(): EntityManager {
    return this.em().fork()
  }

  private static readonly movementIndexer: CrudIndexerConfig<StockMovement> = {
    entityType: E.production.stock_movement,
  }

  // `production.stock_movement.created` (events.ts) — every movement, including
  // storno compensating movements, is a `created` append — there is no
  // `updated`/`deleted` lifecycle for this entity.
  private static readonly movementEvents: CrudEventsConfig<StockMovement> = {
    module: 'production',
    entity: 'stock_movement',
    persistent: true,
  }

  private async emitMovementCreated(movement: StockMovement): Promise<void> {
    await emitCrudSideEffects({
      dataEngine: this.dataEngine,
      action: 'created',
      entity: movement,
      identifiers: { id: movement.id, organizationId: movement.organizationId, tenantId: movement.tenantId },
      indexer: StockLedgerService.movementIndexer,
      events: StockLedgerService.movementEvents,
    })
  }

  private async findStockItem(
    em: EntityManager,
    scope: StockScope,
    productId: string,
    variantId: string | null | undefined,
  ): Promise<StockItem | null> {
    return em.findOne(StockItem, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      productId,
      variantId: variantId ?? null,
    })
  }

  private async resolveOrCreateStockItem(
    em: EntityManager,
    scope: StockScope,
    productId: string,
    variantId: string | null | undefined,
    uom: string,
  ): Promise<StockItem> {
    const existing = await this.findStockItem(em, scope, productId, variantId)
    if (existing) {
      if (existing.uom !== uom) throw new StockUomMismatchError(existing.uom, uom)
      return existing
    }
    const created = em.create(StockItem, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      productId,
      variantId: variantId ?? null,
      uom,
      onHand: '0',
      reserved: '0',
    } as never)
    em.persist(created)
    return created
  }

  private async resolveOrCreateBatch(
    em: EntityManager,
    scope: StockScope,
    stockItem: StockItem,
    batchId: string | null | undefined,
    batchNumber: string | null | undefined,
    expiresAt?: Date | null,
  ): Promise<StockBatch | null> {
    if (batchId) {
      // Defense-in-depth (2.1 review carried minor #1): scope the lookup by
      // tenant/organization too, not just the (already tenant-scoped)
      // stockItem.id, so a cross-tenant/org batchId can never be matched here.
      const existing = await em.findOne(StockBatch, {
        id: batchId,
        stockItemId: stockItem.id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      })
      if (!existing) throw new InsufficientStockError(`Batch ${batchId} not found for stock item ${stockItem.id}`)
      return existing
    }
    if (batchNumber) {
      const existing = await em.findOne(StockBatch, {
        stockItemId: stockItem.id,
        batchNumber,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      })
      if (existing) return existing
      // `expiresAt` is only ever applied when creating a brand-new batch — an
      // existing batch's expiry is never silently overwritten by a later
      // receipt line that happens to omit/repeat the same batch number.
      const created = em.create(StockBatch, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        stockItemId: stockItem.id,
        batchNumber,
        onHand: '0',
        expiresAt: expiresAt ?? null,
      } as never)
      em.persist(created)
      return created
    }
    return null
  }

  private applyOnHandDelta(item: StockItem, delta: number): void {
    const next = Number(item.onHand) + delta
    if (next < 0) throw new InsufficientStockError(`Stock item ${item.id} on-hand would go negative`)
    item.onHand = String(next)
  }

  private applyBatchOnHandDelta(batch: StockBatch, delta: number): void {
    const next = Number(batch.onHand) + delta
    if (next < 0) throw new InsufficientStockError(`Stock batch ${batch.id} on-hand would go negative`)
    batch.onHand = String(next)
  }

  private buildMovement(
    em: EntityManager,
    scope: StockScope,
    input: {
      movementType: 'receipt' | 'issue' | 'adjustment'
      productId: string
      variantId: string | null
      batchId: string | null
      qty: number
      uom: string
      reasonEntryId: string | null
      sourceType: StockMovementRef['sourceType']
      sourceId: string | null
      reversesMovementId?: string | null
    },
  ): StockMovement {
    const movement = em.create(StockMovement, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      movementType: input.movementType,
      productId: input.productId,
      variantId: input.variantId,
      batchId: input.batchId,
      qty: String(input.qty),
      uom: input.uom,
      reasonEntryId: input.reasonEntryId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      reversesMovementId: input.reversesMovementId ?? null,
    } as never)
    em.persist(movement)
    return movement
  }

  async getOnHand(
    scope: StockScope,
    productId: string,
    variantId: string | null | undefined,
    uom: string,
  ): Promise<number> {
    const em = this.resolveEm()
    const item = await this.findStockItem(em, scope, productId, variantId)
    if (!item) return 0
    if (item.uom !== uom) throw new StockUomMismatchError(item.uom, uom)
    return Number(item.onHand)
  }

  async receive(lines: StockLine[], ref: StockMovementRef): Promise<{ movementIds: string[] }> {
    const em = this.resolveEm()
    const movements: StockMovement[] = []

    await withAtomicFlush(
      em,
      [
        async () => {
          for (const line of lines) {
            const stockItem = await this.resolveOrCreateStockItem(em, ref.scope, line.productId, line.variantId, line.uom)
            const batch = await this.resolveOrCreateBatch(em, ref.scope, stockItem, line.batchId, line.batchNumber, line.expiresAt)
            this.applyOnHandDelta(stockItem, line.qty)
            if (batch) this.applyBatchOnHandDelta(batch, line.qty)
            stockItem.updatedAt = new Date()
            const movement = this.buildMovement(em, ref.scope, {
              movementType: 'receipt',
              productId: line.productId,
              variantId: line.variantId ?? null,
              batchId: batch?.id ?? null,
              qty: line.qty,
              uom: line.uom,
              reasonEntryId: ref.reasonEntryId ?? null,
              sourceType: ref.sourceType,
              sourceId: ref.sourceId ?? null,
            })
            movements.push(movement)
          }
        },
      ],
      { transaction: true, label: 'production.stock.receive' },
    )

    for (const movement of movements) await this.emitMovementCreated(movement)
    return { movementIds: movements.map((m) => m.id) }
  }

  async issue(lines: StockLine[], ref: StockMovementRef): Promise<{ movementIds: string[] }> {
    const em = this.resolveEm()
    const movements: StockMovement[] = []

    await withAtomicFlush(
      em,
      [
        async () => {
          for (const line of lines) {
            const stockItem = await this.findStockItem(em, ref.scope, line.productId, line.variantId)
            if (!stockItem) throw new InsufficientStockError(`No stock item for product ${line.productId}`)
            if (stockItem.uom !== line.uom) throw new StockUomMismatchError(stockItem.uom, line.uom)

            const available = Number(stockItem.onHand) - Number(stockItem.reserved)
            if (line.qty > available) {
              throw new InsufficientStockError(
                `Requested issue qty ${line.qty} exceeds available (on_hand - reserved) ${available} for product ${line.productId}`,
              )
            }

            const batch = line.batchId
              ? await this.resolveOrCreateBatch(em, ref.scope, stockItem, line.batchId, line.batchNumber)
              : null

            this.applyOnHandDelta(stockItem, -line.qty)
            if (batch) this.applyBatchOnHandDelta(batch, -line.qty)
            stockItem.updatedAt = new Date()

            const movement = this.buildMovement(em, ref.scope, {
              movementType: 'issue',
              productId: line.productId,
              variantId: line.variantId ?? null,
              batchId: batch?.id ?? null,
              qty: -line.qty,
              uom: line.uom,
              reasonEntryId: ref.reasonEntryId ?? null,
              sourceType: ref.sourceType,
              sourceId: ref.sourceId ?? null,
            })
            movements.push(movement)
          }
        },
      ],
      { transaction: true, label: 'production.stock.issue' },
    )

    for (const movement of movements) await this.emitMovementCreated(movement)
    return { movementIds: movements.map((m) => m.id) }
  }

  async adjust(line: StockLine, reasonEntryId: string | null, ref: StockMovementRef): Promise<{ movementId: string }> {
    const em = this.resolveEm()
    let movement: StockMovement | undefined

    await withAtomicFlush(
      em,
      [
        async () => {
          const stockItem = await this.resolveOrCreateStockItem(em, ref.scope, line.productId, line.variantId, line.uom)
          const batch = await this.resolveOrCreateBatch(em, ref.scope, stockItem, line.batchId, line.batchNumber, line.expiresAt)

          this.applyOnHandDelta(stockItem, line.qty)
          if (batch) this.applyBatchOnHandDelta(batch, line.qty)
          stockItem.updatedAt = new Date()

          movement = this.buildMovement(em, ref.scope, {
            movementType: 'adjustment',
            productId: line.productId,
            variantId: line.variantId ?? null,
            batchId: batch?.id ?? null,
            qty: line.qty,
            uom: line.uom,
            reasonEntryId: reasonEntryId ?? ref.reasonEntryId ?? null,
            sourceType: ref.sourceType,
            sourceId: ref.sourceId ?? null,
          })
        },
      ],
      { transaction: true, label: 'production.stock.adjust' },
    )

    await this.emitMovementCreated(movement as StockMovement)
    return { movementId: (movement as StockMovement).id }
  }

  async reserve(lines: StockLine[], ref: StockMovementRef): Promise<{ reservationIds: string[] }> {
    const em = this.resolveEm()
    const reservations: MaterialReservation[] = []

    await withAtomicFlush(
      em,
      [
        async () => {
          for (const line of lines) {
            const stockItem = await this.resolveOrCreateStockItem(em, ref.scope, line.productId, line.variantId, line.uom)
            const available = Number(stockItem.onHand) - Number(stockItem.reserved)
            if (line.qty > available) {
              throw new InsufficientStockError(
                `Requested reservation qty ${line.qty} exceeds available (on_hand - reserved) ${available} for product ${line.productId}`,
              )
            }
            stockItem.reserved = String(Number(stockItem.reserved) + line.qty)
            stockItem.updatedAt = new Date()

            const reservation = em.create(MaterialReservation, {
              tenantId: ref.scope.tenantId,
              organizationId: ref.scope.organizationId,
              orderId: ref.sourceId ?? null,
              orderMaterialId: null,
              stockItemId: stockItem.id,
              batchId: line.batchId ?? null,
              qty: String(line.qty),
              uom: line.uom,
              status: 'active',
            } as never)
            em.persist(reservation)
            reservations.push(reservation)
          }
        },
      ],
      { transaction: true, label: 'production.stock.reserve' },
    )

    return { reservationIds: reservations.map((r) => r.id) }
  }

  async releaseReservations(ref: StockMovementRef): Promise<{ releasedIds: string[] }> {
    if (!ref.sourceId) return { releasedIds: [] }
    const em = this.resolveEm()
    const released: MaterialReservation[] = []

    await withAtomicFlush(
      em,
      [
        async () => {
          const active = await em.find(MaterialReservation, {
            tenantId: ref.scope.tenantId,
            organizationId: ref.scope.organizationId,
            orderId: ref.sourceId,
            status: 'active',
          })
          for (const reservation of active) {
            // Defense-in-depth (2.1 review carried minor #1): scope by
            // tenant/organization too, not just id.
            const stockItem = await em.findOne(StockItem, {
              id: reservation.stockItemId,
              tenantId: ref.scope.tenantId,
              organizationId: ref.scope.organizationId,
            })
            if (stockItem) {
              stockItem.reserved = String(Math.max(0, Number(stockItem.reserved) - Number(reservation.qty)))
              stockItem.updatedAt = new Date()
            }
            reservation.status = 'released'
            reservation.updatedAt = new Date()
            released.push(reservation)
          }
        },
      ],
      { transaction: true, label: 'production.stock.releaseReservations' },
    )

    return { releasedIds: released.map((r) => r.id) }
  }

  async findBatches(scope: StockScope, productId: string): Promise<StockBatchSummary[]> {
    const em = this.resolveEm()
    const items = await em.find(StockItem, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      productId,
    })
    if (items.length === 0) return []
    const batches = await em.find(StockBatch, { stockItemId: { $in: items.map((i) => i.id) } })
    return batches.map((b) => ({
      id: b.id,
      batchNumber: b.batchNumber,
      onHand: Number(b.onHand),
      expiresAt: b.expiresAt ?? null,
    }))
  }

  /**
   * Storno (decision h): reverses `movementId` by creating a compensating
   * movement (`reversesMovementId` -> `movementId`) that restores the prior
   * on-hand/batch state. Not part of the {@link ProductionStockProvider}
   * interface (spec decision i lists no `reverse*` method) — exposed here as
   * the concrete correction API for the command layer that will wrap it once
   * routes exist (Phase 2.2).
   */
  async reverseMovement(movementId: string, scope: StockScope): Promise<{ movementId: string }> {
    const em = this.resolveEm()
    let reversal: StockMovement | undefined

    try {
      await withAtomicFlush(
        em,
        [
          async () => {
            const original = await em.findOne(StockMovement, {
              id: movementId,
              tenantId: scope.tenantId,
              organizationId: scope.organizationId,
            })
            if (!original) throw new InsufficientStockError(`Stock movement ${movementId} not found`)

            // Defense-in-depth (2.1 review carried minor #1): scope this
            // lookup by tenant/organization too, not just the movement id.
            const existingReversal = await em.findOne(StockMovement, {
              reversesMovementId: movementId,
              tenantId: scope.tenantId,
              organizationId: scope.organizationId,
            })
            if (existingReversal) throw new DoubleReversalError(movementId)

            const stockItem = await this.findStockItem(em, scope, original.productId, original.variantId)
            if (!stockItem) throw new InsufficientStockError(`Stock item for product ${original.productId} not found`)
            const batch = original.batchId
              ? await em.findOne(StockBatch, { id: original.batchId, tenantId: scope.tenantId, organizationId: scope.organizationId })
              : null

            const compensatingQty = -Number(original.qty)
            this.applyOnHandDelta(stockItem, compensatingQty)
            if (batch) this.applyBatchOnHandDelta(batch, compensatingQty)
            stockItem.updatedAt = new Date()

            reversal = this.buildMovement(em, scope, {
              movementType: original.movementType,
              productId: original.productId,
              variantId: original.variantId ?? null,
              batchId: original.batchId ?? null,
              qty: compensatingQty,
              uom: original.uom,
              reasonEntryId: original.reasonEntryId ?? null,
              sourceType: original.sourceType,
              sourceId: original.sourceId ?? null,
              reversesMovementId: original.id,
            })
          },
        ],
        { transaction: true, label: 'production.stock.reverseMovement' },
      )
    } catch (err) {
      // Carried minor #2 (2.1 review): the pre-check above (`existingReversal`)
      // is a TOCTOU race under concurrent double-storno — two requests can both
      // pass the check before either flushes. The unique index on
      // `reverses_movement_id` (`production_stock_movements_reverses_unique`)
      // is the actual guard; translate its violation into the same
      // `DoubleReversalError` the pre-check throws, so callers see one
      // consistent error regardless of which path caught the race.
      if (err instanceof UniqueConstraintViolationException) {
        throw new DoubleReversalError(movementId)
      }
      throw err
    }

    await this.emitMovementCreated(reversal as StockMovement)
    return { movementId: (reversal as StockMovement).id }
  }
}
