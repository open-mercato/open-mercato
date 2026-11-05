import type { EntityManager } from '@mikro-orm/postgresql'
import {
  CustomFieldDef,
  CustomFieldEntityConfig,
} from '@open-mercato/core/modules/entities/data/entities'

/**
 * Aggregate optimistic-lock version for an entity's *definition schema*
 * (issue #3152).
 *
 * The entity definition edit form (`/backend/entities/user|system/<entityId>`)
 * saves a whole set of `CustomFieldDef` rows (plus fieldset config) via
 * `POST /api/entities/definitions.batch`. There is no single row to lock, so the
 * classic per-record `updated_at` guard cannot apply. Instead we derive one
 * aggregate version token = the newest `updated_at` across the rows that make up
 * the editable schema for the entity in the caller's scope:
 *
 *   - `CustomFieldDef` (active + tombstoned) — a field add/edit/delete bumps it,
 *   - `CustomFieldEntityConfig` — a fieldset/settings change bumps it.
 *
 * The `CustomEntity` metadata row is deliberately NOT part of this token: the
 * form's Save first PUTs entity metadata (`POST /api/entities/entities`, which
 * bumps `CustomEntity.updatedAt` and enforces its own optimistic lock) and only
 * then PUTs the definitions batch — folding the metadata row in here would make
 * the batch 409 against the form's OWN just-completed metadata save. Custom
 * entities therefore keep their concurrent-edit protection from the metadata
 * lock (primary) with the definitions token as defense-in-depth; system/code
 * entities (no metadata row, no metadata PUT) rely on the definitions token.
 * A schema with zero definitions and no config yields `null`, so locking
 * degrades to a no-op for that first-ever concurrent add edge case.
 *
 * Both the read path (`definitions.manage` GET) and the mutating endpoints must
 * compute this with identical scope inputs so the token round-trips without
 * false conflicts.
 */
export type EntityDefinitionsVersionScope = {
  entityId: string
  tenantId: string | null
  organizationId: string | null
}

function buildVisibleScopeWhere(scope: EntityDefinitionsVersionScope): Record<string, unknown> {
  const organizationCandidates: Array<{ organizationId: string | null }> = [{ organizationId: null }]
  if (scope.organizationId) organizationCandidates.unshift({ organizationId: scope.organizationId })

  const tenantCandidates: Array<{ tenantId: string | null }> = [{ tenantId: null }]
  if (scope.tenantId) tenantCandidates.unshift({ tenantId: scope.tenantId })

  return {
    entityId: scope.entityId,
    $and: [
      { $or: organizationCandidates },
      { $or: tenantCandidates },
    ],
  }
}

function toMillis(value: unknown): number {
  if (value instanceof Date) {
    const ms = value.getTime()
    return Number.isFinite(ms) ? ms : 0
  }
  if (typeof value === 'string' && value.length > 0) {
    const ms = Date.parse(value)
    return Number.isFinite(ms) ? ms : 0
  }
  return 0
}

async function latestUpdatedAtMillis(
  em: EntityManager,
  entity: unknown,
  where: Record<string, unknown>,
): Promise<number> {
  if (!entity) return 0
  try {
    const row = await em.findOne(entity as never, where as never, {
      orderBy: { updatedAt: 'desc' } as never,
      fields: ['updatedAt'] as never,
    })
    if (!row || typeof row !== 'object') return 0
    return toMillis((row as Record<string, unknown>).updatedAt)
  } catch {
    // Fail-open: a projection/schema hiccup must never 500 a save — it degrades
    // to "no version available", which the guard treats as a no-op.
    return 0
  }
}

export async function resolveEntityDefinitionsVersion(
  em: EntityManager,
  scope: EntityDefinitionsVersionScope,
): Promise<string | null> {
  const where = buildVisibleScopeWhere(scope)
  const [defMillis, configMillis] = await Promise.all([
    latestUpdatedAtMillis(em, CustomFieldDef, where),
    latestUpdatedAtMillis(em, CustomFieldEntityConfig, where),
  ])
  const newest = Math.max(defMillis, configMillis)
  if (!newest) return null
  return new Date(newest).toISOString()
}
