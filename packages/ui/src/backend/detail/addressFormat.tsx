import * as React from 'react'

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
   * delivery, and the tax identifier this invoice address was billed under. Deliberately NOT part of
   * the postal lines — see `formatAddressLines` — they render only through `AddressView`, and only
   * when the caller supplies labels for them.
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
 * A two-letter prefix is stored as `eu_vat` whatever the country, so a German `DE811907980` reads
 * "EU VAT" and not the neutral fallback. `other` covers a non-domestic address whose number carries
 * no country prefix, and also an address written before `taxIdType` existed. An unrecognised type
 * takes the `other` route rather than a guess: naming a foreign number after a domestic scheme
 * renames it, which is worse than saying nothing specific.
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

function mergeStreetLine(address: AddressValue): string | null {
  const street = normalize(address.addressLine1)
  const building = normalize(address.buildingNumber)
  const flat = normalize(address.flatNumber)
  if (!street && !building && !flat) return null
  let line = street ?? ''
  if (building) line = line ? `${line} ${building}` : building
  if (flat) line = line ? `${line}/${flat}` : flat
  return line.length ? line : null
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

export function formatAddressLines(address: AddressValue, format: AddressFormatStrategy): string[] {
  const json = formatAddressJson(address, format)
  const lines: string[] = []

  if (json.companyName) lines.push(json.companyName)

  if (format === 'street_first') {
    const streetLine = mergeStreetLine(address)
    if (streetLine) lines.push(streetLine)
    const supplemental = normalize(address.addressLine2)
    if (supplemental) lines.push(supplemental)
    const postalCity = [json.postalCode, json.city].filter(Boolean).join(' ')
    if (postalCity.length) lines.push(postalCity)
    if (json.region) lines.push(json.region)
    if (json.country) lines.push(json.country)
  } else {
    if (json.addressLine1) {
      const baseLine1 = json.addressLine1
      const appended = mergeStreetLine(address)
      if (!json.buildingNumber && !json.flatNumber) {
        lines.push(baseLine1)
      } else {
        const composite = appended ?? baseLine1
        lines.push(composite)
      }
    }
    if (json.addressLine2) lines.push(json.addressLine2)
    const postalCity = [json.postalCode, json.city].filter(Boolean).join(' ')
    if (postalCity.length) lines.push(postalCity)
    if (json.region) lines.push(json.region)
    if (json.country) lines.push(json.country)
  }

  return lines
}

export function formatAddressString(address: AddressValue, format: AddressFormatStrategy, separator = ', '): string {
  return formatAddressLines(address, format).filter(Boolean).join(separator)
}

/**
 * The address's own contact details, as `[label, value]` pairs — only the fields the caller labelled
 * AND the address actually carries. Exported so a caller can ask "is there anything to show?" without
 * rendering.
 *
 * Kept out of `formatAddressLines` on purpose: those lines are the POSTAL address, and
 * `formatAddressString` joins them with ", " into one-line summaries used in pickers and table cells.
 * A tax id or a phone number spliced into "Baker Street 10, NW1 London" would be wrong in every one
 * of those places.
 *
 * `taxIdType` never becomes a pair — it is metadata that interprets `taxId` (and will gate its
 * display), not something to print beside it.
 */
const TAX_ID_LABEL_KEY_BY_TYPE: Record<string, keyof TaxIdLabelByType> = {
  pl_nip: 'plNip',
  eu_vat: 'euVat',
}

/**
 * The type an identifier has, given the value and the address it sits on.
 *
 * The vocabulary is Stripe's `{country}_{kind}`. Two letters in front make it an EU VAT number
 * whatever the country — `DE811907980` is one, `PL1234567890` is the same business as a bare
 * `1234567890` written the other way. An unprefixed value is domestic where the address is Polish
 * and `other` everywhere else, which is a deliberate refusal to guess: naming a foreign number after
 * a domestic scheme renames it.
 *
 * Exported because a form has to derive it. Nothing in the UI can sensibly ask a user to pick
 * between `pl_nip` and `eu_vat` — the answer is already in what they typed — while a value entered
 * by hand with no type at all would leave every identifier labelled neutrally, which is the
 * distinction this vocabulary exists to draw.
 */
export function deriveTaxIdType(taxId: string | null | undefined, country: string | null | undefined): string | undefined {
  const value = typeof taxId === 'string' ? taxId.trim() : ''
  if (!value) return undefined
  if (/^[A-Za-z]{2}/.test(value)) return 'eu_vat'
  return (typeof country === 'string' ? country : '').toUpperCase() === 'PL' ? 'pl_nip' : 'other'
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
}

export function AddressView({
  address,
  format,
  className,
  lineClassName,
}: AddressViewProps): React.ReactElement | null {
  const lines = formatAddressLines(address, format)
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
