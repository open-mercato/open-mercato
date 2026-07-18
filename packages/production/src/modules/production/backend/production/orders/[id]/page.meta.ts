import type { RouteVisibilityContext } from '@open-mercato/shared/modules/registry'
import { isProductionEnabledForTenant } from '../../../../lib/productionToggle'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['production.orders.view'],
  visible: (ctx: RouteVisibilityContext) => isProductionEnabledForTenant(ctx.auth?.tenantId ?? null),
  pageTitle: 'Production Order',
  pageTitleKey: 'production.orders.detail.title',
  pageGroup: 'Production',
  pageGroupKey: 'production.nav.group',
  breadcrumb: [
    { label: 'Production', labelKey: 'production.nav.title' },
    { label: 'Production Orders', labelKey: 'production.orders.title' },
    { label: 'Detail', labelKey: 'production.orders.detail.title' },
  ],
} as const
