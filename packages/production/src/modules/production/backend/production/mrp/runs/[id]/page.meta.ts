import type { RouteVisibilityContext } from '@open-mercato/shared/modules/registry'
import { isProductionEnabledForTenant } from '../../../../../lib/productionToggle'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['production.mrp.view'],
  visible: (ctx: RouteVisibilityContext) => isProductionEnabledForTenant(ctx.auth?.tenantId ?? null),
  pageTitle: 'MRP Run Suggestions',
  pageTitleKey: 'production.mrp.suggestions.title',
  pageGroup: 'Production',
  pageGroupKey: 'production.nav.group',
  breadcrumb: [
    { label: 'Production', labelKey: 'production.nav.title' },
    { label: 'MRP Runs', labelKey: 'production.mrp.title' },
    { label: 'Suggestions', labelKey: 'production.mrp.suggestions.title' },
  ],
} as const
