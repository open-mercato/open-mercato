import type { RouteVisibilityContext } from '@open-mercato/shared/modules/registry'
import { isProductionEnabledForTenant } from '../../../../lib/productionToggle'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['production.technology.manage'],
  visible: (ctx: RouteVisibilityContext) => isProductionEnabledForTenant(ctx.auth?.tenantId ?? null),
  pageTitle: 'Create BOM',
  pageTitleKey: 'production.boms.create.title',
  pageGroup: 'Production',
  pageGroupKey: 'production.nav.group',
  pageOrder: 31,
  breadcrumb: [
    { label: 'Production', labelKey: 'production.nav.title' },
    { label: 'Bills of Materials', labelKey: 'production.boms.title' },
    { label: 'Create', labelKey: 'production.boms.create.title' },
  ],
} as const
