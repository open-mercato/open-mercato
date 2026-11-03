/**
 * Authored `entityType` → generated entity id.
 *
 * The bridge between what a task binding carries (free text an author typed)
 * and what the entity-access model is keyed on (`entities.ids.generated.ts`
 * ids, which `ENTITY_ACL_REQUIREMENTS` also keys on). It resolves through the
 * enumerated alias dictionary or through EXACT membership in the entity
 * registry, and refuses everything else.
 *
 * It never guesses. `resolveEntityTableName` pluralizes its way to a table name
 * and logs a warning; doing that here would turn a typo into a plausible-looking
 * grant, which is the opposite of fail-closed. A binding that does not resolve
 * is `null`, and the caller denies.
 *
 * The spellings themselves live in `task-entity-aliases.ts` — one dictionary,
 * shared with `work-inbox/entity-links.ts`.
 */

import { getEntityIds } from '@open-mercato/shared/lib/encryption/entityIds'
import { normalizeTaskEntityTypeSpelling, resolveAliasedTaskEntityId } from './task-entity-aliases'

export {
  TASK_ENTITY_TYPE_ALIAS_GROUPS,
  listTaskEntityTypeAliases,
  normalizeTaskEntityTypeSpelling,
  resolveAliasedTaskEntityId,
} from './task-entity-aliases'
export type { TaskEntityTypeAliasGroup } from './task-entity-aliases'

// The registry is a mutable module singleton (re-registered on HMR), so the
// derived id set is memoized against the registry's object identity rather than
// built once and frozen.
let registryIdsSource: unknown = null
let registryIds: ReadonlySet<string> = new Set<string>()

function knownEntityIds(): ReadonlySet<string> {
  // `false`: an unregistered registry yields an empty set, so every binding
  // outside the alias table resolves to null and the caller denies. Failing
  // closed on a missing registry is intended, not a degradation.
  const registry = getEntityIds(false)
  if (registry !== registryIdsSource) {
    registryIdsSource = registry
    registryIds = new Set(
      Object.values(registry ?? {}).flatMap((moduleEntities) => Object.values(moduleEntities ?? {})),
    )
  }
  return registryIds
}

/**
 * The generated entity id an authored binding means, or `null` when nothing
 * enumerated matches it.
 *
 * `null` is a refusal, not a fallback: a typo such as `Custmers:Deal` must hide
 * the task from everyone rather than resolve to something plausible.
 */
export function normalizeTaskEntityTypeToEntityId(
  entityType: string | null | undefined,
): string | null {
  if (typeof entityType !== 'string') return null
  const normalized = normalizeTaskEntityTypeSpelling(entityType)
  if (!normalized) return null
  const aliased = resolveAliasedTaskEntityId(normalized)
  if (aliased) return aliased
  return knownEntityIds().has(normalized) ? normalized : null
}
