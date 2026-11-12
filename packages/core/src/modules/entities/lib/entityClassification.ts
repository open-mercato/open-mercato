/**
 * Entity classification — "is this id an ORM-backed system entity, a custom
 * entity, or nothing we know?"
 *
 * Extracted from `api/records.ts`, which still re-exports every symbol
 * so its own import path is unchanged. It lives here because the precedence
 * chain (ORM registry → module-declared `ce.ts` → scoped `custom_entities` row)
 * is a security decision — `restricted` drives the per-entity ACL gate — and a
 * second consumer that grew its own copy would drift from this one silently.
 *
 * Live tenant and instance-global restrictions apply across organizations.
 * Registrations from other tenants never participate in classification.
 */

import { isOrmBackedSystemEntityId } from '@open-mercato/shared/lib/data/engine'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
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
  if (declared.get(entityId) === true) return { kind: 'custom', restricted: true }
  try {
    const { CustomEntity } = await import('../data/entities')
    const registrationScopes = scope.tenantId === null
      ? [{ tenantId: null, organizationId: null }]
      : [{ tenantId: scope.tenantId }, { tenantId: null, organizationId: null }]
    const restricted = await findOneWithDecryption<InstanceType<typeof CustomEntity>>(em, CustomEntity, {
      entityId,
      accessRestricted: true,
      isActive: true,
      deletedAt: null,
      $or: registrationScopes,
    }, undefined, { tenantId: scope.tenantId, organizationId: null })
    if (restricted?.accessRestricted === true) return { kind: 'custom', restricted: true }
    if (declared.has(entityId)) return { kind: 'custom', restricted: false }
    const scoped = await findScopedCustomEntity(em, CustomEntity, entityId, scope)
    if (scoped) return { kind: 'custom', restricted: scoped.accessRestricted === true }
    const historical = await findOneWithDecryption<InstanceType<typeof CustomEntity>>(em, CustomEntity, {
      entityId,
      tenantId: scope.tenantId,
      ...(scope.tenantId === null ? { organizationId: null } : {}),
    }, undefined, { tenantId: scope.tenantId, organizationId: null })
    if (historical) return { kind: 'custom', restricted: false }
  } catch {}
  return { kind: 'unknown', restricted: false }
}
