import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { SalesLineSnapshot } from './types'

export type LineUomSource = {
  productId?: string | null
  productVariantId?: string | null
  quantity?: number | null
  quantityUnit?: string | null
}

export type StoredLineUom = {
  productId?: string | null
  productVariantId?: string | null
  quantity?: number | null
  quantityUnit?: string | null
  normalizedQuantity?: number | null
  normalizedUnit?: string | null
  uomSnapshot?: SalesLineSnapshot['uomSnapshot']
}

export type LineUomInput = {
  productId: string | null
  productVariantId: string | null
  quantity: number
  quantityUnit: string | null
  normalizedQuantity: number | null
  normalizedUnit: string | null
  uomSnapshot: SalesLineSnapshot['uomSnapshot'] | null
}

const CARRIED_UNIT_REJECTION_CODES = new Set(['uom.conversion_not_found', 'uom.unit_not_found'])

function resolveLineProduct(parsed: LineUomSource, existingSnapshot: StoredLineUom | null | undefined) {
  const productId =
    parsed.productId !== undefined ? parsed.productId : (existingSnapshot?.productId ?? null)
  const productVariantId =
    parsed.productVariantId !== undefined
      ? parsed.productVariantId
      : (existingSnapshot?.productVariantId ?? null)
  return { productId: productId ?? null, productVariantId: productVariantId ?? null }
}

export function isSameLineProduct(
  productId: string | null | undefined,
  existingSnapshot: StoredLineUom | null | undefined,
): boolean {
  return Boolean(existingSnapshot) && (existingSnapshot?.productId ?? null) === (productId ?? null)
}

/**
 * True when the stored unit is carried over to a different, non-null product
 * without the caller naming a unit. The new product may not sell in that unit,
 * so the caller should retry with the product's default unit on rejection.
 */
export function isCarriedOverLineUnit(
  parsed: LineUomSource,
  existingSnapshot: StoredLineUom | null | undefined,
): boolean {
  if (parsed.quantityUnit !== undefined || !existingSnapshot?.quantityUnit) return false
  const { productId } = resolveLineProduct(parsed, existingSnapshot)
  return Boolean(productId) && !isSameLineProduct(productId, existingSnapshot)
}

export function buildLineUomInput(
  parsed: LineUomSource,
  existingSnapshot: StoredLineUom | null | undefined,
): LineUomInput {
  const { productId, productVariantId } = resolveLineProduct(parsed, existingSnapshot)
  const sameProduct = isSameLineProduct(productId, existingSnapshot)
  const keepsStoredUnit = sameProduct || (Boolean(productId) && Boolean(existingSnapshot))
  const storedUnit = keepsStoredUnit ? (existingSnapshot?.quantityUnit ?? null) : null
  const inheritedNormalization = sameProduct && productId ? existingSnapshot : null
  return {
    productId,
    productVariantId,
    quantity: parsed.quantity ?? existingSnapshot?.quantity ?? 0,
    quantityUnit: parsed.quantityUnit !== undefined ? parsed.quantityUnit : storedUnit,
    normalizedQuantity: inheritedNormalization?.normalizedQuantity ?? null,
    normalizedUnit: inheritedNormalization?.normalizedUnit ?? null,
    uomSnapshot: inheritedNormalization?.uomSnapshot ?? null,
  }
}

export async function normalizeWithCarriedUnitFallback<T>(
  lineUomInput: LineUomInput,
  carriedOver: boolean,
  normalize: (input: LineUomInput) => Promise<T>,
): Promise<{ result: T; lineUomInput: LineUomInput }> {
  try {
    return { result: await normalize(lineUomInput), lineUomInput }
  } catch (err) {
    const code = err instanceof CrudHttpError ? err.body?.error : null
    if (!carriedOver || typeof code !== 'string' || !CARRIED_UNIT_REJECTION_CODES.has(code)) throw err
    const fallback = { ...lineUomInput, quantityUnit: null }
    return { result: await normalize(fallback), lineUomInput: fallback }
  }
}

export function canConvertLineUnitPrices(
  parsed: LineUomSource,
  lineUomInput: { productId: string | null },
  existingSnapshot: StoredLineUom | null | undefined,
): boolean {
  return (
    parsed.quantityUnit !== undefined &&
    Boolean(lineUomInput.productId) &&
    isSameLineProduct(lineUomInput.productId, existingSnapshot)
  )
}
