import type { EntityManager } from '@mikro-orm/postgresql'
import {
  CHECKOUT_DEFAULT_PACKAGE_HEIGHT_CM,
  CHECKOUT_DEFAULT_PACKAGE_LENGTH_CM,
  CHECKOUT_DEFAULT_PACKAGE_WEIGHT_KG,
  CHECKOUT_DEFAULT_PACKAGE_WIDTH_CM,
} from './constants'

// Release 5, Step 2.13 (C13 "rate quoting inputs", C8 "delivery promotions evaluation").
// `checkout` never holds cart lines (§4.1) — this is a scope-free-by-column, scoped-by-
// value "FK-id + snapshot" read of `cart`'s own `cart_lines` table plus `catalog`'s
// `catalog_products`/`catalog_product_variants` tables, the SAME raw-Kysely style
// `lib/cartPeer.ts` already established for the cart header row. Three flat queries
// (never a cross-module join) so each step stays trivially unit-testable with the
// existing `em.getKysely().selectFrom().select().where().execute()` mock shape.

export type CartLinePeerRow = {
  lineId: string
  productId: string
  variantId: string | null
  quantity: string
  unitPriceNet: string | null
  unitPriceGross: string | null
}

type CartLinesDatabase = {
  cart_lines: {
    id: string
    cart_id: string
    tenant_id: string
    organization_id: string
    product_id: string
    variant_id: string | null
    quantity: string
    unit_price_net: string | null
    unit_price_gross: string | null
    origin: string
    flag_state: string | null
    deleted_at: Date | null
  }
}

/**
 * Non-gift, non-flagged cart lines only (mirrors `cart/lib/promotionContext.ts`'s own
 * `evaluableLines` filter: `line.flagState == null && line.origin !== 'promotion'`) — a
 * gift line is evaluator OUTPUT, never input, and a flagged line already left the
 * buyer's assortment.
 */
export async function lookupCartLinePeers(
  em: EntityManager,
  cartId: string,
  scope: { tenantId: string; organizationId: string },
): Promise<CartLinePeerRow[]> {
  const rows = await em
    .getKysely<CartLinesDatabase>()
    .selectFrom('cart_lines')
    .select([
      'id',
      'product_id',
      'variant_id',
      'quantity',
      'unit_price_net',
      'unit_price_gross',
      'origin',
      'flag_state',
    ])
    .where('cart_id', '=', cartId)
    .where('tenant_id', '=', scope.tenantId)
    .where('organization_id', '=', scope.organizationId)
    .where('deleted_at', 'is', null)
    .execute()

  return rows
    .filter((row) => row.flag_state == null && row.origin !== 'promotion')
    .map((row) => ({
      lineId: row.id,
      productId: row.product_id,
      variantId: row.variant_id ?? null,
      quantity: row.quantity,
      unitPriceNet: row.unit_price_net ?? null,
      unitPriceGross: row.unit_price_gross ?? null,
    }))
}

export type CatalogWeightDimensionsRow = {
  id: string
  weightValue: string | null
  weightUnit: string | null
  dimensions: { width?: number | null; height?: number | null; depth?: number | null; unit?: string | null } | null
}

type CatalogProductsDatabase = {
  catalog_products: {
    id: string
    tenant_id: string
    organization_id: string
    weight_value: string | null
    weight_unit: string | null
    dimensions: unknown
  }
}

type CatalogProductVariantsDatabase = {
  catalog_product_variants: {
    id: string
    tenant_id: string
    organization_id: string
    weight_value: string | null
    weight_unit: string | null
    dimensions: unknown
  }
}

export async function lookupCatalogProductWeightDimensions(
  em: EntityManager,
  productIds: string[],
  scope: { tenantId: string; organizationId: string },
): Promise<CatalogWeightDimensionsRow[]> {
  if (productIds.length === 0) return []
  const rows = await em
    .getKysely<CatalogProductsDatabase>()
    .selectFrom('catalog_products')
    .select(['id', 'weight_value', 'weight_unit', 'dimensions'])
    .where('id', 'in', productIds)
    .where('tenant_id', '=', scope.tenantId)
    .where('organization_id', '=', scope.organizationId)
    .execute()
  return rows.map((row) => ({
    id: row.id,
    weightValue: row.weight_value ?? null,
    weightUnit: row.weight_unit ?? null,
    dimensions: (row.dimensions as CatalogWeightDimensionsRow['dimensions']) ?? null,
  }))
}

export async function lookupCatalogVariantWeightDimensions(
  em: EntityManager,
  variantIds: string[],
  scope: { tenantId: string; organizationId: string },
): Promise<CatalogWeightDimensionsRow[]> {
  if (variantIds.length === 0) return []
  const rows = await em
    .getKysely<CatalogProductVariantsDatabase>()
    .selectFrom('catalog_product_variants')
    .select(['id', 'weight_value', 'weight_unit', 'dimensions'])
    .where('id', 'in', variantIds)
    .where('tenant_id', '=', scope.tenantId)
    .where('organization_id', '=', scope.organizationId)
    .execute()
  return rows.map((row) => ({
    id: row.id,
    weightValue: row.weight_value ?? null,
    weightUnit: row.weight_unit ?? null,
    dimensions: (row.dimensions as CatalogWeightDimensionsRow['dimensions']) ?? null,
  }))
}

