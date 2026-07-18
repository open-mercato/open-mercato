import type { StockMovementSourceType } from '../data/entities.js'

/**
 * `productionStockProvider` DI seam (spec § Decisions, row i).
 *
 * Only this interface and the events it emits (`production.stock_movement.created`)
 * are contract surfaces — the `production_stock_*` tables backing the default
 * implementation are an internal detail. A future warehouse module can register
 * its own implementation under the same DI token (`productionStockProvider`)
 * with a one-time data migration from these tables; the production module
 * itself does not change (extraction path documented in the spec).
 *
 * UoM handling (Phase 2 decision, documented per the task brief): this
 * interface does NOT perform unit conversion. Every call must pass the exact
 * `uom` the caller believes the line is expressed in; the default
 * implementation compares it against the `StockItem`'s own `uom` and rejects a
 * mismatch with {@link StockUomMismatchError} rather than silently converting.
 * UoM conversion (reusing the cost-rollup-style conversion approach) is left
 * as a Phase 2.2+ concern once the API layer needs to translate that error
 * into a user-facing message.
 */

export type StockScope = { tenantId: string; organizationId: string }

/** One quantity line for a stock mutation. `batchNumber` may be supplied on
 * `receive` to create/find a batch by number when `batchId` is not yet known.
 * `expiresAt` is only applied when `receive`/`adjust` creates a brand-new
 * batch for that `batchNumber` — it never overwrites the expiry of an
 * already-existing batch. */
export type StockLine = {
  productId: string
  variantId?: string | null
  batchId?: string | null
  batchNumber?: string | null
  expiresAt?: Date | null
  qty: number
  uom: string
}

/** Traceability + dictionary-reason context attached to every mutating call
 * (also carries `scope`, since the spec's positional signatures only show it
 * explicitly for `getOnHand`/`findBatches` — see module doc for the reason). */
export type StockMovementRef = {
  scope: StockScope
  sourceType: StockMovementSourceType
  sourceId?: string | null
  reasonEntryId?: string | null
}

export type StockBatchSummary = {
  id: string
  batchNumber: string
  onHand: number
  expiresAt: Date | null
}

/**
 * `message` stays `[internal]`-tagged (server logs / diagnostics only —
 * never rendered to a user). Callers that need to surface this to an
 * operator MUST translate a `production.errors.*` key using the structured
 * `expected`/`actual` fields below rather than forwarding `message` (review
 * finding: raw `[internal]` messages, including row UUIDs, were leaking
 * verbatim into `CrudHttpError` bodies that `CrudForm` renders as-is).
 */
export class StockUomMismatchError extends Error {
  constructor(
    public readonly expected: string,
    public readonly actual: string,
  ) {
    super(`[internal] Stock item uom mismatch: expected "${expected}", got "${actual}"`)
    this.name = 'StockUomMismatchError'
  }
}

/** See {@link StockUomMismatchError} doc — `message` is internal-only. */
export class InsufficientStockError extends Error {
  constructor(message: string) {
    super(`[internal] ${message}`)
    this.name = 'InsufficientStockError'
  }
}

/** See {@link StockUomMismatchError} doc — `message` is internal-only. */
export class DoubleReversalError extends Error {
  constructor(public readonly movementId: string) {
    super(`[internal] Stock movement ${movementId} has already been reversed`)
    this.name = 'DoubleReversalError'
  }
}

/**
 * Spec decision (i) interface — exact method list:
 * `getOnHand`, `reserve`, `releaseReservations`, `issue`, `receive`, `adjust`,
 * `findBatches`.
 */
export interface ProductionStockProvider {
  getOnHand(scope: StockScope, productId: string, variantId: string | null | undefined, uom: string): Promise<number>
  reserve(lines: StockLine[], ref: StockMovementRef): Promise<{ reservationIds: string[] }>
  releaseReservations(ref: StockMovementRef): Promise<{ releasedIds: string[] }>
  /**
   * Records an `issue` movement (decrements on-hand). Does NOT auto-release
   * any active {@link MaterialReservation} for the consumed line — issuing
   * against a reservation and releasing that reservation are separate calls.
   * A caller that reserves material and later issues it (e.g. a production
   * order consuming its reserved components) MUST sequence its own
   * `releaseReservations(ref)` call after `issue(...)` succeeds; this
   * provider will not do it implicitly.
   */
  issue(lines: StockLine[], ref: StockMovementRef): Promise<{ movementIds: string[] }>
  receive(lines: StockLine[], ref: StockMovementRef): Promise<{ movementIds: string[] }>
  adjust(line: StockLine, reasonEntryId: string | null, ref: StockMovementRef): Promise<{ movementId: string }>
  findBatches(scope: StockScope, productId: string): Promise<StockBatchSummary[]>
}
