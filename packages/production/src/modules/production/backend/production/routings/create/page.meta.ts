import type { RouteVisibilityContext } from '@open-mercato/shared/modules/registry'
import { isProductionEnabledForTenant } from '../../../../lib/productionToggle'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['production.technology.manage'],
  visible: (ctx: RouteVisibilityContext) => isProductionEnabledForTenant(ctx.auth?.tenantId ?? null),
  pageTitle: 'Create routing',
  pageTitleKey: 'production.routings.create.title',
  pageGroup: 'Production',
  pageGroupKey: 'production.nav.group',
  pageOrder: 41,
  breadcrumb: [
    { label: 'Production', labelKey: 'production.nav.title' },
    { label: 'Routings', labelKey: 'production.routings.title' },
    { label: 'Create', labelKey: 'production.routings.create.title' },
  ],
} as const
