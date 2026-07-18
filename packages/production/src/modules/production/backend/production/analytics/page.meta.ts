import type { RouteVisibilityContext } from '@open-mercato/shared/modules/registry'
import { isProductionEnabledForTenant } from '../../../lib/productionToggle'

/**
 * MVP analytics/reports page (task 6.1, spec § Scope: quantity-based-only
 * reports, no valuation). Gated on `production.reports.view` — the same
 * read-only oversight feature the shop-floor reports list already uses.
 */
export const metadata = {
  requireAuth: true,
  requireFeatures: ['production.reports.view'],
  visible: (ctx: RouteVisibilityContext) => isProductionEnabledForTenant(ctx.auth?.tenantId ?? null),
  pageTitle: 'Reports & Analytics',
  pageTitleKey: 'production.analytics.title',
  pageGroup: 'Production',
  pageGroupKey: 'production.nav.group',
  pageOrder: 70,
  breadcrumb: [
    { label: 'Production', labelKey: 'production.nav.title' },
    { label: 'Reports & Analytics', labelKey: 'production.analytics.title' },
  ],
} as const
