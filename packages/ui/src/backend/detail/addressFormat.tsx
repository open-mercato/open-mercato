import * as React from 'react'
import { addressDisplayProfile, formatAddress } from '@open-mercato/shared/lib/display/address'
import type { DisplayProfile } from '@open-mercato/shared/lib/display/profile'

/**
 * The per-organization address format setting. Deliberately narrower than the display profile's
 * `AddressLayout`: this union is the stored setting's vocabulary, and a market layout such as `us`
 * arrives through the profile rather than by widening a persisted enum.
 */
export type AddressFormatStrategy = 'line_first' | 'street_first'

export type AddressValue = {
  addressLine1: string | null | undefined
  addressLine2?: string | null
  buildingNumber?: string | null
  flatNumber?: string | null
  city?: string | null
  region?: string | null
  postalCode?: string | null
  country?: string | null
  companyName?: string | null
  /**
   * Contact details that belong to the ADDRESS rather than to the customer: who to call about this
   * delivery, and the tax identifier this invoice address was billed under. They remain available to
   * address editors and snapshot payloads, but are deliberately excluded from `formatAddressLines`
   * and `AddressView`, whose existing contract remains postal-only.
   *
   * `taxIdType` interprets the value in Stripe's `{country}_{kind}` vocabulary (`pl_nip`, `eu_vat`,
   * `other`, widened additively): `1234567890` and `PL1234567890` are the same business, and only the
   * type tells a domestic identifier from an EU VAT number. It is metadata about `taxId`, never a
   * displayed field of its own.
   */
  phone?: string | null
  taxId?: string | null
  taxIdType?: string | null
}

/**
 * Tax-id labels keyed by `taxIdType`, for a caller that wants the identifier named correctly rather
 * than generically.
 *
 * The stored scheme is chosen explicitly rather than inferred from the identifier. `other` also
 * covers an address written before `taxIdType` existed. An unrecognised type takes the `other` route
 * instead of guessing a domestic scheme.
 */
export type TaxIdLabelByType = {
  plNip: string
  euVat: string
  other: string
}

export type AddressJsonShape = {
  format: AddressFormatStrategy
  companyName: string | null
  addressLine1: string | null
  addressLine2: string | null
  buildingNumber: string | null
  flatNumber: string | null
  postalCode: string | null
  city: string | null
  region: string | null
  country: string | null
}

function normalize(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

export function formatAddressJson(address: AddressValue, format: AddressFormatStrategy): AddressJsonShape {
  return {
    format,
    companyName: normalize(address.companyName),
    addressLine1: normalize(address.addressLine1),
    addressLine2: normalize(address.addressLine2),
    buildingNumber: normalize(address.buildingNumber),
    flatNumber: normalize(address.flatNumber),
    postalCode: normalize(address.postalCode),
    city: normalize(address.city),
    region: normalize(address.region),
    country: normalize(address.country),
  }
}

/**
 * The postal lines of an address, in the conventions of the organization's market.
 *
 * The line building itself lives in `@open-mercato/shared/lib/display/address`, so this copy and
 * the `customers` copy cannot drift in their postal rules while they remain two files (spec
 * assumption A1). Without a profile the shared helper renders the frozen legacy defaults, which
 * reproduce this function's previous output line for line.
 */
export function formatAddressLines(
  address: AddressValue,
  format: AddressFormatStrategy,
  profile?: DisplayProfile | null,
): string[] {
  return formatAddress(address, addressDisplayProfile(format, profile)).lines
}

export function formatAddressString(
  address: AddressValue,
  format: AddressFormatStrategy,
  separator = ', ',
  profile?: DisplayProfile | null,
): string {
  return formatAddressLines(address, format, profile).filter(Boolean).join(separator)
}

/**
 * Which member of a label map names which scheme. Private, and deliberately not exhaustive: an
 * unrecognised type resolves to `other`, so the vocabulary can widen without every caller being
 * updated in the same release.
 */
const TAX_ID_LABEL_KEY_BY_TYPE: Record<string, keyof TaxIdLabelByType> = {
  pl_nip: 'plNip',
  eu_vat: 'euVat',
}

/**
 * The label a tax identifier should carry, given its type. Exported because the editor renders the
 * same identifier as an input and must name it the same way this formatter does — two copies of the
 * mapping is exactly how a foreign number ends up under a domestic scheme's name.
 */
export function resolveTaxIdLabel(
  label: string | TaxIdLabelByType | undefined,
  taxIdType: string | null | undefined,
): string | undefined {
  if (!label) return undefined
  if (typeof label === 'string') return label
  const key = TAX_ID_LABEL_KEY_BY_TYPE[typeof taxIdType === 'string' ? taxIdType : ''] ?? 'other'
  return label[key]
}

type AddressViewProps = {
  address: AddressValue
  format: AddressFormatStrategy
  className?: string
  lineClassName?: string
  /** The organization's market display profile; its layout wins over `format` when present. */
  profile?: DisplayProfile | null
}

export function AddressView({
  address,
  format,
  className,
  lineClassName,
  profile,
}: AddressViewProps): React.ReactElement | null {
  const lines = formatAddressLines(address, format, profile)
  if (!lines.length) return null
  return (
    <div className={className}>
      {lines.map((line, index) => (
        <div key={`${index}-${line}`} className={lineClassName}>
          {line}
        </div>
      ))}
    </div>
  )
}
