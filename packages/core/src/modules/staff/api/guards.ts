import type { AwilixContainer } from 'awilix'
import {
  bridgeLegacyGuard,
  runMutationGuards,
  type MutationGuard,
  type MutationGuardInput,
} from '@open-mercato/shared/lib/crud/mutation-guard-registry'
import { getAllMutationGuardInstances } from '@open-mercato/shared/lib/crud/mutation-guard-store'
import { resolveFeatureAccess } from '../lib/time-tracking/featureAccess'

type GuardAfterCallback = {
  guard: MutationGuard
  metadata: Record<string, unknown> | null
}

/**
 * @deprecated `AuthContext` has no `features` field, so this always answered `[]` —
 * which silently filtered out every registered guard declaring `features`, leaving
 * feature-gated guards enforced on the `makeCrudRoute` resources (the factory
 * resolves real grants) and skipped on every hand-rolled write route.
 * `runStaffMutationGuards` now resolves the caller's grants itself through
 * `resolveFeatureAccess`; pass nothing. Kept as an exported symbol for one release.
 */
export function resolveUserFeatures(auth: unknown): string[] {
  const features = (auth as { features?: unknown })?.features
  if (!Array.isArray(features)) return []
  return features.filter((value): value is string => typeof value === 'string')
}

/**
 * The `resourceKind` every hand-rolled time-tracking write route passes into the
 * mutation-guard contract, published as one map so a guard author can target a route
 * without reading it.
 *
 * These strings are what `MutationGuardInput.resourceKind` carries; they are NOT the
 * CRUD factory's cache/audit resource tag, which the factory derives on its own from
 * each route's `events` config. A guard that filters on `resourceKind` matches against
 * the values below on the custom routes and against the factory-derived tag on the
 * eight `makeCrudRoute` resources.
 *
 * `staff.timesheets.time_task` and `staff.timesheets.time_report` are re-exported from
 * the command modules that also feed them to `enforceCommandOptimisticLockWithGuards`
 * (`STAFF_TIME_TASK_RESOURCE_KIND`, `STAFF_TIME_REPORT_RESOURCE_KIND`); the unit test
 * pins both copies to the same string so they cannot drift.
 */
export const STAFF_TIME_TRACKING_RESOURCE_KINDS = {
  /** `time-entries/{bulk,copy-day,start-timer}`, `time-entries/[id]/{duplicate,timer-start,timer-stop}` */
  timeEntry: 'staff.timesheets.time_entry',
  /** `time-entries/[id]/segments`, `time-entries/[id]/segments/[segmentId]` */
  timeEntrySegment: 'staff.timesheets.time_entry_segment',
  /** `tasks/[id]/status` */
  timeTask: 'staff.timesheets.time_task',
  /** `tasks/[id]/comments` */
  timeTaskComment: 'staff.timesheets.task_comment',
  /** `time-projects/[id]/change-currency` */
  timeProject: 'staff.timesheets.time_project',
  /** `my-projects/[projectId]` */
  timeProjectMember: 'staff.timesheets.time_project_member',
  /** `reports/[id]/close`, `reports/[id]/unlock` */
  timeReport: 'staff.timesheets.time_report',
  /** `tags/entry-assignments` */
  entryTag: 'staff.timesheets.entry_tag',
  /** `tags/task-assignments` */
  taskTag: 'staff.timesheets.task_tag',
  /** `settings`, `settings/reapply-rounding` */
  settings: 'staff.timesheets.settings',
  /** `access-requests` */
  accessRequest: 'staff.timesheets.access_request',
} as const

export type StaffTimeTrackingResourceKind =
  typeof STAFF_TIME_TRACKING_RESOURCE_KINDS[keyof typeof STAFF_TIME_TRACKING_RESOURCE_KINDS]

/**
 * Runs the same guard set as `makeCrudRoute`: every guard a module registered through
 * `data/guards.ts` (`getAllMutationGuardInstances()`) plus the bridged legacy DI
 * service. Mirrors `collectAndRunGuards()` in the CRUD factory; bridging only the
 * legacy service — as this did originally — left registry guards unenforced on every
 * hand-rolled time-tracking write route.
 *
 * **The grant list is resolved here, not passed in.** `runMutationGuards` drops any
 * guard whose `features` the caller does not hold, so an empty list silently disables
 * every feature-gated guard — a third-party `record_locks.enforce` guard fired on the
 * `makeCrudRoute` resources (the factory asks RBAC) and was skipped on `/bulk`, the
 * timer transitions, segments, tag assignments and report close/unlock. Callers used
 * to supply `resolveUserFeatures(auth)`, which read a field `AuthContext` does not
 * have and therefore always returned `[]`. The lookup now goes through
 * `resolveFeatureAccess`, the module's one RBAC authority, which fails closed and
 * logs rather than failing silently.
 *
 * `extraFeatures` is additive and exists only for a caller that already holds a
 * resolved grant list; it is never the sole source.
 */
export async function runStaffMutationGuards(
  container: AwilixContainer,
  input: MutationGuardInput,
  extraFeatures: readonly string[] = [],
): Promise<{
  ok: boolean
  errorBody?: Record<string, unknown>
  errorStatus?: number
  modifiedPayload?: Record<string, unknown>
  afterSuccessCallbacks: GuardAfterCallback[]
}> {
  const allGuards: MutationGuard[] = [...getAllMutationGuardInstances()]
  const legacyGuard = bridgeLegacyGuard(container)
  if (legacyGuard) allGuards.push(legacyGuard)
  if (!allGuards.length) {
    return { ok: true, afterSuccessCallbacks: [] }
  }

  const { grantedFeatures } = await resolveFeatureAccess(container, input.userId ?? null, [], {
    tenantId: input.tenantId ?? null,
    organizationId: input.organizationId ?? null,
  })
  const userFeatures = Array.from(new Set([...grantedFeatures, ...extraFeatures]))

  return runMutationGuards(allGuards, input, { userFeatures })
}

export async function runStaffMutationGuardAfterSuccess(
  callbacks: GuardAfterCallback[],
  input: {
    tenantId: string
    organizationId: string | null
    userId: string
    resourceKind: string
    resourceId: string
    operation: 'create' | 'update' | 'delete'
    requestMethod: string
    requestHeaders: Headers
  },
): Promise<void> {
  for (const callback of callbacks) {
    if (!callback.guard.afterSuccess) continue
    await callback.guard.afterSuccess({
      ...input,
      metadata: callback.metadata ?? null,
    })
  }
}
