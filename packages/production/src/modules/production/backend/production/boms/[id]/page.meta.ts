import type { RouteVisibilityContext } from '@open-mercato/shared/modules/registry'
import { isProductionEnabledForTenant } from '../../../../lib/productionToggle'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['production.technology.manage'],
  visible: (ctx: RouteVisibilityContext) => isProductionEnabledForTenant(ctx.auth?.tenantId ?? null),
  pageTitle: 'Edit BOM',
  pageTitleKey: 'production.boms.edit.title',
  pageGroup: 'Production',
  pageGroupKey: 'production.nav.group',
  breadcrumb: [
    { label: 'Production', labelKey: 'production.nav.title' },
    { label: 'Bills of Materials', labelKey: 'production.boms.title' },
    { label: 'Edit', labelKey: 'production.boms.edit.title' },
  ],
} as const
