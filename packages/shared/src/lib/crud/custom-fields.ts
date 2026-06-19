import type { CustomFieldSet, EntityId } from '@open-mercato/shared/modules/entities'
import type { EntityManager } from '@mikro-orm/core'
import { CustomFieldDef, CustomFieldValue } from '@open-mercato/core/modules/entities/data/entities'
import type { WhereValue } from '@open-mercato/shared/lib/query/types'
import type { TenantDataEncryptionService } from '../encryption/tenantDataEncryptionService'
import { decryptCustomFieldValue, resolveTenantEncryptionService } from '../encryption/customFieldValues'
import { parseBooleanToken } from '../boolean'
import { extractCustomFieldEntries } from './custom-fields-client'
import {
  buildCustomFieldDefinitionIndexFromRows,
  normalizeDefinitionKey,
  normalizeFieldsetFilter,
  selectDefinitionForRecord,
  type CustomFieldDefinitionIndex,
  type CustomFieldDefinitionRow,
  type CustomFieldDefinitionSummary,
} from './custom-field-definition-index'

export type { CustomFieldDefinitionSummary, CustomFieldDefinitionIndex } from './custom-field-definition-index'

export type CustomFieldSelectors = {
  keys: string[]
  selectors: string[] // e.g. ['cf:priority', 'cf:severity']
  outputKeys: string[] // e.g. ['cf_priority', 'cf_severity']
}

export type SplitCustomFieldPayload = {
  base: Record<string, unknown>
  custom: Record<string, unknown>
}

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
  return extractCustomFieldEntries(item)
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
      const fieldsets = Array.isArray(d.configJson?.fieldsets)
        ? d.configJson.fieldsets
            .filter((entry: unknown): entry is string => typeof entry === 'string')
            .map((entry: string) => entry.trim())
            .filter((entry: string) => entry.length > 0)
        : []
      const rawFieldset = typeof d.configJson?.fieldset === 'string' ? d.configJson.fieldset.trim() : ''
      const normalizedFieldset = rawFieldset.length ? rawFieldset : null
      const matches = fieldsets.length > 0
        ? fieldsets.some((entry: string) => fieldsetFilter.has(entry))
        : fieldsetFilter.has(normalizedFieldset)
      if (!matches) continue
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
      case 'boolean': return parseBooleanToken(String(v)) === true
      case 'date':
      case 'datetime': return String(v)
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
    if (key === 'customFields') {
      if (Array.isArray(value)) {
        value.forEach((entry) => {
          if (!entry || typeof entry !== 'object') return
          const entryKey = typeof (entry as any).key === 'string' ? (entry as any).key.trim() : ''
          if (!entryKey) return
          custom[entryKey] = (entry as any).value
        })
        continue
      }
      if (value && typeof value === 'object') {
        for (const [ck, cv] of Object.entries(value as Record<string, unknown>)) {
          const normalizedKey = typeof ck === 'string' ? ck.trim() : ''
          if (!normalizedKey) continue
          custom[normalizedKey] = cv
        }
        continue
      }
    }
    if (key === 'customValues' && value && typeof value === 'object' && !Array.isArray(value)) {
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

type LoadCustomFieldDefinitionIndexOptions = {
  em: EntityManager
  entityIds: string | string[]
  tenantId?: string | null | undefined
  organizationIds?: Array<string | null | undefined> | null
  fieldset?: string | string[] | null
}

type CustomFieldDefIndexCache = {
  get(key: string): Promise<unknown> | unknown
  set(key: string, value: unknown, opts?: { ttl?: number; tags?: string[] }): Promise<unknown> | unknown
  deleteByTags?(tags: string[]): Promise<number> | number
}

const CF_DEF_INDEX_CACHE_KEY_PREFIX = 'crud:cf-def-index'
// Phase 2 default-off: integration runs observed `/api/customers/people`
// returning 500 with this cache path active, and the readiness-probe
// timeout blocked artifact upload so the direct stack trace was lost.
// Until cross-request safety of the SQLite-cache JSON round-trip is
// re-verified, ship with the layer disabled. Set
// `OM_CF_DEF_CACHE_TTL_MS=300000` (or any positive integer) to opt in.
const CF_DEF_INDEX_DEFAULT_TTL_MS = 0

function resolveCfDefIndexCacheTtlMs(): number {
  const raw = process.env.OM_CF_DEF_CACHE_TTL_MS
  if (raw === undefined) return CF_DEF_INDEX_DEFAULT_TTL_MS
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < 0) return CF_DEF_INDEX_DEFAULT_TTL_MS
  return parsed
}

function buildCfDefIndexCacheKey(opts: {
  tenantId: string | null
  entityIds: string[]
  organizationIds: string[]
  fieldsetKey: string | null
}): string {
  const tenant = opts.tenantId ?? 'global'
  const entities = opts.entityIds.slice().sort().join('|')
  const orgs = opts.organizationIds.length ? opts.organizationIds.slice().sort().join('|') : 'none'
  const fieldset = opts.fieldsetKey ?? 'all'
  return `${CF_DEF_INDEX_CACHE_KEY_PREFIX}:${tenant}:${entities}:${orgs}:${fieldset}`
}

