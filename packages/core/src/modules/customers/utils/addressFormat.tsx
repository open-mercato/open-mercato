import * as React from 'react'
import type { CustomerAddressFormat } from '../data/entities'

export type AddressFormatStrategy = CustomerAddressFormat

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

type AddressViewProps = {
  address: AddressValue
  format: AddressFormatStrategy
  className?: string
  lineClassName?: string
}

export function AddressView({ address, format, className, lineClassName }: AddressViewProps): React.ReactElement | null {
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
