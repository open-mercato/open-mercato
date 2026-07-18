import { makeProductKey } from '../types'
import type {
  MrpBomItem,
  MrpBomVersion,
  MrpDemand,
  MrpInputs,
  MrpOpenSupply,
  MrpPlanningParams,
  MrpStock,
  ProcurementType,
} from '../types'

/**
 * Task 5.3 — seeded, deterministic in-memory `MrpInputs` generator for the
 * performance benchmark (`benchmark.test.ts`). Never touches the ORM/DB —
 * this is the "already bulk-loaded plain data" the engine consumes (spec §
 * MRP engine); building a *representative* dataset here is what lets the
 * benchmark isolate the engine's own compute cost from the loader's DB cost
 * (see `benchmark.test.ts`'s scoping note).
 *
 * PRNG: mulberry32 (not `Math.random`) so a given `seed` always produces
 * the exact same dataset — required for a reproducible benchmark and for
 * the "same seed -> same result" determinism test.
 */

export interface GenerateBenchmarkInputsOptions {
  /** Total distinct products across all BOM levels. Default 10,000 (spec KPI dataset size). */
  products?: number
  /** Number of BOM levels (top-level finished products down to raw materials). Default 5 (spec KPI). */
  levels?: number
  /** PRNG seed — same seed always produces the same dataset. */
  seed?: number
  /** Anchor date for demand due dates and min-stock computation. */
  asOfDate?: string
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function addDaysIso(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * Level-size weights: a pyramid that grows from the top-level finished
 * products (level 0, fewest) down to raw materials (last level, most) —
 * the realistic shape of a discrete-manufacturing BOM (few end products,
 * many purchased components). Falls back to an even split for `levels`
 * values outside the tuned 5-level table (so the generator never divides
 * by zero or produces an empty level for an unusual `levels` override).
 */
function levelWeights(levels: number): number[] {
  const table: Record<number, number[]> = {
    5: [0.04, 0.12, 0.18, 0.26, 0.4],
  }
  if (table[levels]) return table[levels]
  return Array.from({ length: levels }, () => 1 / levels)
}

function distributeLevelSizes(products: number, levels: number): number[] {
  const weights = levelWeights(levels)
  const sizes = weights.map((w) => Math.max(1, Math.round(products * w)))
  const total = sizes.reduce((sum, n) => sum + n, 0)
  // Correct rounding drift on the last level so the total is exact.
  sizes[sizes.length - 1] += products - total
  if (sizes[sizes.length - 1] < 1) sizes[sizes.length - 1] = 1
  return sizes
}

/**
 * Generates a deterministic, in-memory `MrpInputs` dataset shaped like a
 * real discrete-manufacturing net-requirements problem:
 *  - `~products` total products spread across `levels` BOM levels.
 *  - Each `make` product (levels[0..levels-2]) fans out to 2-5 components
 *    one level down; ~20% of the time a fan-out slot reuses an
 *    already-referenced component instead of an unused one, modeling a
 *    component shared across multiple parents.
 *  - Roughly 60/40 make/buy mix (the last level is always `buy` — it has
 *    no level below it to source components from).
 *  - Stock seeded for ~half of all products; open supply (released/
 *    in_progress) sprinkled across ~10%, with due dates before/after the
 *    anchor date so both the "reduces suggestion" and "reschedule-in"
 *    engine branches get exercised.
 *  - Demand (`sales_order`) seeded for ~10% of the top-level products,
 *    which is what drives the BOM explosion down through every level.
 */
export function generateBenchmarkInputs(options: GenerateBenchmarkInputsOptions = {}): MrpInputs {
  const products = options.products ?? 10_000
  const levels = options.levels ?? 5
  const seed = options.seed ?? 1
  const asOfDate = options.asOfDate ?? '2026-01-01'

  const rand = mulberry32(seed)

  const levelSizes = distributeLevelSizes(products, levels)
  const levelProductIds: string[][] = levelSizes.map((size, level) =>
    Array.from({ length: size }, (_, idx) => `bench-l${level}-${idx}`),
  )

  const bomVersionsByProductKey: Record<string, MrpBomVersion[]> = {}
  const planningParamsByProductKey: Record<string, MrpPlanningParams> = {}
  const stockByProductKey: Record<string, MrpStock> = {}
  const openSupply: MrpOpenSupply[] = []
  const demands: MrpDemand[] = []

  // Tracks how many components have been referenced so far at each level,
  // so a later parent's "reuse" roll can pick among ALREADY-referenced
  // components (component sharing) instead of only ever-unused ones.
  const referencedCount = new Array(levels).fill(0)

  for (let level = 0; level < levels; level++) {
    const isLeafLevel = level === levels - 1
    const pool = levelProductIds[level]

    for (let idx = 0; idx < pool.length; idx++) {
      const productId = pool[idx]
      const productKey = makeProductKey(productId, null)
      const procurement: ProcurementType = isLeafLevel ? 'buy' : rand() < 0.6 ? 'make' : 'buy'

      const planningParams: MrpPlanningParams = {
        procurement,
        leadTimeDays: 1 + Math.floor(rand() * 5),
        minLot: 1 + Math.floor(rand() * 10),
        lotMultiple: [1, 5, 10][Math.floor(rand() * 3)],
        safetyStock: Math.floor(rand() * 5),
      }
      planningParamsByProductKey[productKey] = planningParams

      if (rand() < 0.5) {
        stockByProductKey[productKey] = {
          onHand: Math.floor(rand() * 50),
          reserved: Math.floor(rand() * 5),
          uom: 'pcs',
        }
      }

      if (rand() < 0.1) {
        openSupply.push({
          productKey,
          qty: 5 + Math.floor(rand() * 20),
          uom: 'pcs',
          dueDate: addDaysIso(asOfDate, Math.floor(rand() * 20) - 10),
          sourceId: `bench-open-${productId}`,
          status: rand() < 0.5 ? 'released' : 'in_progress',
        })
      }

      if (procurement === 'make' && !isLeafLevel) {
        const childLevel = level + 1
        const childPool = levelProductIds[childLevel]
        const fanOut = 2 + Math.floor(rand() * 4)
        const items: MrpBomItem[] = []
        const chosenIndices = new Set<number>()

        for (let c = 0; c < fanOut; c++) {
          let childIdx: number
          if (referencedCount[childLevel] > 0 && rand() < 0.2) {
            childIdx = Math.floor(rand() * referencedCount[childLevel])
          } else {
            childIdx = referencedCount[childLevel] % childPool.length
            referencedCount[childLevel] += 1
          }
          if (chosenIndices.has(childIdx)) continue
          chosenIndices.add(childIdx)

          items.push({
            componentKey: makeProductKey(childPool[childIdx], null),
            qtyPerUnit: 1 + rand() * 3,
            uom: 'pcs',
            scrapFactor: rand() < 0.3 ? Math.round(rand() * 0.05 * 1000) / 1000 : 0,
            isPhantom: false,
          })
        }

        if (items.length > 0) {
          bomVersionsByProductKey[productKey] = [
            {
              productKey,
              validFrom: null,
              validTo: null,
              items,
            },
          ]
        }
      }
    }
  }

  const topLevelIds = levelProductIds[0]
  for (let idx = 0; idx < topLevelIds.length; idx++) {
    if (rand() >= 0.1) continue
    const productId = topLevelIds[idx]
    demands.push({
      productKey: makeProductKey(productId, null),
      qty: 10 + Math.floor(rand() * 90),
      uom: 'pcs',
      dueDate: addDaysIso(asOfDate, 5 + Math.floor(rand() * 20)),
      source: { type: 'sales_order', id: `bench-so-${productId}` },
    })
  }

  return {
    asOfDate,
    demands,
    bomVersionsByProductKey,
    planningParamsByProductKey,
    stockByProductKey,
    openSupply,
    unitConversionsByProductKey: {},
  }
}
