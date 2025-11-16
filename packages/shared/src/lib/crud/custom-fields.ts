import type { CustomFieldSet, EntityId } from '@/modules/entities'
import type { EntityManager } from '@mikro-orm/core'
import { CustomFieldDef, CustomFieldValue } from '@open-mercato/core/modules/entities/data/entities'
import type { WhereValue } from '@open-mercato/shared/lib/query/types'

export type CustomFieldSelectors = {
  keys: string[]
  selectors: string[] // e.g. ['cf:priority', 'cf:severity']
  outputKeys: string[] // e.g. ['cf_priority', 'cf_severity']
}

export type SplitCustomFieldPayload = {
  base: Record<string, unknown>
  custom: Record<string, unknown>
}

export type CustomFieldDefinitionSummary = {
  key: string
  label: string | null
  kind: string | null
  multi: boolean
  dictionaryId?: string | null
  organizationId?: string | null
  tenantId?: string | null
  priority: number
  updatedAt: number
}

export type CustomFieldDefinitionIndex = Map<string, CustomFieldDefinitionSummary[]>

export type CustomFieldDisplayEntry = {
  key: string
  label: string | null
  value: unknown
  kind: string | null
  multi: boolean
}

export type CustomFieldDisplayPayload = {
  customValues: Record<string, unknown> | null
  customFields: CustomFieldDisplayEntry[]
}

export type CustomFieldSnapshot = {
  entries: Record<string, unknown>
  customValues: Record<string, unknown> | null
  customFields: CustomFieldDisplayEntry[]
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

export function extractAllCustomFieldEntries(item: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!item || typeof item !== 'object') return out
  for (const [rawKey, rawValue] of Object.entries(item)) {
    if (rawKey.startsWith('cf_')) {
      if (rawKey.endsWith('__is_multi')) continue
      out[rawKey] = normalizeCustomFieldValue(rawValue)
    } else if (rawKey.startsWith('cf:')) {
      out[`cf_${rawKey.slice(3)}`] = normalizeCustomFieldValue(rawValue)
    }
  }
  return out
}

function normalizeFieldsetFilter(input?: string | string[] | null): Set<string | null> | null {
  if (input == null) return null
  const values = Array.isArray(input) ? input : [input]
  const normalized = new Set<string | null>()
  for (const raw of values) {
    if (raw == null) continue
    const trimmed = String(raw).trim()
    if (!trimmed) {
      normalized.add(null)
    } else {
      normalized.add(trimmed)
    }
  }
  return normalized.size ? normalized : null
}

export async function buildCustomFieldFiltersFromQuery(opts: {
  entityId?: EntityId
  entityIds?: EntityId[]
  query: Record<string, unknown>
  em: EntityManager
  tenantId: string | null | undefined
  fieldset?: string | string[] | null
}): Promise<Record<string, WhereValue>> {
  const out: Record<string, WhereValue> = {}
  const entries = Object.entries(opts.query).filter(([k]) => k.startsWith('cf_'))
  if (!entries.length) return out

  const entityIdList = Array.isArray(opts.entityIds) && opts.entityIds.length
    ? opts.entityIds
    : opts.entityId
      ? [opts.entityId]
      : []
  if (!entityIdList.length) return out

  // Tenant-only scope: allow global (null) or tenant match; ignore organization here
  const defs = await opts.em.find(CustomFieldDef, {
    entityId: { $in: entityIdList as any },
    isActive: true,
    $and: [
      { $or: [ { tenantId: opts.tenantId as any }, { tenantId: null } ] },
    ],
  })
  const fieldsetFilter = normalizeFieldsetFilter(opts.fieldset)
  const order = new Map<string, number>()
  entityIdList.map(String).forEach((id, index) => order.set(id, index))
  const byKey: Record<string, { kind: string; multi?: boolean; entityId: string }> = {}
  for (const d of defs) {
    if (fieldsetFilter) {
      const rawFieldset = typeof d.configJson?.fieldset === 'string' ? d.configJson.fieldset.trim() : ''
      const normalizedFieldset = rawFieldset.length ? rawFieldset : null
      if (!fieldsetFilter.has(normalizedFieldset)) continue
    }
    const key = d.key
    const entityId = String(d.entityId)
    const current = byKey[key]
    const rankNew = order.get(entityId) ?? Number.MAX_SAFE_INTEGER
    if (!current) {
      byKey[key] = { kind: d.kind, multi: Boolean((d as any).configJson?.multi), entityId }
      continue
    }
    const rankOld = order.get(current.entityId) ?? Number.MAX_SAFE_INTEGER
    if (rankNew < rankOld) {
      byKey[key] = { kind: d.kind, multi: Boolean((d as any).configJson?.multi), entityId }
    }
  }

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

export function splitCustomFieldPayload(raw: unknown): SplitCustomFieldPayload {
  const base: Record<string, unknown> = {}
  const custom: Record<string, unknown> = {}
  if (!raw || typeof raw !== 'object') return { base, custom }
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (key === 'customFields' && value && typeof value === 'object') {
      for (const [ck, cv] of Object.entries(value as Record<string, unknown>)) {
        custom[String(ck)] = cv
      }
      continue
    }
    if (key.startsWith('cf_')) {
      custom[key.slice(3)] = value
      continue
    }
    if (key.startsWith('cf:')) {
      custom[key.slice(3)] = value
      continue
    }
    base[key] = value
  }
  return { base, custom }
}

