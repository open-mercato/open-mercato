import { explodeOneLevel, type BomItemInput, type BomItemsByProductKey } from '../bomGraph.js'
import {
  parseProductKey,
  makeProductKey,
  type MrpBomVersion,
  type MrpInputs,
  type MrpPeggingRef,
  type MrpResult,
  type MrpSuggestion,
  type MrpWarning,
  type ProductKey,
} from './types.js'

/**
 * Task 5.1 — pure, in-memory net-requirements engine (spec § MRP engine).
 *
 * `runMrp` never touches the ORM: every input is already bulk-loaded plain
 * data (see `loaders.ts`). It processes products in low-level-code (LLC)
 * order — the classic MRP guarantee that a component is only netted once
 * every parent that demands it has already contributed its dependent
 * demand — so a component shared by several parents is netted (and
 * lot-sized) exactly once, as one aggregated bucket.
 *
 * Per-product netting, in order:
 *  1. Bucket demand by due date (ascending).
 *  2. Consume on-hand stock (`onHand - reserved - safetyStock`, so a
 *     configured safety-stock floor raises the net requirement — it is
 *     never given away to satisfy demand) against the EARLIEST bucket
 *     first; whatever is left over rolls forward to the next bucket.
 *  3. Consume open supply (released/in_progress orders) that is due ON OR
 *     BEFORE a bucket's date, oldest-supply-first — this reduces the
 *     make/buy suggestion silently (case: "before due date reduces
 *     suggestion").
 *  4. Any bucket still unmet after (2)+(3) is checked against LATE open
 *     supply (due AFTER that bucket's date): if such supply exists, propose
 *     rescheding it IN to the bucket's date instead of also suggesting new
 *     make/buy for the same qty (case: "after due date -> reschedule").
 *  5. Whatever remains unmet becomes a make/buy suggestion, lot-sized
 *     (min lot, then rounded up to the nearest multiple).
 *  6. `make` suggestions explode the product's date-valid BOM version one
 *     level down (phantom items are chased through transparently) and push
 *     dependent demand for each real component, due `leadTimeDays` before
 *     the parent's own suggested due date — this is what feeds step (1) for
 *     the next (higher-LLC) product in the loop.
 *  7. Any open-supply order left with qty never touched by (3) or (4) is
 *     genuinely unneeded -> `cancel` suggestion.
 */

interface InternalDemandEntry {
  qty: number
  dueDate: string
  uom: string
  peggingRoots: MrpPeggingRef[]
}

interface DemandBucket {
  dueDate: string
  entries: InternalDemandEntry[]
}

function canonicalUom(value: string): string {
  return value.trim().toLowerCase()
}

function subtractDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

function bucketDemands(entries: InternalDemandEntry[]): DemandBucket[] {
  const byDate = new Map<string, InternalDemandEntry[]>()
  for (const entry of entries) {
    const bucket = byDate.get(entry.dueDate) ?? []
    bucket.push(entry)
    byDate.set(entry.dueDate, bucket)
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([dueDate, bucketEntries]) => ({ dueDate, entries: bucketEntries }))
}

function dedupPegging(refs: MrpPeggingRef[]): MrpPeggingRef[] {
  const byKey = new Map<string, MrpPeggingRef>()
  for (const ref of refs) {
    const key = `${ref.productKey}:${ref.source.type}:${ref.source.id ?? ''}`
    const existing = byKey.get(key)
    if (existing) existing.qty += ref.qty
    else byKey.set(key, { ...ref })
  }
  return [...byKey.values()]
}

function applyLotSizing(qty: number, minLot: number, lotMultiple: number): number {
  if (qty <= 0) return 0
  let lot = Math.max(qty, minLot)
  if (lotMultiple > 0) lot = Math.ceil(lot / lotMultiple) * lotMultiple
  return lot
}

function isDateWithinWindow(dueDate: string, validFrom: string | null, validTo: string | null): boolean {
  if (validFrom && dueDate < validFrom) return false
  if (validTo && dueDate > validTo) return false
  return true
}