function buildCfDefIndexCacheTags(opts: {
  tenantId: string | null
  entityIds: string[]
}): string[] {
  const tenant = opts.tenantId ?? 'global'
  const tagBase = `entities:definitions:${tenant}`
  const tags = new Set<string>([tagBase])
  for (const entityId of opts.entityIds) {
    tags.add(`${tagBase}:entity:${entityId}`)
  }
  return Array.from(tags)
}

function normalizeFieldsetKey(value: string | string[] | null | undefined): string | null {
  if (!value) return null
  if (Array.isArray(value)) {
    const cleaned = value
      .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
      .filter((entry) => entry.length > 0)
    if (!cleaned.length) return null
    return cleaned.sort().join(',')
  }
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function serializableIndexFromMap(index: CustomFieldDefinitionIndex): Array<[string, CustomFieldDefinitionSummary[]]> {
  return Array.from(index.entries())
}

function indexMapFromSerializable(value: unknown): CustomFieldDefinitionIndex | null {
  if (!Array.isArray(value)) return null
  const map: CustomFieldDefinitionIndex = new Map()
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length !== 2) return null
    const [key, summaries] = entry as [unknown, unknown]
    if (typeof key !== 'string' || !Array.isArray(summaries)) return null
    map.set(key, summaries as CustomFieldDefinitionSummary[])
  }
  return map
}

// Per-request micro-cache. Two CRUD calls within one HTTP request (rare but
// possible via interceptors) share the same Map keyed by ctx-like objects.
const requestScopedCfDefIndexCache = new WeakMap<object, Map<string, CustomFieldDefinitionIndex>>()

export type CustomFieldDefinitionIndexCacheKey = string

export function getRequestScopedCfDefIndexCache(scope: object): Map<string, CustomFieldDefinitionIndex> {
  let bucket = requestScopedCfDefIndexCache.get(scope)
  if (!bucket) {
    bucket = new Map()
    requestScopedCfDefIndexCache.set(scope, bucket)
  }
  return bucket
}

async function loadCustomFieldDefinitionIndexFresh(
  opts: LoadCustomFieldDefinitionIndexOptions & { entityIds: string[]; orgCandidates: string[] }
): Promise<CustomFieldDefinitionIndex> {
  const { em, entityIds, orgCandidates } = opts
  const tenantId = opts.tenantId ?? null
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
  const defs = await em.find(CustomFieldDef, where as any)
  const rows: CustomFieldDefinitionRow[] = defs.map((def) => ({
    key: def.key,
    entityId: String((def as any).entityId),
    kind: typeof def.kind === 'string' ? def.kind : null,
    configJson: (def as any).configJson,
    organizationId: def.organizationId ?? null,
    tenantId: def.tenantId ?? null,
    deletedAt: (def as any).deletedAt ?? null,
    updatedAt: (def as any).updatedAt ?? null,
  }))
  return buildCustomFieldDefinitionIndexFromRows(rows, {
    organizationIds: orgCandidates,
    fieldset: opts.fieldset,
  })
}

