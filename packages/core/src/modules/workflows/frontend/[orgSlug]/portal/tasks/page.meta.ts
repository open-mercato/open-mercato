import type { PageMetadata } from '@open-mercato/shared/modules/registry'

/**
 * The ONLY enforcement point for this page.
 *
 * The `(frontend)` catch-all reads this file to guard the route; a portal page
 * without a sibling `page.meta.ts` is not "unguarded by default", it is
 * SILENTLY PUBLIC. The `nav` block is what lists the page in the portal sidebar,
 * RBAC-filtered by the same feature — so granting `portal.tasks.view` is all it
 * takes for the entry to appear, with no menu-injection widget.
 */
export const metadata: PageMetadata = {
  requireCustomerAuth: true,
  requireCustomerFeatures: ['portal.tasks.view'],
  titleKey: 'workflows.portal.tasks.title',
  title: 'Tasks',
  nav: {
    label: 'Tasks',
    labelKey: 'workflows.portal.tasks.nav',
    group: 'main',
    order: 40,
  },
}

export default metadata
