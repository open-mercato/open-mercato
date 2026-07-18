/**
 * Pure `ProductionOrder` status machine (spec § Status machine).
 *
 * `draft → planned → released → in_progress → completed → closed`,
 * `cancelled` reachable from `draft|planned|released`. This module only
 * knows the *shape* of allowed transitions and a couple of structural guard
 * predicates that do not require I/O (aggregate-level checks such as "does an
 * active BOM/routing version exist" or "does the DB reservation ledger have
 * an active row" live in `commands/orders.ts`, which calls into this table
 * before doing any I/O so illegal transitions never reach a DB write).
 *
 * `closed` and `cancelled` are terminal — no transition is allowed out of
 * either. `completed`'s only outbound transition is to `closed`.
 */

export type ProductionOrderStatus =
  | 'draft'
  | 'planned'
  | 'released'
  | 'in_progress'
  | 'completed'
  | 'closed'
  | 'cancelled'

/**
 * Allowed-transitions map: `key` is the current status, `value` is the set of
 * statuses that can be transitioned to directly from it.
 */
export const ALLOWED_TRANSITIONS: Record<ProductionOrderStatus, ProductionOrderStatus[]> = {
  draft: ['planned', 'cancelled'],
  planned: ['released', 'cancelled'],
  released: ['in_progress', 'cancelled'],
  in_progress: ['completed'],
  completed: ['closed'],
  closed: [],
  cancelled: [],
}

export class IllegalOrderTransitionError extends Error {
  constructor(
    public readonly from: ProductionOrderStatus,
    public readonly to: ProductionOrderStatus,
  ) {
    super(`[internal] Illegal production order transition: ${from} -> ${to}`)
    this.name = 'IllegalOrderTransitionError'
  }
}

/** Pure predicate — does the map allow `from -> to`? */
export function canTransitionOrderStatus(from: ProductionOrderStatus, to: ProductionOrderStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false
}

/**
 * Throws {@link IllegalOrderTransitionError} when `from -> to` is not in the
 * allowed-transitions map. Callers (commands/orders.ts) call this BEFORE any
 * DB write so an illegal transition never partially mutates state.
 */
export function assertOrderTransition(from: ProductionOrderStatus, to: ProductionOrderStatus): void {
  if (!canTransitionOrderStatus(from, to)) {
    throw new IllegalOrderTransitionError(from, to)
  }
}

/** Statuses `cancel` is allowed to run from (spec § Status machine). */
export const CANCELLABLE_FROM: ProductionOrderStatus[] = ['draft', 'planned', 'released']

export function canCancelFromStatus(status: ProductionOrderStatus): boolean {
  return CANCELLABLE_FROM.includes(status)
}
