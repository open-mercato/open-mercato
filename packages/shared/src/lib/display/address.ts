import { testLinearRegex } from '../regex/linear'
import { getSubdivisions, isValidSubdivision, type Subdivision } from '../location/subdivisions'
import { LEGACY_DISPLAY_DEFAULTS, withProfile, type AddressLayout, type DisplayProfile } from './profile'

/**
 * The address shape the display layer reads.
 *
 * Structurally compatible with the `AddressValue` both editors already pass, minus the fields a
 * postal rendering never prints (`phone`, `taxId`, `taxIdType`). `recipient` is additive: the `us`
 * layout prints a person above the company, and no existing caller has to supply it.
 */
export type DisplayAddressValue = {
  recipient?: string | null
  companyName?: string | null
  addressLine1?: string | null
  addressLine2?: string | null
  buildingNumber?: string | null
  flatNumber?: string | null
  city?: string | null
  region?: string | null
  postalCode?: string | null
  country?: string | null
}

/**
 * What an address editor needs to know to render itself for a market, with no `markets` import.
 *
 * The editors consume this descriptor instead of branching on the layout themselves, so the two
 * `AddressEditor` twins cannot drift in their rules while they remain two files (spec assumption A1).
 */
export type AddressLayoutDescriptor = {
  layout: AddressLayout
  postalCodeLabelKey: string
  subdivisionLabelKey: string
  addressLine2LabelKey: string
  /** Render `region` as a select over these when non-empty, otherwise as a text input. */
  subdivisions: readonly Subdivision[]
  subdivisionRequired: boolean
  postalCodePattern: string | null
  defaultCountryCode: string | null
  /** Polish building and flat number inputs are hidden under a layout that has no use for them. */
  showBuildingAndFlatNumber: boolean
}

export type AddressValidationIssue = 'invalid_subdivision' | 'invalid_postal_code'

