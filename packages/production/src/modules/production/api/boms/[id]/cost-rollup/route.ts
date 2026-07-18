import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  CatalogProduct,
  CatalogProductPrice,
  CatalogProductUnitConversion,
} from '@open-mercato/core/modules/catalog/data/entities'
import { resolvePriceVariantId, type PriceRow } from '@open-mercato/core/modules/catalog/lib/pricing'
import type { CatalogPricingService } from '@open-mercato/core/modules/catalog/services/catalogPricingService'
import { resolveProductionActionContext } from '../../../actionRouteContext.js'
import { resolveOrganizationScopeFilter } from '../../../organizationScopeFilter.js'
import { ProductionBom, ProductionBomItem, Routing, RoutingOperation, WorkCenter } from '../../../../data/entities.js'
import { explodeBom } from '../../../../lib/bomGraph.js'
import { computeStandardCost, type CostRollupLine, type UnitConversionInfo, type UnitPriceInfo } from '../../../../lib/costRollup.js'
import { loadActiveBomGraph, productKeyOf } from '../../../../commands/technology.js'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['production.technology.view'],
}

const quantityQuerySchema = z.coerce.number().positive().default(1)

const costRollupLineSchema = z.object({
  componentKey: z.string(),
  qty: z.number(),
  bomUom: z.string(),
  priceUom: z.string().nullable(),
  unitAmount: z.number().nullable(),
  currency: z.string().nullable(),
  lineCost: z.number().nullable(),
  status: z.enum(['ok', 'missing_price', 'missing_conversion', 'mixed_currency']),
})

const costRollupResponseSchema = z.object({
  bomId: z.string().uuid(),
  quantity: z.number(),
  materials: z.number(),
  labor: z.number(),
  total: z.number(),
  perUnit: z.number(),
  currency: z.string().nullable(),
  /**
   * How `materials` was priced. Currently always `'catalog_list_price'`:
   * catalog has no purchase/cost price kind (only regular/sale sell-side
   * kinds — spec decision d, no purchasing module yet), so this is a
   * LIST-PRICE-BASED ESTIMATE, not a true standard/purchase cost. Kept as an
   * explicit enum (rather than a boolean) so a future purchase-price source
   * (tracked as a 1.5 spec delta) can add a `'purchase_price'` value without
   * a breaking response-shape change.
   */
  priceBasis: z.literal('catalog_list_price'),
  missingPrices: z.array(z.string()),
  missingConversions: z.array(z.string()),
  mixedCurrency: z.array(z.string()),
  missingRouting: z.boolean(),
  lines: z.array(costRollupLineSchema),
})

/**
 * Splits a BOM graph `componentKey` (built by `productKeyOf` as
 * `productId` or `productId:variantId`) back into its parts. UUIDs never
 * contain `:`, so a single split on the first occurrence is safe.
 */
function parseComponentKey(componentKey: string): { productId: string; variantId: string | null } {
  const separatorIndex = componentKey.indexOf(':')
  if (separatorIndex === -1) return { productId: componentKey, variantId: null }
  return { productId: componentKey.slice(0, separatorIndex), variantId: componentKey.slice(separatorIndex + 1) }
}

