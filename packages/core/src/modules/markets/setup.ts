import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { ensureMarketDisplayProfile } from './lib/seeds'

/**
 * `seedDefaults` deliberately writes nothing unless a market was explicitly chosen.
 *
 * Absence of a profile row is the documented meaning of "no market picked yet", and every display
 * helper then renders the frozen legacy defaults (spec assumption A5). Seeding a market here would
 * change how every existing screen renders for a tenant that never asked for it.
 *
 * Two paths do pick a market: the onboarding market selection step, which writes the row through
 * its own best-effort provisioning step, and `OM_DEFAULT_MARKET`, which lets a `mercato init` for a
 * known market skip the settings page.
 */
export const setup: ModuleSetupConfig = {
  seedDefaults: async (ctx) => {
    const requested = process.env.OM_DEFAULT_MARKET?.trim().toLowerCase()
    if (!requested) return
    await ensureMarketDisplayProfile(ctx.em, {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
    }, requested)
  },

  defaultRoleFeatures: {
    admin: ['markets.*'],
    employee: ['markets.view'],
  },
}

export default setup
