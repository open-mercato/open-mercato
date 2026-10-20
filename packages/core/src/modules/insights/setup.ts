import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  async seedDefaults(ctx) {
    const [{ seedInsightsFieldExplainToggle }, { seedXrayIngestToggle }, { seedXrayIngest }, { ensureSimulationMaintenanceSchedule }] = await Promise.all([
      import('./lib/fieldExplainToggleSeed'),
      import('./lib/projection/killSwitch'),
      import('./lib/projection/jobs'),
      import('./lib/simulation/queue'),
    ])
    await seedInsightsFieldExplainToggle(ctx.em, ctx.container)
    await seedXrayIngestToggle(ctx.em, ctx.container)
    await seedXrayIngest(ctx.container, { tenantId: ctx.tenantId, organizationId: ctx.organizationId })
    await ensureSimulationMaintenanceSchedule(ctx.container)
  },
  defaultRoleFeatures: {
    superadmin: ['insights.*'],
    admin: [
      'insights.explain.view',
      'insights.explain.access_detail',
      'insights.xray.view',
      'insights.xray.manage',
      'insights.simulator.view',
      'insights.simulator.run',
    ],
    employee: ['insights.explain.view'],
  },
}

export default setup
