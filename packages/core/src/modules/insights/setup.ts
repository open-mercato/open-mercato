import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  async seedDefaults({ em, container }) {
    const { seedInsightsFieldExplainToggle } = await import('./lib/fieldExplainToggleSeed')
    await seedInsightsFieldExplainToggle(em, container)
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

  async seedDefaults(ctx) {
    const [{ seedXrayIngestToggle }, { ensureXrayIngestSchedule }] = await Promise.all([
      import('./lib/projection/killSwitch'),
      import('./lib/projection/queue'),
    ])
    await seedXrayIngestToggle(ctx.em, ctx.container)
    await ensureXrayIngestSchedule(ctx.container, { tenantId: ctx.tenantId, organizationId: ctx.organizationId })
  },
}

export default setup
