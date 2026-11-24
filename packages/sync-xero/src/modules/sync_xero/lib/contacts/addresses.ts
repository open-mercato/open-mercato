import { ISO_COUNTRIES } from '@open-mercato/shared/lib/location/countries'
import type { XeroAddressType } from '../external-ids'
import { nonBlank, type XeroContact } from './contact'

export const XERO_ADDRESS_TYPES: XeroAddressType[] = ['POBOX', 'STREET']
export const XERO_ADDRESS_PURPOSE: Record<XeroAddressType, string> = { POBOX: 'billing', STREET: 'office' }

const LINE_MAX_LENGTH = 300
const PLACE_MAX_LENGTH = 150
const POSTAL_CODE_MAX_LENGTH = 30

export type XeroAddressColumn = 'addressLine1' | 'addressLine2' | 'city' | 'region' | 'postalCode' | 'country'
export type XeroAddressValues = Partial<Record<XeroAddressColumn, string>> & { addressLine1: string }
export type XeroAddressWarning = {
  code: 'xero.value_left_out' | 'xero.value_truncated' | 'xero.address_country_unrecognised'
  field: XeroAddressColumn
}
export type MappedXeroAddress = { addressType: XeroAddressType; values: XeroAddressValues; warnings: XeroAddressWarning[] }

/** A Xero-owned row as the run reads it; `entityId` is the Company the row belongs to now. */
export type AddressSnapshot = { id: string; entityId: string } & Partial<Record<XeroAddressColumn, string | null>>

const countryByName = new Map<string, string>()
for (const country of ISO_COUNTRIES) {
  countryByName.set(country.code.toLowerCase(), country.code)
  countryByName.set(country.name.toLowerCase(), country.code)
}

/** The ISO 3166-1 alpha-2 code OM's address editor selects by, when Xero's free text names a country. */
export function toCountryCode(value: string): string | null {
  return countryByName.get(value.trim().toLowerCase()) ?? null
}

function limited(value: string | null, max: number, field: XeroAddressColumn, warnings: XeroAddressWarning[]): string | null {
  if (value === null || value.length <= max) return value
  warnings.push({ code: 'xero.value_truncated', field })
  return value.slice(0, max).trimEnd()
}

/**
 * App Spec § 6.2a "Addresses": one address per Xero address type that has an address line.
 * `addressLine1` is the first non-blank line and `addressLine2` the other lines joined; blank
 * values are left out, so they clear nothing.
 */
export function mapXeroAddresses(contact: XeroContact): MappedXeroAddress[] {
  const mapped: MappedXeroAddress[] = []
  for (const addressType of XERO_ADDRESS_TYPES) {
    const address = (contact.Addresses ?? []).find((entry) => nonBlank(entry.AddressType)?.toUpperCase() === addressType)
    if (!address) continue
    const lines = [address.AddressLine1, address.AddressLine2, address.AddressLine3, address.AddressLine4]
      .map((line) => nonBlank(line))
      .filter((line): line is string => line !== null)
    if (lines.length === 0) continue
    const warnings: XeroAddressWarning[] = []
    const values: XeroAddressValues = { addressLine1: limited(lines[0], LINE_MAX_LENGTH, 'addressLine1', warnings)! }
    const addressLine2 = limited(lines.length > 1 ? lines.slice(1).join(', ') : null, LINE_MAX_LENGTH, 'addressLine2', warnings)
    if (addressLine2) values.addressLine2 = addressLine2
    const city = limited(nonBlank(address.City), PLACE_MAX_LENGTH, 'city', warnings)
    if (city) values.city = city
    const region = limited(nonBlank(address.Region), PLACE_MAX_LENGTH, 'region', warnings)
    if (region) values.region = region
    const postalCode = nonBlank(address.PostalCode)
    if (postalCode && postalCode.length > POSTAL_CODE_MAX_LENGTH) warnings.push({ code: 'xero.value_left_out', field: 'postalCode' })
    else if (postalCode) values.postalCode = postalCode
    const country = nonBlank(address.Country)
    if (country) {
      const code = toCountryCode(country)
      if (!code) warnings.push({ code: 'xero.address_country_unrecognised', field: 'country' })
      const kept = limited(code ?? country, PLACE_MAX_LENGTH, 'country', warnings)
      if (kept) values.country = kept
    }
    mapped.push({ addressType, values, warnings })
  }
  return mapped
}

/** Compare-before-write per row: only the columns whose Xero value differs. */
export function diffAddress(mapped: MappedXeroAddress, current: AddressSnapshot): Partial<XeroAddressValues> | null {
  const update: Partial<XeroAddressValues> = {}
  for (const [column, value] of Object.entries(mapped.values) as Array<[XeroAddressColumn, string]>) {
    if (value !== (current[column] ?? null)) update[column] = value
  }
  return Object.keys(update).length > 0 ? update : null
}
