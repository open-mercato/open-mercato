// Core-free building blocks for the custom-field definition index.
//
// This module intentionally has ZERO dependency on `@open-mercato/core` (no ORM
// entity imports) so that infrastructure code such as the query engine can build
// the same definition index that `custom-fields.ts` produces via MikroORM, without
// pulling a domain package into the query layer.

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

// Plain-row representation of a `custom_field_defs` record. Both the ORM-backed
// loader (`custom-fields.ts`) and the Kysely-backed query engine map their native
// rows into this shape before building an index, so the two paths stay in lockstep.
export type CustomFieldDefinitionRow = {
  key: string
  entityId: string
  kind: string | null
  configJson: unknown
  organizationId: string | null
  tenantId: string | null
  deletedAt: Date | string | number | null
  updatedAt: Date | string | number | null
}

// The resolved definition index the query engine threads onto its result so the
// CRUD factory can decorate list rows without reloading definitions (issue #2133).
export type ResolvedCustomFieldDefinitions = {
  index: CustomFieldDefinitionIndex
  entityIds: string[]
  tenantId: string | null
  organizationIds: string[]
}

export function normalizeDefinitionKey(key: unknown): string {
  if (typeof key !== 'string') return ''
  const trimmed = key.trim()
  return trimmed.length ? trimmed.toLowerCase() : ''
}

export function normalizeDefinitionConfig(raw: unknown): Record<string, any> {
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

export function normalizeFieldsetFilter(input?: string | string[] | null): Set<string | null> | null {
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

function toTimeMs(value: Date | string | number | null | undefined): number {
  if (value == null) return 0
  if (value instanceof Date) return value.getTime()
  const parsed = new Date(value as any).getTime()
  return Number.isNaN(parsed) ? 0 : parsed
}

export function summarizeDefinitionRow(row: CustomFieldDefinitionRow): CustomFieldDefinitionSummary | null {
  const normalizedKey = normalizeDefinitionKey(row.key)
  if (!normalizedKey) return null
  const cfg = normalizeDefinitionConfig(row.configJson)
  const label =
    typeof cfg.label === 'string' && cfg.label.trim().length
      ? cfg.label.trim()
      : row.key
  const dictionaryId =
    typeof cfg.dictionaryId === 'string' && cfg.dictionaryId.trim().length
      ? cfg.dictionaryId.trim()
      : null
  const multi = cfg.multi !== undefined ? Boolean(cfg.multi) : false
  const priority = typeof cfg.priority === 'number' ? cfg.priority : 0
  return {
    key: row.key,
    label,
    kind: typeof row.kind === 'string' ? row.kind : null,
    multi,
    dictionaryId,
    organizationId: row.organizationId ?? null,
    tenantId: row.tenantId ?? null,
    priority,
    updatedAt: toTimeMs(row.updatedAt),
  }
}

export function sortDefinitionSummaries(defs: CustomFieldDefinitionSummary[]): CustomFieldDefinitionSummary[] {
  return [...defs].sort((a, b) => {
    const priorityDiff = (a.priority ?? 0) - (b.priority ?? 0)
    if (priorityDiff !== 0) return priorityDiff
    const updatedDiff = (b.updatedAt ?? 0) - (a.updatedAt ?? 0)
    if (updatedDiff !== 0) return updatedDiff
    return a.key.localeCompare(b.key)
  })
}

export function selectDefinitionForRecord(
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

// Resolve the effective list of organization candidates for a definition index
// lookup, mirroring `loadCustomFieldDefinitionIndex`: when explicit org ids are
// present they win, otherwise the fallback (selected org) is used. Null/empty
// entries are dropped — the null-org branch is always allowed by the index filter.
export function resolveCfDefIndexOrgCandidates(
  organizationIds: Array<string | null | undefined> | null | undefined,
  fallbackOrganizationId: string | null | undefined,
): string[] {
  const source = Array.isArray(organizationIds) && organizationIds.length
    ? organizationIds
    : [fallbackOrganizationId ?? null]
  return source
    .map((id) => (typeof id === 'string' ? id.trim() : id))
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
}

function matchesFieldset(configJson: unknown, fieldsetFilter: Set<string | null>): boolean {
  const config = normalizeDefinitionConfig(configJson)
  const fieldsets = Array.isArray(config.fieldsets)
    ? config.fieldsets
        .filter((entry: unknown): entry is string => typeof entry === 'string')
        .map((entry: string) => entry.trim())
        .filter((entry: string) => entry.length > 0)
    : []
  const fieldset = typeof config.fieldset === 'string' && config.fieldset.trim().length > 0
    ? config.fieldset.trim()
    : null
  return fieldsets.length > 0
    ? fieldsets.some((entry: string) => fieldsetFilter.has(entry))
    : fieldsetFilter.has(fieldset)
}

// Build the grouped + sorted definition index from plain rows. Callers must
// pre-filter rows by tenant + is_active (both the ORM loader and the query engine
// already do so in SQL); this function additionally applies the org candidate
// filter, the soft-delete guard, and the optional fieldset filter so its output is
// byte-for-byte identical to the ORM-backed loader for the same logical scope.
export function buildCustomFieldDefinitionIndexFromRows(
  rows: CustomFieldDefinitionRow[],
  opts: { organizationIds?: string[] | null; fieldset?: string | string[] | null } = {},
): CustomFieldDefinitionIndex {
  const orgCandidates = opts.organizationIds ?? []
  const fieldsetFilter = normalizeFieldsetFilter(opts.fieldset)
  const index: CustomFieldDefinitionIndex = new Map()
  for (const row of rows) {
    if (row.deletedAt != null) continue
    const org = row.organizationId ?? null
    if (org !== null && !(orgCandidates.length > 0 && orgCandidates.includes(org))) continue
    if (fieldsetFilter && !matchesFieldset(row.configJson, fieldsetFilter)) continue
    const summary = summarizeDefinitionRow(row)
    if (!summary) continue
    const normalizedKey = normalizeDefinitionKey(summary.key)
    if (!normalizedKey) continue
    if (!index.has(normalizedKey)) index.set(normalizedKey, [])
    index.get(normalizedKey)!.push(summary)
  }
  index.forEach((entries, key) => {
    index.set(key, sortDefinitionSummaries(entries))
  })
  return index
}

function sameStringSet(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a)
  const right = new Set(b)
  if (left.size !== right.size) return false
  for (const value of left) {
    if (!right.has(value)) return false
  }
  return true
}

// Decide whether a precomputed definition index from a QueryEngine result can be
// reused for a decoration request. Reuse is only safe when the engine resolved
// definitions for exactly the same entity-id set, tenant, and org candidates.
export function canReuseCustomFieldDefinitions(
  resolved: ResolvedCustomFieldDefinitions | null | undefined,
  request: { entityIds: string[]; tenantId: string | null; organizationIds: string[] },
): boolean {
  if (!resolved) return false
  if ((resolved.tenantId ?? null) !== (request.tenantId ?? null)) return false
  if (!sameStringSet(resolved.entityIds.map(String), request.entityIds.map(String))) return false
  if (!sameStringSet(resolved.organizationIds, request.organizationIds)) return false
  return true
}
