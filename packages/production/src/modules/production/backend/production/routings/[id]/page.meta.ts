import type { RouteVisibilityContext } from '@open-mercato/shared/modules/registry'
import { isProductionEnabledForTenant } from '../../../../lib/productionToggle'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['production.technology.manage'],
  visible: (ctx: RouteVisibilityContext) => isProductionEnabledForTenant(ctx.auth?.tenantId ?? null),
  pageTitle: 'Edit routing',
  pageTitleKey: 'production.routings.edit.title',
  pageGroup: 'Production',
  pageGroupKey: 'production.nav.group',
  breadcrumb: [
    { label: 'Production', labelKey: 'production.nav.title' },
    { label: 'Routings', labelKey: 'production.routings.title' },
    { label: 'Edit', labelKey: 'production.routings.edit.title' },
  ],
} as const