// ---------------------------------------------------------------------------
// Pure package aggregation (§5.3 C13) — no EntityManager, fully unit-testable.
// ---------------------------------------------------------------------------

export type PackageLineInput = {
  quantity: string
  weightKg: number | null
  lengthCm: number | null
  widthCm: number | null
  heightCm: number | null
}

export type ResolvedPackage = { weightKg: number; lengthCm: number; widthCm: number; heightCm: number }

function weightToKg(value: string | null, unit: string | null): number | null {
  if (value == null) return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  switch ((unit ?? 'kg').toLowerCase()) {
    case 'g':
      return parsed / 1000
    case 'lb':
      return parsed * 0.45359237
    case 'oz':
      return parsed * 0.028349523125
    case 'kg':
    default:
      return parsed
  }
}

/**
 * §5.3: "packages: One parcel per cart, weight and dimensions summed from catalog product
 * weight and dimensions; lines without data contribute a configured default (single-
 * parcel default: 1 kg, 30x20x10 cm)". Weight is a physically meaningful sum across every
 * unit in the cart (per-line weight-or-default times quantity). Dimensions are NOT summed
 * line-to-line — the spec's own single-parcel framing ("one parcel per cart") only makes
 * sense as a bounding box, so each axis takes the largest single-unit value seen across
 * lines (a judgment call, documented here and in NOTIFY.md: literally summing lengths
 * across unrelated products would produce a parcel no real carrier could quote).
 */
export function resolveCartPackage(lines: PackageLineInput[]): ResolvedPackage {
  if (lines.length === 0) {
    return {
      weightKg: CHECKOUT_DEFAULT_PACKAGE_WEIGHT_KG,
      lengthCm: CHECKOUT_DEFAULT_PACKAGE_LENGTH_CM,
      widthCm: CHECKOUT_DEFAULT_PACKAGE_WIDTH_CM,
      heightCm: CHECKOUT_DEFAULT_PACKAGE_HEIGHT_CM,
    }
  }

  let weightKg = 0
  let lengthCm = 0
  let widthCm = 0
  let heightCm = 0

  for (const line of lines) {
    const quantity = Math.max(0, Number(line.quantity) || 0)
    const unitWeightKg = line.weightKg ?? CHECKOUT_DEFAULT_PACKAGE_WEIGHT_KG
    weightKg += unitWeightKg * quantity
    lengthCm = Math.max(lengthCm, line.lengthCm ?? CHECKOUT_DEFAULT_PACKAGE_LENGTH_CM)
    widthCm = Math.max(widthCm, line.widthCm ?? CHECKOUT_DEFAULT_PACKAGE_WIDTH_CM)
    heightCm = Math.max(heightCm, line.heightCm ?? CHECKOUT_DEFAULT_PACKAGE_HEIGHT_CM)
  }

  return { weightKg, lengthCm, widthCm, heightCm }
}

function dimensionToCm(value: number | null | undefined, unit: string | null | undefined): number | null {
  if (value == null) return null
  switch ((unit ?? 'cm').toLowerCase()) {
    case 'mm':
      return value / 10
    case 'm':
      return value * 100
    case 'in':
      return value * 2.54
    case 'cm':
    default:
      return value
  }
}

/**
 * Builds one `PackageLineInput` per cart line, preferring the variant's own weight/
 * dimensions over the parent product's when the line has a variant (same "variant
 * overrides product" convention catalog pricing already follows elsewhere).
 */
export function buildPackageLineInputs(
  lines: CartLinePeerRow[],
  productRows: CatalogWeightDimensionsRow[],
  variantRows: CatalogWeightDimensionsRow[],
): PackageLineInput[] {
  const productById = new Map(productRows.map((row) => [row.id, row]))
  const variantById = new Map(variantRows.map((row) => [row.id, row]))

  return lines.map((line) => {
    const variantRow = line.variantId ? variantById.get(line.variantId) : undefined
    const productRow = productById.get(line.productId)
    const source = variantRow?.weightValue != null ? variantRow : productRow

    const weightKg = source ? weightToKg(source.weightValue, source.weightUnit) : null
    const dimensions = (variantRow?.dimensions ?? productRow?.dimensions) ?? null

    return {
      quantity: line.quantity,
      weightKg,
      lengthCm: dimensions ? dimensionToCm(dimensions.depth, dimensions.unit) : null,
      widthCm: dimensions ? dimensionToCm(dimensions.width, dimensions.unit) : null,
      heightCm: dimensions ? dimensionToCm(dimensions.height, dimensions.unit) : null,
    }
  })
}
