import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { resolveBusinessRuleDiscoveryCache } from '@open-mercato/core/modules/business_rules/lib/rule-engine'
import { seedExampleWorkflows } from './lib/seeds'

export const setup: ModuleSetupConfig = {
  seedDefaults: async (ctx) => {
    const scope = { tenantId: ctx.tenantId, organizationId: ctx.organizationId }
    const cache = resolveBusinessRuleDiscoveryCache(ctx.container.resolve.bind(ctx.container))
    await seedExampleWorkflows(ctx.em, scope, { cache })
  },

  /**
   * Portal grants for the §6.4 portal task surface.
   *
   * Declared HERE rather than in `customer_accounts` because a module ships its
   * own portal features the same way it ships its own backoffice ones —
   * `ensureDefaultCustomerRoleAcls` collects `defaultCustomerRoleFeatures` from
   * every enabled module and merges them into the seeded customer roles.
   * Workflows is the first shipped consumer of that seam.
   *
   * `portal_admin` is deliberately absent: it already carries `portal.*`, and a
   * wildcard is exactly what the portal branch of the predicate refuses to treat
   * as ownership. Granting it explicitly would suggest the wildcard means
   * something it does not.
   *
   * Two rollout caveats, neither a bug:
   * - The merge is additive into EXISTING roles (`if (!role) continue`) and runs
   *   during tenant setup, so an already-provisioned tenant grants these by hand
   *   from the customer-role editor.
   * - `CustomerRbacService` caches ACLs for 5 minutes, so a fresh grant is not
   *   immediately visible to a signed-in portal user.
   */
  defaultCustomerRoleFeatures: {
    buyer: ['portal.tasks.view', 'portal.tasks.complete'],
    viewer: ['portal.tasks.view'],
  },

  defaultRoleFeatures: {
    admin: ['workflows.*'],
    employee: [
      'workflows.view',
      'workflows.view_tasks',
      'workflows.tasks.view',
      'workflows.tasks.claim',
      'workflows.tasks.complete',
      'workflows.instances.view',
    ],
  },
}

export default setup
