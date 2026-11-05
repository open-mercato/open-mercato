import type { CatalogGtinType } from '../data/types'

const DIGITS_ONLY = /^[0-9]+$/
const ASIN_PATTERN = /^[A-Z0-9]{10}$/
const ISBN10_PATTERN = /^[0-9]{9}[0-9X]$/

const GTIN_DIGIT_LENGTHS: Partial<Record<CatalogGtinType, number>> = {
  ean13: 13,
  ean8: 8,
  upc: 12,
}

export const GTIN_MAX_LENGTH = 70

export function computeGs1CheckDigit(digitsWithoutCheck: string): number {
  let sum = 0
  let weight = 3
  for (let index = digitsWithoutCheck.length - 1; index >= 0; index -= 1) {
    sum += (digitsWithoutCheck.charCodeAt(index) - 48) * weight
    weight = weight === 3 ? 1 : 3
  }
  return (10 - (sum % 10)) % 10
}

function hasValidGs1CheckDigit(digits: string): boolean {
  const body = digits.slice(0, -1)
  const checkDigit = digits.charCodeAt(digits.length - 1) - 48
  return computeGs1CheckDigit(body) === checkDigit
}

export function normalizeGtinValue(type: CatalogGtinType, raw: string): string {
  const trimmed = raw.trim()
  switch (type) {
    case 'ean13':
    case 'ean8':
    case 'upc':
      return trimmed.replace(/\s+/g, '')
    case 'isbn':
      return trimmed.replace(/[\s-]+/g, '').toUpperCase()
    case 'asin':
      return trimmed.toUpperCase()
    case 'mpn':
      return trimmed
  }
}

export function isValidGtin(type: CatalogGtinType, normalizedValue: string): boolean {
  if (!normalizedValue.length || normalizedValue.length > GTIN_MAX_LENGTH) return false
  const gs1Length = GTIN_DIGIT_LENGTHS[type]
  if (gs1Length !== undefined) {
    return (
      normalizedValue.length === gs1Length &&
      DIGITS_ONLY.test(normalizedValue) &&
      hasValidGs1CheckDigit(normalizedValue)
    )
  }
  if (type === 'isbn') {
    if (normalizedValue.length === 10) return ISBN10_PATTERN.test(normalizedValue)
    if (normalizedValue.length === 13) return DIGITS_ONLY.test(normalizedValue)
    return false
  }
  if (type === 'asin') {
    return ASIN_PATTERN.test(normalizedValue)
  }
  return true
}
