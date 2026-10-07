import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { seedPostingRulesDefaults } from './lib/seedDefaults'

export const setup: ModuleSetupConfig = {
  // Seeds the sentinel `CostCenter` ('UNALLOCATED') and an empty
  // `PostingRulesSettings` row for this organization. No
  // `DefaultAccountPostingRule` template is seeded — account numbering is
  // not standardized across tenants (see the spec's Design decisions,
  // "4→5 rules"), so an admin configures rules themselves once their own
  // chart of accounts exists.
  seedDefaults: async (ctx) => {
    const scope = { tenantId: ctx.tenantId, organizationId: ctx.organizationId }
    await seedPostingRulesDefaults(ctx.em, scope)
  },

  defaultRoleFeatures: {
    admin: [
      'posting_rules.cost_centers.manage',
      'posting_rules.settings.manage',
      'posting_rules.periods.manage',
      'posting_rules.reconcile.run',
    ],
  },
}

export default setup
