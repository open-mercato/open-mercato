/**
 * The one registry shape every time-tracking strategy registry is built from
 * (EP-32…EP-41 of `.ai/specs/2026-08-24-time-tracking-umes-extension-points.md`).
 *
 * It follows the house provider idiom — `registerPaymentProvider` /
 * `registerShippingProvider` in `modules/sales/lib/providers/registry.ts`: a
 * module-level `Map`, a `register` that returns its own disposer, and plain
 * lookup helpers. That makes every registry reachable from the browser bundle as
 * well as the server, which matters because four of these strategies are
 * consulted by client previews that cannot resolve DI.
 *
 * Ordering is the only thing added on top of the sales idiom, and it is what
 * keeps "no contribution means no behaviour change" true: entries are served in
 * descending `priority`, ties broken by registration order, and every built-in
 * registers at `BUILT_IN_STRATEGY_PRIORITY` — far below the default of `0` — so
 * a built-in is always the last candidate considered.
 */

export const BUILT_IN_STRATEGY_PRIORITY = -1000

export type RegisteredStrategy = {
  id: string
  priority?: number
}

export type StrategyRegistry<TEntry extends RegisteredStrategy> = {
  registryId: string
  register(entry: TEntry): () => void
  get(id: string | null | undefined): TEntry | null
  has(id: string | null | undefined): boolean
  list(): TEntry[]
  ids(): string[]
}

type Slot<TEntry extends RegisteredStrategy> = {
  entry: TEntry
  sequence: number
}

function orderSlots<TEntry extends RegisteredStrategy>(left: Slot<TEntry>, right: Slot<TEntry>): number {
  const leftPriority = left.entry.priority ?? 0
  const rightPriority = right.entry.priority ?? 0
  if (leftPriority !== rightPriority) return rightPriority - leftPriority
  return left.sequence - right.sequence
}

export function createStrategyRegistry<TEntry extends RegisteredStrategy>(
  registryId: string,
): StrategyRegistry<TEntry> {
  const slots = new Map<string, Slot<TEntry>>()
  let sequence = 0

  const register = (entry: TEntry): (() => void) => {
    const id = typeof entry?.id === 'string' ? entry.id.trim() : ''
    if (!id) throw new Error(`[internal] ${registryId} requires a non-empty strategy id`)
    sequence += 1
    const slot: Slot<TEntry> = { entry: { ...entry, id }, sequence }
    slots.set(id, slot)
    return () => {
      if (slots.get(id) === slot) slots.delete(id)
    }
  }

  const list = (): TEntry[] =>
    Array.from(slots.values())
      .sort(orderSlots)
      .map((slot) => slot.entry)

  const get = (id: string | null | undefined): TEntry | null => {
    if (typeof id !== 'string') return null
    return slots.get(id.trim())?.entry ?? null
  }

  return {
    registryId,
    register,
    get,
    has: (id) => get(id) !== null,
    list,
    ids: () => list().map((entry) => entry.id),
  }
}
