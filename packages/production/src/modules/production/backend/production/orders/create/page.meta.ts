import type { RouteVisibilityContext } from '@open-mercato/shared/modules/registry'
import { isProductionEnabledForTenant } from '../../../../lib/productionToggle'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['production.orders.manage'],
  visible: (ctx: RouteVisibilityContext) => isProductionEnabledForTenant(ctx.auth?.tenantId ?? null),
  pageTitle: 'Create Production Order',
  pageTitleKey: 'production.orders.create.title',
  pageGroup: 'Production',
  pageGroupKey: 'production.nav.group',
  pageOrder: 51,
  breadcrumb: [
    { label: 'Production', labelKey: 'production.nav.title' },
    { label: 'Production Orders', labelKey: 'production.orders.title' },
    { label: 'Create', labelKey: 'production.orders.create.title' },
  ],
} as const
