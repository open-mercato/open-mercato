import type { RouteVisibilityContext } from '@open-mercato/shared/modules/registry'
import { isProductionEnabledForTenant } from '../../../lib/productionToggle'

/**
 * Operator "lite" panel (task 4.3, spec decision e): the shop-floor surface
 * gated on `production.operator.view` ONLY, so a shared tablet/device
 * logged in as the `operator` role sees nothing beyond this page.
 */
export const metadata = {
  requireAuth: true,
  requireFeatures: ['production.operator.view'],
  visible: (ctx: RouteVisibilityContext) => isProductionEnabledForTenant(ctx.auth?.tenantId ?? null),
  pageTitle: 'Operator',
  pageTitleKey: 'production.operator.title',
  pageGroup: 'Production',
  pageGroupKey: 'production.nav.group',
  pageOrder: 60,
  breadcrumb: [
    { label: 'Production', labelKey: 'production.nav.title' },
    { label: 'Operator', labelKey: 'production.operator.title' },
  ],
} as const
