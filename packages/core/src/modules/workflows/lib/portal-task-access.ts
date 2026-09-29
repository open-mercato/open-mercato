/**
 * Per-request wiring for the §6.4 rule on the PORTAL side.
 *
 * The counterpart to `lib/task-visibility-request.ts`. Same contract: the pure
 * predicate (`lib/task-visibility.ts`) decides, this module only assembles its
 * inputs and turns the expressible half into a `WHERE`. A second copy of the
 * rule anywhere is a review failure.
 *
 * ## Three things this file exists to get exactly right
 *
 * **1. A task with no bindings DENIES.** The backoffice branch passes an empty
 * binding set vacuously, because a backoffice principal already carries an
 * org-membership grant and being assigned a task inside your own tenant is a
 * complete authorization story. A portal principal carries no such grant: the
 * binding to their own record *is* the entire authorization, so with no binding
 * there is nothing to authorize against. The predicate answers
 * `denied:portal-unbound`; this module additionally excludes those rows in SQL
 * (`entity_types IS NOT NULL`) so `pagination.total` does not count rows the
 * predicate then drops.
 *
 * **2. `isPortalAdmin` buys nothing.** `customerAuth.ts` replaces a portal
 * admin's grants with the literal `['*']`, and `CustomerRbacService` short-
 * circuits `userHasAllFeatures` before any matching, so *every* feature check
 * passes for them. Therefore no feature check may take part in the ownership
 * decision: `PortalTaskPrincipal` carries no feature array at all, ownership is
 * a `Set.has` against `ownedRecordIds`, and `isPortalAdmin` is consulted last
 * and only to widen `visible` — never `actable`, never ownership.
 *
 * **3. The two id spaces are not interchangeable.** `assignedTo` on a portal
 * task names a `CustomerUser.id` (the JWT `sub`). A binding's `entityId` names a
 * customer/person ENTITY RECORD. They are resolved from the same company query
 * and used in different places: user ids drive the SQL assignee arm, record ids
 * drive the ownership `Set.has`. Feeding one where the other belongs would make
 * a portal admin's own user id "own" a record.
 *
 * ## Company scoping
 *
 * Copied from `customer_accounts/api/portal/users.ts` verbatim, including its
 * hard precondition: no `customerEntityId` ⇒ 403 "No company association" and
 * an empty owned set. A portal user who belongs to no company owns nothing, so
 * they see nothing, admin or not.
 *
 * Note `customerEntityId` / `personEntityId` are JWT claims read straight off
 * the token and not re-verified per request, so a user moved between companies
 * keeps stale ownership until their token turns over (design §9 item 8).
 */

import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { CustomerAuthContext } from '@open-mercato/core/modules/customer_accounts/lib/customerAuth'
import { CustomerUser } from '@open-mercato/core/modules/customer_accounts/data/entities'
import { UserTask } from '../data/entities'
import {
  decideTaskVisibility,
  type PortalTaskPrincipal,
  type TaskEntityAccessMap,
  type TaskVisibilityDecision,
  type TaskVisibilityPolicy,
} from './task-visibility'
import { toTaskFacts } from './task-visibility-request'

/** Portal ACL features. New ids on an ADDITIVE-ONLY surface — nothing renamed. */
export const PORTAL_TASKS_VIEW_FEATURE = 'portal.tasks.view'
export const PORTAL_TASKS_COMPLETE_FEATURE = 'portal.tasks.complete'

/**
 * The portal branch reads NEITHER of these — it decides on structure, tenant,
 * organization, `assignee_kind` and record ownership alone. They exist because
 * `decideTaskVisibility` takes one shape for both principals. Frozen here so no
 * route invents a map that could accidentally start meaning something.
 */
const PORTAL_ENTITY_ACCESS: TaskEntityAccessMap = new Map()
const PORTAL_POLICY: TaskVisibilityPolicy = { businessContextEnabled: true }

export type PortalTaskPrincipalResolution =
  | { ok: true; principal: PortalTaskPrincipal; assigneeIds: readonly string[] }
  | { ok: false; status: 403; body: Record<string, unknown> }

/**
 * Refusal body copied verbatim from `portal/users.ts` so the whole portal
 * answers a company-less principal the same way.
 */
export const PORTAL_NO_COMPANY_BODY: Record<string, unknown> = {
  ok: false,
  error: 'No company association',
}

export const PORTAL_TASK_NOT_FOUND_BODY: Record<string, unknown> = {
  ok: false,
  error: 'Task not found',
}

function pushIfPresent(target: Set<string>, value: string | null | undefined): void {
  if (typeof value === 'string' && value.length > 0) target.add(value)
}

