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
 *
 * **A built-in is not just a low-priority entry, it is a separate slot.** The
 * fail-closed rule in `scope.ts` lands an unscoped call on "the built-in", and the
 * whole point of that rule is that the built-in is the same pure code the module
 * shipped before the registries existed. With one map keyed by id and last-writer-
 * wins semantics, a contribution registering under a published built-in id BECAME
 * the built-in: it ran on the unscoped path the gate exists to keep byte-identical,
 * and its disposer then deleted the real built-in permanently, after which every
 * resolver that requires one throws. So `registerBuiltIn` writes to a map
 * `register` cannot reach, `register` refuses a built-in id outright, and no
 * disposer can remove a built-in.
 */

export const BUILT_IN_STRATEGY_PRIORITY = -1000

export type RegisteredStrategy = {
  id: string
  priority?: number
}

export type StrategyRegistry<TEntry extends RegisteredStrategy> = {
  registryId: string
  /**
   * Registers the module's own default. Not part of the contribution surface —
   * module-load code only. The returned entry is the identity every resolver
   * should compare against rather than re-looking the id up.
   */
  registerBuiltIn(entry: TEntry): TEntry
  /** Contributes a strategy. Throws on a built-in id. Returns its own disposer. */
  register(entry: TEntry): () => void
  get(id: string | null | undefined): TEntry | null
  has(id: string | null | undefined): boolean
  isBuiltIn(id: string | null | undefined): boolean
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
  const builtInSlots = new Map<string, Slot<TEntry>>()
  const contributedSlots = new Map<string, Slot<TEntry>>()
  let sequence = 0

  const readId = (entry: TEntry): string => {
    const id = typeof entry?.id === 'string' ? entry.id.trim() : ''
    if (!id) throw new Error(`[internal] ${registryId} requires a non-empty strategy id`)
    return id
  }

  const registerBuiltIn = (entry: TEntry): TEntry => {
    const id = readId(entry)
    if (builtInSlots.has(id)) {
      throw new Error(`[internal] ${registryId} already has a built-in registered as ${id}`)
    }
    sequence += 1
    const slot: Slot<TEntry> = { entry: { ...entry, id }, sequence }
    builtInSlots.set(id, slot)
    return slot.entry
  }

  const register = (entry: TEntry): (() => void) => {
    const id = readId(entry)
    if (builtInSlots.has(id)) {
      throw new Error(
        `[internal] ${id} is a built-in ${registryId} strategy and cannot be replaced; register your own id`,
      )
    }
    sequence += 1
    const slot: Slot<TEntry> = { entry: { ...entry, id }, sequence }
    contributedSlots.set(id, slot)
    return () => {
      if (contributedSlots.get(id) === slot) contributedSlots.delete(id)
    }
  }

  const list = (): TEntry[] =>
    [...contributedSlots.values(), ...builtInSlots.values()].sort(orderSlots).map((slot) => slot.entry)

  const get = (id: string | null | undefined): TEntry | null => {
    if (typeof id !== 'string') return null
    const trimmed = id.trim()
    return contributedSlots.get(trimmed)?.entry ?? builtInSlots.get(trimmed)?.entry ?? null
  }

  return {
    registryId,
    registerBuiltIn,
    register,
    get,
    has: (id) => get(id) !== null,
    isBuiltIn: (id) => typeof id === 'string' && builtInSlots.has(id.trim()),
    list,
    ids: () => list().map((entry) => entry.id),
  }
}