function selectBomVersionForDate(versions: MrpBomVersion[], dueDate: string): MrpBomVersion | null {
  return versions.find((version) => isDateWithinWindow(dueDate, version.validFrom, version.validTo)) ?? null
}

/**
 * Resolves the BOM version list for `productKey`, falling back to the
 * product-level BOM (same `productId`, `variantId: null`) when no
 * variant-specific BOM exists at all for this exact key (review finding:
 * a variant with no BOM of its own must still be plannable off its
 * product-level technology). Only falls back when `productKey` itself has
 * NO entry — if a variant-specific BOM list exists but simply has no
 * version covering a given due date, that is a `missing_bom_version`
 * warning (handled by the caller), not a silent fallback to a different
 * variant's technology.
 */
function resolveBomVersions(inputs: MrpInputs, productKey: ProductKey): MrpBomVersion[] {
  const direct = inputs.bomVersionsByProductKey[productKey]
  if (direct && direct.length > 0) return direct
  const { productId, variantId } = parseProductKey(productKey)
  if (variantId === null) return direct ?? []
  const fallbackKey = makeProductKey(productId, null)
  return inputs.bomVersionsByProductKey[fallbackKey] ?? direct ?? []
}

function collectDirectChildren(productKey: ProductKey, inputs: MrpInputs): Set<ProductKey> {
  const children = new Set<ProductKey>()
  for (const version of resolveBomVersions(inputs, productKey)) {
    for (const item of version.items) children.add(item.componentKey)
  }
  return children
}

function collectAllProductKeys(
  inputs: MrpInputs,
  demandsByProduct: Map<ProductKey, InternalDemandEntry[]>,
): Set<ProductKey> {
  const keys = new Set<ProductKey>()
  for (const key of demandsByProduct.keys()) keys.add(key)
  for (const [key, versions] of Object.entries(inputs.bomVersionsByProductKey)) {
    keys.add(key)
    for (const version of versions ?? []) {
      for (const item of version.items) keys.add(item.componentKey)
    }
  }
  for (const supply of inputs.openSupply) keys.add(supply.productKey)
  for (const key of Object.keys(inputs.planningParamsByProductKey)) keys.add(key)
  for (const key of Object.keys(inputs.stockByProductKey)) keys.add(key)
  return keys
}

/**
 * Low-level coding: `llc[key]` is the LONGEST path length from any root
 * product down to `key` through the (assumed acyclic) BOM graph. Computed
 * by iterative relaxation to a fixed point rather than a single DFS pass,
 * because a component reachable via multiple parents at different depths
 * must take the DEEPEST one — otherwise it could be netted before every
 * parent has contributed its demand.
 */
function computeLowLevelCodes(inputs: MrpInputs, allKeys: Set<ProductKey>): Map<ProductKey, number> {
  const llc = new Map<ProductKey, number>()
  for (const key of allKeys) llc.set(key, 0)

  let changed = true
  let guard = 0
  const maxGuard = allKeys.size + 10
  while (changed && guard < maxGuard) {
    changed = false
    guard++
    for (const productKey of allKeys) {
      const parentLevel = llc.get(productKey) ?? 0
      for (const child of collectDirectChildren(productKey, inputs)) {
        const proposed = parentLevel + 1
        if (proposed > (llc.get(child) ?? 0)) {
          llc.set(child, proposed)
          changed = true
        }
      }
    }
  }
  return llc
}

