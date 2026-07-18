import type { RouteVisibilityContext } from '@open-mercato/shared/modules/registry'
import { isProductionEnabledForTenant } from '../../../lib/productionToggle'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['production.stock.view'],
  visible: (ctx: RouteVisibilityContext) => isProductionEnabledForTenant(ctx.auth?.tenantId ?? null),
  pageTitle: 'Stock',
  pageTitleKey: 'production.stock.title',
  pageGroup: 'Production',
  pageGroupKey: 'production.nav.group',
  pageOrder: 25,
  breadcrumb: [
    { label: 'Production', labelKey: 'production.nav.title' },
    { label: 'Stock', labelKey: 'production.stock.title' },
  ],
} as const
