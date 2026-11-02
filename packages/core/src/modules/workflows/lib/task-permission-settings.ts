/**
 * The tenant opt-out from the §6.4 task-permission model.
 *
 * ## What it is
 *
 * One tenant-scoped boolean, `workflows` / `task_permissions_business_context`,
 * default `true`. `true` is the new model. `false` restores the pre-change READ
 * filter — `SCOPE ∧ workflows.tasks.view` — on the task list, the task detail
 * and the work inbox, and nothing else.
 *
 * ## What it is NOT
 *
 * **It is a `SELECT` filter, not an authorization mode.** `actable` and
 * `claimable` are computed by the new rule whether it is on or off: completing
 * still requires being the assignee or claimant, claiming still requires role
 * overlap on an unclaimed `PENDING` row, tenant and organization scoping are
 * never reachable by a setting, and the portal routes never consult it at all.
 * If `businessContextEnabled` is read anywhere outside a read filter, that is a
 * review failure. The predicate enforces this structurally — the flag reaches
 * `decideTaskVisibility` as `policy` and only ever widens `visible`.
 *
 * ## Why the read fails to `true`
 *
 * The exemplar this route is copied from (`entities/api/entity-settings.ts`)
 * swallows read errors and returns its permissive default. Inverted here on
 * purpose: a config read that fails — no container, no service, a broken row —
 * must NOT silently reopen every task in the tenant to everyone holding
 * `workflows.tasks.view`. Only an explicitly stored, explicitly false value
 * opts a tenant out.
 *
 * ## Lifecycle
 *
 * A migration aid with a removal date. It exists for one minor release so a
 * tenant with an unusual role topology can keep the lights on while they grant
 * `workflows.tasks.view_all`, and it is removed in the release after. A
 * permanent opt-out is a permanent second security model to test.
 */

import { parseBooleanFromUnknown } from '@open-mercato/shared/lib/boolean'
import type { TaskVisibilityPolicy } from './task-visibility'

/** `module_configs.module_id` for the workflows module's own settings. */
export const WORKFLOWS_CONFIG_MODULE = 'workflows'

/** `module_configs.name`. Well within `moduleConfigKeySchema`'s 128 chars. */
export const TASK_PERMISSIONS_BUSINESS_CONTEXT_KEY = 'task_permissions_business_context'

/** Default-ON at release, per the spec's flagged BC paragraph. */
export const TASK_PERMISSIONS_BUSINESS_CONTEXT_DEFAULT = true

/** The `ModuleConfigService` slice this needs, so tests need no container. */
export type TaskPermissionsConfigService = {
  getValue: (
    moduleId: string,
    name: string,
    options?: { defaultValue?: unknown; scope?: { tenantId?: string | null } },
  ) => Promise<unknown>
  setValue: (
    moduleId: string,
    name: string,
    value: unknown,
    scope?: { tenantId?: string | null },
  ) => Promise<unknown>
}

/**
 * Read the tenant's setting.
 *
 * Tenant-scoped only — never organization-scoped. One organization inside a
 * tenant running wide open next to a narrow one is unreviewable, so the scope
 * carries `tenantId` and nothing else. Callers MUST pass the tenant id from the
 * authenticated context, never from request input.
 */
export async function readTaskPermissionsBusinessContext(
  moduleConfigService: TaskPermissionsConfigService | null | undefined,
  tenantId: string | null,
): Promise<boolean> {
  if (!moduleConfigService) return TASK_PERMISSIONS_BUSINESS_CONTEXT_DEFAULT
  try {
    const value = await moduleConfigService.getValue(
      WORKFLOWS_CONFIG_MODULE,
      TASK_PERMISSIONS_BUSINESS_CONTEXT_KEY,
      {
        defaultValue: TASK_PERMISSIONS_BUSINESS_CONTEXT_DEFAULT,
        scope: { tenantId },
      },
    )
    const parsed = parseBooleanFromUnknown(value)
    // An unparseable stored value is a resolution failure, not an opt-out.
    return parsed === null ? TASK_PERMISSIONS_BUSINESS_CONTEXT_DEFAULT : parsed
  } catch {
    return TASK_PERMISSIONS_BUSINESS_CONTEXT_DEFAULT
  }
}

/** The `policy` argument `decideTaskVisibility` and the filter builders take. */
export async function resolveTaskVisibilityPolicy(
  moduleConfigService: TaskPermissionsConfigService | null | undefined,
  tenantId: string | null,
): Promise<TaskVisibilityPolicy> {
  return {
    businessContextEnabled: await readTaskPermissionsBusinessContext(moduleConfigService, tenantId),
  }
}

export async function writeTaskPermissionsBusinessContext(
  moduleConfigService: TaskPermissionsConfigService,
  tenantId: string,
  enabled: boolean,
): Promise<void> {
  await moduleConfigService.setValue(
    WORKFLOWS_CONFIG_MODULE,
    TASK_PERMISSIONS_BUSINESS_CONTEXT_KEY,
    enabled,
    { tenantId },
  )
}
