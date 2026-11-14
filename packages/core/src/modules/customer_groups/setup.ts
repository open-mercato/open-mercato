import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { registerCustomerGroupsSchedules } from './lib/scheduling'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['customer_groups.*'],
    admin: ['customer_groups.*'],
    // Release 5 Phases 3-4 (D-R5-7, least privilege): `employee` gets the view-only
    // credit AND approvals features. `credit.manage`/`credit.adjust`/`approvals.decide`
    // stay with `admin` (covered by the `customer_groups.*` wildcard above) or are
    // granted by hand. Existing tenants need `yarn mercato auth sync-role-acls` (spec
    // §8.4).
    employee: [
      'customer_groups.groups.view',
      'customer_groups.memberships.view',
      'customer_groups.terms.view',
      'customer_groups.credit.view',
      'customer_groups.approvals.view',
    ],
  },

  // Release 5 Phase 4 (Step 2.6, D-R5-7/G16, spec §9.1 grant plan). Portal grants for
  // the buyer-facing approval API (G5): `portal_admin` views and decides its own
  // company's requests; `buyer` views and withdraws its own requests (the feature only
  // gates the read/withdraw surface — "own requests only" is enforced by the route's
  // company/requester scoping, not by withholding the feature, same reasoning Step
  // 2.6's task brief states explicitly); `viewer` gets nothing. Existing tenants need
  // `yarn mercato customer_accounts sync-customer-role-acls` (spec §8.4).
  defaultCustomerRoleFeatures: {
    portal_admin: ['customer_groups.portal.approvals.view', 'customer_groups.portal.approvals.decide'],
    buyer: ['customer_groups.portal.approvals.view'],
  },

  // Release 5 Phase 3 (G21, Step 1.8): schedule the daily exposure audit and the hourly
  // expire-approvals sweep per tenant/organization, same pattern as
  // `warranty_claims/setup.ts`'s SLA sweep. `seedDefaults` only runs for brand-new
  // tenants — an existing tenant needs the `customer_groups.register-schedules` upgrade
  // action (`configs/lib/upgrade-actions.ts`, #8822) to pick these up.
  async seedDefaults({ tenantId, organizationId, container }) {
    await registerCustomerGroupsSchedules(container, { tenantId, organizationId })
  },
}

export default setup