export function extractCustomFieldValuesFromPayload(raw: Record<string, unknown>): Record<string, unknown> {
  return splitCustomFieldPayload(raw).custom
}

function normalizeDefinitionKey(key: unknown): string {
  if (typeof key !== 'string') return ''
  const trimmed = key.trim()
  return trimmed.length ? trimmed.toLowerCase() : ''
}

function normalizeDefinitionConfig(raw: unknown): Record<string, any> {
  if (!raw) return {}
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { ...(parsed as Record<string, any>) }
      }
      return {}
    } catch {
      return {}
    }
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return { ...(raw as Record<string, any>) }
  }
  return {}
}

function summarizeDefinition(def: CustomFieldDef): CustomFieldDefinitionSummary | null {
  const normalizedKey = normalizeDefinitionKey(def.key)
  if (!normalizedKey) return null
  const cfg = normalizeDefinitionConfig((def as any).configJson)
  const label =
    typeof cfg.label === 'string' && cfg.label.trim().length
      ? cfg.label.trim()
      : def.key
  const dictionaryId =
    typeof cfg.dictionaryId === 'string' && cfg.dictionaryId.trim().length
      ? cfg.dictionaryId.trim()
      : null
  const multi =
    cfg.multi !== undefined ? Boolean(cfg.multi) : false
  const priority =
    typeof cfg.priority === 'number' ? cfg.priority : 0
  const updatedAt =
    def.updatedAt instanceof Date
      ? def.updatedAt.getTime()
      : new Date(def.updatedAt as any).getTime()
  return {
    key: def.key,
    label,
    kind: typeof def.kind === 'string' ? def.kind : null,
    multi,
    dictionaryId,
    organizationId: def.organizationId ?? null,
    tenantId: def.tenantId ?? null,
    priority,
    updatedAt: Number.isNaN(updatedAt) ? 0 : updatedAt,
  }
}

function sortDefinitionSummaries(defs: CustomFieldDefinitionSummary[]): CustomFieldDefinitionSummary[] {
  return [...defs].sort((a, b) => {
    const priorityDiff = (a.priority ?? 0) - (b.priority ?? 0)
    if (priorityDiff !== 0) return priorityDiff
    const updatedDiff = (b.updatedAt ?? 0) - (a.updatedAt ?? 0)
    if (updatedDiff !== 0) return updatedDiff
    return a.key.localeCompare(b.key)
  })
}

function selectDefinitionForRecord(
  defs: CustomFieldDefinitionSummary[],
  organizationId: string | null,
  tenantId: string | null,
): CustomFieldDefinitionSummary | null {
  if (!defs.length) return null
  const prioritizedForOrg = defs.filter(
    (def) => def.organizationId && organizationId && def.organizationId === organizationId,
  )
  if (prioritizedForOrg.length) return sortDefinitionSummaries(prioritizedForOrg)[0]
  const prioritizedForTenant = defs.filter(
    (def) => def.tenantId && tenantId && def.tenantId === tenantId && !def.organizationId,
  )
  if (prioritizedForTenant.length) return sortDefinitionSummaries(prioritizedForTenant)[0]
  const global = defs.filter((def) => !def.organizationId)
  if (global.length) return sortDefinitionSummaries(global)[0]
  return sortDefinitionSummaries(defs)[0] ?? null
}

