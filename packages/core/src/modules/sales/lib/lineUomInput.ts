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

export function buildLineUomInput(parsed: LineUomSource, existingSnapshot: StoredLineUom | null | undefined) {
  const productId =
    parsed.productId !== undefined ? parsed.productId : (existingSnapshot?.productId ?? null)
  const productVariantId =
    parsed.productVariantId !== undefined
      ? parsed.productVariantId
      : (existingSnapshot?.productVariantId ?? null)
  const sameProduct = isSameLineProduct(productId, existingSnapshot)
  const inheritedUnit = sameProduct ? existingSnapshot : null
  const inheritedNormalization = sameProduct && productId ? existingSnapshot : null
  return {
    productId: productId ?? null,
    productVariantId: productVariantId ?? null,
    quantity: parsed.quantity ?? existingSnapshot?.quantity ?? 0,
    quantityUnit: parsed.quantityUnit ?? inheritedUnit?.quantityUnit ?? null,
    normalizedQuantity: inheritedNormalization?.normalizedQuantity ?? null,
    normalizedUnit: inheritedNormalization?.normalizedUnit ?? null,
    uomSnapshot: inheritedNormalization?.uomSnapshot ?? null,
  }
}

export function isSameLineProduct(
  productId: string | null | undefined,
  existingSnapshot: StoredLineUom | null | undefined,
): boolean {
  return Boolean(existingSnapshot) && (existingSnapshot?.productId ?? null) === (productId ?? null)
}

export function canConvertLineUnitPrices(
  parsed: LineUomSource,
  lineUomInput: { productId: string | null },
  existingSnapshot: StoredLineUom | null | undefined,
): boolean {
  return parsed.quantityUnit !== undefined && isSameLineProduct(lineUomInput.productId, existingSnapshot)
}