function explodeForSuggestion(
  inputs: MrpInputs,
  productKey: ProductKey,
  dueDate: string,
  warnings: MrpWarning[],
): { componentKey: ProductKey; qtyPerUnit: number; uom: string }[] | null {
  const versions = resolveBomVersions(inputs, productKey)
  const version = selectBomVersionForDate(versions, dueDate)
  if (!version) {
    warnings.push({
      code: 'missing_bom_version',
      productKey,
      message: `No active BOM version for "${productKey}" (or its product-level fallback) covers due date ${dueDate}`,
    })
    return null
  }

  // Build a lookup so phantom chains (which may span into OTHER products'
  // bom items, each themselves date-valid-selected for the same due date)
  // resolve correctly, one level at a time, via `explodeOneLevel`.
  const bomItemsByProductKey: BomItemsByProductKey = {}
  const visited = new Set<ProductKey>()
  function register(key: ProductKey): void {
    if (visited.has(key)) return
    visited.add(key)
    const keyVersions = resolveBomVersions(inputs, key)
    const keyVersion = selectBomVersionForDate(keyVersions, dueDate)
    if (!keyVersion) return
    bomItemsByProductKey[key] = keyVersion.items.map((item): BomItemInput => ({
      componentKey: item.componentKey,
      qtyPerUnit: item.qtyPerUnit,
      scrapFactor: item.scrapFactor,
      isPhantom: item.isPhantom,
      uom: item.uom,
    }))
    for (const item of keyVersion.items) {
      if (item.isPhantom) register(item.componentKey)
    }
  }
  register(productKey)

  return explodeOneLevel(bomItemsByProductKey, productKey)
}

