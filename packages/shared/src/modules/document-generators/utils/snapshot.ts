import { parseDecryptedFieldValue } from '../../../lib/encryption/tenantDataEncryptionService'

export type SnapshotRecord = Record<string, unknown>

export function toSnapshotRecord(value: unknown): SnapshotRecord | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as SnapshotRecord
  if (typeof value !== 'string') return null
  const parsed = parseDecryptedFieldValue(value)
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as SnapshotRecord) : null
}
