import type { RouteVisibilityContext } from '@open-mercato/shared/modules/registry'
import { isProductionEnabledForTenant } from '../../../lib/productionToggle'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['production.mrp.view'],
  visible: (ctx: RouteVisibilityContext) => isProductionEnabledForTenant(ctx.auth?.tenantId ?? null),
  pageTitle: 'MRP Runs',
  pageTitleKey: 'production.mrp.title',
  pageGroup: 'Production',
  pageGroupKey: 'production.nav.group',
  pageOrder: 55,
  breadcrumb: [
    { label: 'Production', labelKey: 'production.nav.title' },
    { label: 'MRP Runs', labelKey: 'production.mrp.title' },
  ],
} as const
