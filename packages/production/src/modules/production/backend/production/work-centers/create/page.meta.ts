import type { RouteVisibilityContext } from '@open-mercato/shared/modules/registry'
import { isProductionEnabledForTenant } from '../../../../lib/productionToggle'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['production.technology.manage'],
  visible: (ctx: RouteVisibilityContext) => isProductionEnabledForTenant(ctx.auth?.tenantId ?? null),
  pageTitle: 'Create work center',
  pageTitleKey: 'production.work_centers.create.title',
  pageGroup: 'Production',
  pageGroupKey: 'production.nav.group',
  pageOrder: 21,
  breadcrumb: [
    { label: 'Production', labelKey: 'production.nav.title' },
    { label: 'Work Centers', labelKey: 'production.work_centers.title' },
    { label: 'Create', labelKey: 'production.work_centers.create.title' },
  ],
} as const
