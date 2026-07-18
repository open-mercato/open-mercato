import type { RouteVisibilityContext } from '@open-mercato/shared/modules/registry'
import { isProductionEnabledForTenant } from '../../../lib/productionToggle'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['production.technology.view'],
  visible: (ctx: RouteVisibilityContext) => isProductionEnabledForTenant(ctx.auth?.tenantId ?? null),
  pageTitle: 'Routings',
  pageTitleKey: 'production.routings.title',
  pageGroup: 'Production',
  pageGroupKey: 'production.nav.group',
  pageOrder: 40,
  breadcrumb: [
    { label: 'Production', labelKey: 'production.nav.title' },
    { label: 'Routings', labelKey: 'production.routings.title' },
  ],
} as const
