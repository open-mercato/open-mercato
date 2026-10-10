import {
  firstText,
  toSnapshotRecord,
  toText,
  type SnapshotRecord,
} from '@open-mercato/shared/modules/document-generators'

export function resolveClientName(snapshot: SnapshotRecord | null): string {
  const customer = toSnapshotRecord(snapshot?.customer)
  const contact = toSnapshotRecord(snapshot?.contact)
  const companyProfile = toSnapshotRecord(customer?.companyProfile)
  const contactName = [toText(contact?.firstName), toText(contact?.lastName)].filter(Boolean).join(' ')
  return (
    firstText(
      customer?.displayName,
      companyProfile?.legalName,
      companyProfile?.brandName,
      contact?.preferredName,
      contactName,
    ) ?? ''
  )
}

export function resolveClientAddress(snapshot: SnapshotRecord | null): string | undefined {
  if (!snapshot) return undefined
  const street = [toText(snapshot.addressLine1), toText(snapshot.buildingNumber)].filter(Boolean).join(' ')
  const flat = toText(snapshot.flatNumber)
  const streetWithFlat = flat ? `${street}/${flat}` : street
  const locality = [toText(snapshot.postalCode), toText(snapshot.city)].filter(Boolean).join(' ')
  const parts = [
    streetWithFlat,
    toText(snapshot.addressLine2),
    locality,
    toText(snapshot.region),
    toText(snapshot.country),
  ].filter((part): part is string => Boolean(part))
  return parts.length > 0 ? parts.join(', ') : undefined
}
