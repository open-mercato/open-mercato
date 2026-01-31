import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { seedDashboardDefaultsForTenant } from '@open-mercato/core/modules/dashboards/cli'
import { appendWidgetsToRoles, resolveAnalyticsWidgetIds } from '@open-mercato/core/modules/dashboards/lib/role-widgets'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    admin: ['dashboards.*', 'dashboards.admin.assign-widgets', 'analytics.view'],
    employee: ['dashboards.view', 'dashboards.configure', 'analytics.view'],
  },

  async onTenantCreated({ em, tenantId, organizationId }) {
    await seedDashboardDefaultsForTenant(em, { tenantId, organizationId, logger: () => {} })
  },

  async seedDefaults({ em, tenantId, organizationId }) {
    const analyticsWidgetIds = await resolveAnalyticsWidgetIds()
    await appendWidgetsToRoles(em, {
      tenantId,
      organizationId,
      roleNames: ['admin', 'employee'],
      widgetIds: analyticsWidgetIds,
    })
  },
}

export default setup