export async function loadCustomFieldDefinitionIndex(opts: {
  em: EntityManager
  entityIds: string | string[]
  tenantId?: string | null | undefined
  organizationIds?: Array<string | null | undefined> | null
}): Promise<CustomFieldDefinitionIndex> {
  const list = Array.isArray(opts.entityIds) ? opts.entityIds : [opts.entityIds]
  const entityIds = list
    .map((id) => (typeof id === 'string' ? id.trim() : String(id ?? '')))
    .filter((id) => id.length > 0)
  if (!entityIds.length) return new Map()
  const tenantId = opts.tenantId ?? null
  const orgCandidates = Array.isArray(opts.organizationIds)
    ? opts.organizationIds
        .map((id) => (typeof id === 'string' ? id.trim() : id))
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
    : []
  const scopeClauses: Record<string, unknown>[] = [
    tenantId
      ? { $or: [{ tenantId: tenantId as any }, { tenantId: null }] }
      : { tenantId: null },
  ]
  if (orgCandidates.length) {
    scopeClauses.push({
      $or: [{ organizationId: { $in: orgCandidates as any } }, { organizationId: null }],
    })
  } else {
    scopeClauses.push({ organizationId: null })
  }
  const where: Record<string, unknown> = {
    entityId: { $in: entityIds as any },
    deletedAt: null,
    isActive: true,
    $and: scopeClauses,
  }
  const defs = await opts.em.find(CustomFieldDef, where as any)
  const index: CustomFieldDefinitionIndex = new Map()
  defs.forEach((def) => {
    const summary = summarizeDefinition(def)
    if (!summary) return
    const normalizedKey = normalizeDefinitionKey(summary.key)
    if (!normalizedKey) return
    if (!index.has(normalizedKey)) index.set(normalizedKey, [])
    index.get(normalizedKey)!.push(summary)
  })
  index.forEach((entries, key) => {
    index.set(key, sortDefinitionSummaries(entries))
  })
  return index
}

export function decorateRecordWithCustomFields(
  record: Record<string, unknown>,
  definitions: CustomFieldDefinitionIndex,
  context: {
    organizationId?: string | null
    tenantId?: string | null
  } = {},
): CustomFieldDisplayPayload {
  const rawEntries = extractAllCustomFieldEntries(record)
  if (!Object.keys(rawEntries).length) {
    return { customValues: null, customFields: [] }
  }
  const values: Record<string, unknown> = {}
  const entries: Array<{ entry: CustomFieldDisplayEntry; priority: number; updatedAt: number }> = []
  const organizationId = context.organizationId ?? null
  const tenantId = context.tenantId ?? null

  Object.entries(rawEntries).forEach(([prefixedKey, value]) => {
    const bareKey = prefixedKey.replace(/^cf_/, '')
    const normalizedKey = normalizeDefinitionKey(bareKey)
    if (!normalizedKey) return
    values[bareKey] = value
    const defsForKey = definitions.get(normalizedKey) ?? []
    const resolvedDef = selectDefinitionForRecord(defsForKey, organizationId, tenantId)
    const entry: CustomFieldDisplayEntry = {
      key: bareKey,
      label: resolvedDef?.label ?? bareKey,
      value,
      kind: resolvedDef?.kind ?? null,
      multi: resolvedDef?.multi ?? Array.isArray(value),
    }
    entries.push({
      entry,
      priority: resolvedDef?.priority ?? Number.MAX_SAFE_INTEGER,
      updatedAt: resolvedDef?.updatedAt ?? 0,
    })
  })

  const ordered = entries
    .sort((a, b) => {
      const priorityDiff = a.priority - b.priority
      if (priorityDiff !== 0) return priorityDiff
      const updatedDiff = b.updatedAt - a.updatedAt
      if (updatedDiff !== 0) return updatedDiff
      return a.entry.key.localeCompare(b.entry.key)
    })
    .map((item) => item.entry)

  return {
    customValues: Object.keys(values).length ? values : null,
    customFields: ordered,
  }
}

