/**
 * Test builder for `TaskVisibilityRequestContext`.
 *
 * Keeping it in one place matters: every suite that exercises a task read now
 * has to state which principal is asking, and a per-suite ad-hoc literal would
 * make it easy to accidentally test a superadmin everywhere and never exercise
 * the narrowing at all.
 */

import type {
  TaskEntityAccessDecision,
  TaskEntityAccessMap,
} from '../../task-visibility'
import type { TaskVisibilityRequestContext } from '../../task-visibility-request'

export type TaskVisibilityContextOverrides = {
  userId?: string
  tenantId?: string
  organizationIds?: readonly string[] | null
  roleNames?: readonly string[]
  grantedFeatures?: readonly string[]
  isSuperAdmin?: boolean
  businessContextEnabled?: boolean
  /** Authored entity type → what it requires of the caller. */
  entityAccess?: Record<string, TaskEntityAccessDecision>
}

export function makeTaskVisibilityContext(
  overrides: TaskVisibilityContextOverrides = {},
): TaskVisibilityRequestContext {
  const entityAccess: TaskEntityAccessMap = new Map(
    Object.entries(overrides.entityAccess ?? {}),
  )

  return {
    principal: {
      kind: 'backoffice',
      userId: overrides.userId ?? 'user-1',
      tenantId: overrides.tenantId ?? 'tenant-1',
      organizationIds:
        overrides.organizationIds === undefined ? ['org-1'] : overrides.organizationIds,
      roleNames: overrides.roleNames ?? [],
      grantedFeatures: overrides.grantedFeatures ?? ['workflows.tasks.view'],
      isSuperAdmin: overrides.isSuperAdmin ?? false,
    },
    policy: { businessContextEnabled: overrides.businessContextEnabled ?? true },
    entityAccess,
    scopedEntityTypes: [...entityAccess.keys()],
  }
}
