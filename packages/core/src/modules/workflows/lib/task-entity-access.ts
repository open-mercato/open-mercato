/**
 * Builds the `TaskEntityAccessMap` the visibility predicate consumes — the
 * impure half of the entity gate.
 *
 * ## What "entity access" means here, exactly
 *
 * **Entity TYPE plus scope. There is no record-level ACL in this platform and
 * this resolver does not add one.** The query engine's public interface is
 * `query(entity, opts)` with no ACL seam anywhere in it, and the only per-record
 * rule in the repo is `assertCanAccessChannel`, a bespoke owner comparison over
 * an already-loaded row. So the guarantee this makes is: *you may see a task
 * about a deal iff you may see deals at all, and the task is inside your tenant
 * and organization.* A user who can see deals can see a task about ANY deal in
 * their organization, including one they would never have opened themselves.
 * Do not read more into it, and do not let a caller document it as row-level.
 *
 * Verifying each BOUND RECORD's own organization would cost one query per
 * (entity type, id) per row, and there is no generic `(entityType, recordId) →
 * record` resolver to do it with. Accepted residual risk, on the review
 * checklist. The portal path does not accept it — there the record identity is
 * compared directly against the caller's owned ids.
 *
 * ## Cost
 *
 * ONE `loadAcl` and ONE classification pass per REQUEST, keyed on the distinct
 * entity types across the whole page. `assertEntityAclForRequest` calls
 * `rbac.loadAcl` on every invocation, so calling it per binding would issue ~100
 * ACL loads for a 50-row inbox page with two bindings each.
 *
 * ## Failure
 *
 * Nothing here is caught. A resolver that throws must fail the whole request —
 * degrading to an empty map would leave the predicate with no key for any
 * binding, and while that denies today, "swallow the error and carry on" is the
 * shape of bug that later becomes "swallow the error and pass". Absence of data
 * is not failure: a task with no bindings asks nothing of this map.
 */

import type { EntityManager } from '@mikro-orm/core'
import { classifyRecordsEntity } from '@open-mercato/core/modules/entities/lib/entityClassification'
import { resolveEntityAclRequirement } from '@open-mercato/core/modules/entities/lib/entityAcl'
import {
  RECORDS_VIEW_FEATURE,
  deriveCustomEntityRecordFeature,
} from '@open-mercato/core/modules/entities/lib/recordFeatures'
import {
  normalizeTaskEntityTypeSpelling,
  normalizeTaskEntityTypeToEntityId,
} from './task-entity-types'
import type { TaskEntityAccessDecision, TaskEntityAccessMap } from './task-visibility'

export type TaskEntityAccessScope = { tenantId: string | null; organizationId: string | null }

export type TaskEntityAccessAcl = {
  isSuperAdmin: boolean
  features: string[]
}

/** The slice of `RbacService` this resolver needs, so tests need no container. */
export type TaskEntityAccessRbacService = {
  loadAcl(userId: string, scope: TaskEntityAccessScope): Promise<TaskEntityAccessAcl | null>
}

export type ResolveTaskEntityAccessInput = {
  /** Distinct authored `entityType` values across the page. Deduped here. */
  entityTypes: Iterable<string>
  em: EntityManager
  rbac: TaskEntityAccessRbacService
  userId: string
  scope: TaskEntityAccessScope
}

export type TaskEntityAccessResult = {
  map: TaskEntityAccessMap
  /**
   * Returned alongside the map because the caller needs both to build the
   * principal, and loading the ACL twice per request is the cost this resolver
   * exists to avoid.
   */
  isSuperAdmin: boolean
  grantedFeatures: string[]
}

type BoundTask = { entityBindings?: readonly { entityType?: unknown }[] | null }

/**
 * The distinct authored entity types across a page of tasks, verbatim.
 *
 * Verbatim matters: the map is keyed on exactly the string the binding carries,
 * so the predicate's lookup is an identity match and "no key" unambiguously
 * means the resolver never saw that type. Normalization happens INSIDE the
 * resolver, where a normalization failure has a `unknown-entity-type` answer to
 * record.
 */
export function collectTaskEntityTypes(tasks: Iterable<BoundTask>): string[] {
  const seen = new Set<string>()
  for (const task of tasks) {
    for (const binding of task.entityBindings ?? []) {
      const entityType = binding?.entityType
      if (typeof entityType === 'string' && entityType.length > 0) seen.add(entityType)
    }
  }
  return [...seen]
}

/**
 * Mirrors `assertEntityAclForRequest`: an unrestricted custom entity is
 * authorized by the coarse route-level feature alone; a restricted one also
 * needs its synthesized per-entity grant.
 */
function customEntityRequirement(entityId: string, restricted: boolean): TaskEntityAccessDecision {
  return restricted
    ? {
        kind: 'requires',
        features: [RECORDS_VIEW_FEATURE, deriveCustomEntityRecordFeature(entityId, 'view')],
      }
    : { kind: 'requires', features: [RECORDS_VIEW_FEATURE] }
}

async function decideEntityType(
  entityType: string,
  em: EntityManager,
  scope: TaskEntityAccessScope,
): Promise<TaskEntityAccessDecision> {
  const entityId = normalizeTaskEntityTypeToEntityId(entityType)

  if (!entityId) {
    // A TENANT-CREATED custom entity (a `custom_entities` row, not a module's
    // `ce.ts`) is absent from the generated registry, so normalization cannot
    // vouch for it and refusing here would hide every task bound to one. Ask the
    // classifier instead: a real registration inside the caller's own scope is
    // proof enough, and anything the classifier does not recognize either is a
    // genuine authored typo — reported as its own reason so the Problems panel
    // can name it rather than leaving an author staring at an invisible task.
    const spelling = normalizeTaskEntityTypeSpelling(entityType)
    const fallback = await classifyRecordsEntity(em, spelling, scope)
    if (fallback.kind !== 'custom') return { kind: 'unknown-entity-type' }
    return customEntityRequirement(spelling, fallback.restricted)
  }

  const classification = await classifyRecordsEntity(em, entityId, scope)

  if (classification.kind === 'custom') return customEntityRequirement(entityId, classification.restricted)

  if (classification.kind === 'system') {
    const requirement = resolveEntityAclRequirement(entityId)
    // No entry, or a platform-only entity: `entityAcl.ts` answers 403 for both,
    // and so does this.
    if (!requirement || requirement.platformOnly) return { kind: 'unavailable' }
    return { kind: 'requires', features: requirement.view }
  }

  return { kind: 'unavailable' }
}

/**
 * Resolve, once per request, what each bound entity type requires of the caller.
 *
 * The map carries REQUIREMENTS, not verdicts — the wildcard-aware match happens
 * in the predicate, so there is exactly one place that decides anything. A
 * superadmin is the single exception: they short-circuit the entity gate in
 * `entityAcl.ts` too, so every type resolves to an empty requirement.
 */
export async function resolveTaskEntityAccess(
  input: ResolveTaskEntityAccessInput,
): Promise<TaskEntityAccessResult> {
  const distinct = [...new Set(input.entityTypes)]
  const acl = await input.rbac.loadAcl(input.userId, input.scope)
  const isSuperAdmin = acl?.isSuperAdmin === true
  const grantedFeatures = acl?.features ?? []

  const map = new Map<string, TaskEntityAccessDecision>()
  for (const entityType of distinct) {
    map.set(
      entityType,
      isSuperAdmin ? { kind: 'requires', features: [] } : await decideEntityType(entityType, input.em, input.scope),
    )
  }

  return { map, isSuperAdmin, grantedFeatures }
}