/**
 * Assemble the portal principal for this request.
 *
 * `assigneeIds` is the set of `CustomerUser.id` values whose tasks this
 * principal may be shown — themselves, plus every company member when they are
 * a portal admin. It is the SQL arm; `ownedRecordIds` is the ownership check.
 * Both come from the one company query.
 */
export async function resolvePortalTaskPrincipal(input: {
  auth: CustomerAuthContext
  em: EntityManager
  isPortalAdmin: boolean
}): Promise<PortalTaskPrincipalResolution> {
  const { auth, em, isPortalAdmin } = input

  if (!auth.customerEntityId) {
    return { ok: false, status: 403, body: PORTAL_NO_COMPANY_BODY }
  }

  const ownedRecordIds = new Set<string>()
  pushIfPresent(ownedRecordIds, auth.customerEntityId)
  pushIfPresent(ownedRecordIds, auth.personEntityId)

  const assigneeIds = new Set<string>([auth.sub])

  if (isPortalAdmin) {
    // The exact filter `portal/users.ts` uses, so "my company" means the same
    // thing on both surfaces.
    const members = await findWithDecryption<CustomerUser>(
      em,
      CustomerUser,
      {
        customerEntityId: auth.customerEntityId,
        tenantId: auth.tenantId,
        deletedAt: null,
      },
      { fields: ['id', 'personEntityId', 'customerEntityId'] },
      { tenantId: auth.tenantId, organizationId: auth.orgId },
    )
    for (const member of members) {
      assigneeIds.add(member.id)
      pushIfPresent(ownedRecordIds, member.personEntityId)
      pushIfPresent(ownedRecordIds, member.customerEntityId)
    }
  }

  return {
    ok: true,
    principal: {
      kind: 'portal',
      principalId: auth.sub,
      tenantId: auth.tenantId,
      organizationId: auth.orgId,
      ownedRecordIds,
      isPortalAdmin,
    },
    assigneeIds: [...assigneeIds],
  }
}

/**
 * The expressible half of the portal rule as ORM conditions.
 *
 * Three structural filters and no fourth:
 *
 * - `assignee_kind = 'customer'` keeps every backoffice row out of the portal
 *   result set entirely, independent of the predicate. It is defence 3 of 4
 *   against the `['*']` wildcard.
 * - `assigned_to IN (…)` narrows to this principal (plus their company members
 *   for an admin). Ownership is still checked afterwards by the predicate — this
 *   only avoids fetching rows that cannot survive it.
 * - `entity_types IS NOT NULL` drops unbound rows, which the predicate denies
 *   anyway. Doing it in SQL is what keeps `pagination.total` honest.
 *
 * Ownership itself is NOT expressible: it is a containment test over the
 * `entity_bindings` jsonb against a per-principal id set. The predicate answers
 * it, and any row it drops that SQL admitted is an authoring anomaly, not a
 * routine case.
 */
export function buildPortalTaskConditions(input: {
  principal: PortalTaskPrincipal
  assigneeIds: readonly string[]
}): Record<string, unknown> {
  return {
    tenantId: input.principal.tenantId,
    organizationId: input.principal.organizationId,
    assigneeKind: 'customer',
    assignedTo: { $in: [...input.assigneeIds] },
    entityTypes: { $ne: null },
  }
}

/** The predicate's answer for one already-loaded row, portal side. */
export function decidePortalTaskAccess(
  principal: PortalTaskPrincipal,
  task: UserTask,
): TaskVisibilityDecision {
  return decideTaskVisibility(principal, toTaskFacts(task), PORTAL_ENTITY_ACCESS, PORTAL_POLICY)
}

/**
 * The rows of an already-filtered page the predicate agrees are visible.
 *
 * The SQL above is not the whole rule — ownership is not expressible — so unlike
 * the backoffice list this genuinely drops rows: a task assigned to a company
 * member but bound to a record outside the company. Dropping is the correct
 * direction, and the caller logs the divergence rather than hiding it.
 */
export function filterVisiblePortalTasks(
  principal: PortalTaskPrincipal,
  tasks: readonly UserTask[],
): UserTask[] {
  return tasks.filter((task) => decidePortalTaskAccess(principal, task).visible)
}

/**
 * Every portal refusal is the same 404 with the same body.
 *
 * There is no portal analogue of the backoffice `view_all` diagnostic: no portal
 * principal has a legitimate reason to learn that a row they cannot read exists,
 * and a portal admin least of all — telling them "this task exists but is not
 * yours" is precisely the cross-customer disclosure the ownership check prevents.
 */
export const PORTAL_TASK_REFUSAL = { status: 404 as const, body: PORTAL_TASK_NOT_FOUND_BODY }