export async function loadCustomFieldDefinitionIndex(opts: LoadCustomFieldDefinitionIndexOptions & {
  cache?: CustomFieldDefIndexCache | null
  requestScope?: object | null
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

  const fieldsetKey = normalizeFieldsetKey(opts.fieldset)
  const ttlMs = resolveCfDefIndexCacheTtlMs()
  const cacheKey = buildCfDefIndexCacheKey({
    tenantId,
    entityIds,
    organizationIds: orgCandidates,
    fieldsetKey,
  })

  const requestBucket = opts.requestScope
    ? getRequestScopedCfDefIndexCache(opts.requestScope)
    : null
  if (requestBucket) {
    const cached = requestBucket.get(cacheKey)
    if (cached) return cached
  }

  const sharedCache = ttlMs > 0 ? opts.cache ?? null : null
  if (sharedCache && typeof sharedCache.get === 'function') {
    try {
      const cached = await sharedCache.get(cacheKey)
      const restored = indexMapFromSerializable(cached)
      if (restored) {
        if (requestBucket) requestBucket.set(cacheKey, restored)
        return restored
      }
    } catch (err) {
      console.warn('[crud:cf-def-cache] read failed', err)
    }
  }

  const index = await loadCustomFieldDefinitionIndexFresh({
    ...opts,
    entityIds,
    orgCandidates,
  })

  if (sharedCache && typeof sharedCache.set === 'function') {
    try {
      await sharedCache.set(cacheKey, serializableIndexFromMap(index), {
        ttl: ttlMs,
        tags: buildCfDefIndexCacheTags({ tenantId, entityIds }),
      })
    } catch (err) {
      console.warn('[crud:cf-def-cache] write failed', err)
    }
  }
  if (requestBucket) requestBucket.set(cacheKey, index)
  return index
}

export type ApplyCustomFieldsNormalizationOptions = {
  /**
   * When true, removes raw `cf_*` and `cf:*` keys from the record once they
   * have been extracted into `customValues` / `customFields`. Produces a single
   * canonical response shape (issue #1769). Defaults to `false` to preserve the
   * existing wire format for callers that read `cf_*` from the top level.
   */
  stripPrefixedKeys?: boolean
}

export function applyCustomFieldsNormalization(
  record: Record<string, unknown>,
  decorated: CustomFieldDisplayPayload,
  options: ApplyCustomFieldsNormalizationOptions = {},
): Record<string, unknown> {
  const stripPrefixedKeys = options.stripPrefixedKeys === true
  const base: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    if (stripPrefixedKeys && (key.startsWith('cf_') || key.startsWith('cf:'))) continue
    base[key] = value
  }
  base.customValues = decorated.customValues
  base.customFields = decorated.customFields
  return base
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
    const defsForKey = definitions.get(normalizedKey) ?? []
    const resolvedDef = selectDefinitionForRecord(defsForKey, organizationId, tenantId)
    // Skip custom field values without active definitions to prevent orphaned fields
    if (!resolvedDef) return
    values[bareKey] = value
    const entry: CustomFieldDisplayEntry = {
      key: bareKey,
      label: resolvedDef.label ?? bareKey,
      value,
      kind: resolvedDef.kind ?? null,
      multi: resolvedDef.multi ?? Array.isArray(value),
    }
    entries.push({
      entry,
      priority: resolvedDef.priority ?? Number.MAX_SAFE_INTEGER,
      updatedAt: resolvedDef.updatedAt ?? 0,
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
  encryptionService?: TenantDataEncryptionService | null
}): Promise<Record<string, Record<string, unknown>>> {
  const { em, entityId, recordIds } = opts
  if (!Array.isArray(recordIds) || recordIds.length === 0) return {}

  const normalizedRecordIds = recordIds.map((id) => String(id))
  let encryptionService: TenantDataEncryptionService | null | undefined
  const encryptionCache = new Map<string | null, string | null>()
  const getEncryptionService = () => {
    if (encryptionService !== undefined) return encryptionService
    encryptionService = resolveTenantEncryptionService(em, opts.encryptionService)
    return encryptionService
  }
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
  const fallbackTenant = (opts.tenantFallbacks || []).find((t) => t != null) ?? null

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

  type Bucket = { orgId: string | null; tenantId: string | null; values: unknown[]; def?: CustomFieldDef | null; encrypted?: boolean }
  const buckets = new Map<string, Bucket>()

  const rowInfos = cfRows.map((row) => {
    const recordId = String(row.recordId)
    const key = String(row.fieldKey)
    const bucketKey = `${recordId}::${key}`
    const orgId = row.organizationId ? String(row.organizationId) : null
    const tenantId = row.tenantId ? String(row.tenantId) : null
    const resolvedOrgId = orgId ?? (opts.organizationIdByRecord?.[recordId] ?? null)
    const resolvedTenantId = tenantId ?? (opts.tenantIdByRecord?.[recordId] ?? fallbackTenant)
    const def = pickDefinition(key, resolvedOrgId, resolvedTenantId)
    const encrypted = Boolean(def?.configJson && (def as any).configJson?.encrypted)
    const value = valueFromRow(row)
    return { bucketKey, resolvedOrgId, resolvedTenantId, tenantId, def, encrypted, value }
  })

  // Decrypt every encrypted value concurrently so a list of N rows × M encrypted
  // fields costs the slowest single decryption rather than the sum (issue #2229).
  // The shared encryptionCache keeps DEK lookups deduped per tenant.
  const decryptedValues = await Promise.all(
    rowInfos.map((info) =>
      info.encrypted
        ? decryptCustomFieldValue(
            info.value,
            info.resolvedTenantId ?? info.tenantId ?? null,
            getEncryptionService(),
            encryptionCache,
            { kind: info.def?.kind ?? null },
          )
        : info.value,
    ),
  )

  rowInfos.forEach((info, index) => {
    const decrypted = decryptedValues[index]
    const existing = buckets.get(info.bucketKey)
    if (existing) {
      if (existing.orgId == null && info.resolvedOrgId) existing.orgId = info.resolvedOrgId
      if (existing.tenantId == null && info.resolvedTenantId) existing.tenantId = info.resolvedTenantId
      if (existing.def == null && info.def) existing.def = info.def
      existing.encrypted = existing.encrypted || info.encrypted
      existing.values.push(decrypted)
    } else {
      buckets.set(info.bucketKey, { orgId: info.resolvedOrgId, tenantId: info.resolvedTenantId, values: [decrypted], def: info.def ?? null, encrypted: info.encrypted })
    }
  })

  const result: Record<string, Record<string, unknown>> = {}
  for (const [compoundKey, bucket] of buckets.entries()) {
    const [recordId, fieldKey] = compoundKey.split('::')
    if (!result[recordId]) result[recordId] = {}
    const prefixed = `cf_${fieldKey}`
    const def = bucket.def ?? pickDefinition(fieldKey, bucket.orgId ?? (opts.organizationIdByRecord?.[recordId] ?? null), bucket.tenantId ?? (opts.tenantIdByRecord?.[recordId] ?? null))
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
