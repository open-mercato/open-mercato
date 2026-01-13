import type { EntityManager } from '@mikro-orm/postgresql'
import { loadCustomFieldValues } from '@open-mercato/shared/lib/crud/custom-fields'

export type CustomFieldSnapshot = Record<string, unknown>

type LoadSnapshotOptions = {
  entityId: string
  recordId: string
  tenantId?: string | null
  organizationId?: string | null
  tenantFallbacks?: Array<string | null | undefined>
}

export async function loadCustomFieldSnapshot(
  em: EntityManager,
  { entityId, recordId, tenantId, organizationId, tenantFallbacks }: LoadSnapshotOptions
): Promise<CustomFieldSnapshot> {
  const tenant = tenantId ?? null
  const organization = organizationId ?? undefined
  const records = await loadCustomFieldValues({
    em,
    entityId: entityId as any,
    recordIds: [recordId],
    tenantIdByRecord: { [recordId]: tenant },
    organizationIdByRecord: organization === undefined ? undefined : { [recordId]: organization ?? null },
    tenantFallbacks: tenantFallbacks ?? [tenant],
  })
  const raw = records[recordId] ?? {}
  const custom: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (key.startsWith('cf_')) custom[key.slice(3)] = value
  }
  return custom
}

export function buildCustomFieldResetMap(
  before: CustomFieldSnapshot | undefined,
  after: CustomFieldSnapshot | undefined
): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  const keys = new Set<string>()
  if (before) for (const key of Object.keys(before)) keys.add(key)
  if (after) for (const key of Object.keys(after)) keys.add(key)
  for (const key of keys) {
    const hasBefore = Boolean(before && Object.prototype.hasOwnProperty.call(before, key))
    if (hasBefore) {
      const beforeValue = before?.[key]
      if (beforeValue === null && Array.isArray(after?.[key])) {
        values[key] = []
      } else {
        values[key] = beforeValue
      }
    } else {
      values[key] = Array.isArray(after?.[key]) ? [] : null
    }
  }
  return values
}

export type CustomFieldChangeSet = Record<string, { from: unknown; to: unknown }>

export function diffCustomFieldChanges(
  before: CustomFieldSnapshot | undefined,
  after: CustomFieldSnapshot | undefined
): CustomFieldChangeSet {
  const out: CustomFieldChangeSet = {}
  const keys = new Set<string>()
  if (before) for (const key of Object.keys(before)) keys.add(key)
  if (after) for (const key of Object.keys(after)) keys.add(key)
  for (const key of keys) {
    const prev = before ? before[key] : undefined
    const next = after ? after[key] : undefined
    if (!customFieldValuesEqual(prev, next)) {
      out[key] = { from: prev ?? null, to: next ?? null }
    }
  }
  return out
}

function customFieldValuesEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    return a.every((value, idx) => customFieldValuesEqual(value, b[idx]))
  }
  return a === b
}
