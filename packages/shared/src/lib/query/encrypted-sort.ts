import type { EntityId } from '@open-mercato/shared/modules/entities'
import { SortDir, type Sort } from './types'

export type QueryEncryptionService = {
  getEncryptedFieldNames?: (
    entityId: EntityId,
    tenantId?: string | null,
    organizationId?: string | null,
  ) => Promise<readonly string[]>
  isEnabled?: () => boolean
}

const toSnakeCase = (value: string): string =>
  value.replace(/([A-Z])/g, '_$1').replace(/__/g, '_').toLowerCase()

const toCamelCase = (value: string): string =>
  value.replace(/_([a-z])/g, (_, c) => c.toUpperCase())

export function fieldNameCandidates(field: string): string[] {
  const raw = String(field || '').trim()
  if (!raw) return []
  const candidates = [raw, toSnakeCase(raw), toCamelCase(raw)]
  if (raw.startsWith('cf:')) candidates.push(raw.replace(/[^a-zA-Z0-9_]/g, '_'))
  return Array.from(new Set(candidates))
}

/**
 * Opt-in cap on how many candidate rows the plaintext-sort path may fetch
 * for sort-column decryption. Unset or invalid input means uncapped — the
 * default must stay byte-identical to the pre-cap behavior.
 */
export function resolveEncryptedSortMaxRows(): number | null {
  const raw = process.env.OM_ENCRYPTED_SORT_MAX_ROWS
  if (raw === undefined || raw === '') return null
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return Math.floor(parsed)
}

/**
 * Reads the entity's encryption map once so a query can answer both "which sort fields are
 * encrypted" and "must the projection carry `tenant_id` into the decrypt decision" without paying
 * for two lookups.
 *
 * `null` means the map is unavailable — no service, or one that cannot report field names. A query
 * that reads `null` keeps today's behaviour for sorting (no plaintext-sort path) but must assume a
 * decrypt attempt may still follow. An empty array means the entity genuinely encrypts nothing.
 */
export async function resolveEncryptedFieldNames(
  service: QueryEncryptionService | null | undefined,
  entity: EntityId,
  tenantId?: string | null,
  organizationId?: string | null,
): Promise<readonly string[] | null> {
  if (service?.isEnabled && !service.isEnabled()) return []
  if (!service?.getEncryptedFieldNames) return null
  return await service.getEncryptedFieldNames(entity, tenantId ?? null, organizationId ?? null)
}

export function matchEncryptedSortFields(
  encryptedFieldNames: readonly string[] | null,
  sortFields: readonly string[],
): Set<string> {
  const result = new Set<string>()
  if (!encryptedFieldNames || encryptedFieldNames.length === 0) return result
  const encryptedCandidates = new Set<string>()
  for (const field of encryptedFieldNames) {
    for (const candidate of fieldNameCandidates(field)) encryptedCandidates.add(candidate)
  }
  for (const field of sortFields) {
    if (field.startsWith('cf:')) continue
    const matches = fieldNameCandidates(field).some((candidate) => encryptedCandidates.has(candidate))
    if (matches) result.add(field)
  }
  return result
}

export async function resolveEncryptedSortFields(
  service: QueryEncryptionService | null | undefined,
  entity: EntityId,
  sortFields: readonly string[],
  tenantId?: string | null,
  organizationId?: string | null,
): Promise<Set<string>> {
  const encryptedFieldNames = await resolveEncryptedFieldNames(service, entity, tenantId, organizationId)
  return matchEncryptedSortFields(encryptedFieldNames, sortFields)
}

function readField(row: Record<string, unknown>, field: string): unknown {
  for (const candidate of fieldNameCandidates(field)) {
    if (Object.prototype.hasOwnProperty.call(row, candidate)) return row[candidate]
  }
  return undefined
}

function compareValues(left: unknown, right: unknown): number {
  const leftMissing = left === null || left === undefined
  const rightMissing = right === null || right === undefined
  if (leftMissing && rightMissing) return 0
  if (leftMissing) return 1
  if (rightMissing) return -1
  if (left instanceof Date && right instanceof Date) return left.getTime() - right.getTime()
  if (typeof left === 'number' && typeof right === 'number') return left - right
  if (typeof left === 'boolean' && typeof right === 'boolean') return Number(left) - Number(right)
  return String(left).localeCompare(String(right), undefined, {
    sensitivity: 'base',
    numeric: true,
  })
}

export function sortRowsInMemory<T extends Record<string, unknown>>(
  rows: readonly T[],
  sorts: readonly Sort[],
): T[] {
  return [...rows].sort((left, right) => {
    for (const sort of sorts) {
      const direction = sort.dir === SortDir.Desc ? -1 : 1
      const compared = compareValues(readField(left, sort.field), readField(right, sort.field))
      if (compared !== 0) return compared * direction
    }
    const leftId = readField(left, 'id')
    const rightId = readField(right, 'id')
    return compareValues(leftId, rightId)
  })
}
