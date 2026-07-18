import type { RouteVisibilityContext } from '@open-mercato/shared/modules/registry'
import { isProductionEnabledForTenant } from '../../../lib/productionToggle'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['production.technology.view'],
  visible: (ctx: RouteVisibilityContext) => isProductionEnabledForTenant(ctx.auth?.tenantId ?? null),
  pageTitle: 'Work Centers',
  pageTitleKey: 'production.work_centers.title',
  pageGroup: 'Production',
  pageGroupKey: 'production.nav.group',
  pageOrder: 20,
  breadcrumb: [
    { label: 'Production', labelKey: 'production.nav.title' },
    { label: 'Work Centers', labelKey: 'production.work_centers.title' },
  ],
} as const
