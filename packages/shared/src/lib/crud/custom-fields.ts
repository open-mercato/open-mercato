import type { CustomFieldSet, EntityId } from '@/modules/entities'
import type { EntityManager } from '@mikro-orm/core'
import { CustomFieldDef } from '@open-mercato/core/modules/custom_fields/data/entities'
import type { WhereValue } from '@open-mercato/shared/lib/query/types'

export type CustomFieldSelectors = {
  keys: string[]
  selectors: string[] // e.g. ['cf:priority', 'cf:severity']
  outputKeys: string[] // e.g. ['cf_priority', 'cf_severity']
}

export function buildCustomFieldSelectorsForEntity(entityId: EntityId, sets: CustomFieldSet[]): CustomFieldSelectors {
  const keys = Array.from(new Set(
    (sets || [])
      .filter((s) => s.entity === entityId)
      .flatMap((s) => (s.fields || []).map((f) => f.key))
  ))
  const selectors = keys.map((k) => `cf:${k}`)
  const outputKeys = keys.map((k) => `cf_${k}`)
  return { keys, selectors, outputKeys }
}

export function normalizeCustomFieldValue(val: unknown): unknown {
  if (Array.isArray(val)) return val
  if (typeof val === 'string') {
    const s = val.trim()
    // Parse Postgres array-like '{a,b,c}' to string[] when present
    if (s.startsWith('{') && s.endsWith('}')) {
      const inner = s.slice(1, -1).trim()
      if (!inner) return []
      return inner.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean)
    }
    return s
  }
  return val as any
}

// Extracts cf_* fields from a record that may contain both 'cf:<key>' and/or 'cf_<key>'
export function extractCustomFieldsFromItem(item: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of keys) {
    const colon = item[`cf:${key}` as keyof typeof item]
    const snake = item[`cf_${key}` as keyof typeof item]
    const value = colon !== undefined ? colon : snake
    if (value !== undefined) out[`cf_${key}`] = normalizeCustomFieldValue(value)
  }
  return out
}

export async function buildCustomFieldFiltersFromQuery(opts: {
  entityId: EntityId
  query: Record<string, unknown>
  em: EntityManager
  orgId: string | null | undefined
  tenantId: string | null | undefined
}): Promise<Record<string, WhereValue>> {
  const out: Record<string, WhereValue> = {}
  const entries = Object.entries(opts.query).filter(([k]) => k.startsWith('cf_'))
  if (!entries.length) return out

  const defs = await opts.em.find(CustomFieldDef, {
    entityId: opts.entityId as string,
    organizationId: { $in: [opts.orgId ?? null, null] as any },
    tenantId: { $in: [opts.tenantId ?? null, null] as any },
    isActive: true,
  })
  const byKey: Record<string, { kind: string; multi?: boolean }> = {}
  for (const d of defs) byKey[d.key] = { kind: d.kind, multi: Boolean((d as any).configJson?.multi) }

  const coerce = (kind: string, v: unknown) => {
    if (v == null) return v as undefined
    switch (kind) {
      case 'integer': return Number.parseInt(String(v), 10)
      case 'float': return Number.parseFloat(String(v))
      case 'boolean': return String(v).toLowerCase() === 'true'
      default: return String(v)
    }
  }

  for (const [rawKey, rawVal] of entries) {
    const isIn = rawKey.endsWith('In')
    const key = isIn ? rawKey.replace(/^cf_/, '').replace(/In$/, '') : rawKey.replace(/^cf_/, '')
    const def = byKey[key]
    const fieldId = `cf:${key}`
    if (!def) continue
    if (isIn) {
      const list = Array.isArray(rawVal)
        ? (rawVal as unknown[])
        : String(rawVal)
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
      if (list.length) out[fieldId] = { $in: list.map((x) => coerce(def.kind, x)) as (string[] | number[] | boolean[]) }
    } else {
      out[fieldId] = coerce(def.kind, rawVal)
    }
  }

  return out
}
