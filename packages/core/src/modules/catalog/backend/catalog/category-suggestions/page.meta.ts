import type { RouteVisibilityContext } from '@open-mercato/shared/modules/registry'
import { isAiCategorizationEffectiveForTenant } from '../../../lib/aiCategorization/isEffectiveForTenant'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['catalog.ai_categorization.use'],
  visible: (ctx: RouteVisibilityContext) => isAiCategorizationEffectiveForTenant(ctx.auth?.tenantId ?? null),
  pageTitle: 'AI category suggestions',
  pageTitleKey: 'catalog.categorySuggestions.page.title',
  pageGroup: 'Catalog',
  pageGroupKey: 'catalog.nav.group',
  pagePriority: 30,
  pageOrder: 110,
  icon: 'sparkles',
  breadcrumb: [{ label: 'AI category suggestions', labelKey: 'catalog.categorySuggestions.page.title' }],
}
