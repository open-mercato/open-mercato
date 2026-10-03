import { parseDecryptedFieldValue } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'

export type SnapshotRecord = Record<string, unknown>

export function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export function toSnapshotRecord(value: unknown): SnapshotRecord | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as SnapshotRecord
  if (typeof value !== 'string') return null
  const parsed = parseDecryptedFieldValue(value)
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as SnapshotRecord) : null
}

export function toText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

export function toNumber(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''))
  return Number.isFinite(parsed) ? parsed : 0
}

export function firstText(...values: unknown[]): string | undefined {
  for (const value of values) {
    const text = toText(value)
    if (text) return text
  }
  return undefined
}

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

export function buildLabels<Key extends string>(
  keys: readonly Key[],
  defaults: Record<Key, string>,
  translationPrefix: string,
  translate: (key: string, fallback?: string) => string,
): Record<Key, string> {
  const entries = keys.map((key) => [key, translate(`${translationPrefix}.${key}`, defaults[key])])
  return Object.fromEntries(entries) as Record<Key, string>
}