export async function loadCustomFieldValues(opts: {
  em: EntityManager
  entityId: EntityId
  recordIds: string[]
  tenantIdByRecord?: Record<string, string | null | undefined>
  organizationIdByRecord?: Record<string, string | null | undefined>
  tenantFallbacks?: (string | null | undefined)[]
}): Promise<Record<string, Record<string, unknown>>> {
  const { em, entityId, recordIds } = opts
  if (!Array.isArray(recordIds) || recordIds.length === 0) return {}

  const normalizedRecordIds = recordIds.map((id) => String(id))
  const tenantCandidates = new Set<string | null>()
  tenantCandidates.add(null)
  if (opts.tenantIdByRecord) {
    for (const val of Object.values(opts.tenantIdByRecord)) {
      tenantCandidates.add(val ? String(val) : null)
    }
  }
  if (opts.tenantFallbacks) {
    for (const val of opts.tenantFallbacks) tenantCandidates.add(val ? String(val) : null)
  }

  const tenantList = Array.from(tenantCandidates)
  const tenantNonNull = tenantList.filter((t): t is string => t !== null)
  const tenantFilter = tenantNonNull.length
    ? { tenantId: { $in: [...tenantNonNull, null] as any } }
    : { tenantId: null }
  const cfRows = await em.find(CustomFieldValue, {
    entityId: entityId as any,
    recordId: { $in: normalizedRecordIds as any },
    deletedAt: null,
    ...(tenantList.length ? tenantFilter : {}),
  })

  if (!cfRows.length) return {}

  const allKeys = Array.from(new Set(cfRows.map((row) => String(row.fieldKey))))
  const organizationCandidates = new Set<string | null>()
  organizationCandidates.add(null)
  if (opts.organizationIdByRecord) {
    for (const val of Object.values(opts.organizationIdByRecord)) {
      organizationCandidates.add(val ? String(val) : null)
    }
  }
  for (const row of cfRows) {
    organizationCandidates.add(row.organizationId ? String(row.organizationId) : null)
  }
  const orgList = Array.from(organizationCandidates)

  const defs = allKeys.length
    ? await em.find(CustomFieldDef, {
        entityId: entityId as any,
        key: { $in: allKeys as any },
        deletedAt: null,
        isActive: true,
        ...(tenantList.length ? { tenantId: tenantFilter.tenantId } : {}),
        organizationId: { $in: orgList as any },
      })
    : []

  const defsByKey = new Map<string, CustomFieldDef[]>()
  for (const def of defs) {
    const list = defsByKey.get(def.key) || []
    list.push(def)
    defsByKey.set(def.key, list)
  }

  const pickDefinition = (fieldKey: string, organizationId: string | null, tenantId: string | null) => {
    const candidates = defsByKey.get(fieldKey)
    if (!candidates || candidates.length === 0) return null
    const active = candidates.filter((opt) => opt.isActive !== false && !opt.deletedAt)
    const list = active.length ? active : candidates
    if (organizationId && tenantId) {
      const exact = list.find((opt) => opt.organizationId === organizationId && opt.tenantId === tenantId)
      if (exact) return exact
    }
    if (organizationId) {
      const orgMatch = list.find((opt) => opt.organizationId === organizationId && (!tenantId || opt.tenantId == null || opt.tenantId === tenantId))
      if (orgMatch) return orgMatch
    }
    if (tenantId) {
      const tenantMatch = list.find((opt) => opt.organizationId == null && opt.tenantId === tenantId)
      if (tenantMatch) return tenantMatch
    }
    const global = list.find((opt) => opt.organizationId == null && opt.tenantId == null)
    return global ?? list[0]
  }

  const valueFromRow = (row: CustomFieldValue): unknown => {
    if (row.valueMultiline !== null && row.valueMultiline !== undefined) return row.valueMultiline
    if (row.valueText !== null && row.valueText !== undefined) return row.valueText
    if (row.valueInt !== null && row.valueInt !== undefined) return row.valueInt
    if (row.valueFloat !== null && row.valueFloat !== undefined) return row.valueFloat
    if (row.valueBool !== null && row.valueBool !== undefined) return row.valueBool
    return null
  }

  type Bucket = { orgId: string | null; tenantId: string | null; values: unknown[] }
  const buckets = new Map<string, Bucket>()

  for (const row of cfRows) {
    const recordId = String(row.recordId)
    const key = String(row.fieldKey)
    const bucketKey = `${recordId}::${key}`
    const orgId = row.organizationId ? String(row.organizationId) : null
    const tenantId = row.tenantId ? String(row.tenantId) : null
    const value = valueFromRow(row)
    const existing = buckets.get(bucketKey)
    if (existing) {
      if (existing.orgId == null && orgId) existing.orgId = orgId
      if (existing.tenantId == null && tenantId) existing.tenantId = tenantId
      existing.values.push(value)
    } else {
      buckets.set(bucketKey, { orgId, tenantId, values: [value] })
    }
  }

  const result: Record<string, Record<string, unknown>> = {}
  for (const [compoundKey, bucket] of buckets.entries()) {
    const [recordId, fieldKey] = compoundKey.split('::')
    if (!result[recordId]) result[recordId] = {}
    const prefixed = `cf_${fieldKey}`
    const def = pickDefinition(fieldKey, bucket.orgId ?? (opts.organizationIdByRecord?.[recordId] ?? null), bucket.tenantId ?? (opts.tenantIdByRecord?.[recordId] ?? null))
    if (def && def.configJson && typeof def.configJson === 'object' && (def.configJson as any).multi) {
      const cleaned = bucket.values.filter((v) => v !== undefined && v !== null)
      result[recordId][prefixed] = cleaned
    } else if (bucket.values.length > 1) {
      const cleaned = bucket.values.filter((v) => v !== undefined)
      result[recordId][prefixed] = cleaned
    } else {
      result[recordId][prefixed] = bucket.values[0] ?? null
    }
  }

  return result
}

export function summarizeCustomFields(record: Record<string, unknown>): CustomFieldSnapshot {
  const entries = extractAllCustomFieldEntries(record)
  const values = Object.fromEntries(
    Object.entries(entries).map(([prefixedKey, value]) => [
      prefixedKey.replace(/^cf_/, ''),
      value,
    ]),
  )
  const customValues = Object.keys(values).length ? values : null
  const customFields = Object.entries(values).map(([key, value]) => ({
    key,
    label: key,
    value,
    kind: null,
    multi: Array.isArray(value),
  }))
  return { entries, customValues, customFields }
}