export function runMrp(inputs: MrpInputs): MrpResult {
  const start = Date.now()
  const warnings: MrpWarning[] = []
  const suggestions: MrpSuggestion[] = []
  let levelsExploded = 0

  const demandsByProduct = new Map<ProductKey, InternalDemandEntry[]>()
  function pushDemand(productKey: ProductKey, entry: InternalDemandEntry): void {
    const list = demandsByProduct.get(productKey) ?? []
    list.push(entry)
    demandsByProduct.set(productKey, list)
  }

  for (const demand of inputs.demands) {
    pushDemand(demand.productKey, {
      qty: demand.qty,
      dueDate: demand.dueDate,
      uom: demand.uom,
      peggingRoots: [{ productKey: demand.productKey, source: demand.source, qty: demand.qty }],
    })
  }

  const allKeys = collectAllProductKeys(inputs, demandsByProduct)
  const llc = computeLowLevelCodes(inputs, allKeys)
  const orderedKeys = [...allKeys].sort((a, b) => {
    const levelDiff = (llc.get(a) ?? 0) - (llc.get(b) ?? 0)
    if (levelDiff !== 0) return levelDiff
    return a < b ? -1 : a > b ? 1 : 0
  })

  for (const productKey of orderedKeys) {
    const demandList = demandsByProduct.get(productKey)
    const supplyForProduct = inputs.openSupply
      .filter((s) => s.productKey === productKey)
      .map((s) => ({ ...s, remaining: s.qty }))
      .sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0))

    const { productId, variantId } = parseProductKey(productKey)

    if (!demandList || demandList.length === 0) {
      for (const supply of supplyForProduct) {
        if (supply.remaining <= 0) continue
        suggestions.push({
          type: 'cancel',
          productKey,
          productId,
          variantId,
          qty: supply.remaining,
          uom: supply.uom,
          dueDate: supply.dueDate,
          pegging: [],
          openSupplySourceId: supply.sourceId,
        })
      }
      continue
    }

    const params = inputs.planningParamsByProductKey[productKey]
    const hasBom = resolveBomVersions(inputs, productKey).length > 0
    const procurement = params?.procurement ?? (hasBom ? 'make' : 'buy')
    if (!params) {
      warnings.push({
        code: 'missing_planning_params',
        productKey,
        message: `No planning params for "${productKey}"; defaulted to procurement=${procurement}, leadTime=0`,
      })
    }

    const stock = inputs.stockByProductKey[productKey]
    const safetyStock = params?.safetyStock ?? 0
    let freeStock = (stock?.onHand ?? 0) - (stock?.reserved ?? 0) - safetyStock

    const buckets = bucketDemands(demandList)
    const netBuckets = buckets.map((bucket) => {
      const gross = bucket.entries.reduce((sum, entry) => sum + entry.qty, 0)
      const consumeFromStock = Math.min(Math.max(freeStock, 0), gross)
      freeStock -= consumeFromStock
      const pegging = dedupPegging(bucket.entries.flatMap((entry) => entry.peggingRoots))
      return { dueDate: bucket.dueDate, netQty: gross - consumeFromStock, pegging }
    })

    // Phase A: on-time open supply (due <= bucket date) silently reduces the bucket.
    for (const bucket of netBuckets) {
      if (bucket.netQty <= 0) continue
      for (const supply of supplyForProduct) {
        if (bucket.netQty <= 0) break
        if (supply.remaining <= 0) continue
        if (supply.dueDate > bucket.dueDate) continue
        const take = Math.min(supply.remaining, bucket.netQty)
        supply.remaining -= take
        bucket.netQty -= take
      }
    }

    // Phase B: late open supply (due > bucket date) is reschedule-in candidate.
    for (const bucket of netBuckets) {
      if (bucket.netQty <= 0) continue
      for (const supply of supplyForProduct) {
        if (bucket.netQty <= 0) break
        if (supply.remaining <= 0) continue
        if (supply.dueDate <= bucket.dueDate) continue
        const take = Math.min(supply.remaining, bucket.netQty)
        supply.remaining -= take
        bucket.netQty -= take
        suggestions.push({
          type: 'reschedule',
          productKey,
          productId,
          variantId,
          qty: take,
          uom: supply.uom,
          dueDate: bucket.dueDate,
          pegging: bucket.pegging,
          openSupplySourceId: supply.sourceId,
          previousDueDate: supply.dueDate,
        })
      }
    }

    for (const bucket of netBuckets) {
      if (bucket.netQty <= 0) continue
      const lotQty = applyLotSizing(bucket.netQty, params?.minLot ?? 0, params?.lotMultiple ?? 0)
      suggestions.push({
        type: procurement === 'make' ? 'make' : 'buy',
        productKey,
        productId,
        variantId,
        qty: lotQty,
        uom: stock?.uom ?? demandList[0]?.uom ?? '',
        dueDate: bucket.dueDate,
        pegging: bucket.pegging,
      })

      if (procurement === 'make') {
        levelsExploded++
        const resolvedLines = explodeForSuggestion(inputs, productKey, bucket.dueDate, warnings)
        if (resolvedLines) {
          const childDueDate = subtractDays(bucket.dueDate, params?.leadTimeDays ?? 0)
          for (const line of resolvedLines) {
            let qtyInLineUom = lotQty * line.qtyPerUnit
            const componentStock = inputs.stockByProductKey[line.componentKey]
            const componentUom = componentStock?.uom ?? line.uom
            if (canonicalUom(line.uom) !== canonicalUom(componentUom)) {
              // Catalog unit conversions (`CatalogProductUnitConversion`) are
              // product-level only -- there is no variant dimension on that
              // table -- so this lookup is keyed by the bare `productId`,
              // not the composite `ProductKey`.
              const conversion = inputs.unitConversionsByProductKey[parseProductKey(line.componentKey).productId]
              if (!conversion || canonicalUom(conversion.fromUom) !== canonicalUom(line.uom)) {
                warnings.push({
                  code: 'missing_unit_conversion',
                  productKey: line.componentKey,
                  message: `No conversion from "${line.uom}" to "${componentUom}" for component "${line.componentKey}"`,
                })
                continue
              }
              qtyInLineUom = qtyInLineUom * conversion.factor
            }
            pushDemand(line.componentKey, {
              qty: qtyInLineUom,
              dueDate: childDueDate,
              uom: componentUom,
              peggingRoots: bucket.pegging.map((ref) => ({ ...ref })),
            })
          }
        }
      }
    }

    for (const supply of supplyForProduct) {
      if (supply.remaining <= 0) continue
      suggestions.push({
        type: 'cancel',
        productKey,
        productId,
        variantId,
        qty: supply.remaining,
        uom: supply.uom,
        dueDate: supply.dueDate,
        pegging: [],
        openSupplySourceId: supply.sourceId,
      })
    }
  }

  return {
    suggestions,
    warnings,
    stats: {
      demandsProcessed: inputs.demands.length,
      levelsExploded,
      elapsedMsPlaceholder: Date.now() - start,
    },
  }
}
