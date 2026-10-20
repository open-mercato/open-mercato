import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  async seedDefaults({ em, container }) {
    const { seedInsightsFieldExplainToggle } = await import('./lib/fieldExplainToggleSeed')
    await seedInsightsFieldExplainToggle(em, container)
  },
  defaultRoleFeatures: {
    superadmin: ['insights.*'],
    admin: ['insights.*'],
    employee: ['insights.explain.view'],
  },
}

export default setup
