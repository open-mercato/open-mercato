import { formatNumber } from './money'
import { withProfile, type DisplayProfile } from './profile'

export type UnitDimension = 'mass' | 'length'

/**
 * Factors to the dimension's base unit: grams for mass, millimetres for length.
 *
 * Deliberately not a dimension engine (spec decision D9): mass and length are the two dimensions a
 * US merchant needs to read a package in, and volume and area are refused rather than guessed.
 */
const MASS_TO_GRAMS: Record<string, number> = {
  kg: 1000,
  g: 1,
  lb: 453.59237,
  oz: 28.349523125,
}

const LENGTH_TO_MILLIMETRES: Record<string, number> = {
  m: 1000,
  cm: 10,
  mm: 1,
  in: 25.4,
  ft: 304.8,
  yd: 914.4,
}

function normalizeUnit(code: string | null | undefined): string {
  return typeof code === 'string' ? code.trim().toLowerCase() : ''
}

export function unitDimension(code: string | null | undefined): UnitDimension | null {
  const unit = normalizeUnit(code)
  if (unit in MASS_TO_GRAMS) return 'mass'
  if (unit in LENGTH_TO_MILLIMETRES) return 'length'
  return null
}

/**
 * Convert between two unit codes of the same dimension.
 *
 * Returns `null` for an unknown code or a cross-dimension pair, rather than guessing: a silent
 * wrong number on a shipping label costs more than a visible empty one.
 */
export function convertUnit(value: number, from: string | null | undefined, to: string | null | undefined): number | null {
  if (!Number.isFinite(value)) return null
  const fromUnit = normalizeUnit(from)
  const toUnit = normalizeUnit(to)
  if (!fromUnit || !toUnit) return null
  if (fromUnit === toUnit) return value

  const dimension = unitDimension(fromUnit)
  if (!dimension || dimension !== unitDimension(toUnit)) return null

  const table = dimension === 'mass' ? MASS_TO_GRAMS : LENGTH_TO_MILLIMETRES
  const fromFactor = table[fromUnit]
  const toFactor = table[toUnit]
  if (!fromFactor || !toFactor) return null
  return (value * fromFactor) / toFactor
}

export type FormatUnitOptions = {
  locale?: string | null
  maximumFractionDigits?: number
}

function renderAmount(value: number, profile: DisplayProfile | null | undefined, options?: FormatUnitOptions): string {
  return (
    formatNumber(value, profile, {
      locale: options?.locale,
      maximumFractionDigits: options?.maximumFractionDigits ?? 2,
    }) ?? String(value)
  )
}

/**
 * Render a length in the market's unit, as `27 ft 6 in` when the market reads feet and inches.
 *
 * Rounds to the nearest inch: a fractional inch on a pallet height is noise, and `27 ft 6.03 in`
 * reads as a measurement error rather than a dimension.
 */
export function formatLength(
  valueInBaseUnit: number,
  baseUnit: string,
  profile?: DisplayProfile | null,
  options?: FormatUnitOptions,
): string | null {
  if (!Number.isFinite(valueInBaseUnit)) return null
  const resolved = withProfile(profile)
  const target = resolved.defaultLengthUnit

  if (resolved.lengthDisplay === 'feet_inches') {
    const inches = convertUnit(valueInBaseUnit, baseUnit, 'in')
    if (inches === null) return null
    const rounded = Math.round(inches)
    const feet = Math.trunc(rounded / 12)
    const remainder = Math.abs(rounded % 12)
    if (feet === 0) return `${renderAmount(rounded, profile, options)} in`
    if (remainder === 0) return `${renderAmount(feet, profile, options)} ft`
    return `${renderAmount(feet, profile, options)} ft ${renderAmount(remainder, profile, options)} in`
  }

  const converted = convertUnit(valueInBaseUnit, baseUnit, target)
  if (converted === null) return null
  return `${renderAmount(converted, profile, options)} ${target}`
}

/** Render a weight in the market's unit. */
export function formatWeight(
  valueInBaseUnit: number,
  baseUnit: string,
  profile?: DisplayProfile | null,
  options?: FormatUnitOptions,
): string | null {
  if (!Number.isFinite(valueInBaseUnit)) return null
  const target = withProfile(profile).defaultWeightUnit
  const converted = convertUnit(valueInBaseUnit, baseUnit, target)
  if (converted === null) return null
  return `${renderAmount(converted, profile, options)} ${target}`
}
