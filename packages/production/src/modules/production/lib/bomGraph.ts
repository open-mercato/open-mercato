/**
 * Pure, data-first BOM graph helpers (spec § MRP engine, decision g/technology snapshot).
 *
 * These are the low-level-code BOM explosion building blocks reused later by
 * the Phase 5 MRP engine. They MUST stay free of ORM access: callers bulk-load
 * `ProductionBomItem` rows per BOM and pass them in as plain data.
 *
 * Explosion strategy: for each product key, `explodeUnit` computes (and
 * memoizes) the rolled-up component quantities required to build exactly ONE
 * unit of that product, walking every level beneath it. Phantom items are
 * pass-through: their own subtree is merged into the parent without the
 * phantom item itself appearing in the result. Real (non-phantom) items with
 * their own BOM appear in the result AND have their subtree merged in, so the
 * result carries every intermediate assembly plus every raw material.
 *
 * Scrap factor compounds multiplicatively level over level:
 * `effectiveQtyPerUnit = qtyPerUnit * (1 + scrapFactor)`.
 */

export type BomComponentKey = string

export interface BomItemInput {
  componentKey: BomComponentKey
  qtyPerUnit: number
  scrapFactor?: number
  isPhantom?: boolean
}

export type BomItemsByProductKey = Record<BomComponentKey, BomItemInput[] | undefined>

export interface ExplodedComponent {
  componentKey: BomComponentKey
  /** Quantity required to build exactly one unit of the root product. */
  qtyPerRootUnit: number
  /** Quantity required to build `rootQty` units of the root product. */
  qty: number
}

export interface ExplodeBomOptions {
  /** Safety guard against pathological/very deep BOMs. Default 50. */
  maxLevels?: number
}

const DEFAULT_MAX_LEVELS = 50

type UnitRollup = Map<BomComponentKey, number>

function mergeSubtree(target: UnitRollup, subtree: UnitRollup, multiplier: number): void {
  for (const [key, qtyPerUnit] of subtree) {
    const contributed = qtyPerUnit * multiplier
    target.set(key, (target.get(key) ?? 0) + contributed)
  }
}

/**
 * Explodes a BOM to compute, for every component reachable from
 * `rootProductKey`, the quantity required to build `rootQty` units of the
 * root product. Multi-level: intermediate assemblies AND leaf raw materials
 * are both included, each with their fully rolled-up quantity.
 *
 * Throws if a cycle is encountered while exploding (callers should run
 * `findBomCycle` first — this function is not a cycle-detection tool, it is
 * a safety net against pathological input) or if `maxLevels` is exceeded.
 */
export function explodeBom(
  bomItemsByProductKey: BomItemsByProductKey,
  rootProductKey: BomComponentKey,
  rootQty: number,
  opts: ExplodeBomOptions = {},
): ExplodedComponent[] {
  const maxLevels = opts.maxLevels ?? DEFAULT_MAX_LEVELS
  const cache = new Map<BomComponentKey, UnitRollup>()

  function explodeUnit(productKey: BomComponentKey, pathStack: Set<BomComponentKey>, depth: number): UnitRollup {
    const cached = cache.get(productKey)
    if (cached) return cached

    if (pathStack.has(productKey)) {
      throw new Error(`BOM cycle detected while exploding "${productKey}"`)
    }
    if (depth > maxLevels) {
      throw new Error(`BOM explosion exceeded max levels (${maxLevels}) at "${productKey}"`)
    }

    const items = bomItemsByProductKey[productKey] ?? []
    const result: UnitRollup = new Map()
    const nextStack = new Set(pathStack)
    nextStack.add(productKey)

    for (const item of items) {
      const scrapFactor = item.scrapFactor ?? 0
      const effectiveQtyPerUnit = item.qtyPerUnit * (1 + scrapFactor)

      if (item.isPhantom) {
        // Phantom pass-through: the phantom item itself never appears in the
        // result — only its exploded subtree, scaled by this edge's qty.
        const subtree = explodeUnit(item.componentKey, nextStack, depth + 1)
        mergeSubtree(result, subtree, effectiveQtyPerUnit)
        continue
      }

      // Real component: always counted at its own rolled-up quantity, plus
      // its own subtree (if any — an empty subtree is a harmless no-op merge).
      // `explodeUnit` is memoized by productKey, so calling it here even when
      // the component turns out to be a leaf costs at most one array lookup,
      // and a component shared across multiple parents (e.g. X used directly
      // by A and via B) is only ever looked up once.
      result.set(item.componentKey, (result.get(item.componentKey) ?? 0) + effectiveQtyPerUnit)
      const subtree = explodeUnit(item.componentKey, nextStack, depth + 1)
      mergeSubtree(result, subtree, effectiveQtyPerUnit)
    }

    cache.set(productKey, result)
    return result
  }

  const perUnit = explodeUnit(rootProductKey, new Set(), 0)
  const out: ExplodedComponent[] = []
  for (const [componentKey, qtyPerRootUnit] of perUnit) {
    out.push({ componentKey, qtyPerRootUnit, qty: qtyPerRootUnit * rootQty })
  }
  return out
}

/**
 * Depth-first cycle detection over the BOM graph (ignores the phantom flag —
 * any component reference, phantom or not, counts toward a cycle). Returns
 * the cycle path (e.g. `['A', 'B', 'C', 'A']`) when found, otherwise `null`.
 */
export function findBomCycle(
  bomItemsByProductKey: BomItemsByProductKey,
  rootProductKey: BomComponentKey,
): BomComponentKey[] | null {
  const visited = new Set<BomComponentKey>()
  const stack: BomComponentKey[] = []
  const stackSet = new Set<BomComponentKey>()

  function dfs(key: BomComponentKey): BomComponentKey[] | null {
    if (stackSet.has(key)) {
      const cycleStart = stack.indexOf(key)
      return [...stack.slice(cycleStart), key]
    }
    if (visited.has(key)) return null
    visited.add(key)
    stack.push(key)
    stackSet.add(key)

    const items = bomItemsByProductKey[key] ?? []
    for (const item of items) {
      const found = dfs(item.componentKey)
      if (found) return found
    }

    stack.pop()
    stackSet.delete(key)
    return null
  }

  return dfs(rootProductKey)
}
