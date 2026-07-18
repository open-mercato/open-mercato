/**
 * Pure, data-first backflush computation (spec § Data Models / Status
 * machine, Phase 4 task 4.1). Mirrors `lib/costRollup.ts`'s approach of
 * keeping all math ORM/catalog-free and unit-testable — the command layer
 * (`commands/reports.ts`) resolves `ProductionOrderMaterial` snapshot rows +
 * catalog UoM conversion factors and passes plain data in here.
 *
 * Material-line "per unit" semantics: `qtyPerUnit` below is fed from
 * `ProductionOrderMaterial.qtyRequired`. Task 3.1's release snapshot copies
 * `ProductionBomItem.qtyPerUnit` verbatim into `qtyRequired` (see
 * `commands/orders.ts#releaseOrderCommand` and the "task 3.1 semantics"
 * comment in `commands/__tests__/orders.test.ts`) rather than multiplying by
 * `order.qtyPlanned` — so `qtyRequired` already IS the "material required per
 * one unit of finished good", not a pre-multiplied order total. Backflush
 * reuses that same inherited semantics rather than re-deriving a different
 * one; this is a documented consequence of Phase 3's snapshot shape, not a
 * new decision made here.
 *
 * Consumption formula (task 4.1 decision): both good AND scrap units consume
 * material — a scrapped unit was still built from the components issued to
 * make it — so `consumedUnits = reportedGoodQty + reportedScrapQty`, and the
 * per-line issue quantity (in the material's own `uom`) is
 * `qtyPerUnit * (1 + scrapFactor) * consumedUnits`.
 */

export type BackflushMaterialLine = {
  id: string
  componentProductId: string
  componentVariantId: string | null
  operationSequence: number | null
  /** `ProductionOrderMaterial.qtyRequired` — see module doc for semantics. */
  qtyPerUnit: number
  scrapFactor: number
  uom: string
}

export type BackflushIssueLine = {
  materialId: string
  componentProductId: string
  componentVariantId: string | null
  /** Quantity to issue, expressed in `uom` (the material line's own unit). */
  qtyInMaterialUom: number
  uom: string
}

/**
 * Selects the material lines a given operation's report should backflush
 * against. `ProductionBomItem.operationSequence` (copied verbatim into
 * `ProductionOrderMaterial.operationSequence` at release) assigns a material
 * to a specific operation; a `null` assignment means "not tied to a specific
 * operation" — those backflush on the LAST reporting-point operation instead
 * (documented convention, spec § Data Models does not otherwise specify one).
 */
export function selectBackflushMaterials(
  materials: BackflushMaterialLine[],
  operationSequence: number,
  isLastReportingOperation: boolean,
): BackflushMaterialLine[] {
  return materials.filter((material) => {
    if (material.operationSequence != null) return material.operationSequence === operationSequence
    return isLastReportingOperation
  })
}

/** See module doc for the consumption formula this implements. */
export function computeBackflushIssueLines(
  materials: BackflushMaterialLine[],
  reportedGoodQty: number,
  reportedScrapQty: number,
): BackflushIssueLine[] {
  const consumedUnits = reportedGoodQty + reportedScrapQty
  return materials.map((material) => ({
    materialId: material.id,
    componentProductId: material.componentProductId,
    componentVariantId: material.componentVariantId,
    qtyInMaterialUom: material.qtyPerUnit * (1 + material.scrapFactor) * consumedUnits,
    uom: material.uom,
  }))
}

export type UomConversionResult =
  | { qty: number; converted: boolean }
  | { error: 'missing_conversion' }

/**
 * Converts a quantity expressed in `materialUom` into `stockUom` — the exact
 * conversion the stock ledger requires before calling
 * `ProductionStockProvider.issue` (which does NOT convert itself, per
 * `lib/stockProvider.ts`'s module doc). Mirrors the
 * `boms/[id]/cost-rollup/route.ts` convention: `toBaseFactor` converts one
 * unit of `materialUom` into the component product's BASE unit — this
 * helper therefore only has a conversion path when `stockUom` IS that base
 * unit (the same assumption cost-rollup makes for `priceUom`). A missing or
 * inapplicable factor is a `missing_conversion` result, never a silent 1:1
 * assumption (spec § Data Models: "Missing conversion ⇒ validation error").
 */
export function convertQtyToStockUom(
  qtyInMaterialUom: number,
  materialUom: string,
  stockUom: string,
  toBaseFactor: number | null | undefined,
): UomConversionResult {
  const materialKey = materialUom.trim().toLowerCase()
  const stockKey = stockUom.trim().toLowerCase()
  if (materialKey === stockKey) return { qty: qtyInMaterialUom, converted: false }
  if (toBaseFactor == null || !Number.isFinite(toBaseFactor) || toBaseFactor <= 0) {
    return { error: 'missing_conversion' }
  }
  return { qty: qtyInMaterialUom * toBaseFactor, converted: true }
}
