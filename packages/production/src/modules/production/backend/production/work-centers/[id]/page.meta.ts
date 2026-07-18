import type { RouteVisibilityContext } from '@open-mercato/shared/modules/registry'
import { isProductionEnabledForTenant } from '../../../../lib/productionToggle'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['production.technology.manage'],
  visible: (ctx: RouteVisibilityContext) => isProductionEnabledForTenant(ctx.auth?.tenantId ?? null),
  pageTitle: 'Edit work center',
  pageTitleKey: 'production.work_centers.edit.title',
  pageGroup: 'Production',
  pageGroupKey: 'production.nav.group',
  breadcrumb: [
    { label: 'Production', labelKey: 'production.nav.title' },
    { label: 'Work Centers', labelKey: 'production.work_centers.title' },
    { label: 'Edit', labelKey: 'production.work_centers.edit.title' },
  ],
} as const
