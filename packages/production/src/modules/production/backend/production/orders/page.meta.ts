import type { RouteVisibilityContext } from '@open-mercato/shared/modules/registry'
import { isProductionEnabledForTenant } from '../../../lib/productionToggle'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['production.orders.view'],
  visible: (ctx: RouteVisibilityContext) => isProductionEnabledForTenant(ctx.auth?.tenantId ?? null),
  pageTitle: 'Production Orders',
  pageTitleKey: 'production.orders.title',
  pageGroup: 'Production',
  pageGroupKey: 'production.nav.group',
  pageOrder: 50,
  breadcrumb: [
    { label: 'Production', labelKey: 'production.nav.title' },
    { label: 'Production Orders', labelKey: 'production.orders.title' },
  ],
} as const
