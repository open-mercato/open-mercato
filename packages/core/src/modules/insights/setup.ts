import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  async seedDefaults(ctx) {
    const [{ seedInsightsFieldExplainToggle }, { seedXrayIngestToggle }, { seedXrayIngest }] = await Promise.all([
      import('./lib/fieldExplainToggleSeed'),
      import('./lib/projection/killSwitch'),
      import('./lib/projection/jobs'),
    ])
    await seedInsightsFieldExplainToggle(ctx.em, ctx.container)
    await seedXrayIngestToggle(ctx.em, ctx.container)
    await seedXrayIngest(ctx.container, { tenantId: ctx.tenantId, organizationId: ctx.organizationId })
  },
  defaultRoleFeatures: {
    superadmin: ['insights.*'],
    admin: [
      'insights.explain.view',
      'insights.explain.access_detail',
      'insights.xray.view',
      'insights.xray.manage',
    ],
    employee: ['insights.explain.view'],
  },
}

export default setup
