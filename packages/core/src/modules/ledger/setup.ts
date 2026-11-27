import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { seedPolishAccountGroups } from './lib/seeds'

export const setup: ModuleSetupConfig = {
  // Seeds `LedgerAccountGroup` rows for jurisdiction 'PL' (zespoły 0-8)
  // into this organization's scope. Hardcoded to 'PL' in Phase 1 — no
  // jurisdiction-selection mechanism exists yet (see the spec's Design
  // decisions). This is the one exception to "no default chart of
  // accounts is seeded": `LedgerAccountGroup` is system reference data,
  // not the tenant's own chart of accounts (`LedgerAccountType`/
  // `LedgerAccount`) — a tenant still builds those by hand, or via
  // `ledger.importDefaultChartOfAccounts` (2026-09-15-default-chart-of-accounts.md).
  seedDefaults: async (ctx) => {
    const scope = { tenantId: ctx.tenantId, organizationId: ctx.organizationId }
    await seedPolishAccountGroups(ctx.em, scope)
  },

  defaultRoleFeatures: {
    admin: ['ledger.*'],
    employee: ['ledger.accounts.view', 'ledger.entries.view', 'ledger.periods.view'],
  },
}

export default setup
