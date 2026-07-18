import type { RouteVisibilityContext } from '@open-mercato/shared/modules/registry'
import { isProductionEnabledForTenant } from '../../lib/productionToggle'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['production.orders.view'],
  visible: (ctx: RouteVisibilityContext) => isProductionEnabledForTenant(ctx.auth?.tenantId ?? null),
  pageTitle: 'Production',
  pageTitleKey: 'production.nav.title',
  pageGroup: 'Production',
  pageGroupKey: 'production.nav.group',
  pageOrder: 10,
  icon: 'wrench',
  breadcrumb: [{ label: 'Production', labelKey: 'production.nav.title' }],
} as const