/**
 * Standard cost rollup for a BOM version (spec § API Contracts, task 1.4):
 * explodes the BOM (reusing `loadActiveBomGraph` from the technology
 * commands + the pure `explodeBom`/`computeStandardCost` helpers so scrap
 * factors, multi-level assemblies, and catalog pricing/UoM-conversion gaps
 * are handled identically to the rest of the technology module), then priced
 * with catalog unit prices (via `catalogPricingService`, the sanctioned
 * pricing entry point) and labor from the matching routing version's
 * operations x work-center rates.
 *
 * Price source — LIST PRICE, NOT a purchase/cost price (honest-labeling
 * fix, spec decision d: this module ships with no purchasing module, so
 * catalog exposes only sell-side `CatalogPriceKind`s — e.g. `regular`/
 * `sale` — and no purchase/cost price kind at all). For each component, the
 * resolved-best `CatalogProductPrice` row (see `selectBestPrice`/
 * `catalogPricingService.resolvePrice`) is read as `unitPriceNet` (falling
 * back to `unitPriceGross` when net is absent). `materials` is therefore a
 * LIST-PRICE-BASED ESTIMATE, surfaced explicitly via the response's
 * `priceBasis: 'catalog_list_price'` field — it is a proxy for standard
 * cost, not standard cost itself, until a real purchase-price source
 * exists (tracked as a task 1.5 spec delta). The price is assumed
 * denominated in the product's `defaultUnit`;
 * `CatalogProductUnitConversion.toBaseFactor` converts a BOM line's
 * non-base `uom` into that same base unit (this mirrors
 * `catalog/api/products/route.ts`'s quantity-unit conversion).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> | { id: string } }) {
  const { translate } = await resolveTranslations()
  try {
    const { ctx } = await resolveProductionActionContext(req)
    const resolvedParams = await params
    const id = resolvedParams?.id
    if (!id) {
      return NextResponse.json({ error: translate('production.errors.id_required', 'Record id is required') }, { status: 400 })
    }

    const tenantId = ctx.auth?.tenantId
    if (!tenantId) {
      return NextResponse.json({ error: translate('production.errors.unauthorized', 'Unauthorized') }, { status: 401 })
    }
    const organizationId = ctx.selectedOrganizationId
    if (!organizationId) {
      return NextResponse.json(
        { error: translate('production.errors.organization_required', 'Organization context is required') },
        { status: 400 },
      )
    }

    const orgScopeFilter = resolveOrganizationScopeFilter({
      organizationIds: ctx.organizationIds,
      selectedOrganizationId: ctx.selectedOrganizationId,
    })

    const url = new URL(req.url)
    const quantityParam = url.searchParams.get('quantity')
    const quantityParse = quantityQuerySchema.safeParse(quantityParam ?? undefined)
    const quantity = quantityParse.success ? quantityParse.data : 1

    const em = ctx.container.resolve<EntityManager>('em')
    const bom = await em.findOne(ProductionBom, { id, tenantId, ...orgScopeFilter, deletedAt: null })
    if (!bom) {
      return NextResponse.json({ error: translate('production.boms.error.not_found', 'BOM not found') }, { status: 404 })
    }

    const bomItems = await em.find(ProductionBomItem, { bomId: bom.id, ...orgScopeFilter, deletedAt: null })
    const rootProductKey = productKeyOf(bom.productId, bom.variantId ?? null)

    const { graph, uomByComponentKey } = await loadActiveBomGraph(
      em,
      { tenantId, organizationId },
      rootProductKey,
      bomItems.map((i) => ({
        componentProductId: i.componentProductId,
        componentVariantId: i.componentVariantId ?? null,
        qtyPerUnit: Number(i.qtyPerUnit),
        uom: i.uom,
        scrapFactor: Number(i.scrapFactor),
        isPhantom: i.isPhantom,
        operationSequence: i.operationSequence ?? null,
      })),
    )

    const exploded = explodeBom(graph, rootProductKey, quantity)
    const lines: CostRollupLine[] = exploded.map((component) => ({
      componentKey: component.componentKey,
      qty: component.qty,
      bomUom: uomByComponentKey[component.componentKey] ?? 'pc',
    }))

    const componentInfos = lines.map((line) => parseComponentKey(line.componentKey))
    const productIds = Array.from(new Set(componentInfos.map((info) => info.productId)))

    // Org scoping: `CatalogProduct.organizationId`, `CatalogProductPrice.organizationId`,
    // and `CatalogProductUnitConversion.organizationId` are all NON-nullable
    // (checked against `packages/core/src/modules/catalog/data/entities.ts` —
    // unlike `CatalogPriceKind.organizationId`, which IS nullable for
    // tenant-global price kinds, these three entities never share rows
    // across organizations via a null organizationId). So there is no
    // null-org-sharing case to account for here; the only correctness gap is
    // multi-org "All Organizations" scope, where a caller's
    // `ctx.organizationIds` can contain more than one id and a scalar
    // `organizationId` equality filter would miss rows that legitimately
    // belong to a different (but still permitted) org — the exact bug class
    // task 1.3's review flagged for the BOM/routing detail routes. Reuse the
    // same `orgScopeFilter` ($in when multi-org, scalar fallback otherwise)
    // used for every other read in this route instead of the ad hoc scalar
    // `organizationId` catalog's own supplementary reads use (e.g.
    // `catalog/api/products/route.ts`'s `decorateProductsAfterList` — a
    // pre-existing latent gap in catalog itself, out of scope here).
    const [products, priceRows, conversionRows] = productIds.length
      ? await Promise.all([
          findWithDecryption(
            em,
            CatalogProduct,
            { id: { $in: productIds }, ...orgScopeFilter, tenantId, deletedAt: null },
            undefined,
            { tenantId, organizationId },
          ),
          findWithDecryption(
            em,
            CatalogProductPrice,
            { product: { $in: productIds }, ...orgScopeFilter, tenantId },
            { populate: ['offer', 'variant', 'product', 'priceKind'] },
            { tenantId, organizationId },
          ),
          findWithDecryption(
            em,
            CatalogProductUnitConversion,
            { product: { $in: productIds }, ...orgScopeFilter, tenantId, deletedAt: null, isActive: true },
            undefined,
            { tenantId, organizationId },
          ),
        ])
      : [[], [], []]

    const productById = new Map(products.map((p) => [p.id, p]))
    const priceRowsByProduct = new Map<string, PriceRow[]>()
    for (const row of priceRows as PriceRow[]) {
      const productId = typeof row.product === 'string' ? row.product : (row.product?.id ?? null)
      if (!productId) continue
      const bucket = priceRowsByProduct.get(productId) ?? []
      bucket.push(row)
      priceRowsByProduct.set(productId, bucket)
    }
    const conversionsByProductAndUnit = new Map<string, number>()
    for (const row of conversionRows) {
      const productId = typeof row.product === 'string' ? row.product : (row.product?.id ?? null)
      if (!productId) continue
      const factor = Number(row.toBaseFactor)
      if (!Number.isFinite(factor) || factor <= 0) continue
      conversionsByProductAndUnit.set(`${productId}:${row.unitCode.trim().toLowerCase()}`, factor)
    }

    const pricingService = ctx.container.resolve<CatalogPricingService>('catalogPricingService')
    const unitPrices: Record<string, UnitPriceInfo> = {}
    const unitConversions: Record<string, UnitConversionInfo> = {}

    await Promise.all(
      lines.map(async (line, index) => {
        const { productId, variantId } = componentInfos[index]
        const product = productById.get(productId)
        if (!product) return

        const candidateRows = (priceRowsByProduct.get(productId) ?? []).filter((row) => {
          const rowVariantId = resolvePriceVariantId(row)
          return variantId ? rowVariantId === variantId || rowVariantId === null : rowVariantId === null
        })
        if (!candidateRows.length) return

        const resolved = await pricingService.resolvePrice(candidateRows, { quantity: line.qty, date: new Date() })
        if (!resolved) return

        const amountRaw = resolved.unitPriceNet ?? resolved.unitPriceGross
        if (amountRaw == null) return
        const amount = Number(amountRaw)
        if (!Number.isFinite(amount)) return

        const priceUom = product.defaultUnit ?? 'pc'
        unitPrices[line.componentKey] = { amount, currency: resolved.currencyCode, uom: priceUom }

        const bomUomKey = line.bomUom.trim().toLowerCase()
        if (bomUomKey !== priceUom.trim().toLowerCase()) {
          const factor = conversionsByProductAndUnit.get(`${productId}:${bomUomKey}`)
          if (factor !== undefined) unitConversions[line.componentKey] = { factor }
        }
      }),
    )

    const routing = await em.findOne(Routing, {
      productId: bom.productId,
      variantId: bom.variantId ?? null,
      version: bom.version,
      tenantId,
      ...orgScopeFilter,
      deletedAt: null,
    })
    const missingRouting = !routing
    const operations = routing
      ? await em.find(RoutingOperation, { routingId: routing.id, ...orgScopeFilter, deletedAt: null })
      : []

    const workCenterIds = Array.from(new Set(operations.map((op) => op.workCenterId)))
    const workCenters = workCenterIds.length
      ? await em.find(WorkCenter, { id: { $in: workCenterIds }, tenantId, ...orgScopeFilter, deletedAt: null })
      : []
    const workCenterRates: Record<string, number> = {}
    for (const wc of workCenters) workCenterRates[wc.id] = Number(wc.costRatePerHour)

    const result = computeStandardCost({
      lines,
      unitPrices,
      unitConversions,
      operations: operations.map((op) => ({
        workCenterId: op.workCenterId,
        setupTimeMinutes: Number(op.setupTimeMinutes),
        runTimePerUnitSeconds: Number(op.runTimePerUnitSeconds),
      })),
      workCenterRates,
      quantity,
    })

    return NextResponse.json({
      bomId: bom.id,
      quantity,
      ...result,
      priceBasis: 'catalog_list_price' as const,
      missingRouting,
    })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    return NextResponse.json(
      { error: translate('production.boms.error.cost_rollup_failed', 'Failed to compute BOM cost rollup') },
      { status: 400 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Production',
  summary: 'Standard cost rollup for a BOM version',
  methods: {
    GET: {
      operationId: 'getProductionBomCostRollup',
      summary: 'Compute the standard cost rollup for a BOM version',
      description:
        'Explodes the BOM (multi-level, scrap-adjusted) and prices materials from catalog unit prices (UoM-converted) plus labor from the matching routing version\'s operations x work-center rates. Missing prices/UoM conversions and a missing routing version are surfaced explicitly rather than silently treated as zero cost.',
      query: z.object({ quantity: z.coerce.number().positive().optional() }),
      responses: [
        { status: 200, description: 'Cost rollup result', schema: costRollupResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid request', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 404, description: 'BOM not found', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
