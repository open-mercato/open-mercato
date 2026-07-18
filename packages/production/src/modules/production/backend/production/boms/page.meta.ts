import type { RouteVisibilityContext } from '@open-mercato/shared/modules/registry'
import { isProductionEnabledForTenant } from '../../../lib/productionToggle'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['production.technology.view'],
  visible: (ctx: RouteVisibilityContext) => isProductionEnabledForTenant(ctx.auth?.tenantId ?? null),
  pageTitle: 'Bills of Materials',
  pageTitleKey: 'production.boms.title',
  pageGroup: 'Production',
  pageGroupKey: 'production.nav.group',
  pageOrder: 30,
  breadcrumb: [
    { label: 'Production', labelKey: 'production.nav.title' },
    { label: 'Bills of Materials', labelKey: 'production.boms.title' },
  ],
} as const
