import { getModules } from '@open-mercato/shared/lib/i18n/server'
import { synthesizedRecordFeatures } from './recordFeatures'

export type SynthesizedFeatureItem = {
  id: string
  title: string
  module: string
  dependsOn?: string[]
}

type RestrictedEntity = { entityId: string; label: string }

type DeclaredEntities = { restricted: RestrictedEntity[]; ids: Set<string> }

// Reads module-declared (ce.ts) custom entities. `restricted` holds those flagged
// accessRestricted; `ids` holds ALL declared ids so the DB path can defer to the
// declaration — the declared registry is authoritative for its own ids, matching
// the records-route enforcement precedence (declared wins over the DB row).
function declaredEntities(): DeclaredEntities {
  const restricted: RestrictedEntity[] = []
  const ids = new Set<string>()
  try {
    const mods = getModules() as Array<{
      customEntities?: Array<{ id?: string; label?: string; accessRestricted?: boolean }>
    }>
    for (const mod of mods || []) {
      for (const spec of mod?.customEntities ?? []) {
        if (!spec?.id) continue
        ids.add(spec.id)
        if (spec.accessRestricted === true) restricted.push({ entityId: spec.id, label: spec.label || spec.id })
      }
    }
  } catch {}
  return { restricted, ids }
}

// Reads user-registered custom entities flagged access_restricted for the given
// tenant scope. Uses the raw table (not the ORM class) to keep this helper cheap
// and avoid pulling entity metadata into unrelated callers.
async function registeredRestrictedEntities(em: any, tenantId: string): Promise<RestrictedEntity[]> {
  try {
    const db = em.getKysely()
    const rows = await db
      .selectFrom('custom_entities' as any)
      .select(['entity_id' as any, 'label' as any])
      .where('access_restricted' as any, '=', true)
      .where('deleted_at' as any, 'is', null as any)
      .where((eb: any) =>
        eb.or([
          eb('tenant_id' as any, '=', tenantId),
          eb('tenant_id' as any, 'is', null as any),
        ]),
      )
      .execute()
    return (rows as Array<{ entity_id?: unknown; label?: unknown }>).map((row) => ({
      entityId: String(row.entity_id ?? ''),
      label: typeof row.label === 'string' && row.label.length ? row.label : String(row.entity_id ?? ''),
    })).filter((row) => row.entityId.length > 0)
  } catch {
    return []
  }
}

/**
 * Feature-catalog contribution for restricted custom entities: two synthesized
 * per-entity features (view/manage) per restricted entity in the tenant scope,
 * so admins can grant them in the Role/User ACL editor. Fails safe (returns what
 * it can) — never throws — so the static feature catalog is unaffected on error.
 */
export async function synthesizeRestrictedEntityFeatures(
  em: any,
  tenantId: string | null | undefined,
): Promise<SynthesizedFeatureItem[]> {
  if (!tenantId) return []
  const declared = declaredEntities()
  const byEntityId = new Map<string, RestrictedEntity>()
  for (const entity of declared.restricted) byEntityId.set(entity.entityId, entity)
  // DB rows are authoritative only for ids the declared registry does not own, so
  // the catalog and the records-route enforcement agree on the same source.
  for (const entity of await registeredRestrictedEntities(em, tenantId)) {
    if (declared.ids.has(entity.entityId)) continue
    byEntityId.set(entity.entityId, entity)
  }

  const items: SynthesizedFeatureItem[] = []
  for (const { entityId, label } of byEntityId.values()) {
    for (const feature of synthesizedRecordFeatures(entityId)) {
      const verb = feature.action === 'manage' ? 'Manage records' : 'View records'
      items.push({
        id: feature.id,
        title: `${verb}: ${label}`,
        module: 'entities',
        dependsOn: feature.dependsOn,
      })
    }
  }
  return items
}