function normalize(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function mergeStreetLine(address: DisplayAddressValue): string | null {
  const street = normalize(address.addressLine1)
  const building = normalize(address.buildingNumber)
  const flat = normalize(address.flatNumber)
  if (!street && !building && !flat) return null
  let line = street ?? ''
  if (building) line = line ? `${line} ${building}` : building
  if (flat) line = line ? `${line}/${flat}` : flat
  return line.length ? line : null
}

/**
 * The profile an address surface should format with, given the per-organization address format
 * setting it already reads today.
 *
 * A picked market wins over the legacy setting: Phase 1 turned the `customers` address format
 * control into an info alert as soon as a profile row exists, so two sources of truth for the same
 * decision cannot both be live. Without a profile the legacy setting is all there is, so it is
 * folded into the frozen defaults and today's rendering is reproduced exactly.
 */
export function addressDisplayProfile(
  fallbackLayout: AddressLayout,
  profile?: DisplayProfile | null,
): DisplayProfile {
  if (profile) return profile
  return { ...LEGACY_DISPLAY_DEFAULTS, addressLayout: fallbackLayout }
}

export function resolveAddressLayout(profile?: DisplayProfile | null): AddressLayoutDescriptor {
  const resolved = withProfile(profile)
  const countryCode = resolved.defaultCountryCode
  const subdivisions = resolved.subdivisionRequired ? getSubdivisions(countryCode) : []
  return {
    layout: resolved.addressLayout,
    postalCodeLabelKey: resolved.postalCodeLabelKey,
    subdivisionLabelKey: resolved.subdivisionLabelKey,
    addressLine2LabelKey: resolved.addressLine2LabelKey,
    subdivisions,
    subdivisionRequired: resolved.subdivisionRequired,
    postalCodePattern: resolved.postalCodePattern,
    defaultCountryCode: countryCode,
    showBuildingAndFlatNumber: resolved.addressLayout !== 'us',
  }
}

/**
 * Whether a postal code satisfies the market's pattern.
 *
 * The pattern is operator-supplied, so it runs through the linear-time RE2 matcher rather than
 * `RegExp`: a catastrophically backtracking pattern saved on the settings page would otherwise hang
 * a request thread on every address that fails to match it. An unparseable pattern accepts the
 * value rather than locking the admin out of their own data.
 */
export function isValidPostalCode(value: string | null | undefined, pattern: string | null | undefined): boolean {
  const normalized = normalize(value)
  if (!normalized) return true
  const trimmedPattern = normalize(pattern)
  if (!trimmedPattern) return true
  const result = testLinearRegex(trimmedPattern, normalized, { maxInputLength: 64 })
  return result.ok ? result.matched : true
}

/**
 * The market rules an address breaks, for a warning badge.
 *
 * Never an error and never a save blocker on an existing record (spec invariant 5): a display
 * setting must not make data that predates it unreachable.
 */
export function validateAddressForProfile(
  address: DisplayAddressValue,
  profile?: DisplayProfile | null,
): AddressValidationIssue[] {
  const descriptor = resolveAddressLayout(profile)
  const issues: AddressValidationIssue[] = []
  const region = normalize(address.region)
  const country = normalize(address.country) ?? descriptor.defaultCountryCode

  if (descriptor.subdivisionRequired && region && !isValidSubdivision(country, region)) {
    issues.push('invalid_subdivision')
  }
  if (!isValidPostalCode(address.postalCode, descriptor.postalCodePattern)) {
    issues.push('invalid_postal_code')
  }
  return issues
}

function usLines(address: DisplayAddressValue, profile: DisplayProfile): string[] {
  const lines: string[] = []
  const recipient = normalize(address.recipient)
  const company = normalize(address.companyName)
  const line1 = normalize(address.addressLine1)
  const line2 = normalize(address.addressLine2)
  const city = normalize(address.city)
  const region = normalize(address.region)
  const postalCode = normalize(address.postalCode)
  const country = normalize(address.country)

  if (recipient) lines.push(recipient)
  if (company) lines.push(company)
  if (line1) lines.push(line1)
  if (line2) lines.push(line2)

  const localityParts: string[] = []
  if (city) localityParts.push(city.toUpperCase())
  if (region) localityParts.push(region.toUpperCase())
  if (postalCode) localityParts.push(postalCode)
  if (localityParts.length) lines.push(localityParts.join(' '))

  // The country is noise on a domestic envelope and essential on an international one.
  if (country && country.toUpperCase() !== (profile.defaultCountryCode ?? '').toUpperCase()) {
    lines.push(country)
  }
  return lines
}

function europeanLines(address: DisplayAddressValue, layout: AddressLayout): string[] {
  const lines: string[] = []
  const recipient = normalize(address.recipient)
  const company = normalize(address.companyName)
  const line2 = normalize(address.addressLine2)
  const city = normalize(address.city)
  const region = normalize(address.region)
  const postalCode = normalize(address.postalCode)
  const country = normalize(address.country)

  if (recipient) lines.push(recipient)
  if (company) lines.push(company)

  if (layout === 'street_first') {
    const streetLine = mergeStreetLine(address)
    if (streetLine) lines.push(streetLine)
    if (line2) lines.push(line2)
  } else {
    const line1 = normalize(address.addressLine1)
    if (line1) {
      const merged = mergeStreetLine(address)
      lines.push(!normalize(address.buildingNumber) && !normalize(address.flatNumber) ? line1 : (merged ?? line1))
    }
    if (line2) lines.push(line2)
  }

  const postalCity = [postalCode, city].filter(Boolean).join(' ')
  if (postalCity.length) lines.push(postalCity)
  if (region) lines.push(region)
  if (country) lines.push(country)
  return lines
}

/** Render an address in the market's postal conventions, as separate lines and as one line. */
export function formatAddress(
  address: DisplayAddressValue,
  profile?: DisplayProfile | null,
  separator = ', ',
): { lines: string[]; oneLine: string } {
  const resolved = withProfile(profile)
  const lines = resolved.addressLayout === 'us'
    ? usLines(address, resolved)
    : europeanLines(address, resolved.addressLayout)
  return { lines, oneLine: lines.filter(Boolean).join(separator) }
}
