/**
 * Entity classification — "is this id an ORM-backed system entity, a custom
 * entity, or nothing we know?"
 *
 * Extracted verbatim from `api/records.ts`, which still re-exports every symbol
 * so its own import path is unchanged. It lives here because the precedence
 * chain (ORM registry → module-declared `ce.ts` → scoped `custom_entities` row)
 * is a security decision — `restricted` drives the per-entity ACL gate — and a
 * second consumer that grew its own copy would drift from this one silently.
 *
 * The scoped lookup is the reason this cannot be a pure lookup table: the
 * `access_restricted` flag is read from the registration row that applies to
 * THIS caller, so a colliding entityId in another tenant cannot flip it.
 */

import { isOrmBackedSystemEntityId } from '@open-mercato/shared/lib/data/engine'
import { getModules } from '@open-mercato/shared/lib/i18n/server'

export type RecordsEntityScope = { tenantId: string | null; organizationId: string | null }

export type RecordsEntityKind = 'system' | 'custom' | 'unknown'

// `restricted` is meaningful only when `kind === 'custom'`; it drives the
// per-entity ACL gate in `assertEntityAclForRequest`.
export type RecordsEntityClassification = { kind: RecordsEntityKind; restricted: boolean }

let declaredCustomEntityRestricted: Map<string, boolean> | null = null

export function loadDeclaredCustomEntities(): Map<string, boolean> {
  if (declaredCustomEntityRestricted === null) {
    try {
      const mods = getModules() as Array<{ customEntities?: Array<{ id?: string; accessRestricted?: boolean }> }>
      const map = new Map<string, boolean>()
      for (const mod of mods ?? []) {
        for (const spec of mod?.customEntities ?? []) {
          if (spec?.id) map.set(spec.id, spec.accessRestricted === true)
        }
      }
      // Cache even when empty so we don't rebuild on every request (and fall back
      // to the DB lookup unnecessarily). Only a thrown getModules() leaves it null
      // so a genuinely-uninitialized registry is retried.
      declaredCustomEntityRestricted = map
    } catch {}
  }
  return declaredCustomEntityRestricted ?? new Map<string, boolean>()
}

export function isDeclaredCustomEntity(entityId: string): boolean {
  return loadDeclaredCustomEntities().has(entityId)
}

// Resolve the CustomEntity registration that applies to THIS caller, most-specific
// first (org+tenant → tenant-global → instance-global), mirroring the overlay
// precedence used by the entity-definitions list. Scoping matters because the
// row's `access_restricted` flag is a security control: an unscoped lookup could
// read another tenant's row for a colliding entityId (e.g. `user:vendors`) and
// mis-decide the restriction. Returns null when the caller's scope has no row.
export async function findScopedCustomEntity(em: any, CustomEntity: any, entityId: string, scope: RecordsEntityScope) {
  const { tenantId, organizationId } = scope
  const candidates: Array<Record<string, unknown>> = [
    { entityId, organizationId, tenantId },
    { entityId, organizationId: null, tenantId },
    { entityId, organizationId: null, tenantId: null },
  ]
  const seen = new Set<string>()
  for (const where of candidates) {
    const key = JSON.stringify(where)
    if (seen.has(key)) continue
    seen.add(key)
    const row = await em.findOne(CustomEntity as any, where)
    if (row) return row
  }
  return null
}

// This surface manages doc-storage records, which exist for CUSTOM entities only.
// Module-declared ids backed by a registered ORM table are system entities — their
// records live in their own module tables/APIs, and stray doc rows for them poisoned
// read-path classification platform-wide (#2939) — so they are rejected outright. The
// previous fallback that classified an entity by the mere presence of
// `custom_entities_storage` rows is gone: within the allowed set, declaration (ce.ts)
// or an active `custom_entities` registration is authoritative.
export async function classifyRecordsEntity(em: any, entityId: string, scope: RecordsEntityScope): Promise<RecordsEntityClassification> {
  if (isOrmBackedSystemEntityId(em, entityId)) return { kind: 'system', restricted: false }
  const declared = loadDeclaredCustomEntities()
  if (declared.has(entityId)) return { kind: 'custom', restricted: declared.get(entityId) === true }
  try {
    const { CustomEntity } = await import('../data/entities')
    // Restriction is decided from the row that applies to THIS caller's scope so
    // a colliding entityId in another tenant can't flip the flag.
    const scoped = await findScopedCustomEntity(em, CustomEntity, entityId, scope)
    if (scoped) return { kind: 'custom', restricted: (scoped as any).accessRestricted === true }
    // No in-scope registration: preserve the historical custom-vs-unknown
    // classification (any registration row — active or soft-deleted — proves the
    // id is custom; records persist beyond soft delete, TC-ENTITIES-006). A row
    // outside the caller's scope never marks the entity restricted for them, and
    // the record query is itself tenant/org-scoped, so this cannot leak data.
    const anyRow = await em.findOne(CustomEntity as any, { entityId })
    if (anyRow) return { kind: 'custom', restricted: false }
  } catch {}
  return { kind: 'unknown', restricted: false }
}
