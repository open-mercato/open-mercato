/**
 * Registration seam for entity types a task may be bound to (PURE — zero
 * imports, safe wherever a module's `workflows.ts` is evaluated).
 *
 * The §6.4 entity gate (`task-entity-access.ts`) answers "may this caller see a
 * task about records of this type?" from the core `ENTITY_ACL_REQUIREMENTS`
 * table, which only knows core entities. An app-owned ORM entity therefore
 * resolves to `unavailable` and every task bound to one is visible to
 * superadmins only. This registry is how the OWNING module states the answer
 * for its own entity, the same way `registerWorkflowSafeCommands` lets a module
 * state which of its commands a workflow may run.
 *
 * ## Fail closed, never broadened
 *
 * - An entity type nobody registered keeps resolving exactly as before.
 * - The core table always wins: a registration for an entity it already lists
 *   is ignored, so a module can never weaken (or re-point) a core requirement.
 * - A requirement with no `view` feature is rejected at registration — an empty
 *   list would make the type visible to every caller in scope.
 * - The gate stays entity TYPE plus tenant/organization scope. A registration
 *   adds no record-level check and removes no scoping.
 *
 * Registrations are keyed on the GENERATED entity id (`module:entity`, as in
 * `entities.ids.generated.ts`), normalized the way authored binding types are.
 */

export type TaskEntityAclRegistration = {
  /** Generated entity id, e.g. `notary:notary_case`. */
  entityId: string
  /** Features a caller must hold (all of them) to see tasks bound to this type. */
  view: readonly [string, ...string[]]
}

/** Returns a same-origin backend path for the record, or `null` for no link. */
export type TaskEntityLinkBuilder = (recordId: string) => string | null | undefined

export type TaskEntityLinkRegistration = {
  /** Generated entity id, e.g. `notary:notary_case`. */
  entityId: string
  buildHref: TaskEntityLinkBuilder
}

const aclRequirements = new Map<string, readonly string[]>()
const linkBuilders = new Map<string, TaskEntityLinkBuilder>()

/** `Notary.Notary_Case` / `notary:notary_case` → `notary:notary_case`. */
export function normalizeRegisteredTaskEntityId(entityId: unknown): string | null {
  if (typeof entityId !== 'string') return null
  const normalized = entityId.trim().toLowerCase().replace(/\./g, ':')
  return /^[a-z0-9_]+:[a-z0-9_]+$/.test(normalized) ? normalized : null
}

function normalizeFeatures(features: unknown): string[] | null {
  if (!Array.isArray(features)) return null
  const normalized = features
    .filter((feature): feature is string => typeof feature === 'string')
    .map((feature) => feature.trim())
    .filter((feature) => feature.length > 0)
  return normalized.length > 0 ? [...new Set(normalized)] : null
}

/**
 * Register the `view` features that make tasks bound to an entity type visible.
 *
 * Throws on a malformed entry (no usable entity id, or no view feature): a
 * registration that silently degraded would leave its tasks hidden with nothing
 * pointing at the cause. Re-registering an id replaces the previous entry, so
 * an HMR re-evaluation of the registering module is idempotent.
 */
export function registerTaskEntityAclRequirements(
  registrations: readonly TaskEntityAclRegistration[],
): void {
  for (const registration of registrations) {
    const entityId = normalizeRegisteredTaskEntityId(registration?.entityId)
    const view = normalizeFeatures(registration?.view)
    if (!entityId || !view) {
      throw new Error('[internal] Task entity ACL registrations require an entityId and at least one view feature')
    }
    aclRequirements.set(entityId, view)
  }
}

/** Register a record deep-link builder for an entity type. */
export function registerTaskEntityLinkBuilders(
  registrations: readonly TaskEntityLinkRegistration[],
): void {
  for (const registration of registrations) {
    const entityId = normalizeRegisteredTaskEntityId(registration?.entityId)
    if (!entityId || typeof registration?.buildHref !== 'function') {
      throw new Error('[internal] Task entity link registrations require an entityId and a buildHref function')
    }
    linkBuilders.set(entityId, registration.buildHref)
  }
}

/**
 * The registered `view` features for an entity id, or `null`.
 *
 * Callers MUST consult the core requirement table first and only fall back to
 * this when it has no entry — that ordering is what keeps core entries
 * un-overridable.
 */
export function resolveRegisteredTaskEntityViewFeatures(entityId: string): string[] | null {
  const normalized = normalizeRegisteredTaskEntityId(entityId)
  const features = normalized ? aclRequirements.get(normalized) : undefined
  return features ? [...features] : null
}

export function resolveRegisteredTaskEntityLinkBuilder(entityId: string): TaskEntityLinkBuilder | null {
  const normalized = normalizeRegisteredTaskEntityId(entityId)
  return (normalized ? linkBuilders.get(normalized) : undefined) ?? null
}

export function clearTaskEntityRegistrationsForTests(): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('[internal] clearTaskEntityRegistrationsForTests is test-only')
  }
  aclRequirements.clear()
  linkBuilders.clear()
}
